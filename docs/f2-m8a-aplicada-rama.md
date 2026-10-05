# F2 · M8-A — APLICADA EN LA RAMA `f2-push` (no en producción)

Registro y reasignación de suscripciones push mediante una RPC, y retirada del
alta directa (B+). Aplicado el **2026-10-04** en la rama aislada **`f2-push`**
(`sslcgakpxiwhjxsgmngg`, proyecto de prueba `meseo-c5-test`).

**Estado: M8-A = PASS** (pruebas T1–T23 y P1–P3 antes y después de B+, y
concurrencia real C0–C10 con tres conexiones `psql`). Cerrada el 2026-10-05.

**Lo que NO se ha tocado:** producción (`advkoujfgbrrjvqexrcu`), F1, M1–M7
(incluida la migración histórica de M5), send-push, check-inactive, VAPID, el
cliente, el service worker, usuarios y Edge Functions. **M8-B y siguientes no
han empezado.**

---

## 1 · Trazabilidad

| Artefacto | Identificador |
|---|---|
| Migración M8-A | `20261004233249 f2_m8a_push_suscripcion_registrar` (10.ª de la rama; aplicada 1 vez) |
| SQL M8-A | `supabase/f2_m8a_push_suscripcion_registrar.sql` · SHA-256 `682e1bcc28a59180da841717698d33cb05b1b8e84a51981d4fb9944c2834a5eb` · md5 `8228bda960971614cfd4ee7d02044ddc` = md5 del texto guardado en `schema_migrations` |
| `push_suscripcion_registrar(text,text,text)` | md5 de `pg_get_functiondef` `8d47b82195783930c11452f6ef2381e7` · ACL `{postgres=X, authenticated=X}` |
| Migración B+ | `20261004233944 f2_m8a2_push_subscriptions_solo_rpc` (11.ª; aplicada 1 vez, **después** de probar la RPC) |
| SQL B+ | `supabase/f2_m8a2_push_subscriptions_solo_rpc.sql` · SHA-256 `752456b00a07ce560774da62e24596e169cac9d3f98e57b91bd67f51c1a3341f` · md5 `284eba39ca51deadbe1e7749323ebc5b` = md5 guardado |
| Prueba funcional | `supabase/tests/f2-m8a/M8A_funcional.sql` · SHA-256 `33ae4d07394f95da763b2b73c4e7ca68131eceb9f62ece1425c5d21f296df22a` |
| Prueba de concurrencia | 9 scripts `supabase/tests/f2-m8a/C*.sql`, SHA-256 en § 4 |

## 2 · Lo que se ha creado y cambiado

**`public.push_suscripcion_registrar(p_endpoint, p_p256dh, p_auth) returns json`**
- SECURITY DEFINER, VOLATILE, `search_path=''`; solo `authenticated` la ejecuta.
- La identidad y el restaurante salen de `auth.uid()` (`app.emp_actual`, `app.venue_actual`).
- **Validación**, antes de tomar el candado y sin escribir nada:
  - endpoint no nulo, de como mucho 1024 caracteres, con el host del CHECK;
  - `p256dh` de 87 caracteres base64url;
  - `auth` de 22 caracteres base64url.
- **Bajo el candado** `(hashtext('push_subscriptions'), hashtext('e:'||endpoint))`, bloqueante:
  1. `DELETE` de las filas de **otras** identidades con ese endpoint;
  2. `INSERT … ON CONFLICT (employee_name, endpoint) DO UPDATE` de las claves y el restaurante.
- **Respuestas:** `{ok:true}` es la misma para alta, repetición y reasignación. Los errores son `no_autenticado`, `sin_identidad` y `formato`.

**B+** (`push_subscriptions`):
- `authenticated` pasa de `arwdm` a `rdm`: sin INSERT ni UPDATE directos;
- se elimina la política `push_propias_insert`.

**Sin cambios:** columnas, CHECK, UNIQUE `(employee_name, endpoint)`, índices, el
trigger `trg_push_subscriptions_propietario` (md5 de la definición `9ea77e10…`,
función `b9c8d713…`), las políticas `push_propias_select` y
`push_propias_delete`, `service_role` y la secuencia.

## 3 · Prueba funcional (dos ejecuciones, ambas deshechas)

El mismo bloque se ejecutó **antes** y **después** de B+. Lo ejecutó Claude con
MCP sobre la rama. Las dos veces dio 26 respuestas y 0 filas al terminar.

| Caso | Antes de B+ | Después de B+ |
|---|---|---|
| T1 alta | `{ok:true}`; fila `zz_m8a_a_invalid`/`zzv`; candado `e:ep1` tomado = 1 | igual |
| T2 repetición | `{ok:true}`; 1 fila; mismo `id` y `created_at` | igual |
| T3 claves nuevas | `{ok:true}`; claves actualizadas, mismo `id`, 1 fila | igual |
| T4 B registra el endpoint de A | `{ok:true}`; 1 fila, dueño B; 0 filas de A; `id` nuevo | igual |
| T5 sin ficha / sin uid | `sin_identidad` / `no_autenticado`; 0 filas | igual |
| T6 anon · T7 service_role | 42501 · 42501 | igual |
| T8 claims falsos (`venue`, `role`, `employee_name`) | `{ok:true}`; fila con el nombre y restaurante reales (`zz_m8a_c_invalid`/`zzw`) | igual |
| T9–T15 formato (host, host engañoso, `http`, 1025 caracteres, nulos, p256dh 86/88/`+`/`/`, auth 21/23/`==`/`=`) | `formato` en las 15; 0 filas nuevas | igual |
| T11c endpoint de 1024 exactos | `{ok:true}` (en el límite) | igual |
| T16 C (`zzw`) registra el endpoint de B (`zzv`) | `{ok:true}`; 1 fila, `zz_m8a_c_invalid`/`zzw` | igual |
| T17 C borra lo suyo | 1 fila; conserva su otro endpoint | igual |
| T18 A y B borran lo de C | 0 y 0; las filas de C intactas; A ve 0 filas ajenas | igual |
| T19 A con dos dispositivos | 2 filas; A ve las 2 | igual |
| T20 función | ACL `{postgres, authenticated}`, SECURITY DEFINER, VOLATILE, `search_path=""`, dueño postgres | igual |
| T21 campos del servidor | 3 de 3 filas con nombre y restaurante de su ficha; `created_at = now()`; trigger `O` (activo) | igual |
| T22 respuestas | 4 formas distintas, sin fugas de claves, uuid ni nombres | igual |
| T23 endpoints con más de un dueño | 0 | 0 |
| **P1 INSERT directo** de A con el endpoint de C | **ENTRÓ**: el endpoint queda con **dos dueños** (A/zzv por el trigger y C/zzw). Es el hueco que justifica B+ | **42501** |
| **P2 UPDATE directo** | 0 filas (sin política) | **42501** |
| **P3** política `push_propias_insert` / ACL | 1 / `authenticated=arwdm` | **0 / `authenticated=rdm`** |

Límite de T21: la RPC y el trigger escriben los mismos valores, así que la
prueba demuestra que las filas tienen los valores del servidor, no cuál de las
dos capas los puso. Que el trigger está activo se comprueba en el catálogo.

**Pruebas de M5 afectadas por B+:**
- el alta propia por la vía directa, que ahora es 42501 a propósito (P1);
- el UPDATE (P2).

Siguen igual: ver lo propio (T18c, T19), borrar lo propio (T17), no alcanzar
lo ajeno (T18) y el aislamiento entre restaurantes (T16, T18). F1 y M7 no tocan
`push_subscriptions`.

**Catálogo tras B+:**
- 11 migraciones;
- los md5 de F1, `app.*`, los triggers de `employees`, `sup_pin_*`, `push_subscriptions_propietario` y M7 no han cambiado;
- ACL de `push_envios` `{postgres=arwdDxtm}` y de `push_pin_intentos` `{postgres, service_role}`, sin cambios;
- 0 filas en todas las tablas, 0 objetos `zz`, 0 candados.

## 4 · Concurrencia real · PASS

Igual que E18 de M7: tres conexiones `psql` reales a `f2-push` por el Session
Pooler. El entorno de Claude no puede abrir conexiones TCP a la base, así que
la ejecutó el responsable, a mano. No se simuló.

| Script | SHA-256 |
|---|---|
| `C0_preparacion.sql` | `0c654975e159e94725928f056eb0183e0ac003e968b70305e3c951c06a5678c5` |
| `C_O1_cerrar_puertas.sql` | `d24f1082635ed26a8a2872575d12e76203e900a389da08f1949f27342ac6c55c` |
| `C_A.sql` | `f403223a0f957591ef487206286ca51130b2e97bad3180d71d61b963f2dfff3f` |
| `C_B.sql` | `7b942979a0a3ea7de9d0c7e4a984954b7cef87caa50bd1e123084ddfaacd638c` |
| `C_O2_estado.sql` | `d4c0bc848f62bc6274738ebdcfa3f73d7efc5e9a381e9394881524ef4c66de12` |
| `C_O3_abrir_salida.sql` | `05b4dd0f4b88c5fbf010ea88213edc04daa86f70e2181de7eb46a7ec61aa6c3d` |
| `C_O4_abrir_commit.sql` | `f0e4899b14f6b6662ece6fac9ea9c8d431e767be810c9e549a82fbf57ef45ada` |
| `C9_comprobacion.sql` | `8ca3a061e71d724da606365274dfcea9a3c97b6d16e3859b3d2f89c7bceefbab` |
| `C10_limpieza.sql` | `7878f3846dd3b7753039e877f512886ad7bff9a14884220f793f2bfb1721b012` |

**Escenario:** dos identidades de `zzv`, A (`…e8ca1`) y B (`…e8cb1`), registran a
la vez el mismo endpoint X (`…/zz-m8c-x`), las dos desde la misma puerta de
salida.

**Orden:**
1. `C0` (crea datos sintéticos confirmados en la rama).
2. **O:** `C_O1`, y se mantiene abierta.
3. Terminal A: `psql … -f C_A.sql`; terminal B: `psql … -f C_B.sql`.
4. **O:** `C_O2`: A y B en `puerta salida`, `granted=false`.
5. **O:** `C_O3`.
6. **O:** `C_O4`.
7. `C9`.
8. `C10`.

**PASS solo si se cumplen a la vez:**
- **O3** imprime `M8C CERROJO`: el primero tiene `e:X` y espera la puerta de commit, el segundo espera `e:X` (`granted=false`), y hay 0 filas confirmadas con X;
- **A y B** devuelven las dos `{"ok" : true}` y muestran `aislamiento = read committed`;
- **C9** da `filas_con_x = 1`, `endpoints_con_dos_duenos = 0`, `UN SOLO DUEÑO` y `claves_del_dueno = true`, y `dueno_sesion` es la sesión del pid **segundo** de O3, el último en conseguir el candado;
- **C10** deja todo a 0 y sin candados advisory.

**Resultado observado** (ejecución del responsable, 2026-10-05):

| Paso | Observado | Resultado |
|---|---|---|
| C0 | `M8C PREP OK`: `auth.users` = 2, `employees` = 2, suscripciones con X = 0 | PASS |
| C_O1 | Puertas de salida y de commit cerradas por O | PASS |
| C_O2 | A y B esperando el mismo candado advisory (puerta de salida) | PASS |
| C_O3 | `M8C CERROJO`: **B** obtuvo primero `e:X` y esperó en la puerta de commit; **A** quedó esperando `e:X`; 0 filas confirmadas con X | PASS |
| C_O4 | Puerta de commit abierta; A y B terminan; sin candados suyos | PASS |
| B | `{"ok":true}`; confirmó primero | PASS |
| A | `{"ok":true}`; confirmó después | PASS |
| C9 | `filas_con_x = 1`, `claves_del_dueno = true`, `endpoints_con_dos_duenos = 0`, `UN SOLO DUEÑO`, `dueno_sesion = A` | PASS |
| C10 | `push_subscriptions`, `employees`, `auth_users`, `push_envios`, `push_pin_intentos` y `advisory` a 0 | PASS |

**Criterios:**

| Criterio | Observado | Resultado |
|---|---|---|
| Cerrojo real | El primero (B) tiene `e:X` y espera el commit mientras el segundo (A) espera `e:X`; 0 filas confirmadas | PASS |
| Respuestas | Las dos `{"ok":true}`: la reasignación no se distingue de un alta | PASS |
| Un solo dueño | 1 fila con X, 0 endpoints con dos dueños, y las claves son las del dueño | PASS |
| Dueño final = último en conseguir el candado | O3 dice que el segundo fue A, y C9 da `dueno_sesion = A` | PASS |
| Limpieza | Todo a 0, sin candados advisory | PASS |

El informe no incluye los pids concretos ni la línea `aislamiento` de A y B.
El orden se identifica por sesión: B primero, A segundo. El aislamiento
`read committed` es el de la rama, comprobado en el catálogo para M7 E18. La
reasignación bajo el candado se ve en el resultado: A borró la fila ya
confirmada de B y dejó la suya.

## 5 · Compatibilidad y vuelta atrás

- **Clientes que dejan de poder darse de alta con B+:** todos los que hacen `POST /rest/v1/push_subscriptions`, es decir, todas las versiones publicadas hasta hoy (`index.html:5191`). Reciben 42501. Sus filas existentes siguen recibiendo avisos, y el borrado propio sigue funcionando.
- **Por eso B+ no se aplica en producción** hasta que el cliente que usa la RPC esté publicado y adoptado. Antes de eso, en producción solo se aplicaría M8-A, que solo añade una función y no rompe nada.
- **Revertir B+:** `grant insert, update on table public.push_subscriptions to authenticated;` y recrear `push_propias_insert` con su definición literal (al final de `f2_m8a2_…sql`).
- **Retirar la RPC:** `drop function public.push_suscripcion_registrar(text, text, text);`. Solo si ningún cliente depende de ella y B+ se ha revertido antes; si no, nadie podría darse de alta.
- **send-push v9 y v10** no dependen de esto: leen y borran con `service_role`, que no cambia.

## 6 · Deudas y fuera de alcance

- **Producción:** no se ha tocado. Ni M8-A ni B+ están aplicadas allí.
- **Antes de aplicar M8-A en producción:** limpiar, con autorización, el endpoint compartido y la suscripción huérfana que ya existían.
- **B+ en producción:** solo después de publicar y adoptar el cliente que usa la RPC (M8-E).
- **Cliente** (M8-E, sin tocar):
  - dejar de hacer `POST` directo y llamar a la RPC;
  - capturar el bearer **antes** de `_authSesionSalir()` en el cierre de sesión. Hoy el `DELETE` sale probablemente con la clave `anon` (`index.html:13042`), según la lectura del código.
- **UNIQUE `(endpoint)` como segunda barrera:** no se ha añadido. Se valora después de la limpieza de producción.
- **Riesgo residual documentado:** quien conozca el endpoint de otra persona puede desalojarla de ese dispositivo con la RPC. No puede leer sus avisos.
- **Fuera de M8-A:**
  - el permiso `anon=rw` de `push_subscriptions_id_seq`;
  - S1 (empleado desactivado, F2-22);
  - C1 y el resto de deudas de endurecimiento ya documentadas.

## 7 · Siguiente

- **M8-B** (send-push v10 y check-inactive) **no está autorizado**.
