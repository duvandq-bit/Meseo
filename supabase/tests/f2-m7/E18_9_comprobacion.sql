-- E18 · 9 · Comprobación final (sólo lectura)
with p as (
  select * from public.push_envios
   where remitente = '00000000-0000-4000-8000-00000000e180' and destino = 'zz_e18_dest_invalid')
select count(*)                                                                         as total_par,
       count(*) filter (where evento_id = '00000000-0000-4000-8000-0000000e18a1')      as filas_evento_a,
       count(*) filter (where evento_id = '00000000-0000-4000-8000-0000000e18b1')      as filas_evento_b,
       count(distinct date_bin(interval '10 minutes', created_at, timestamptz '2000-01-01 00:00:00+00')) as ventanas,
       case
         when count(distinct date_bin(interval '10 minutes', created_at, timestamptz '2000-01-01 00:00:00+00')) <> 1
           then 'INVÁLIDO: cambió la ventana de 10 min; limpiar y repetir'
         when count(*) = 6
          and count(*) filter (where evento_id in ('00000000-0000-4000-8000-0000000e18a1',
                                                   '00000000-0000-4000-8000-0000000e18b1')) = 1
           then 'SIN OVERSHOOT: 6 filas, una sola de A/B'
         else 'FALLO: total o reparto incorrecto'
       end                                                                              as veredicto_datos,
       case when count(*) filter (where evento_id = '00000000-0000-4000-8000-0000000e18a1') = 1 then 'A'
            when count(*) filter (where evento_id = '00000000-0000-4000-8000-0000000e18b1') = 1 then 'B' end as ganador_en_tabla
  from p;
