# Evidencia C5 (S3-C-02) — capturada 2026-10-02 UTC

## C5-A · PostgreSQL 16.13 local (/var/tmp/pgrl, base aislada c5a, sin red)
- Sentencias: las 10 literales de supabase/push_autorizar.sql (sha256 e8cb2759436b6bc6d6eb888d39b4f09d98e9e9febf34c5a882c77dfdc1c3fea1)
- md5 cuerpos: _push_pin_fallo cba5484636e9daf32da68724b4120c3e · _push_pin_evaluar 9186a2bf36f268b836f109951a27e9fe · push_autorizar 9dbd9f269f4253d3b6914d520ee71a58
- C5A-1 (10 + fallo + ROLLBACK): estado = referencia
- C5A-2 (1–5 + fallo + 6–10 rechazadas "current transaction is aborted" + ROLLBACK): estado = referencia
- C5A-3 (1 + fallo + ROLLBACK): estado = referencia
- C5A-4 (10 + COMMIT): 1 tabla, 1 índice, 3 funciones; RLS on, 0 políticas; ACL esperadas
- Veredicto: PASS

## C5-B · apply_migration en rama Supabase
- Rama: c5-atomicidad · project_ref gqhwkbipooxrovlubpgd · Branch ID a6460d88-4275-4685-a1d3-c8d8468c0bf7
- Padre: meseo-c5-test (bykcngwgruqmyecyrjmm) · eu-west-1 · PostgreSQL 17.11 (17.11.0.002) · ACTIVE_HEALTHY / FUNCTIONS_DEPLOYED · with_data=false
- Producción NO usada: advkoujfgbrrjvqexrcu

### Q0 (antes de A)
- migraciones=1, última 20261002005540 remote_schema (30 statements, md5 d6ccc069966dabced9c09fa83942f8cb)
- objetos zz_c5b*: 0; migraciones zz_c5b_*: 0
- columnas schema_migrations: version:text, statements:ARRAY, name:text

### Migración A (zz_c5b_a_fallida) · sha256 625be8f4aebf4c0899d04a88bdaefab0c5ef7e94217ab8a9290a4eb5c79dfd91 · 01:06:35 UTC
create table public.zz_c5b_atomicidad (id integer primary key);
create function public.zz_c5b_atomicidad_fn(p integer) returns integer language sql as $$ select p + 1 $$;
do $$ begin raise exception 'ZZ_C5B_FALLO_DELIBERADO'; end $$;
- Respuesta: {"error":{"name":"HttpException","message":"Failed to apply database migration: ERROR:  P0001: ZZ_C5B_FALLO_DELIBERADO\nCONTEXT:  PL/pgSQL function inline_code_block line 1 at RAISE\n"}}
- Q1: tabla null, función null
- Q2: rel [], proc [], type [], constraint []
- Q3: migraciones=1, última 20261002005540, filas_zz [], historial idéntico a Q0; list_migrations = [remote_schema]
- Veredicto A: PASS

### Migración B (zz_c5b_b_control) · sha256 30169fb4ab97319ec900ba71b10078b13616f1305a0c8e2f96b73ff622608a4c · 01:30:44 UTC
create table public.zz_c5b_control (id integer primary key);
- Respuesta: {"success":true}
- Tabla zz_c5b_control presente; restos de A: ninguno; filas de A en historial: 0
- schema_migrations: 2 filas; nueva 20261002013915 zz_c5b_b_control statements ["create table public.zz_c5b_control (id integer primary key);\n"] (md5 1a20ed4783770e4cffea92b3b3a95ab1); remote_schema intacta
- list_migrations: [20261002005540 remote_schema, 20261002013915 zz_c5b_b_control]
- Veredicto B: PASS

### Snapshot final (fase 1 de limpieza, antes de tocar nada)
- objetos: public.zz_c5b_control (r), public.zz_c5b_control_pkey (i); constraint zz_c5b_control_pkey; tipos zz_c5b_control, _zz_c5b_control; funciones zz_c5b: ninguna; filas en zz_c5b_control: 0
- historial: 2 migraciones, última 20261002013915; otras zz_c5b_*: 0

## Veredicto
C5-A = PASS · C5-B = PASS EMPÍRICO (apply_migration + schema_migrations, rama c5-atomicidad, PG 17.11, eu-west-1, 2026-10-02 01:06–01:39 UTC). No es garantía contractual de Supabase ni prueba directa de producción (advkoujfgbrrjvqexrcu, PG 17.6.1.063, eu-central-1).
