# FASE B2 — Diseño de la cola de eventos para `scores` y `actividad`

**Diseño. No se ha cambiado código, ni SQL, ni esquema; no se ha desplegado nada
ni se ha tocado producción.** Todas las consultas de la investigación son de
lectura.

B1 queda cerrada en la etiqueta `b1-cerrada` (`af9fd7e`, v7.452, sin publicar).

---

## 1 · Qué hay hoy, medido

### 1.1 · Los escritores de `scores` — tres, y ninguno sabe si escribió

| Función | Línea | Qué escribe | Quién la llama |
|---|---|---|---|
| `supaInsertScore(session, employee)` | 2833 | examen: `score, total, topic, cat, time_sec` | examen general (21897) y simulacro de alérgenos (25131) |
| `supaInsertTxokoRecord(employee, record)` | 2883 | récord del juego Txoko: `topic:'txoko'` | 32677 |
| `supaInsertEtRecord(employee, secs, orders)` | 2942 | récord de El Turno: `topic:'elturno'` | 32289 |

Las tres comparten tres defectos:

1. **`Prefer: return=minimal`** — no pueden distinguir insertado de rechazado.
2. **Ninguna mira `res.ok`** — un 400 o un 403 pasa inadvertido.
3. **Las tres tragan el error con `catch(e) {}`**, así que **nunca rechazan**.

Consecuencia del tercero, y es un hallazgo: el `.catch()` de las líneas 21897 y
25131 enseña un aviso con botón **«Reintentar»**… y **nunca se ejecuta**. Ese
aviso no lo ha visto nadie. La aplicación cree tener un reintento manual para las
puntuaciones y no lo tiene.

### 1.2 · El escritor de `actividad` — uno, con quince puertas

`registrarActividad(a)` (línea 2370), llamada desde **quince** sitios: recorrido,
repaso, reto del día, examen de sala, quiz de vinos, maridaje, examen general,
simulacro de alérgenos, examen LQA, situaciones LQA, auditor LQA, servicio
fantasma, survivors, Mr. Shoesmith y el examen de carta.

Su `catch` dice *«Se reintentará cuando vuelva la conexión»*. **No existe tal
reintento.** Lo comprobé: ninguna función vuelve a llamarla.

### 1.3 · Qué es online y qué puede ocurrir sin red

**Todo puede ocurrir sin red.** Es una PWA con el armazón cacheado por el service
worker: se entra, se estudia, se hacen exámenes y se juega sin cobertura. No hay
ninguna escritura que sea intrínsecamente «sólo online».

### 1.4 · Dónde se pierde hoy una escritura, exactamente

| Qué ocurre | `scores` | `actividad` | `employees.sessions_data` |
|---|---|---|---|
| Examen terminado sin red | **se pierde** | **se pierde** | **sobrevive** |
| Récord de juego sin red | **se pierde** | **se pierde** | sobrevive (`txoko_record`) |
| Actividad de práctica sin red | — | **se pierde** | parcialmente (el diario local) |

**Y aquí está el dato que cambia el diseño:** un examen deja **tres** rastros —una
fila en `scores`, una en `actividad` y una entrada en `emp.sessions`— y el
tercero **ya tiene durabilidad offline**, porque viaja en el snapshot de
`employees` que la cola de B1 protege.

El objeto de sesión es `{score, total, topic, cat, time, date, ts}` (línea 21886),
que es **casi exactamente una fila de `scores`**, con `ts` en milisegundos. Se
conservan las últimas 20 en la nube y 50 en local.

O sea: **la recuperación parcial ya existe**. B2 no parte de cero.

### 1.5 · Relación con las 18 identidades

| | Filas | |
|---|---|---|
| `scores` de empleados **con** identidad Auth | **347** | podrán llevar `auth_user_id` |
| `scores` de empleados **sin** identidad (los 4 sin PIN) | **22** | se quedan sin identidad, para siempre |
| `scores` huérfanos (nombre que ya no existe) | **58** | ídem |
| **Total** | **427** | |

`actividad`: **5 filas**, de Duvan y Jenfry, todas `kind='practica'`, desde el 15
de septiembre.

> **Corrección a la premisa del encargo:** `actividad` **no tiene 0 filas**, tiene
> 5. La fase 1 está funcionando en producción. Implica que el diseño de B2 ya no
> puede tratarla como tabla virgen: tiene datos reales, aunque pocos.

### 1.6 · ¿Hay duplicados históricos?

**No. Cero.** Ni duplicados exactos (mismo empleado, puntuación, total, tema y
segundo) ni dos filas del mismo empleado y tema en el mismo minuto.

Y la explicación es incómoda: **no hay duplicados porque nada reintenta nunca**.
La ausencia de duplicados no es una virtud del diseño actual; es el síntoma del
mismo fallo que hace que se pierdan eventos. En cuanto B2 introduzca reintentos,
la idempotencia deja de ser opcional.

### 1.7 · Índices actuales

`scores`: `scores_pkey`, `scores_venue_idx`.
`actividad`: `actividad_pkey`, `actividad_venue_fecha_idx`,
`actividad_venue_empleado_idx`, `actividad_venue_competencia_idx`.

**Ninguna restricción de unicidad más allá de la clave primaria**, que es un
`uuid` generado por el servidor y por tanto inútil para deduplicar.

### 1.8 · Una distinción que el encargo no hace: no todo `scores` es un examen

De las 427 filas, **236 son `topic='txoko'`** y **18 `elturno`**: récords de
juego, no evaluaciones. Los exámenes reales son 173.

Importa porque un récord es **idempotente por naturaleza** (si se escribe dos
veces el récord no cambia el máximo, que vive en `employees.txoko_record`),
mientras que un examen duplicado **sí falsea una media**. Los dos pueden compartir
mecanismo, pero el riesgo de un duplicado no es el mismo.

---

## 2 · Qué campos debe llevar un evento

```
{
  v: 2,
  tipo: 'score' | 'actividad',
  evento_id: <uuid v4>,        ← nace con el HECHO, no con el envío
  uid: <auth.uid() de la sesión que lo creó>,
  ts: <Date.now() del hecho>,
  datos: { … }                 ← sin employee, sin venue: los pone el servidor
}
```

**Lo que NO va en `datos`:** `employee`, `venue`, `auth_user_id`. Los tres los
pone el servidor. Lo que el cliente no manda no se puede falsificar.

**Cuándo se genera el `evento_id`:** en el instante en que ocurre el hecho —al
terminar el examen, al batir el récord—, **antes** de intentar ningún envío, y se
guarda con el evento en `localStorage`. Un UUID v4 del cliente y no un hash del
contenido: dos exámenes idénticos el mismo día son **dos hechos distintos** y
deben contar dos veces.

---

## 3 · Opción A — `auth_user_id` y `evento_id` en las tablas

```sql
-- SIN EJECUTAR
alter table public.scores    add column evento_id uuid, add column auth_user_id uuid default auth.uid();
alter table public.actividad add column evento_id uuid, add column auth_user_id uuid default auth.uid();

create unique index concurrently scores_evt_uk
  on public.scores (auth_user_id, evento_id) where evento_id is not null;
create unique index concurrently actividad_evt_uk
  on public.actividad (auth_user_id, evento_id) where evento_id is not null;

-- Y la pieza sin la cual todo lo anterior es decorativo:
revoke insert (auth_user_id) on public.scores    from anon, authenticated;
revoke insert (auth_user_id) on public.actividad from anon, authenticated;
```

**Ese `revoke` es el corazón de la opción.** Si el cliente puede escribir
`auth_user_id`, el `DEFAULT` no sirve de nada: bastaría con mandar el ajeno. Al
quitarle el permiso **de columna**, el `DEFAULT auth.uid()` es la única fuente
posible. Lo mismo hará falta para `employee` y `venue` cuando se pongan sus
`DEFAULT`.

| Eje | Valoración |
|---|---|
| **Integridad** | La unicidad es una restricción de base de datos: la capa que no se puede rodear. `auth_user_id` lo pone el servidor a partir de un JWT firmado |
| **Migración** | Dos `alter table` y dos índices `concurrently`. **Ninguna fila existente se toca**: las 427 y las 5 quedan con `evento_id` nulo y el índice parcial las ignora |
| **Datos históricos** | Los 58 huérfanos y los 22 de empleados sin identidad conviven sin conflicto. `NULL` no colisiona consigo mismo |
| **Offline** | Encaja con la cola de B1 sin cambiarla: misma estructura, mismo sellado, mismo vaciado por identidad |
| **Idempotencia** | En el servidor, por `UNIQUE`. Un reintento da `23505` o, con `ignore-duplicates`, 0 filas — y las dos se tratan como «ya estaba» |
| **RLS futura** | Natural: `with check (auth_user_id = auth.uid())` es directo, y el `DEFAULT` ya lo garantiza |
| **Mezclar empleados** | **Imposible por construcción**: Ana no puede escribir en el espacio de ids de Bruno porque no puede escribir su `auth_user_id` |
| **Complejidad** | Baja. Ningún despliegue nuevo, ninguna latencia añadida, el cliente conserva la forma de la llamada |

**Riesgo propio:** los 4 empleados sin PIN nunca tendrán `auth.uid()`, así que sus
eventos futuros caerían con `auth_user_id` nulo y **dos de ellos podrían colisionar
en el índice**… no: `NULL` nunca colisiona en un índice único. Pero tampoco estarían
protegidos contra duplicados. Como esas cuatro personas no pueden entrar, no
generarán eventos. Queda anotado, no es un problema activo.

---

## 4 · Opción B — una Edge Function `registrar`

El cliente manda el evento a una Edge Function; ella deriva la identidad del JWT
del llamante, resuelve `employee` y `venue` desde `employees`, y hace el `insert`
con `service_role`, comprobando la idempotencia dentro.

| Eje | Valoración |
|---|---|
| **Integridad** | Igual de fuerte **sólo si** sigue existiendo el `UNIQUE` en la tabla. Si la unicidad se comprueba en JavaScript, dos peticiones simultáneas la saltan. Es decir: **B no ahorra el índice, lo añade a lo demás** |
| **Migración** | Requiere el mismo esquema que A **más** una función nueva desplegada |
| **Datos históricos** | Igual que A |
| **Offline** | Igual que A: la cola es del cliente en ambos casos |
| **Idempotencia** | Igual que A si se apoya en el `UNIQUE`; peor si se apoya en la función |
| **RLS futura** | **Se la salta**: `service_role` no pasa por las políticas. Eso quita una capa de defensa en vez de añadirla |
| **Mezclar empleados** | Depende de que la función esté bien escrita. En A depende de un `revoke`, que no tiene bugs |
| **Complejidad** | Alta: otro desplegable, otra superficie, otra latencia, otro CORS, otro limitador |

**Lo único que B aporta de verdad** es atomicidad si algún día hiciera falta
escribir `scores` y `employees` en la misma transacción. Hoy no hace falta: son
dos hechos distintos y la fusión de `employees` es monótona, así que un desajuste
temporal se corrige solo.

---

## 5 · Recomendación

**Opción A.** El argumento decisivo no es la simplicidad: es **dónde vive la
garantía**. En A, la identidad la impone un `revoke` de columna y la unicidad un
índice — dos cosas que no se pueden rodear ni tienen errores de programación. En
B, las dos dependen de que una función escrita a mano haga lo correcto, y además
esa función **se salta RLS por definición**, que es justo la capa que llevamos
tres fases construyendo.

B se quedaría como alternativa si apareciera una necesidad real de atomicidad
entre tablas. Hoy no existe.

### La arquitectura, en una vista

```
  hecho (examen, récord, práctica)
        │  evento_id = crypto.randomUUID()   ← aquí, no al enviar
        ▼
  cola de eventos  ──sellada con el uid de la sesión (igual que B1)
        │
        │  se salta lo que no es de esta sesión
        ▼
  POST /rest/v1/{scores|actividad}?select=id
       Prefer: resolution=ignore-duplicates,return=representation
       body: { evento_id, …datos }        ← sin employee, sin venue, sin auth_user_id
        │
        ▼
  servidor:  auth_user_id ← DEFAULT auth.uid()     (el cliente no puede escribirlo)
             employee, venue ← DEFAULT del servidor
             UNIQUE (auth_user_id, evento_id)      ← la idempotencia
        │
        ├─ 1 fila  → 'confirmado'   → desencolar
        ├─ 0 filas → 'ya estaba'    → desencolar   (con ignore-duplicates)
        ├─ 23505   → 'ya estaba'    → desencolar   (sin ella)
        ├─ 401     → 'reintentable' → esperar
        ├─ 403/42501 → 'permanente' → cuarentena
        └─ 5xx/red → 'reintentable' → esperar
```

### Respuestas a los casos que pediste

| Caso | Qué pasa |
|---|---|
| **Cambio de empleado antes de sincronizar** | El evento lleva el `uid` de Ana. Con Bruno dentro **no se intenta**, no se desencola y no se reasigna. Espera a que Ana vuelva a ese dispositivo. Idéntico a B1 |
| **Eventos antiguos sin identidad** | No existen: la cola de eventos **nace** en B2, así que toda entrada lleva `uid` desde el primer día. Es la ventaja de crearla ahora y no heredarla |
| **Evento de Ana enviado con el token de Bruno** | No puede salir (la cola lo salta). Si saliera manipulando `localStorage`, el servidor le pondría `auth_user_id` = Bruno y **quedaría registrado como de Bruno** — por eso el filtro del cliente no es la defensa, sino la cortesía. La defensa real es que Ana no puede hacer que su evento parezca de Bruno |
| **401** | reintentable: la sesión se renueva |
| **403 / 42501** | permanente → cuarentena |
| **5xx / red / timeout** | reintentable |
| **0 filas** | con `ignore-duplicates`, «ya estaba» → desencolar. **Sin** esa cabecera, 0 filas sería un rechazo → cuarentena. La cabecera cambia el significado, así que hay que elegirla y no mezclarla |
| **Consumir el id de otro** | **Imposible**: la unicidad es `(auth_user_id, evento_id)` y `auth_user_id` no lo escribe el cliente. Ana quemando un UUID sólo quema el suyo |
| **Reintentos sin duplicar** | El `evento_id` es estable entre reintentos porque nace con el hecho y vive en `localStorage` |
| **Encaje con B1** | La misma cola, el mismo sellado, el mismo vaciado por identidad, la misma cuarentena y la misma taxonomía de cuatro estados. B2 **añade entradas de otro `tipo`**, no una cola paralela |

---

## 6 · Plan de implementación por pasos

| Paso | Qué | Reversible |
|---|---|---|
| **0** | Arreglar lo que ya está roto **sin tocar esquema**: que los tres escritores de `scores` y `registrarActividad` miren `res.ok`, dejen de usar `return=minimal` y devuelvan estado. Y **retirar el aviso de «Reintentar» que nunca se muestra**, o hacerlo funcionar | despliegue |
| **1** | Esquema: las dos columnas, los dos índices parciales, el `revoke insert (auth_user_id)` | `drop column` / `grant` |
| **2** | `DEFAULT` de servidor para `employee` y `venue` + su `revoke` (depende de `app.mi_nombre()`/`app.mi_venue()`, de la fase C) | `drop default` |
| **3** | Cliente: `evento_id` al ocurrir el hecho, y el evento a la cola de B1 con `tipo` | despliegue |
| **4** | Cliente: el vaciado envía también los eventos, con la misma clasificación | despliegue |
| **5** | Quitar `employee` y `venue` del cuerpo de las cuatro escrituras | despliegue |
| **6** | Pruebas negativas (sección 7) | — |
| **7** | Observar en producción: cuántos eventos entran, cuántos duplicados absorbe el índice, cuánta cuarentena | — |

**El paso 0 se puede hacer hoy y aporta valor solo**: hace visible lo que hoy se
pierde en silencio, sin esquema y sin RLS.

**El paso 2 depende de la fase C.** Si la fase C se retrasa, B2 puede quedarse en
los pasos 0, 1, 3, 4 y aún así ser correcta: `employee` y `venue` seguirían
viniendo del cliente, que es lo de hoy.

---

## 7 · Pruebas negativas — lo que habría que intentar romper

| # | Intento | Esperado | Capa que lo impide |
|---|---|---|---|
| 1 | Mandar `auth_user_id` de otro en el cuerpo | la columna se ignora; queda el propio | `revoke insert (auth_user_id)` |
| 2 | Mandar `employee` de otro | ídem (tras el paso 2) | `revoke` + `DEFAULT` |
| 3 | Mandar `venue` de otro restaurante | ídem | `revoke` + `DEFAULT` |
| 4 | Reenviar el mismo evento diez veces | una sola fila | `UNIQUE` |
| 5 | Reenviar con el mismo `evento_id` y **datos distintos** | una sola fila, la primera; **y el cliente debe enterarse** | `UNIQUE` + clasificación |
| 6 | Usar el `evento_id` de otro empleado | se inserta como propio, **sin afectar al de él** | `UNIQUE (auth_user_id, evento_id)` |
| 7 | Dos pestañas enviando el mismo evento a la vez | una sola fila | `UNIQUE` |
| 8 | Evento de Ana con Bruno dentro | no sale | cola (uid) |
| 9 | Evento de Ana forzado a salir con el token de Bruno | queda como de Bruno, **no como de Ana** | `DEFAULT` |
| 10 | Timeout tras aceptación | el reenvío no duplica | `UNIQUE` |
| 11 | Token caducado a mitad del vaciado | reintentable, nada se pierde | clasificación |
| 12 | `evento_id` malformado o ausente | rechazo claro, no fila sin identificador | validación + `not null` donde toque |
| 13 | Cerrar la pestaña con eventos en cola | sobreviven en `localStorage` | cola |
| 14 | Mil eventos sin red durante días | se envían todos, sin duplicar, sin reventar la cuota | cola + `UNIQUE` |
| 15 | Empleado sin PIN generando eventos | no puede: no entra | login |
| 16 | Un evento de un `tipo` desconocido | se ignora sin romper la cola | lector de la cola |
| 17 | `localStorage` lleno al encolar | aviso, no pérdida silenciosa | manejo de cuota |
| 18 | Mutación: quitar el `UNIQUE` | las pruebas 4, 6, 7 y 10 caen | — |
| 19 | Mutación: devolver el `insert` de `auth_user_id` | las pruebas 1 y 9 caen | — |
| 20 | Mutación: generar el `evento_id` al enviar y no al ocurrir | la prueba 10 cae | — |

---

## 8 · Riesgos y decisiones pendientes

1. **`ignore-duplicates` cambia el significado de «0 filas».** Con ella, 0 filas
   es «ya estaba»; sin ella, es un rechazo. B1 ya trata 0 filas como rechazo en
   `employees`. **Hay que decidir si los eventos usan la cabecera o no**, y no
   mezclar los dos criterios en la misma función.
2. **Los récords de juego (254 de 427 filas) no son evaluaciones.** Quizá no
   merezcan cola: un récord perdido se vuelve a batir, y el máximo ya vive en
   `employees`. Se puede reducir el alcance de B2 a exámenes y actividad.
3. **`emp.sessions` ya sobrevive offline** y contiene casi lo mismo que `scores`.
   Hay una pregunta legítima que no me toca responder: **¿hace falta `scores`
   como tabla, o es un duplicado de `sessions_data` con otra forma?** Fuera de
   alcance, pero conviene mirarlo antes de invertir en su cola.
4. **Los 4 sin PIN** no generarán eventos; sus 22 filas históricas se quedan sin
   identidad para siempre. Aceptado en su día.
5. **El paso 2 depende de la fase C.** B2 es útil sin él, pero incompleto.
