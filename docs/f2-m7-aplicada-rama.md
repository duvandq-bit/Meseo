# F2 · M7 — APLICADA EN LA RAMA `f2-push` (no en producción)

`push_envios`: límites de envío e idempotencia del contrato F2 (apartado B).
Aplicada el **2026-10-03** en la rama aislada **`f2-push`** (`sslcgakpxiwhjxsgmngg`,
proyecto de prueba `meseo-c5-test`) como migración
**`20261003203713 f2_m7_push_envios`**, una sola vez.

**Estado: M7 = PASS (E1–E18).** Cerrada el 2026-10-04.

**Lo que NO se ha tocado:** producción (`advkoujfgbrrjvqexrcu`), F1
(`push_autorizar` y sus helpers), M1–M6, send-push, check-inactive, el cliente,
el service worker y `push_subscriptions`. No hay Edge Functions desplegadas.
**M8 no ha empezado.**

---

## 1 · Trazabilidad

| Artefacto | Identificador |
|---|---|
| Migración en la rama | `20261003203713 f2_m7_push_envios` (9.ª de la rama; aplicada 1 vez) |
| SQL de la migración (§ 4) | SHA-256 `290e99b1be6e6f2522ea1c886929bc1fc5edad5f7290cc86d639cf6b9d226806` · md5 `17e4ea4b02ef21b2a6a3064abd8acc9c` = md5 del texto guardado en `schema_migrations` |
| `push_envio_reservar(text,text,text,uuid)` | md5 de `pg_get_functiondef` `8a50663776975cabec01177527c3ad9d` |
| `push_envio_inactividad(text,text,uuid)` | md5 de `pg_get_functiondef` `1daaf6ed964e1c24b79b384f996009e1` |
| F1 `push_autorizar` (sin cambios) | md5 `08e0dc8ada5bdee595aef5d19616d373`, igual que producción |
| Prueba funcional E1–E17 | `M7_funcional.sql`, SHA-256 `80cd5eb1d9bbe091d475adf38ac9844023360b72ed97282d35495fb51e769210` (versión con `uSenders` y E16 corregido) |
| Prueba de concurrencia E18 | 9 scripts, SHA-256 en § 3.3 (paquete `E18_M7.zip`, SHA-256 `f0e2afca86147d3d8c1e05df948ac2338a6365b422acbda959f9f55fdeaeb206`) |

Los scripts de prueba no están en el repositorio; se entregaron como ficheros
al responsable y se identifican por su SHA-256.

## 2 · Objetos creados

- **Tabla `public.push_envios`**:
  - columnas `id` (identity), `evento_id`, `remitente`, `tipo`, `venue`, `destino` y `created_at`;
  - CHECK `tipo_chk` y `forma_chk`;
  - UNIQUE NULLS NOT DISTINCT `(remitente, evento_id)`;
  - 3 índices;
  - RLS activa, sin políticas ni triggers;
  - ACL `{postgres=arwdDxtm}`; la secuencia, `{postgres=rwU}`.
- **`push_envio_reservar`**, el camino del usuario:
  - SECURITY DEFINER, `search_path=''`, solo `authenticated`;
  - llama a `push_autorizar` sin cambios;
  - comprueba el `evento_id` y aplica los límites persona 60/10 min por remitente, 6/10 min remitente→destinatario y 30/10 min por destinatario, y restaurante 3/60 min.
- **`push_envio_inactividad`**, el camino de servicio:
  - SECURITY DEFINER, `search_path=''`, solo `service_role`;
  - permite 1 aviso por destinatario y día (UTC).
- **Candados de transacción bloqueantes**, en el espacio de claves `push_envios`, siempre en el orden `r:` (remitente) → `d:` (destinatario) / `v:` (restaurante).

## 3 · Pruebas

### 3.1 · Catálogo (2026-10-03, tras aplicar)
Las ACL y los privilegios efectivos son los esperados:
- anon: nada;
- authenticated: solo `reservar`;
- service_role: solo `inactividad`;
- nadie lee la tabla.

F1 sigue intacta.

### 3.2 · E1–E17 · PASS
Bloque `DO … raise exception 'RESULTADO %'`, ejecutado una vez en la rama y deshecho por completo. Lo ejecutó y lo validó el responsable.

Hubo dos correcciones del script de prueba, sin tocar M7:
- **F2-7.2:** la variable `us` chocaba con `uS`; se renombró a `uSenders`.
- **F2-7.3:** E16 no probaba un duplicado real, porque E13 borraba la fila de `e1`; ahora usa un `evento_id` dedicado.

**Resultado:** E1–E15 y E17 dieron el resultado esperado, y E16 corregido también.

### 3.3 · E18 · Concurrencia real · PASS
**Cómo se ejecutó:** 2026-10-04, a mano, en `f2-push`, con 3 conexiones PostgreSQL simultáneas (O, A y B) por el Session Pooler.

**Escenario:**
- 5 reservas previas del par `zz_e18_rem_invalid` → `zz_e18_dest_invalid`;
- A (`evento …e18a1`) y B (`evento …e18b1`) compiten por el 6.º cupo;
- las dos parten de la misma puerta de salida.

**Scripts usados:**

| Script | SHA-256 |
|---|---|
| `E18_0_preparacion.sql` | `98e34a847203d76c26b349fa5028b3fd26c1793c67b823b43d13becaf6b3ba50` |
| `E18_O1_cerrar_puertas.sql` | `f052868a241e2a90954db97303563f735830c5f69c67fb8fa0f70ea9d9bd158d` |
| `E18_A.sql` | `8dc985aa676dbf1025a01124138ce9aae302b9a8c939436f07cdabe835c44863` |
| `E18_B.sql` | `8772236957fb1126010f7cbf312d98d566e0409166044742bfb1dcd20545eee8` |
| `E18_O2_estado.sql` | `3796a23261e81a48feccbb65705805b6c8617c62bf485ad9adb06da8c0e45c6c` |
| `E18_O3_abrir_salida.sql` | `ebeaf0fbefd4bdc680965e9c45fad83d421f53b4f1658e920ed98df3e7b09dda` |
| `E18_O4_abrir_commit.sql` | `a803ba61f1d924e9a505c69d115519fd0acc55ff4d27727cc910d7103cc183e9` |
| `E18_9_comprobacion.sql` | `b8f5b1c74263137e0e9b9fd9eb0ecab191fabba523d694d8fa85bbb8b4be5bf8` |
| `E18_10_limpieza.sql` | `76087313a3f61409718b3267ed4df9b442b994d26111c96a6e80e3cb3111d880` |

**Resultados reportados por el responsable:**

| Paso | Observado | Resultado |
|---|---|---|
| E18-0 | `E18 PREP OK`: 5 reservas previas; ventana `2026-10-04 00:00:00+00`; `auth.users` = 1, `employees` = 2, `push_envios` = 5; COMMIT | PASS |
| E18-O1 | O (pid 129363) tiene cerradas las puertas de salida y de commit | PASS |
| E18-O2 | pid 129363 con las dos puertas en `ExclusiveLock`, `granted=true`; pids 129979 y 129982 en la puerta de salida, `ShareLock`, `granted=false`, esperando un candado advisory | PASS |
| E18-O3 | `E18 CERROJO`: el ganador, pid 129982, tiene `r:` concedido y espera la puerta de commit; el perdedor, pid 129979, espera `r:` con `granted=false`; 5 filas confirmadas del par | PASS |
| E18-O4 | Puerta de commit abierta; A y B terminan; no quedan candados suyos | PASS |
| A (pid 129979) | `{"ok":false,"error":"limite"}` | PASS |
| B (pid 129982) | `{"ok":true,"enviar":true,"alcance":"persona","venue":"zzv","destino":"zz_e18_dest_invalid"}` | PASS |
| E18-9 | `total_par = 6`, `filas_evento_a = 0`, `filas_evento_b = 1`, `ventanas = 1`, `SIN OVERSHOOT: 6 filas, una sola de A/B`, `ganador_en_tabla = B` | PASS |
| E18-10 | DELETE 6 / 2 / 1; `push_envios`, `push_pin_intentos`, `push_subscriptions`, `employees`, `supervisor_pins`, `supervisor_pin_secret`, `auth_users` y `advisory` a 0 | PASS |

**Criterios E18:**

| Criterio | Observado | Resultado |
|---|---|---|
| A · Cerrojo real | El ganador (129982) tiene `r:` y espera la puerta de commit mientras el perdedor (129979) espera `r:`; 5 filas confirmadas | PASS |
| B · Resultado | Exactamente un `enviar:true` (B) y exactamente un `limite` (A) | PASS |
| C · Coherencia del ganador | El ganador es el mismo en O3 (pid 129982), en la sesión con `enviar:true` (B) y en `ganador_en_tabla` (B) | PASS |
| D · Sin overshoot | `total_par = 6`, una sola fila de A/B, `ventanas = 1` | PASS |
| E · Limpieza | Todos los conteos a 0 y sin candados advisory | PASS |

La serialización la hace el candado de **remitente** (`r:`), que es el primero
que toma `push_envio_reservar`. El perdedor reevalúa el límite después del
commit del ganador porque la función es VOLATILE y el aislamiento es
`read committed`. Ambas cosas se comprobaron en el catálogo de la rama el
2026-10-03.

### 3.4 · Verificación posterior (2026-10-04, solo lectura)
- `push_envios`, `push_pin_intentos`, `push_subscriptions`, `employees`, `supervisor_pins`, `supervisor_pin_secret`, `auth.users` y los candados advisory: 0.
- 9 migraciones; la última es `20261003203713 f2_m7_push_envios`.
- Los md5 de `reservar`, `inactividad` y `push_autorizar` son los de § 1, y la ACL de la tabla sigue en `{postgres=arwdDxtm}`.

## 4 · SQL exacto aplicado

```sql
-- F2-7 · M7 · push_envios: límites de envío e idempotencia (contrato F2, apartado B)
-- Solo para la rama f2-push (sslcgakpxiwhjxsgmngg). Objeto NUEVO: no existe en
-- producción. Sin datos. ACL explícitas, independientes de los default privileges
-- (en producción darían anon/authenticated/service_role; aquí se retiran todos).
--
-- QUIÉN LO LLAMA (send-push v10, futura; no se despliega en M7)
--   · Usuario:  push_envio_reservar(tipo, target, pin, evento_id) con el bearer
--               DEL USUARIO. Dentro llama a push_autorizar (F1, sin cambios): la
--               autoridad sigue siendo F1; esto sólo añade límites y evento_id.
--   · Servicio: push_envio_inactividad(destino, venue, evento_id) con la service
--               key (check-inactive). Sólo service_role puede ejecutarla.
--   Sólo con enviar:true se envía. enviar:false = evento repetido, no reenviar.
--
-- LÍMITES (ventanas FIJAS alineadas a UTC con date_bin, como dice el contrato)
--   persona:      60 / 10 min por remitente
--                  6 / 10 min remitente → mismo destinatario
--                 30 / 10 min por destinatario (todos los remitentes)
--                 (la bienvenida a uno mismo es 'persona': cuenta igual)
--   restaurante:   3 / 60 min por restaurante (además del limitador de PIN de F1)
--   servicio:      1 aviso por destinatario y día (UTC)
--   Superado → {ok:false, error:'limite'}, sin decir cuál ni de quién, sin
--   guardar fila y sin tocar los contadores del PIN.
--
-- IDEMPOTENCIA
--   (remitente, evento_id) único; servicio = remitente null (NULLS NOT DISTINCT).
--   Repetido → {ok:true, enviar:false} antes de autorizar y antes de los límites.
--
-- CONCURRENCIA
--   Candados de transacción BLOQUEANTES (esperan, no deniegan), siempre en el
--   mismo orden: primero remitente ('r:'), después destinatario ('d:') o
--   restaurante ('v:'). Ningún camino toma un 'r:' después de un 'd:'/'v:', así
--   que no hay ciclo. Espacio de claves 'push_envios', distinto del de F1.
--
-- NO SE GUARDA: endpoint, claves, PIN, título, cuerpo, imagen, IP.

-- 1 · Tabla
create table public.push_envios (
  id         bigint generated always as identity primary key,
  evento_id  uuid not null,
  remitente  uuid,                                   -- auth.uid(); null = servicio
  tipo       text not null,
  venue      text not null,
  destino    text,                                   -- nombre canónico; null en 'restaurante'
  created_at timestamptz not null default now(),
  constraint push_envios_tipo_chk check (tipo in ('persona', 'restaurante', 'servicio')),
  constraint push_envios_forma_chk check (
    (tipo = 'persona'     and remitente is not null and destino is not null) or
    (tipo = 'restaurante' and remitente is not null and destino is null) or
    (tipo = 'servicio'    and remitente is null     and destino is not null)),
  constraint push_envios_evento_key unique nulls not distinct (remitente, evento_id)
);
create index push_envios_remitente_idx on public.push_envios (remitente, created_at);
create index push_envios_destino_idx   on public.push_envios (venue, destino, created_at);
create index push_envios_venue_idx     on public.push_envios (venue, tipo, created_at);

-- 2 · RLS activa, sin políticas: nadie fuera de las funciones
alter table public.push_envios enable row level security;
revoke all on table public.push_envios from public, anon, authenticated, service_role;
revoke all on sequence public.push_envios_id_seq from public, anon, authenticated, service_role;

-- 3 · Camino de usuario
create function public.push_envio_reservar(p_tipo text, p_target text default null, p_pin text default null, p_evento_id uuid default null)
returns json language plpgsql security definer set search_path = '' as $f$
declare
  v_uid   uuid := auth.uid();
  v_aut   json;
  v_alc   text;
  v_venue text;
  v_dest  text;
  v_v10   timestamptz := date_bin(interval '10 minutes', now(), timestamptz '2000-01-01 00:00:00+00');
  v_v60   timestamptz := date_bin(interval '60 minutes', now(), timestamptz '2000-01-01 00:00:00+00');
begin
  if v_uid is null then
    return json_build_object('ok', false, 'error', 'no_autenticado');
  end if;
  if p_evento_id is null then
    return json_build_object('ok', false, 'error', 'formato');
  end if;

  perform pg_advisory_xact_lock(hashtext('push_envios'), hashtext('r:' || v_uid::text));
  if exists (select 1 from public.push_envios where remitente = v_uid and evento_id = p_evento_id) then
    return json_build_object('ok', true, 'enviar', false);
  end if;

  v_aut := public.push_autorizar(p_tipo, p_target, p_pin);
  if not coalesce((v_aut ->> 'ok')::boolean, false) then
    return v_aut;                       -- no_autenticado | sin_identidad | denegado | tipo_no_permitido
  end if;
  v_alc   := v_aut ->> 'alcance';
  v_venue := v_aut ->> 'venue';
  v_dest  := v_aut ->> 'destino';

  if v_alc = 'persona' then
    perform pg_advisory_xact_lock(hashtext('push_envios'), hashtext('d:' || v_venue || ':' || v_dest));
    if (select count(*) from public.push_envios
         where remitente = v_uid and tipo = 'persona' and created_at >= v_v10) >= 60
    or (select count(*) from public.push_envios
         where remitente = v_uid and tipo = 'persona' and venue = v_venue and destino = v_dest and created_at >= v_v10) >= 6
    or (select count(*) from public.push_envios
         where tipo = 'persona' and venue = v_venue and destino = v_dest and created_at >= v_v10) >= 30 then
      return json_build_object('ok', false, 'error', 'limite');
    end if;
  elsif v_alc = 'restaurante' then
    perform pg_advisory_xact_lock(hashtext('push_envios'), hashtext('v:' || v_venue));
    if (select count(*) from public.push_envios
         where tipo = 'restaurante' and venue = v_venue and created_at >= v_v60) >= 3 then
      return json_build_object('ok', false, 'error', 'limite');
    end if;
  else
    return json_build_object('ok', false, 'error', 'tipo_no_permitido');
  end if;

  insert into public.push_envios (evento_id, remitente, tipo, venue, destino)
  values (p_evento_id, v_uid, v_alc, v_venue, v_dest);
  return json_build_object('ok', true, 'enviar', true, 'alcance', v_alc, 'venue', v_venue, 'destino', v_dest);
end $f$;
revoke all on function public.push_envio_reservar(text, text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.push_envio_reservar(text, text, text, uuid) to authenticated;

-- 4 · Camino de servicio (check-inactive): sin límite de usuario, 1 aviso por destinatario y día
create function public.push_envio_inactividad(p_destino text, p_venue text, p_evento_id uuid)
returns json language plpgsql security definer set search_path = '' as $f$
declare
  v_dest text;
  v_dia  timestamptz := date_bin(interval '1 day', now(), timestamptz '2000-01-01 00:00:00+00');
begin
  if p_evento_id is null or p_destino is null or p_venue is null then
    return json_build_object('ok', false, 'error', 'formato');
  end if;
  select e.name into v_dest from public.employees e where e.name = p_destino and e.venue = p_venue;
  if v_dest is null then
    return json_build_object('ok', false, 'error', 'denegado');
  end if;

  perform pg_advisory_xact_lock(hashtext('push_envios'), hashtext('d:' || p_venue || ':' || v_dest));
  if exists (select 1 from public.push_envios where remitente is null and evento_id = p_evento_id) then
    return json_build_object('ok', true, 'enviar', false);
  end if;
  if exists (select 1 from public.push_envios
              where tipo = 'servicio' and venue = p_venue and destino = v_dest and created_at >= v_dia) then
    return json_build_object('ok', false, 'error', 'limite');
  end if;

  insert into public.push_envios (evento_id, remitente, tipo, venue, destino)
  values (p_evento_id, null, 'servicio', p_venue, v_dest);
  return json_build_object('ok', true, 'enviar', true, 'alcance', 'servicio', 'venue', p_venue, 'destino', v_dest);
end $f$;
revoke all on function public.push_envio_inactividad(text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.push_envio_inactividad(text, text, uuid) to service_role;

-- ── VUELTA ATRÁS (no ejecutar salvo decisión expresa) ────────────────────────
--   drop function public.push_envio_inactividad(text, text, uuid);
--   drop function public.push_envio_reservar(text, text, text, uuid);
--   drop table public.push_envios;
```

## 5 · Decisiones de M7 y deudas que quedan
**Decisiones tomadas:**
- send-push v10 llamará a `push_envio_reservar` con el bearer del usuario. La autoridad sigue siendo `push_autorizar` (F1).
- La tabla no es accesible ni siquiera para `service_role`: solo a través de las funciones.
- Las ventanas son fijas y alineadas a UTC con `date_bin`. El "día" del camino de servicio es el día UTC.
- Los rechazos (`limite`) no se registran.

**Deudas que quedan fuera de M7:**
- no hay purga de filas antiguas;
- no se guardan "número de destinos" ni "resultado" del envío (auditoría §8 de S3-C);
- la difusión de chat resuelta por el servidor;
- las imágenes.

## 6 · Siguiente
**M8** (RPC de reasignación de endpoint) **no está autorizada**. No se ha diseñado ni aplicado nada de M8.
