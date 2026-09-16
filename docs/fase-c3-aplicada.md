# FASE C-3 — APLICADA

Cierre de la escritura de identidad en `scores` y `actividad`. Migración
`fase_c3_cierre_escritura_identidad`, **2026-09-16**.

**Esto rompe la escritura anónima a propósito.** Era el objetivo. La lectura no
se toca. La aplicación **no se ha publicado**: producción sigue en v7.451 y la
rama en v7.453.

---

## 1 · Grants, antes y después

Del catálogo (`information_schema.column_privileges`), no del comportamiento.

### Antes

| Rol | Tabla | Privilegio | Columnas efectivas |
|---|---|---|---|
| `anon` | `scores` | **INSERT (10)** | `auth_user_id, cat, created_at, employee, id, score, time_sec, topic, total, venue` |
| `authenticated` | `scores` | **INSERT (10)** | *(las mismas 10)* |
| `anon` | `actividad` | **INSERT (12)** | `activity, auth_user_id, competency, created_at, employee, id, kind, meta, score, seconds, total, venue` |
| `authenticated` | `actividad` | **INSERT (12)** | *(las mismas 12)* |

ACL de tabla: `anon=arDxtm`, `authenticated=arDxtm`. La `a` es INSERT de tabla, y
un grant de tabla **implica todas las columnas**, incluidas las que aún no
existían cuando se concedió.

### Después

| Rol | Tabla | Privilegio | Columnas efectivas |
|---|---|---|---|
| **`anon`** | `scores` | **— ninguno** | **ninguna** |
| **`anon`** | `actividad` | **— ninguno** | **ninguna** |
| `authenticated` | `scores` | INSERT (5) | `cat, score, time_sec, topic, total` |
| `authenticated` | `actividad` | INSERT (7) | `activity, competency, kind, meta, score, seconds, total` |

ACL de tabla: `anon=rDxtm`, `authenticated=rDxtm` — **la `a` ha desaparecido en
los dos**. `SELECT` intacto (10 y 12 columnas) para los dos roles.

### Columna por columna, las cinco del servidor

| Columna | `scores` | `actividad` |
|---|---|---|
| `employee` | **sólo servidor ✓** | **sólo servidor ✓** |
| `venue` | **sólo servidor ✓** | **sólo servidor ✓** |
| `auth_user_id` | **sólo servidor ✓** | **sólo servidor ✓** |
| `id` | **sólo servidor ✓** | **sólo servidor ✓** |
| `created_at` | **sólo servidor ✓** | **sólo servidor ✓** |

Comprobación de catálogo `CINCO_DEL_SERVIDOR_cerradas`: **`true`**. Ninguna de
las diez combinaciones está concedida a `anon` ni a `authenticated`.

---

## 2 · Políticas, antes y después

| | Antes | Después |
|---|---|---|
| `scores` INSERT | `insert_scores` · **`public`** · `with check (true)` | **`scores_alta_propia`** · `authenticated` · `employee = app.emp_actual() and venue = app.venue_actual() and auth_user_id = auth.uid()` |
| `actividad` INSERT | `actividad_insert` · `anon, authenticated` · `with check (true)` | **`actividad_alta_propia`** · `authenticated` · *(la misma comprobación)* |
| `scores` SELECT | `read_scores` · `public` · `true` | **sin cambios** |
| `actividad` SELECT | `actividad_select` · `anon, authenticated` · `true` | **sin cambios** |

Las dos políticas nuevas son **`TO authenticated`**: `anon` se queda sin ninguna
política de INSERT, que es un segundo muro por detrás del de privilegios.

---

## 3 · SQL exacto

Aplicado como migración y guardado en **`supabase/fase_c_identidad_servidor.sql`**
(que incluye también C-1, para que el estado del servidor esté en un solo sitio).

```sql
-- (1) QUITAR EL INSERT DE TABLA.
revoke insert on public.scores    from anon, authenticated;
revoke insert on public.actividad from anon, authenticated;

-- (2) RECONCEDER SÓLO LAS COLUMNAS DE NEGOCIO, y sólo a quien tiene identidad.
grant insert (score, total, topic, cat, time_sec)
  on public.scores to authenticated;
grant insert (activity, competency, kind, score, total, seconds, meta)
  on public.actividad to authenticated;

-- (3) EL SEGUNDO CERROJO.
drop policy if exists insert_scores    on public.scores;
drop policy if exists actividad_insert on public.actividad;

create policy scores_alta_propia on public.scores
  for insert to authenticated
  with check ( employee     = app.emp_actual()
           and venue        = app.venue_actual()
           and auth_user_id = auth.uid() );

create policy actividad_alta_propia on public.actividad
  for insert to authenticated
  with check ( employee     = app.emp_actual()
           and venue        = app.venue_actual()
           and auth_user_id = auth.uid() );
```

**La trampa que este SQL evita** —y que el diseño anterior no evitaba— es que
`REVOKE INSERT (columna)` sobre quien tiene INSERT **de tabla** es un **no-op
silencioso**. Hay que quitar el de tabla y reconceder por columnas. Lo destapó el
primer ensayo de esta fase: parecía proteger, y no protegía nada.

---

## 4 · Matriz de ataques

Ejecutada contra las tablas reales con identidad real (`set local role` +
`request.jwt.claims`, que es lo que PostgREST pone tras validar la firma), dentro
de bloques revertidos. **Las dos tablas por separado.**

| # | Petición | Rol | HTTP | `code` | SQLSTATE | **Defensa que lo bloqueó** | ¿Fila? |
|---|---|---|---|---|---|---|---|
| **A** | cuerpo antiguo (`employee`+`venue`) | `anon` | **401** ¹ | `42501` | `42501` | **privilegio** — sin INSERT | **no** |
| **B** | cuerpo limpio | `anon` | **401** ¹ | `42501` | `42501` | **privilegio** | **no** |
| **C** | cuerpo limpio | `authenticated` | 201 | — | — | — *(debe pasar)* | **SÍ** |
| **D** | `employee` de otro | `authenticated` | 401/403 ² | `42501` | `42501` | **privilegio** — columna no concedida | **no** |
| **E** | `venue:'mb'` | `authenticated` | 401/403 ² | `42501` | `42501` | **privilegio** | **no** |
| **F** | `auth_user_id` de otro | `authenticated` | 401/403 ² | `42501` | `42501` | **privilegio** | **no** |
| **G** | `id` inventado | `authenticated` | 401/403 ² | `42501` | `42501` | **privilegio** | **no** |
| **H** | `created_at` de 2000 | `authenticated` | 401/403 ² | `42501` | `42501` | **privilegio** | **no** |
| **I** | JWT válido **sin ficha**, cuerpo limpio | `authenticated` | 401/403 ² | `42501` | `42501` | **RLS** — `new row violates row-level security policy` | **no** |
| **J** | identidad omitida *(= caso C)* | `authenticated` | 201 | — | — | — | **SÍ**, con identidad del servidor |
| **K** | columnas de identidad **a `NULL`** | `authenticated` | 401/403 ² | `42501` | `42501` | **privilegio** — nombrarlas ya basta | **no** |
| **L** | `UPDATE` de identidad | `authenticated` | 401/403 ² | `42501` | `42501` | **privilegio** — UPDATE revocado en **2.5A**, no por C-3 ³ | **no** |
| **M** | `DELETE` | `authenticated` | **401** ¹ | `42501` | `42501` | **privilegio** — DELETE revocado en 2.5A ³ | **no** |

Idéntico en `scores` y en `actividad`: los 13 casos se ejecutaron en las dos.

¹ **Medido por HTTP real** contra PostgREST con la clave anónima.
² SQLSTATE **medido**; el estado HTTP es 401 o 403 —PostgREST devuelve 403 cuando
el rol no es el anónimo— y **no he podido confirmarlo**, porque no puedo emitir un
JWT `authenticated` (sin secreto JWT ni `pgjwt`). No cambia el comportamiento: el
cliente clasifica por `code`, y `42501` va a cuarentena en los dos casos.
³ **Precisión**: L y M no los cierra C-3. Ya estaban cerrados desde la fase 2.5A.
El mensaje es el mismo (`permission denied for table`) pero la causa es el
privilegio de tabla `UPDATE`/`DELETE`, no el de columna.

### El caso más importante, en dos pruebas separadas

**Prueba 1 — un cliente autenticado NO puede elegir la identidad.**
El ataque completo `employee:'Ana'` + `venue:'mb'` + `auth_user_id` ajeno:
`42501`, **ninguna fila creada**. Bloqueado por **privilegio**: la columna no
está concedida, así que la petición muere antes de llegar a la política.

**Prueba 2 — un cliente autenticado legítimo SÍ puede crear una fila.**

```
1 cliente C-2 · scores    -> CREADA  employee=Aless (true)  venue=txoko (true)  auth_user_id=true
2 cliente C-2 · actividad -> CREADA  employee=Aless (true)  venue=txoko (true)  auth_user_id=true
```

Son dos hechos distintos y se han medido por separado, con el **cuerpo literal
que manda el cliente de C-2**.

---

## 5 · HTTP real

Peticiones reales contra `https://advkoujfgbrrjvqexrcu.supabase.co/rest/v1/`:

| Petición | HTTP | Cuerpo |
|---|---|---|
| `POST /scores` · anon · cuerpo antiguo | **401** | `{"code":"42501","message":"permission denied for table scores"}` |
| `POST /scores` · anon · cuerpo limpio | **401** | ídem |
| `POST /actividad` · anon · cuerpo antiguo | **401** | `…permission denied for table actividad` |
| `POST /actividad` · anon · cuerpo limpio | **401** | ídem |
| `DELETE /scores?id=eq.…` · anon | **401** | `…permission denied for table scores` |
| `GET /scores?select=employee,score,total` · anon | **200** | `[{"employee":"Duvan","score":8,"total":10}, …]` |
| `GET /actividad?select=employee,activity` · anon | **200** | `[{"employee":"Jenfry","activity":"reto_dia"}, …]` |

**La escritura anónima está cerrada y la lectura anónima intacta.**

---

## 6 · Conteos

| | Antes | Después |
|---|---|---|
| `scores` | 427 | **427** |
| `actividad` | 5 | **5** |
| `employees` | 22 | **22** |
| `auth.users` | 18 | **18** |
| Fichas con PIN | 18 | **18** |
| **Huérfanos en `scores`** | **58** | **58** |
| Huérfanos en `actividad` | 0 | **0** |
| Filas con `auth_user_id` | 0 | **0** |
| Puntuación más reciente | 2026-09-12 13:01:46 | **2026-09-12 13:01:46** |
| Restos de prueba | — | **0** |

Todas las pruebas de esta fase —matriz, mutaciones, verificaciones— se hicieron
en bloques revertidos, salvo las siete peticiones HTTP, que fueron **rechazos y
lecturas**: ninguna escribió. **No se creó ni se borró ninguna fila real.**

Nada migrado, nada borrado: ni `scores`, ni `actividad`, ni `employees`, ni Auth,
ni los huérfanos históricos.

---

## 7 · Tests y mutaciones

### En la suite — 7 pruebas nuevas, **417 passed, 0 failed**

La suite no habla con la base, así que vigila el **SQL aplicado que queda en el
repositorio** (`supabase/fase_c_identidad_servidor.sql`). Protege contra la
regresión más peligrosa: la que no se ve, porque un `revoke` que no muerde
devuelve 201 igual que un éxito.

### Mutaciones del SQL — las cuatro detectadas

| Mutación | Qué dice la suite |
|---|---|
| **MS1** · usar la forma rota `revoke insert (columna)` | *«falta el revoke de INSERT DE TABLA sobre scores a anon»* |
| **MS2** · colar `employee` en el grant | *«se concede "employee" a authenticated, y esa columna es exclusiva del servidor»* + la lista esperada |
| **MS3** · devolver INSERT a `anon` | *«se concede INSERT a anon sobre scores: la escritura anónima quedó cerrada en C-3»* |
| **MS4** · política que sólo mira `auth_user_id` | *«la política de scores no comprueba employee»* |

### Mutaciones contra la base — y un hallazgo mejor de lo esperado

Cada una deshace **una** defensa y comprueba si el ataque vuelve a pasar. Todas
revertidas.

| Mutación | Resultado | Qué significa |
|---|---|---|
| **MG1** · devolver `grant insert` de tabla a `anon` | **sigue bloqueado**, ahora por **RLS** | tras C-3 `anon` no tiene política de INSERT: hacen falta **dos** errores para reabrirlo |
| **MG2** · conceder `employee` y `venue` a `authenticated` | **sigue bloqueado**, ahora por la **política** | el `with check` atrapa lo que el grant dejó pasar |
| **MG3** · política permisiva + JWT sin ficha | **sigue bloqueado**, por **`23502 NOT NULL`** | `app.emp_actual()` devuelve `NULL` y `employee` es `NOT NULL`: tercera capa |
| **MG4** · quitar el disparador **y** conceder `created_at` | **¡fecha falseada!** | el disparador es la **única** defensa del sello, pero exige que fallen dos cosas a la vez |

**Las defensas se solapan.** En la configuración de C-3 la primera que corta es el
privilegio; quitarla deja la política, y quitar la política deja el `NOT NULL`.
Sólo `created_at` depende de una sola pieza —el disparador— y aun así requiere que
además se conceda la columna.

---

## 8 · Rutas legacy que quedan bloqueadas

Una sola, y es conocida: **la rama de respaldo de `_cuerpoPropio`** (`index.html`,
fase C-2). Cuando no hay token, los cuatro escritores mandan `employee` y `venue`.
A partir de C-3 esa petición recibe `42501` **siempre**:

- sin token → `anon` → sin privilegio de INSERT;
- y medido también: **incluso autenticada y mandando su propio nombre correcto**,
  es rechazada, porque nombra columnas que ya no están concedidas.

**Es código muerto que siempre falla.** Siguiendo tu instrucción, **no he añadido
ninguna excepción ni he restaurado ningún grant.** Queda localizada aquí:

| Ruta | Archivo | Cuándo se activa | A dónde pertenece |
|---|---|---|---|
| `_cuerpoPropio` rama sin token | `index.html:1893` | login sin red, token caducado sin refresco, supabase-js que no carga | **deuda de B2**: es la cola la que debe retener esas escrituras |
| `registrarActividad` sin sesión | `index.html:2419` | ídem | **pérdida silenciosa** — se traga el error por diseño |
| `supaInsertScore` sin sesión | `index.html:2861` | ídem | avisa con un toast y ofrece reintentar |
| `supaInsertTxokoRecord` / `supaInsertEtRecord` sin sesión | 2911 / 2970 | ídem | récords de juego; `employees.txoko_record` sí tiene cola |

---

## 9 · Rollback

**Antes de ofrecerlo, lo que hay que saber: revertir C-3 no es neutro. Reabre la
vulnerabilidad.** A partir del primer `grant insert` de tabla, cualquiera con la
clave anónima —que está en el código de la página— vuelve a poder escribir una
fila a nombre de quien quiera y del restaurante que quiera. Está escrito así, y
comentado para que no se ejecute por accidente, en el propio fichero SQL:

```sql
revoke insert on public.scores    from authenticated;   -- quita los de columna
revoke insert on public.actividad from authenticated;
grant  insert on public.scores    to anon, authenticated;
grant  insert on public.actividad to anon, authenticated;
drop policy if exists scores_alta_propia    on public.scores;
drop policy if exists actividad_alta_propia on public.actividad;
create policy insert_scores    on public.scores    for insert to public with check (true);
create policy actividad_insert on public.actividad for insert to anon, authenticated with check (true);
```

No toca datos, ni Auth, ni `employees`, ni el histórico. Una prueba de la suite
comprueba que ese bloque **sigue comentado** y que **dice explícitamente que
reabre el agujero**.

---

## 10 · Riesgos restantes

| | Riesgo | Gravedad | Estado |
|---|---|---|---|
| **R1** | **Una sesión sin token pierde la escritura, y en `actividad` en silencio** | **alta** | **es el riesgo que gobierna lo que viene**. Lo resuelve B2 |
| **R2** | El SHA del PIN sigue siendo credencial al portador | **alta** | **C-3 no lo arregla.** Cierra la falsificación del *cuerpo*, no la suplantación de la *sesión*: quien lea el hash de Ana en un iPad compartido puede pedir una sesión legítima a su nombre, y entonces todo este diseño le dará la razón |
| **R3** | Empleado desactivado: no existe la noción | media | fuera de alcance |
| **R4** | `created_at` depende sólo del disparador | baja | MG4; exige además que se conceda la columna |
| **R5** | El estado HTTP para `authenticated` (401 vs 403) sin confirmar | baja | no cambia el comportamiento: se clasifica por `code` |
| **R6** | Los 4 empleados sin PIN no pueden escribir | nula | sin PIN no entran; decisión vigente |

### Deuda de `employees`, documentada y no resuelta

1. **`employees_identidad_inmutable` no protege nada** — `SECURITY DEFINER`, donde
   `current_user` es `postgres`, así que su guarda por rol es siempre falsa.
2. **`name` es actualizable por `authenticated`** — está en los grants por columna.
3. **`scores` y `actividad` cuelgan del nombre por texto y sin clave ajena**, así
   que un renombrado mueve o huérfaniza el histórico. Los 58 huérfanos vienen de ahí.

Las tres son de identidad de empleados, no de la autoridad de escritura. **No se
tocan aquí.**

---

## Lo que sigue sin empezar

`evento_id`: **0 columnas**. Índices de evento: **0**. Sin cola, sin cambios de UI,
sin tocar PIN ni `sesion`, sin recuperación de PIN. **B2 sin empezar.**

---

# C-3 APLICADA Y VERIFICADA

El agujero está cerrado. Lo que ayer devolvía `201` —token de Bruno con
`employee:'Ana'` y `venue:'mb'`— hoy devuelve **`42501` y no crea ninguna fila**,
y está medido en las dos tablas. La escritura anónima recibe **401** por HTTP
real; la lectura anónima sigue devolviendo **200**. El cliente autenticado de C-2
crea su fila y **los cinco campos los pone el servidor**.

Y lo que hay que tener presente antes de dar el siguiente paso: **a partir de
ahora, una sesión sin token no escribe.** En `scores` el empleado ve un aviso; en
`actividad` no ve nada. Esa ventana se cierra con B2, y hasta entonces está
abierta.

Suite: **417 passed, 0 failed**. Auditoría de alérgenos: 0/0. Conteos idénticos,
58 huérfanos, 0 filas nuevas. **Nada publicado.**
