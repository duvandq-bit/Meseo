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
