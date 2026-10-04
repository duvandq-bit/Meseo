create table public.zz_c5b_atomicidad (id integer primary key);
create function public.zz_c5b_atomicidad_fn(p integer) returns integer language sql as $$ select p + 1 $$;
do $$ begin raise exception 'ZZ_C5B_FALLO_DELIBERADO'; end $$;
