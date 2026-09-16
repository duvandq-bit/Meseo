# FASE B2.2 — Validación previa a la implementación

**Nada implementado. Ningún cambio de esquema, de RLS, de Auth, de `sesion`, de la
aplicación ni de datos. Nada publicado.** Este documento valida
`fase-b2.1-diseno-corregido.md`; no lo sustituye. Donde una medición contradice a
B2.1, se corrige B2.1 y se dice cuál era el error.

Las sondas de la parte 1 son **HTTP real contra PostgREST de producción**,
lanzadas con `pg_net` desde dentro de Postgres (el entorno de esta sesión no puede
salir a `*.supabase.co` por el proxy). **Ninguna pudo escribir**, por construcción:
las que insertan duplican una clave que ya existe, las que borran apuntan a un id
inexistente, y las inválidas violan `NOT NULL`, `CHECK` o una columna que no
existe. Recuento antes y después, idéntico:

```
scores 427 · actividad 5 · chat_messages 15 · horarios 7 · ai_usage 20
```

---

## 1 · PostgREST real

### 1.1 · La tabla

| Caso | HTTP | `code` | `message` / detalle relevante | Clasificación B2.1 | Veredicto |
|---|---|---|---|---|---|
| **INSERT válido → 201 con fila** | — | — | — | fuera (`confirmado`) | **NO EJECUTADO** — escribiría una fila permanente (§1.4) |
| **2xx con cuerpo `[]`** (trigger `admin_sin_marcas` anula) | **201** | — | cuerpo literal `[]` | cuarentena | **CONFIRMADO** |
| **23505 — PK de `scores`** | **409** | `23505` | `duplicate key value violates unique constraint "scores_pkey"` · **`details` = null** | 409 + `23505` + índice → duplicado idempotente | **CONFIRMADO con corrección** (§1.2-a) |
| **23505 — índice único PARCIAL compuesto** *(SQL, tabla temporal)* | — | `23505` | `…unique constraint "scores_evt_uk_simulado"` · detalle `Key (auth_user_id, evento_id)=(…) already exists.` | ídem | **CONFIRMADO** en Postgres; el tramo HTTP, por composición (§1.3) |
| **23503 — clave ajena** | **409** | `23503` | `insert or update on table "chat_messages" violates foreign key constraint "chat_messages_employee_fkey"` · `details` = `Key is not present in table "employees".` | 409 que no es el duplicado esperado → cuarentena | **CONFIRMADO** |
| **42501 — privilegio de tabla** (`DELETE` sobre `scores`) | **401** | `42501` | `permission denied for table scores` | 401/403 + `42501` → cuarentena | **CONFIRMADO** |
| **42501 — privilegio de tabla** (`DELETE` sobre `employees`) | **401** | `42501` | `permission denied for table employees` | ídem | **CONFIRMADO** |
| **42501 — política RLS** (`INSERT` en `horarios`) | **401** | `42501` | `new row violates row-level security policy for table "horarios"` | no contemplado como mensaje distinto | **CONFIRMADO — hallazgo nuevo** (§1.2-d) |
| **23502 — `NOT NULL`** (`scores` sin `employee`) | **400** | `23502` | `null value in column "employee" of relation "scores" violates not-null constraint` | 400 + `23502` → `revisar` + apagar `B2_ENVIO` | **CONFIRMADO** |
| **23514 — `CHECK`** (`actividad` con `total = 0`) | **400** | `23514` | `new row for relation "actividad" violates check constraint "actividad_total_ck"` | 400 + `23514` → cuarentena | **CONFIRMADO** |
| **PGRST204 — columna inexistente** (`evento_id`) | **400** | `PGRST204` | `Could not find the 'evento_id' column of 'scores' in the schema cache` | 400 + `PGRST204` → `revisar` + apagar | **CONFIRMADO** |
| **JWT malformado** | **401** | **`PGRST301`** | `Expected 3 parts in JWT; got 4` | B2.1: `PGRST301` = **caducado** → renovar y reintentar | **REFUTADO** (§1.2-b) |
| **Sin `apikey` ni `Authorization`** | **401** | *(ninguno)* | `No API key found in request` + `hint` | no contemplado | **CONFIRMADO — hallazgo nuevo** (§1.2-c) |
| **JWT válido pero caducado** | — | — | — | — | **NO EJECUTABLE** (§1.4) |
| **42501 con rol `authenticated`** (¿403?) | — | — | — | — | **NO EJECUTABLE** (§1.4) |
| **5xx / timeout** | — | — | — | reintentable con backoff | **NO PROVOCABLE** sin romper producción (§1.4) |

### 1.2 · Las cuatro correcciones que la medición obliga

**(a) `details` viene `null` en un `23505`.** Esperaba `Key (auth_user_id,
evento_id)=(…) already exists.` y no llega: PostgREST lo omite —razonable, porque
filtraría valores de clave—, mientras que **en un `23503` sí lo manda**. Postgres
lo genera en los dos casos (lo he visto en la prueba de tabla temporal); es
PostgREST quien lo recorta sólo para el único.

> **Consecuencia:** el nombre del índice vive **únicamente en `message`**. La
> comprobación de idempotencia es `code === '23505' && message.includes(INDICE)`, y
> `details` no puede entrar en la decisión.

**(b) `PGRST301` NO significa «caducado».** Un token sintácticamente roto devuelve
exactamente el mismo `code` que —según la documentación— devuelve uno caducado.
`PGRST301` significa *«esta credencial no me sirve»*, sin decir por qué.

> **Consecuencia, y es la corrección de fondo de B2.2:** el cliente **no puede
> preguntarle al servidor si su token ha caducado**. Tiene que saberlo él, que para
> eso lo tiene: `snapshot.exp`. La regla pasa a ser:
>
> - `401 + PGRST301` **y** `exp` ya pasado → caducidad: renovar y reintentar sin
>   contar el intento.
> - `401 + PGRST301` **y** `exp` en el futuro → la credencial no vale por otra
>   razón (rota, falsificada, firmada con otra clave): **un** intento de renovación
>   y, si vuelve igual, `revisar`.
>
> Sin esta distinción, un token manipulado en `localStorage` entraría en el camino
> «renovar y reintentar» indefinidamente. El backoff acotado de B2.1 lo frenaba a
> los diez intentos; ahora se corta al segundo.

**(c) Un 401 puede llegar sin `code`.** La respuesta a una petición sin `apikey`
no trae campo `code`: sólo `message` y `hint`. El clasificador necesita un
comportamiento por defecto para «401 sin código», y el correcto es el
conservador: **`revisar`**, nunca reintento indefinido.

**(d) `42501` tiene dos mensajes distintos** —`permission denied for table X`
(falta el `GRANT`) y `new row violates row-level security policy for table "X"`
(lo para la política)— y los dos llegan como **401**. La acción es la misma
(cuarentena), así que no cambia el comportamiento, pero sí cambia el diagnóstico:
al aplicar la fase C hay que saber cuál de los dos muros ha parado una petición.

### 1.3 · Lo que las dos mitades demuestran juntas

La pregunta original (R2) era: *¿un `INSERT` duplicado contra un índice único
**parcial** devuelve `23505`, y llega al cliente como 409 con el nombre del
índice?* No hay forma de probarlo de una sola vez sin crear el índice en
producción. Se prueba en dos tramos:

| Tramo | Cómo | Resultado |
|---|---|---|
| **Postgres → `23505` con el nombre del índice parcial** | tabla **temporal** con `unique index … (auth_user_id, evento_id) where evento_id is not null` | `sqlstate 23505`, `message` = `duplicate key value violates unique constraint "scores_evt_uk_simulado"` |
| **`23505` → 409 con `message` íntegro** | HTTP real contra `scores` | 409, `message` = `…unique constraint "scores_pkey"` |

La prueba temporal confirmó además las tres propiedades de las que depende el
diseño, y ninguna es teórica ya:

- **Ana reintenta su `evento_id`** → `23505`. Idempotencia.
- **«Bruno» inserta el MISMO `evento_id`** → entra sin tocar la fila de Ana.
  Cuatro filas conviviendo. Confirma que `UNIQUE(auth_user_id, evento_id)` no
  permite que nadie queme el identificador de otro.
- **Dos filas con `evento_id IS NULL` conviven.** El índice parcial deja intacto
  el histórico: las 427 de `scores` y las 5 de `actividad` no colisionan.

### 1.4 · Lo que queda pendiente, y por qué exactamente

| Pendiente | Por qué no se hizo | Qué lo resolvería | ¿Bloquea? |
|---|---|---|---|
| **INSERT válido → 201 con fila** | Escribiría una fila permanente en `scores` o `actividad`. «No cambies datos» | Tu autorización para una fila de prueba que yo borre después; o `Prefer: tx=rollback`, que Supabase no habilita por defecto | **No.** Es el único camino que producción ejerce 427 veces, y tu propio snippet ya devolvió `200 [{…}]` con `return=representation` |
| **JWT válido pero caducado → `PGRST301`** | No hay secreto JWT accesible desde la base (`app.settings.jwt_secret` es nulo, `pgjwt` no instalado): **no puedo firmar un token**, ni caducado ni de ningún tipo | En el navegador: entrar, guardar el `access_token`, esperar a que pase su `exp` (1 h) y reutilizarlo | **No, y ha dejado de importar.** Tras §1.2-b el cliente decide la caducidad por su `exp`, así que los dos casos de `PGRST301` acaban en el mismo camino |
| **`42501` con rol `authenticated` → ¿403?** | Mismo motivo: no puedo emitir un token con `role: authenticated` | Un token real de un empleado, desde el navegador | **No.** 401 y 403 con `42501` tienen la misma acción: cuarentena. El contrato de la fase C se escribe como «**401 o 403** con `code 42501`» |
| **5xx y timeout reales** | Provocarlos exige degradar producción | Observable en el cliente: `fetch` que rechaza (`TypeError`), `AbortError` por `AbortController`, o `status >= 500`. Lo que el cliente **no** puede saber es si un timeout dejó la fila escrita — y para eso está el `evento_id` | **No.** Es precisamente el caso que la idempotencia resuelve |

### 1.5 · Tabla de clasificación corregida (sustituye a B2.1 §8)

```
si (no hubo respuesta: red, AbortError, timeout)      → pendiente + backoff
si (status >= 500 || status === 408 || status === 429) → pendiente + backoff
si (cuerpo ilegible)                                   → pendiente + backoff
si (status === 201 && filas.length > 0)                → CONFIRMADO, fuera
si (status 2xx && filas.length === 0)                  → CUARENTENA 'sin-fila'
si (status === 409)
     code==='23505' && message.includes(INDICE_EVENTOS) → DUPLICADO, fuera
     en cualquier otro caso                             → CUARENTENA 'conflicto'
si (status === 401 || status === 403)
     code === '42501'                                   → CUARENTENA 'sin-autorizacion'
     code === 'PGRST301' && snapshot.exp <= ahora       → RENOVAR y reintentar (no cuenta)
     code === 'PGRST301' && snapshot.exp  > ahora       → 1 renovación; si repite → REVISAR
     sin code, o cualquier otro                         → REVISAR
si (status === 400)
     code === 'PGRST204' || code === '23502'            → REVISAR + apagar B2_ENVIO
     en cualquier otro caso                             → CUARENTENA 'datos-invalidos'
en cualquier otro caso                                  → REVISAR
```

**`INDICE_EVENTOS`** es una constante compartida entre el SQL y el cliente
(`scores_evt_uk` / `actividad_evt_uk`). Si cambia el nombre del índice sin cambiar
la constante, la idempotencia deja de reconocerse y los reintentos acaban en
cuarentena — ruidoso, no silencioso, que es el fallo correcto.

Lo que la medición ha demostrado de forma definitiva: **clasificar por estado HTTP
es imposible.** 409 es `23505` *y* `23503`. 401 es `42501` *y* `PGRST301` *y*
«sin código». 400 es `23502`, `23514` *y* `PGRST204`, con acciones distintas. Los
hallazgos A3 y A4 de la auditoría no eran teóricos.

---

## 2 · Hardware real iOS / WebKit

### 2.1 · No he podido ejecutar esta prueba

**No tengo un dispositivo iOS.** Esta sesión corre en un contenedor Linux con
Chromium. Cualquier cifra de iOS que escribiera aquí sería una extrapolación
disfrazada de medición, que es exactamente lo que este documento existe para
evitar.

Y hay un límite que ninguna herramienta mía salva: **la cuota de `localStorage` es
por origen**. El tamaño real de `txoko_data_v4` sólo puede leerse desde `meseo.es`.
Sin un Mac con Web Inspector, o sin añadir un diagnóstico temporal a la aplicación
—que no está autorizado—, ese dato concreto no es accesible. El resto (techo,
comportamiento de `setItem`, persistencia, capacidades) **sí es política del
navegador y se mide desde cualquier origen**.

### 2.2 · El instrumento

Página de medición, para abrir en el iPad:

**https://claude.ai/artifact/1JwUYr6qV7GkPqZNz595CH**

No toca Meseo: escribe y borra sus propias claves, en su propio origen. Un botón,
unos segundos, y un «Copiar resultados» para mandarme el bloque.

**Para que responda a todo, hay que abrirla tres veces:**

1. **En una pestaña de Safari** → línea «pestaña del navegador».
2. **Añadida a la pantalla de inicio** (Compartir › Añadir a inicio) y abierta
   desde ahí → línea «PWA instalada». Es la comparación que decide si el desalojo
   de siete días nos afecta.
3. **En modo avión**, para confirmar que sin red no cambia nada.

Y una cuarta vez **dentro de unos días** para la sección 6: la página deja un sello
con fecha y lee el anterior. Si el sello sobrevive una semana en la PWA instalada,
el «offline prolongado» de B2.1 §12 tiene respaldo. Si desaparece, no lo tiene, y
hay que rediseñar esa parte.

### 2.3 · La tabla, hoy

| Medición | Safari pestaña | PWA instalada | Resultado | Confianza | Pendiente |
|---|---|---|---|---|---|
| Cuota `storage.estimate()` | — | — | — | — | **sí** — la sonda la lee |
| Techo real de `localStorage` | — | — | — | — | **sí** |
| `setItem` al acercarse al límite (nombre del error, escritura parcial) | — | — | — | — | **sí** |
| Persistencia al cerrar y reabrir la PWA | — | — | — | — | **sí** |
| Persistencia sin red | — | — | — | — | **sí** |
| Persistencia tras reiniciar el aparato | — | — | — | — | **sí** |
| Persistencia a los varios días | — | — | — | — | **sí, y es longitudinal**: exige volver a abrirla |
| `navigator.storage.persist()` | — | — | — | — | **sí** |
| Diferencia pestaña vs PWA | — | — | — | — | **sí** |
| `crypto.randomUUID` (iOS ≥ 15.4) | — | — | — | — | **sí** |
| `navigator.locks` (iOS ≥ 15.4) | — | — | — | — | **sí** |
| Tamaño real de `txoko_data_v4` | — | — | — | — | **sí, y NO lo resuelve la sonda**: es otro origen |
| Coste de encolar a 50…2 000 | — | — | — | — | **sí** |

**Lo medido en Chromium de escritorio sigue siendo Chromium de escritorio:**
techo 5 100 KB, `txoko_data_v4` con 22 fichas 258,2 KB, evento 263-357 B, 500
eventos 174,8 KB, y la curva de encolado 0,25 / 1,57 / 3,27 / 5,75 / 10,21 ms. **No
lo convierto en un hecho de iOS.** `LIMITE_DURO = 1 000` y la extrapolación ×4
siguen siendo estimaciones y así quedan marcadas en B2.1 §9.

---

## 3 · Decisión sobre los eventos sin identidad

### 3.1 · Queda adoptada la regla conservadora

Sin cambios respecto a lo que has escrito. No he encontrado ninguna razón técnica
para modificarla; sí una consecuencia que conviene nombrar (§3.4).

| Situación al ocurrir el hecho | Destino | Enviable |
|---|---|---|
| `authContext` válido (`uid` + token) | cola normal, `pendiente` | sí |
| JWT persistido pero **caducado** | cola normal, con su `uid` real, `pendiente` | **no hasta renovar**; conserva dueño |
| **Ningún JWT persistido** | `txk_eventos_sin_identidad` | **nunca** |

Prohibiciones, todas absolutas: no se adopta automáticamente por quien aparezca en
el dispositivo; no se envía con `uid:null`; no se envía con el token del siguiente
usuario; para recuperarlo hace falta una acción humana explícita y autenticada.

**Y como esa acción no está diseñada todavía, la única disponible es repetir la
prueba.** Esto **cierra el bloqueo D6 de B2.1**: el mecanismo de reclamación —que
yo había dejado abierto porque rozaba tu prohibición de comparar nombres— queda
**fuera de B2**, no como decisión pendiente sino como decisión tomada. B2.1 §3.4
se recorta a la opción conservadora.

### 3.2 · El caso obligatorio, paso a paso

> **Ana sin red y sin JWT → evaluación → Bruno entra → Bruno con red.**

| # | Qué ocurre | Estado del sistema |
|---|---|---|
| 1 | Ana abre el iPad sin cobertura. No hay JWT: el almacén `meseo-auth` está vacío porque nadie marcó «recordarme» en ese aparato | `authContext = {uid:null, token:null, estado:'anonimo'}` |
| 2 | Entra tecleando su PIN. El login antiguo lo acepta contra la ficha local (`index.html:33640`). `_authSesionEnSegundoPlano` devuelve `sin-red` y **no reintenta** | `authContext` sigue vacío. **La app sabe que no sabe quién es** |
| 3 | Ana hace un simulacro de alérgenos | `_eventoCrear` ve `snapshot.uid === null` |
| 4 | El evento se escribe **síncronamente** en `txk_eventos_sin_identidad`, con `nombre_tecleado:'Ana'` y `ts` | `txk_eventos_v1` **sigue sin esa entrada** |
| 5 | Se le dice a Ana, en la propia pantalla de resultados: *«esta prueba no se ha podido asociar a nadie y no se enviará»* | visible en el acto, no al volver la red |
| 6 | Ana se va. Bruno entra con cobertura. `sesion` responde, `setSession`, snapshot nuevo | `authContext = {uid: Bruno, token: …}` |
| 7 | Se dispara el drenaje a los 4 s, y otra vez a los 120 s | `_eventosDrenar()` lee **`txk_eventos_v1`**. **Ni abre la otra clave** |
| 8 | Bruno ve el aviso: *«1 prueba sin identificar en este dispositivo»*, sin decir de quién | el nombre de quién tiene cosas pendientes no es asunto suyo |

**Los cinco resultados exigidos:**

| Exigencia | ¿Se cumple? | Qué lo garantiza |
|---|---|---|
| El evento de Ana **jamás** se atribuye a Bruno | **sí** | No se envía. Y si se enviara, `auth_user_id` lo pondría el servidor desde `auth.uid()` |
| **Jamás** se envía con Bruno | **sí** | El drenaje no lee esa clave. **No es una comprobación que se pueda olvidar: es una ruta de código que no existe** |
| **No** aparece en la cola normal | **sí** | Almacén distinto desde el instante de la creación |
| **No** se pierde en silencio | **sí** | Persistido de forma síncrona, contado en `txk_eventos_registro`, y mostrado |
| Queda **visible** como pendiente de recuperar o repetir | **sí** | Aviso en el resultado y en la superficie de §6.5 |

### 3.3 · Las invariantes de B2.1, revisadas

| Invariante | ¿La mantiene la regla? |
|---|---|
| **C** · un `uid:null` nunca viaja al endpoint de B2 | **sí, y reforzada**: antes por comprobación, ahora por separación de almacén |
| **D** · un evento de Ana nunca sale con el token de Bruno | **sí**: para los que tienen dueño, las tres comprobaciones de B2.1 §3.5; para los que no, no hay ruta de envío |
| El servidor es la única autoridad de identidad | **sí**: no cambia |
| Nunca una pérdida silenciosa | **sí**, con una precisión honesta: el hecho **no llega a la nube**, y eso es pérdida de información — pero **es visible, contada y con una acción ofrecida**. La regla no dice «no se pierde»; dice «no se pierde en silencio» |
| Sin heurísticas de identidad | **sí, y ahora completa**: sin mecanismo de reclamación, no queda ninguna comparación textual en ningún sitio |

### 3.4 · Una consecuencia que hay que nombrar

La regla que acabas de fijar para B2 es **más estricta que lo que hace B1 hoy**.
`_outboxFlush` (`index.html:3395`) dice:

```js
if(e.uid != null && e.uid !== _authUid) continue;   // las de uid NULO sí se intentan
```

Es decir: **una entrada de ficha sin identidad se envía con el token de quien esté
dentro.** Es deliberado y está justificado en B1 (son las entradas heredadas del
formato 1, y mientras `anon` siga abierto el camino funciona igual que antes), y el
daño posible es menor porque el upsert de ficha va por nombre y es monótono. Pero
**la regla de B2 y la de B1 no son la misma**, y conviene que sea una decisión
consciente y no un descuido: al aplicar la fase D, esas entradas pasarán a
cuarentena por sí solas, que es lo que B1 ya previó.

No propongo cambiarlo ahora. Lo dejo anotado.

---

## 4 · Contrato que la fase C debe entregar para desbloquear B2

**B2 NO SE IMPLEMENTA** hasta que todo lo siguiente esté aplicado **y verificado
con la sonda correspondiente**. No implemento nada de esto aquí.

### 4.1 · Las ocho garantías, con su prueba de aceptación

Las respuestas esperadas están escritas con los códigos **medidos hoy**, no con los
que dice la documentación.

| # | Garantía | Mecanismo exigido | Prueba de aceptación | Respuesta esperada |
|---|---|---|---|---|
| **G1** | `auth_user_id = auth.uid()` siempre | `alter … add column auth_user_id uuid default auth.uid()` | INSERT normal autenticado | 201, y la fila tiene el `uid` del token |
| **G2** | El cliente no puede insertar `auth_user_id` | `revoke insert (auth_user_id) … from anon, authenticated` | INSERT con `auth_user_id` de otro | **401 o 403** + `code 42501` |
| **G3** | El cliente no puede elegir `employee` | `revoke insert (employee)` + `default app.mi_nombre()` | INSERT con `employee:'Ana'` desde el token de Bruno | **401 o 403** + `code 42501` |
| **G4** | El cliente no puede elegir `venue` | `revoke insert (venue)` + `default app.mi_venue()` | INSERT con `venue:'mb'` | **401 o 403** + `code 42501` |
| **G5** | `employee` y `venue` se derivan del servidor | `app.mi_nombre()` / `app.mi_venue()`, `security definer`, `search_path` fijo | INSERT sin esos campos | 201 con el nombre y el restaurante correctos |
| **G6** | **Token de Bruno + `employee:'Ana'` + `venue:'mb'` NO puede resultar en 201** | G2 + G3 + G4 a la vez | ese INSERT exacto | **401 o 403** + `42501`. **Un 201 aquí invalida la fase C entera** |
| **G7** | `evento_id` ligado a la identidad | `unique (auth_user_id, evento_id) where evento_id is not null` + `check (evento_id is null or auth_user_id is not null)` | reintento del mismo evento | **409** + `23505` + nombre del índice en `message` |
| **G8** | La política no es la única defensa | `with check (auth_user_id = auth.uid())` **además** de los `revoke` | — | — |

### 4.2 · Por qué G6 necesita los `revoke` y no le basta la política

Es el punto que la auditoría destapó y merece quedar escrito sin ambigüedad.

Con **sólo** `create policy … with check (auth_user_id = auth.uid())`, el ataque
G6 **produce un 201**: Bruno manda su propio token, así que `auth_user_id` acaba
siendo Bruno y la política está satisfecha. `employee` y `venue` son columnas que
la política **no mira**, y llegan del cuerpo. La fila resultante es
`(auth_user_id = Bruno, employee = 'Ana', venue = 'mb')` — válida para el servidor
y **leída como de Ana por todos los consumidores**, porque `_supCargarHistorial`,
el ranking y la gráfica semanal se relacionan por `employee`, no por
`auth_user_id`.

Un `DEFAULT` tampoco basta por sí solo: un `DEFAULT` sólo actúa **cuando la
columna no viene en el `INSERT`**. Mandarla lo anula.

**Lo único que convierte G6 en un 42501 es `revoke insert (employee, venue,
auth_user_id)`.** Es la línea que sostiene el diseño entero, y por eso su prueba de
aceptación es la que puede invalidar la fase C.

### 4.3 · Qué pasa si B2 se ejecuta antes

Ya no es una hipótesis: está medido.

| Falta | Respuesta real | Acción B2.1 |
|---|---|---|
| La columna `evento_id` | **400 `PGRST204`** — `Could not find the 'evento_id' column of 'scores' in the schema cache` | `revisar` + **apagar `B2_ENVIO`** al primero |
| El `DEFAULT` de `employee` | **400 `23502`** — `null value in column "employee"…` | `revisar` + apagar |
| **El `revoke`** | **201** — indistinguible del éxito | **No detectable desde el cliente.** Sólo la prueba G6 lo ve |

El interruptor `B2_ENVIO = false` se mantiene: B2 se publica creando y persistiendo
eventos pero **sin enviar**, y se activa únicamente cuando G1–G8 estén verificadas.

---

## 5 · Matriz de invariantes actualizada

| Entrada | Comportamiento esperado | Protección | Prueba que ya existe | Prueba pendiente |
|---|---|---|---|---|
| **JWT válido** | 201, fila propia | `auth.uid()` + `DEFAULT` | 427 filas en producción | G1, G5 |
| **JWT caducado** | `uid` conservado; no se envía; renovar | `snapshot.exp` decide, no el servidor (§1.2-b) | — | navegador: token real pasado su `exp` |
| **Ningún JWT** | `sin_identidad`, otra clave, nunca se envía | separación de almacén | — | smoke: la clave de envío queda vacía |
| **Cambio de usuario durante un `await`** | aborta el drenaje entero | `_authCtx() !== s` | — | smoke con mutación |
| **Logout durante el POST** | la petición en vuelo sigue; el resto `retenido` | snapshot congelado | — | smoke |
| **Refresh durante el POST** | el token viejo vale hasta su `exp`; mismo `sub` | GoTrue | — | navegador |
| **Bruno reutiliza el `evento_id` de Ana** | fila **de Bruno**; la de Ana intacta | `UNIQUE(auth_user_id, evento_id)` | **SÍ — tabla temporal, 4 filas conviviendo** | G7 sobre el índice real |
| **Bruno falsifica `employee`** | **401/403 + 42501** | `revoke insert (employee)` | — | **G3 y G6 — bloqueante** |
| **Bruno falsifica `venue`** | ídem | `revoke insert (venue)` | — | **G4 y G6 — bloqueante** |
| **`23505` real** | 409 + `code` + índice en `message`; `details` **null** | índice único | **SÍ — HTTP real** | G7 |
| **`23503` real** | **409** + `23503` → cuarentena | clasificador | **SÍ — HTTP real** | — |
| **`42501` real** | **401** + `42501` → cuarentena | clasificador | **SÍ — HTTP real, dos variantes** | la variante 403 con `authenticated` |
| **`PGRST301` real** | 401 + `PGRST301`; **no implica caducidad** | `exp` local + una sola renovación | **SÍ — JWT malformado** | la variante «caducado» (ya no cambia nada) |
| **`setItem` con la cuota agotada** | `bloqueado_por_cuota`, visible, nunca falso éxito | el retorno de `_eventosGuardar` | — | smoke con `setItem` que lanza, **y la sonda en el iPad** |
| **Rollback de versión** | eventos intactos | clave propia `txk_eventos_v1` | — | smoke: `_colaCargar` de v7.452 no la toca |
| **Dos pestañas** | ninguna anotación perdida; peor caso duplicar | `navigator.locks` | — | smoke + **disponibilidad real en iPad** |
| **PWA cerrada y reabierta** | la cola sobrevive | persistencia síncrona | — | **sonda, sección 6** |
| **Evaluación con la cola > 400** | entra; se descartan sólo las prácticas | umbral `UMBRAL_P3` | — | smoke |
| **Evaluación con la cola > 500** | **entra**, con aviso persistente | 500 es umbral, no tope | — | smoke con mutación (rechazarla debe romper el test) |
| **Fallo físico de almacenamiento** | `no_persistido` visible; nunca «guardado» | el retorno manda | — | smoke + sonda |

---

## 6 · Veredicto

## NECESITA OTRA REVISIÓN

Quedan **dos** bloqueos. El bloqueo 1 (PostgREST) y el bloqueo 3 (eventos sin
identidad) están cerrados: el primero por medición contra producción, el segundo
por tu decisión.

**Bloqueo A — no hay ni una medición en el hardware real.**
`LIMITE_DURO = 1 000`, la penalización ×4 y el techo de 5 MB son Chromium de
escritorio. Y sobre todo: **si WebKit desaloja el almacenamiento a los siete días**
en el modo en que realmente usáis la aplicación, una cola pensada para sobrevivir
semanas sin red no tiene respaldo, y eso es rediseño, no ajuste.

*La prueba que lo resuelve:* abrir **https://claude.ai/artifact/1JwUYr6qV7GkPqZNz595CH**
en el iPad, tres veces —pestaña de Safari, añadida a la pantalla de inicio, y en
modo avión—, pulsar «Medir ahora» y mandarme el bloque de «Copiar resultados».
Unos minutos. Y volver a abrirla dentro de unos días para la sección 6, que es la
única parte irreductiblemente longitudinal.

**Bloqueo B — la fase C no existe.**
B2 ya no es independiente: sin `revoke insert (employee, venue, auth_user_id)`, el
escenario que prohibiste —token de Bruno con `employee:'Ana'` y `venue:'mb'`—
**devuelve 201**, y la política `with check` no lo impide, porque `auth_user_id`
sería legítimamente Bruno y `employee` es una columna que la política no mira.

*La prueba que lo resuelve:* aplicar la fase C y pasar **G6** — ese `INSERT` exacto
debe devolver **401 o 403 con `code 42501`**. Es la única de las ocho garantías que
el cliente no puede detectar por su cuenta: desde fuera, un `revoke` ausente se ve
igual que un éxito.

**No he implementado nada, no he modificado esquema, RLS, Auth, `sesion`, la
aplicación ni datos, y no he publicado nada.**
