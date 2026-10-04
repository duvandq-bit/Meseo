-- E18 · O1 · Observador: cerrar las dos puertas (candados de SESIÓN; mantener esta conexión abierta)
select pg_backend_pid() as pid_o,
       pg_advisory_lock(hashtext('zz_e18'), hashtext('salida')) as salida_cerrada,
       pg_advisory_lock(hashtext('zz_e18'), hashtext('commit')) as commit_cerrada;
