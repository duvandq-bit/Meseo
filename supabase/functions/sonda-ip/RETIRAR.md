# Sonda temporal — BORRAR tras leer los registros

Esta carpeta y su RPC acompañante existen para resolver **dos incógnitas** de la
fase 2.5B, y nada más:

- **A** · qué cabecera trae la IP real del navegador hasta dentro de una Edge
  Function.
- **B** · con qué rol llega la petición a Postgres cuando la hace una Edge
  Function (se espera `service_role`).

Hacen falta porque el limitador de `verify_supervisor_pin` agrupa los fallos por
la IP que ve Postgres, y cuando la llamada pasa por una Edge Function esa IP es
la de salida de AWS, que **cambia en cada invocación**: cada intento aterriza en
una fila nueva con `fallos=1` y nunca se alcanza el bloqueo. Medido el 13 de
septiembre de 2026 sobre los registros: tres fallos, tres IPs de AWS Francia.

## Qué NO hacen

No escriben nada. No leen datos de ningún empleado. No cambian ninguna
protección. No devuelven nada al navegador salvo `{ok:true}`.

Las cabeceras se leen con **lista blanca**: sólo el valor de diez cabeceras de
infraestructura relacionadas con la IP, y de las demás únicamente los nombres,
filtrando `authorization`, `apikey`, `cookie`, `token`, `secret` y `sb-`. Una
lista negra siempre se olvida de algo.

## Cómo se retiran

```sql
drop function public._sonda_identidad();
```

Y borrar la Edge Function `sonda-ip` del proyecto, junto con esta carpeta.

---

## RESULTADO (13 sep 2026, 14:45) — la sonda ya cumplió su función

**A · Dentro de la Edge Function**, con la llamada hecha desde el navegador del
propietario:

```
cf-connecting-ip  85.31.131.142                              ← la IP real, un solo valor
x-forwarded-for   85.31.131.142,85.31.131.142, 99.82.162.172 ← cadena, con el primer valor repetido
x-real-ip         (ausente)
true-client-ip    (ausente)
cf-ray            a3a7ef28694eeca5-MAD
```

**B · En Postgres**, cuando la llamada la hace la Edge Function:

```
rol_del_jwt   service_role     ← se puede distinguir
auth_role     service_role
current_user  postgres         (la función es SECURITY DEFINER)
session_user  authenticator

x-forwarded-for / x-real-ip / cf-connecting-ip  →  15.237.96.186
```

Es decir: **en Postgres las tres cabeceras traen la IP de la Edge Function**, no
la del navegador. Confirma el diagnóstico entero.

Aparece además una cabecera `sb-forwarded-for` entre las que llegan a Postgres.
**No se va a depender de ella**: no está documentada, su contenido no se ha
medido, y construir la protección del PIN sobre una cabecera interna del
proveedor es apostar a que no cambie.

## El RPC ya está retirado

`drop function public._sonda_identidad();` — ejecutado. Quedan 0 sondas.

Falta borrar la Edge Function `sonda-ip` desde el panel (no hay forma de
eliminarla por la API de gestión disponible aquí). Sin su RPC ya no puede
consultar nada: sólo registraría cabeceras.
