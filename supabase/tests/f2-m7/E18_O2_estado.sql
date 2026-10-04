-- E18 · O2 · Observador: foto de los candados implicados (se puede repetir cuando se quiera)
select pg_stat_clear_snapshot();
select l.pid,
       case when l.classid = hashtext('push_envios')::oid then 'r: remitente'
            when l.objid = hashtext('salida')::oid then 'puerta salida'
            else 'puerta commit' end as candado,
       l.mode, l.granted, a.wait_event_type, a.wait_event,
       (l.pid = pg_backend_pid()) as es_o
  from pg_locks l left join pg_stat_activity a on a.pid = l.pid
 where l.locktype = 'advisory' and l.objsubid = 2
   and ((l.classid = hashtext('zz_e18')::oid and l.objid in (hashtext('salida')::oid, hashtext('commit')::oid))
     or (l.classid = hashtext('push_envios')::oid and l.objid = hashtext('r:00000000-0000-4000-8000-00000000e180')::oid))
 order by candado, l.granted desc, l.pid;
