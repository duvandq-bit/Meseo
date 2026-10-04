-- M8-A · C9 · Comprobación final (sólo lectura)
select count(*)                                                               as filas_con_x,
       string_agg(employee_name, ',')                                         as dueno,
       bool_and(keys_p256dh = case employee_name when 'zz_m8c_a_invalid' then repeat('A', 87) else repeat('B', 87) end
            and keys_auth   = case employee_name when 'zz_m8c_a_invalid' then repeat('a', 22) else repeat('b', 22) end) as claves_del_dueno,
       (select count(*) from (select endpoint from public.push_subscriptions group by endpoint having count(*) > 1) d) as endpoints_con_dos_duenos,
       case when count(*) = 1 then 'UN SOLO DUEÑO' else 'FALLO: ' || count(*) || ' filas' end as veredicto_datos,
       case string_agg(employee_name, ',') when 'zz_m8c_a_invalid' then 'A' when 'zz_m8c_b_invalid' then 'B' end as dueno_sesion
  from public.push_subscriptions
 where endpoint = 'https://fcm.googleapis.com/fcm/send/zz-m8c-x';
