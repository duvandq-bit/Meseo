# FASE C — Autoridad de identidad en el servidor

**NADA APLICADO.** Ningún cambio de esquema, política, grant, función, dato,
aplicación ni despliegue. Todo el SQL de este documento está **ensayado contra las
tablas reales dentro de transacciones que terminan en excepción**, es decir,
revertidas. Recuento de control antes y después de los tres ensayos:

```
scores 427 · actividad 5 · employees 22
```

Alcance: **sólo la autoridad de identidad necesaria para desbloquear B2.** No es
la fase C completa de `fase2.5d-diseno-rls.md` — no se tocan la lectura, ni
`employees`, ni el aislamiento entre compañeros.

---

## 1 · Estado inicial

Medido hoy, no leído de documentos. Cinco cosas no coincidían con lo escrito.

### 1.1 · Las tablas

| | `scores` | `actividad` |
|---|---|---|
| Filas | 427 | 5 |
| `employee` | `text NOT NULL`, **sin `DEFAULT`** | `text NOT NULL`, **sin `DEFAULT`** |
| `venue` | `text NOT NULL`, `DEFAULT 'txoko'` | `text NOT NULL`, **sin `DEFAULT`** |
| `id` | `uuid NOT NULL DEFAULT gen_random_uuid()` | ídem |
| `created_at` | `timestamptz` **nulable**, `DEFAULT now()` | `timestamptz NOT NULL DEFAULT now()` |
| Claves ajenas | **ninguna** | **ninguna** |
| Huérfanos (sin ficha) | **58** | **0** |
| `evento_id` / `auth_user_id` | **no existen** | **no existen** |

### 1.2 · RLS, políticas y grants — el agujero, exactamente

RLS **activo** en las tres tablas, **no forzado**.

| Tabla | Política | Cmd | Roles | `USING` / `WITH CHECK` |
|---|---|---|---|---|
| `scores` | `insert_scores` | INSERT | `public` | **`true`** |
| `scores` | `read_scores` | SELECT | `public` | `true` |
| `actividad` | `actividad_insert` | INSERT | `anon`, `authenticated` | **`true`** |
| `actividad` | `actividad_select` | SELECT | `anon`, `authenticated` | `true` |

ACL de `scores`: `anon=arDxtm`, `authenticated=arDxtm` — la `a` es **INSERT de
tabla**, que implica **todas las columnas**, `employee` y `venue` incluidas.
`UPDATE` y `DELETE` no están (los quitó la fase 2.5A). Lo mismo en `actividad`.

**Conclusión del estado inicial: hoy, cualquiera con la clave anónima puede
insertar una fila de `scores` a nombre de quien quiera y del restaurante que
quiera.** No hace falta ni token.

### 1.3 · Lo que ya existe y los documentos no recogían

**(a) Las funciones de identidad ya están hechas, y están bien.** B2.1 §5.2 pedía
crear `app.mi_nombre()` y `app.mi_venue()`. Ya existen, con otro nombre:

```sql
app.emp_actual()   → select e.name  from public.employees e where e.auth_user_id = auth.uid()
app.venue_actual() → select e.venue from public.employees e where e.auth_user_id = auth.uid()
app.rol_actual()   → select e.role  from public.employees e where e.auth_user_id = auth.uid()
```

Las tres: `STABLE SECURITY DEFINER`, propiedad de `postgres`, **`SET search_path
TO ''`** — la forma endurecida. `EXECUTE` concedido a `authenticated` y
`service_role`, **no a `anon`**. No hay que crear nada: **la fase C no necesita
ninguna función `SECURITY DEFINER` nueva.**

**(b) `auth.uid()`** sale de `request.jwt.claim.sub` o de `request.jwt.claims->>'sub'`.
Lo pone PostgREST tras validar la firma. El cliente no lo escribe en ningún punto.

**(c) Un disparador que ningún documento mencionaba:**
`trg_employees_identidad_inmutable`, que *pretende* impedir a `anon` y
`authenticated` cambiar `name` y `auth_user_id`.

> **CORREGIDO el 2026-09-16 al aplicar C-1 — ver `docs/fase-c1-aplicada.md` §7.**
> Ese disparador **no protege nada**: es `SECURITY DEFINER`, y dentro de una
> función `SECURITY DEFINER` `current_user` es el **dueño** (`postgres`), no el rol
> que llama, así que su guarda `current_user in ('anon','authenticated')` es
> siempre falsa. Medido. Lo que de verdad protege `auth_user_id` son los **grants
> por columna** de `employees`. Y `name` **sí** está en la lista de columnas
> actualizables: es renombrable por cualquier cliente autenticado salvo que una
> clave ajena lo impida por casualidad. Hallazgo abierto, fuera del alcance de la
> fase C.

**(d) `trg_admin_sin_marcas` está sólo en `scores`, no en `actividad`.** La
exclusión de la cuenta de administración en `actividad` es **únicamente del
cliente** (`_esAdmin` en `registrarActividad`). Hallazgo lateral, no se arregla aquí.

**(e) Un solo restaurante.** `employees.venue` sólo contiene `'txoko'`. El ataque
de `venue` es hoy teórico; deja de serlo el día que entre el equipo de M.B.

### 1.4 · Quién escribe hoy, desde el cliente

Los cuatro, todos con `_vSello()`, que **añade `venue` del cliente**
(`index.html:1871`), y todos con `employee` explícito:

| Función | Línea | Tabla | Cuerpo |
|---|---|---|---|
| `registrarActividad` | 2393 | `actividad` | `employee: currentUser` + `venue` |
| `supaInsertScore` | 2835 | `scores` | `employee` + `venue` |
| `supaInsertTxokoRecord` | 2885 | `scores` | `employee` + `venue` |
| `supaInsertEtRecord` | 2944 | `scores` | `employee` + `venue` |

### 1.5 · El dato que condiciona toda la fase

`pg_stat_statements`, por rol:

```
INSERT INTO "public"."scores"(...)   →  435 llamadas   TODAS como anon
                                         0 llamadas como authenticated
Total acumulado:  anon 477.199  ·  service_role 14.637  ·  authenticated 1.562
```

**El 100 % de las escrituras de puntuación observadas llegan como `anon`.** La
fase A hace que el cliente mande el token *cuando lo tiene*, y `authenticated`
sólo aparece desde hoy. Cualquier diseño que corte `anon` **corta hoy el 100 % de
las escrituras** hasta que el parque esté actualizado y autenticándose. Esto no es
una objeción al diseño: es la razón de que la migración tenga que ir en tres pasos
(§2.5).

---

## 2 · Diseño: A, B y C

### 2.1 · Las tres opciones, punto por punto

| | **A · `DEFAULT` + grants por columna** | **B · RPC `SECURITY DEFINER` como única puerta** | **C · las dos** |
|---|---|---|---|
| **`auth.uid()`** | de la firma del JWT, vía PostgREST | igual, dentro de la función | igual |
| **`employee`** | `DEFAULT app.emp_actual()` | `select` dentro de la función | `DEFAULT` |
| **`venue`** | `DEFAULT app.venue_actual()` | ídem | `DEFAULT` |
| **Cómo se impide que el cliente los escriba** | **quitando el `INSERT` de tabla y concediendo sólo las columnas de datos** | el cliente no tiene `INSERT` sobre la tabla en absoluto | las dos cosas |
| **PostgREST** | `POST /rest/v1/scores`, igual que hoy. `Prefer: return=representation` y `select=id` funcionan | `POST /rest/v1/rpc/...`; cambia la forma de la respuesta y **el contrato de errores hay que volver a medirlo entero** | como A |
| **Offline** | perfecto: es un `INSERT` plano, reproducible desde la cola sin estado extra | también reproducible, pero la cola tendría que guardar la forma del RPC | como A |
| **`registrarActividad()`** | **quitar dos campos**: `employee` y `_vSello` | reescribirla: otra URL, otro cuerpo, otra lectura de respuesta | como A |
| **Histórico** | intacto: un `DEFAULT` sólo afecta a filas nuevas | intacto | intacto |
| **Grants que se revocan** | `INSERT` de **tabla** a `anon` y `authenticated`; se reconcede por columnas a `authenticated` | `INSERT` entero; `EXECUTE` sobre la función | los de A |
| **Políticas que quedan** | `with check (employee = app.emp_actual() and venue = app.venue_actual())` | ninguna necesaria para escribir | la de A |
| **Superficie nueva** | **ninguna**: reutiliza tres funciones ya endurecidas | **una función `SECURITY DEFINER` nueva** por cada tabla | ninguna |
| **Prueba negativa** | ensayada, §4 | habría que rehacerla entera | ensayada |

### 2.2 · Elección: **C**, entendida como A + la política

**El mecanismo es A. La política se mantiene como segundo cerrojo.** No es
decoración, y el ensayo lo demuestra: los dos cerrojos atrapan **casos distintos**.

| Ataque | Lo para… |
|---|---|
| Mandar `employee` de otro | **el grant por columnas** (`42501 permission denied for table scores`) |
| Mandar `venue` de otro | **el grant por columnas** |
| JWT válido de un `uid` **sin ficha** | **la política** — `app.emp_actual()` devuelve `NULL`, `employee = NULL` no es cierto, y la fila se rechaza |

Sin la política, el tercer caso escribiría una fila con identidad nula. Sin los
grants, el primero pasa. **Hacen falta los dos.**

**B se descarta** por dos razones concretas, no por gusto:

1. **Tira a la basura el contrato de errores que acabamos de medir.** B2.2
   confirmó contra producción que `23505` llega como 409 con el nombre del índice
   en `message`, que `23503` también es 409, que `42501` es 401, etc. La
   idempotencia de B2 depende de ese contrato. Un RPC lo sustituye por otro que
   habría que medir desde cero.
2. **Añade superficie `SECURITY DEFINER` sin comprar seguridad.** Con A, el
   cliente **físicamente no puede nombrar** esas columnas. B no protege más; sólo
   protege distinto, con una función más que mantener y endurecer.

### 2.3 · El fallo que el ensayo encontró en mi propio SQL

`fase-b2.1-diseno-corregido.md §5.2` y `fase-b2.2-validacion.md §4.1` dicen:

```sql
revoke insert (auth_user_id, employee, venue) on public.scores from anon, authenticated;
```

**Eso no hace nada.** En PostgreSQL, un `GRANT INSERT` **de tabla** implica todas
las columnas, y **no se puede restar una columna de un grant de tabla**. El
`REVOKE` por columnas sólo funciona sobre grants por columnas.

Lo comprobé sin querer: en el primer ensayo apliqué ese `REVOKE` y el ataque de
`venue` **no** fue rechazado por privilegio — lo paró la política, con otro
mensaje. Si hubiera escrito el SQL «según el diseño» y comprobado sólo que el
ataque falla, habría dado por buena una defensa que no existía.

**La forma correcta, que es la que se propone:**

```sql
revoke insert on public.scores from anon, authenticated;              -- quita el de TABLA
grant  insert (score, total, topic, cat, time_sec) on public.scores to authenticated;
```

Es exactamente el modo de fallo que B2.2 señalaba como el único que el cliente no
puede detectar: **un `revoke` que no muerde se ve igual que un éxito.** Resultaba
ser nuestro propio SQL.

### 2.4 · Dos endurecimientos que salen gratis

Al enumerar las columnas concedidas, quedan fuera dos que hoy el cliente **sí**
puede escribir:

- **`id`** — hoy el cliente elige la clave primaria. Con `evento_id` llegando en
  B2, no hay ninguna razón para que la siga eligiendo.
- **`created_at`** — hoy el cliente puede **falsear la fecha** de una prueba.
  Para una evidencia de seguridad alimentaria, eso importa. El momento del hecho
  viajará en `meta.ts_hecho` (B2.1 §10), que es una afirmación del cliente y se
  lee como tal; `created_at` pasa a ser del servidor y sólo del servidor.

### 2.5 · La migración, en tres pasos — y por qué no puede ser en uno

Aquí está el problema real de la fase C, y no es de diseño sino de orden:

- Si se aplica el servidor primero, **producción se rompe entera**: los cuatro
  escritores mandan `employee`, y el ensayo confirma que un cliente que manda su
  **propio** nombre correcto también recibe `42501`.
- Si se cambia el cliente primero, **también se rompe**: sin los `DEFAULT`, omitir
  `employee` da `23502`.

| Paso | Qué | Efecto | ¿Rompe algo? |
|---|---|---|---|
| **C-1** | Sólo los `DEFAULT` (`employee`, `venue`) y los índices/columnas que B2 necesite | ninguno visible: el cliente sigue mandando los campos y un valor explícito gana al `DEFAULT` | **no** |
| **C-2** | Cliente: los cuatro escritores dejan de mandar `employee` y `venue`. Se publica | cliente viejo y cliente nuevo **funcionan los dos** | **no** |
| **C-3** | `revoke insert` de tabla + `grant insert (columnas)` + políticas nuevas | **se cierra el agujero**: el ataque G6 pasa a `42501` | **sí: `anon` pierde la escritura** |

**C-3 es el paso que convierte el 100 % de las escrituras anónimas actuales en
`42501`.** Sólo se puede dar cuando (a) el parque esté en la versión nueva y (b)
exista una cola que retenga lo que no se pueda enviar — es decir, **después de
B2**, no antes.

**Y eso deshace la aparente circularidad** entre B2 y la fase C:

```
C-1 (defaults)  →  C-2 (cliente sin identidad en el cuerpo)  →  B2 (cola)  →  C-3 (revoke)
```

B2 no necesita C-3 para ser **correcto**: `auth_user_id` lo pone el servidor y la
idempotencia funciona desde C-1. C-3 añade la protección contra un empleado que
falsifique `employee` — un agujero que **ya está abierto hoy**, así que no tenerlo
cerrado durante la ventana no es una regresión.

Lo que B2 **sí** necesita antes de dar por buena la garantía G6 es C-3. Por eso
`B2_ENVIO` y la verificación de §7.

---

## 3 · SQL exacto propuesto — **NO EJECUTADO**

Ensayado íntegro y revertido. Se presenta para autorización, no aplicado.

```sql
-- ═══ PASO C-1 · DEFAULTS. No rompe nada; el cliente actual sigue funcionando. ═══
alter table public.scores    alter column employee set default app.emp_actual(),
                             alter column venue    set default app.venue_actual();
alter table public.actividad alter column employee set default app.emp_actual(),
                             alter column venue    set default app.venue_actual();

-- ═══ PASO C-3 · LOS CERROJOS. Sólo cuando el parque esté en C-2 y exista B2. ═══

-- (1) Quitar el INSERT DE TABLA. Es el paso que el diseño anterior no tenía y
--     sin el cual REVOKE INSERT (columna) es un no-op silencioso.
revoke insert on public.scores    from anon, authenticated;
revoke insert on public.actividad from anon, authenticated;

-- (2) Reconceder SÓLO las columnas de datos, y sólo a quien tiene identidad.
--     Fuera: employee, venue (identidad) · id, created_at (del servidor).
grant insert (score, total, topic, cat, time_sec)
  on public.scores to authenticated;
grant insert (activity, competency, kind, score, total, seconds, meta)
  on public.actividad to authenticated;

-- (3) El segundo cerrojo. Atrapa el JWT válido de un uid SIN ficha, que los
--     grants no ven.
drop policy if exists insert_scores     on public.scores;
drop policy if exists actividad_insert  on public.actividad;

create policy scores_alta_propia on public.scores
  for insert to authenticated
  with check ( employee = app.emp_actual() and venue = app.venue_actual() );

create policy actividad_alta_propia on public.actividad
  for insert to authenticated
  with check ( employee = app.emp_actual() and venue = app.venue_actual() );

-- La lectura NO se toca en esta fase: el ranking y el panel siguen igual.
-- read_scores y actividad_select se mantienen tal cual.
```

**Lo que NO lleva este SQL, a propósito:** ninguna función nueva (las tres de
`app` ya existen y bastan); ningún `UPDATE`/`DELETE` (ya no existen desde 2.5A);
nada sobre `employees`; nada sobre lectura; **ni `evento_id` ni `auth_user_id`,
que son de B2 y no de aquí**.

---

## 4 · Pruebas

Tres ensayos contra las tablas reales, cada uno dentro de un bloque que termina en
`raise exception`, con `set local role` y `request.jwt.claims` reales para
suplantar a un empleado de verdad. Control de filas en cada uno.

| Ensayo | Qué probaba | Resultado |
|---|---|---|
| **1** | el SQL tal como estaba escrito en B2.1 | **encontró el fallo del `revoke`**; víctima mal elegida (la cuenta de administración) hizo ilegibles dos líneas |
| **2** | `scores` con el SQL corregido, 11 casos | todos los ataques rechazados |
| **3** | `actividad` con el SQL corregido, y el cuerpo del cliente **actual** | ídem, y confirma que C-3 rompe el cliente actual |

### 4.1 · Matriz negativa

| # | Petición | Resultado esperado | SQLSTATE / HTTP | Evidencia | Estado |
|---|---|---|---|---|---|
| 1 | Bruno → `employee:'Ana'` | rechazo | `42501` → **401** | grants por columna | **ensayado: RECHAZADO** |
| 2 | Bruno → `venue:'mb'` | rechazo | `42501` → 401 | grants por columna | **ensayado: RECHAZADO** |
| 3 | Bruno → `auth_user_id` de Ana | rechazo | `PGRST204` hoy (columna inexistente); `42501` cuando B2 la cree sin concederla | columna no concedida | pendiente de B2 |
| 4 | **Bruno → `employee:'Ana'` + `venue:'mb'`** | **rechazo** | **`42501` → 401** | grants por columna | **ensayado: RECHAZADO — requisito crítico** |
| 5 | Bruno → otro restaurante | rechazo | `42501` → 401 | ídem | **ensayado (caso 2)** |
| 6 | Sin sesión (`anon`) | rechazo | `42501 permission denied for table scores` → 401 | sin grant | **ensayado: RECHAZADO** |
| 7 | JWT inválido o roto | rechazo | `PGRST301` → 401 | PostgREST valida la firma | **medido en B2.2** |
| 8 | JWT de empleado desactivado | **hoy: ACEPTADO** | 201 | **no existe la noción** (B2.1 §16) | **hueco conocido, fuera de alcance** |
| 9 | `employee` inexistente | **imposible de intentar** | — | el cliente no puede nombrar la columna | por construcción |
| 10 | `venue` inexistente | imposible de intentar | — | ídem | por construcción |
| 11 | JWT válido, `uid` **sin ficha** | rechazo | `42501 new row violates row-level security policy` → 401 | **la política**, no los grants | **ensayado: RECHAZADO** |
| 12 | `event_id` duplicado del propio Bruno | duplicado idempotente | `23505` → **409** con el índice en `message` | índice parcial | **ensayado en B2.2 (tabla temporal)** |
| 13 | `event_id` de Ana reutilizado por Bruno | fila **de Bruno**; la de Ana intacta | 201 | `UNIQUE(auth_user_id, evento_id)` | **ensayado en B2.2** |
| 14 | `event_id` nulo | se acepta, fuera del índice parcial | 201 | histórico compatible | **ensayado en B2.2** |
| 15 | `UPDATE` de identidad sobre `scores` | rechazo | `42501` → 401 | sin grant desde 2.5A | **ensayado: RECHAZADO** |
| 16 | `DELETE` | rechazo | `42501` → 401 | ídem | **ensayado: RECHAZADO** |
| 17 | Cambiar `auth_user_id` en `employees` | rechazo | `42501 identidad_no_editable` | **`trg_employees_identidad_inmutable`, ya existente** | ya cubierto |
| 18 | Modificar una fila de otro empleado | rechazo | `42501` → 401 | no hay `UPDATE` para nadie | **ensayado (caso 15)** |
| 19 | Cliente elige `id` | rechazo | `42501` → 401 | columna no concedida | **ensayado: RECHAZADO** |
| 20 | Cliente falsea `created_at` | rechazo | `42501` → 401 | columna no concedida | **ensayado: RECHAZADO** |

### 4.2 · Prueba positiva y mutaciones

| | Resultado |
|---|---|
| **Flujo legítimo**, cuerpo sin identidad, en `scores` | **ACEPTADO**, la fila quedó `employee=Aless venue=txoko` — **puestos por el servidor** |
| **Flujo legítimo** en `actividad` | **ACEPTADO**, `employee=Aless venue=txoko` |
| `anon` sigue **leyendo** | **sí** — ranking y panel intactos |
| **Mutación 1:** `revoke insert (columna)` en vez de quitar el de tabla | el ataque de `venue` deja de ser rechazado por privilegio → **detectada en el ensayo 1** |
| **Mutación 2:** política sin `employee = app.emp_actual()` | el caso 11 (uid sin ficha) pasa → fila con identidad nula |
| **Mutación 3:** conceder `employee` en el `grant` | caen los casos 1 y 4 |
| **Mutación 4:** dejar el `DEFAULT` sin los `revoke` | **todo parece funcionar y no protege nada** — el modo de fallo que se ve como un 201 |

### 4.3 · Datos históricos

Los tres ensayos verificaron el recuento antes y después. Un `DEFAULT` **sólo
afecta a filas nuevas**; los `revoke` y las políticas **no leen ni reescriben
nada**. Los 58 huérfanos de `scores` siguen donde estaban, y las 5 filas de
`actividad` también. **No hay migración de datos en esta fase, ni destructiva ni
de ningún otro tipo.**

---

## 5 · Resultados reales

Salida literal del ensayo 2, sobre `scores`, con el JWT de un empleado real:

```
atacante=Aless  victima=Alexis
A1  employee ajeno      -> RECHAZADO [42501] permission denied for table scores
A2  venue ajeno         -> RECHAZADO [42501] permission denied for table scores
A3  REQUISITO CRITICO   -> RECHAZADO [42501] permission denied for table scores
A4  id elegido          -> RECHAZADO [42501] permission denied for table scores
A5  created_at falseado -> RECHAZADO [42501] permission denied for table scores
A6  UPDATE de identidad -> RECHAZADO [42501] permission denied for table scores
A7  DELETE              -> RECHAZADO [42501] permission denied for table scores
L1  LEGITIMO            -> ACEPTADO como employee=Aless venue=txoko
A8  uid sin ficha       -> RECHAZADO [42501] new row violates row-level security policy
A9  ANON                -> RECHAZADO [42501] permission denied for table scores
A10 ANON lectura        -> sigue pudiendo leer
antes=427 despues=428          ← revertido: hoy sigue en 427
```

Y del ensayo 3, sobre `actividad`:

```
CONTROL scores=427 (debe ser 427) actividad=5
A3 REQUISITO CRITICO -> RECHAZADO [42501] permission denied for table actividad
L1 LEGITIMO          -> ACEPTADO como employee=Aless venue=txoko
C1 cliente ACTUAL (manda su propio employee) -> RECHAZADO [42501] permission denied
actividad antes=5 despues=6    ← revertido: hoy sigue en 5
```

**`C1` es el resultado más importante del documento después del requisito
crítico:** el cliente de hoy, mandando su **propio** nombre correcto, también es
rechazado. Confirma que C-3 no se puede aplicar sin C-2, y es lo que obliga a la
secuencia de §2.5.

---

## 6 · Riesgos restantes

| | Riesgo | Gravedad | Qué se hace |
|---|---|---|---|
| **R1** | **C-3 corta el 100 % de las escrituras anónimas actuales** | **alta** | No se aplica hasta C-2 publicado y B2 en marcha. Es el riesgo que gobierna el calendario |
| **R2** | Un empleado **sin `auth_user_id`** (los 4 sin PIN) no podría escribir | nula en la práctica: sin PIN no entran | ninguna excepción; decisión del propietario vigente |
| **R3** | Una sesión cuyo token falla cae a `anon` y **pierde la escritura** tras C-3 | alta si no hay cola | **es exactamente lo que B2 resuelve.** Por eso B2 va antes que C-3 |
| **R4** | **Empleado desactivado**: no existe la noción, el servidor acepta sus filas | media | fuera de alcance, documentado en B2.1 §16 |
| **R5** | `actividad` **no tiene** el disparador que excluye a la administración | baja | hallazgo; hoy lo filtra sólo el cliente |
| **R6** | El mensaje `permission denied for table scores` **no dice qué columna** | baja | complica el diagnóstico, no la protección |
| **R7** | El hash del PIN sigue siendo credencial al portador | alta, y **no la arregla la fase C** | quien tenga el hash de Ana puede *ser* Ana ante `sesion`. La fase C impide falsificar el cuerpo, no suplantar la sesión |
| **R8** | 58 huérfanos y ninguna clave ajena | baja | no se tocan; decisión del propietario |

**R7 merece decirse claro:** la fase C cierra la falsificación del **cuerpo**. No
cierra la suplantación de la **sesión**. Mientras el SHA del PIN viva en
`DB.employees[*].pin` en cada iPad compartido, quien lo lea puede pedir una sesión
legítima a nombre de otro, y entonces **todo lo de este documento le dará la
razón**. Son dos problemas distintos y sólo se resuelve uno.

---

## 7 · Qué falta para desbloquear B2

| | Qué | Estado |
|---|---|---|
| **G1** `auth_user_id = auth.uid()` | columna de B2 con `default auth.uid()` | **pendiente** — es de B2, no de la fase C |
| **G2** cliente no escribe `auth_user_id` | no concederla en el `grant insert (…)` | **diseño cerrado**; se aplica con B2 |
| **G3** cliente no elige `employee` | `revoke` + `grant` por columnas | **ensayado y probado** |
| **G4** cliente no elige `venue` | ídem | **ensayado y probado** |
| **G5** `employee`/`venue` derivados del servidor | `DEFAULT app.emp_actual()` / `app.venue_actual()` | **ensayado y probado** |
| **G6** el ataque Bruno→Ana no puede dar 201 | los dos cerrojos | **ENSAYADO: `42501`** |
| **G7** `evento_id` ligado a la identidad | índice parcial + `check` | **ensayado en B2.2**, se aplica con B2 |
| **G8** la política no es la única defensa | grants + política | **ensayado: atrapan casos distintos** |

**Los dos bloqueos de B2 siguen siendo dos:**

1. **La medición en iPad** — sin tocar. Sigue pendiente y no se simula.
2. **La autoridad del servidor** — **el diseño ya no es el bloqueo: lo es su
   aplicación**, y su aplicación depende de C-2 (cliente) y de que B2 exista para
   sostener lo que C-3 va a cortar.

---

# Veredicto

## FASE C LISTA PARA VALIDACIÓN

El diseño está cerrado y **probado contra las tablas reales**: el requisito
crítico —JWT de Bruno con `employee:'Ana'` y `venue:'mb'`— devuelve `42501` y no
crea ninguna fila, y el flujo legítimo sigue funcionando con la identidad puesta
por el servidor. El SQL es exacto y no necesita ninguna función nueva.

«Lista para validación» no es «lista para aplicar». Antes de tocar producción hace
falta tu decisión sobre tres cosas:

1. **La secuencia C-1 → C-2 → B2 → C-3**, y en particular que **C-3 corta las
   escrituras anónimas**, que hoy son el 100 %.
2. **Si C-1 se aplica ya.** Es el único paso que no rompe nada: pone los
   `DEFAULT` y deja el sistema exactamente como está. Es reversible con un
   `drop default`.
3. **Los dos endurecimientos gratis** — que el cliente deje de poder elegir `id` y
   de poder falsear `created_at`.

**No he aplicado nada.** Ningún cambio de esquema, política, grant, función, dato,
aplicación ni despliegue. Los tres ensayos se revirtieron y el control lo confirma:
`scores` 427, `actividad` 5.
