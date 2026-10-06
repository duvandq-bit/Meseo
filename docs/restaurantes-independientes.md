# Restaurantes independientes

Meseo es una sola aplicación con varios restaurantes. Txoko es el primero y su
comportamiento es el contrato: nada de lo de aquí cambia lo que ve su equipo.
«Restaurante 2» (`r2`) es el primero nuevo. Su nombre real no aparece en la
app, en los datos ni en el repositorio hasta que haya autorización.

## Quién es de qué restaurante

- **El servidor manda.** `employees.venue` lo fija el alta con el código del
  restaurante y el móvil no puede escribirlo. `app.venue_actual()` lo lee con
  `auth.uid()`; `scores` y `actividad` lo usan como valor por defecto.
- **Cada ficha es de un restaurante.** Su progreso (SRS, El Pase, diario,
  `extras`, `topic_scores`) es, por definición, de ese restaurante. Por eso no
  hace falta anidar nada por restaurante dentro de `extras`: una versión
  antigua de la app que reescribe `extras` entero no puede borrar nada nuevo.
- **La cuenta de administración** (`role = 'admin'`) existe para revisar
  contenido. No puntúa en el servidor (`admin_no_puntua`, `admin_sin_marcas`).

## La carta

| Restaurante | Dónde vive | Quién la lee |
|---|---|---|
| Txoko | dentro de `index.html` | todos (es la web) |
| Cualquier otro | `public.cartas` (Supabase) | su personal y la cuenta admin, según RLS |

- `supabase/cartas_privadas.sql`: tabla con RLS. anon no lee nada; la app sólo
  lee; nadie escribe salvo mantenimiento. Probada en f2-push con
  `supabase/tests/cartas-privadas/C_funcional.sql`.
- `data/` es público: **ninguna carta que no se pueda enseñar va ahí**.
- Una versión antigua de la app no conoce `public.cartas`: busca
  `data/carta-<venue>.json`, no lo encuentra y se cierra (o la administración
  la ve vacía). No puede enseñar unos alérgenos cuyo estado no entiende.
- `cargarCarta` comprueba antes de poner la carta: que declara su restaurante,
  que sus números caen en su bloque y no son de Txoko, y que sus alérgenos
  están validados (si no, sólo la abre la administración).

## Números de plato

Cada restaurante tiene un bloque en `data/themes.json` (`dishIds`). Un bloque
asignado no se reutiliza nunca, tampoco si el restaurante se retira (se queda
en el registro con `enabled:false`). Así nada guardado por número de plato
—SRS, fallos de El Pase, fotos, platos conocidos— puede caer en el plato de
otro restaurante.

| Restaurante | Bloque |
|---|---|
| Txoko | 1–2999 (sus platos van del 2 al 129) |
| Restaurante 2 | 3000–3999 |
| Siguiente | el siguiente bloque libre de mil |

Al cambiar de carta se tiran las cachés que cuelgan de un número de plato
(fichas de El Pase, buscador, fotos, platos vistos).

## Alérgenos: `allergensValidated`

- Txoko: `true`. Cualquier otra carta lo tiene que declarar; si no, vale
  `false`. Fallo cerrado.
- Con `false`:
  - el personal no abre la carta;
  - la administración la abre en **modo revisión**: ve los alérgenos del
    borrador con el aviso «sin validar por cocina» y una franja fija en toda la
    app;
  - nunca se afirma una ausencia («sin alérgenos» pasa a «pendientes de
    validar»);
  - no se preguntan, no se puntúan y no se registran: sin tema de alérgenos en
    el examen, sin insignias ni fase de la alergia ni nivel de memoria en El
    Pase, sin repaso inteligente ni simulacro, y el plan de hoy no propone
    tareas de alérgenos.
- Pasar a `true` es una decisión sobre datos validados por cocina, no un
  interruptor: se cambia en la carta cuando cada alérgeno tiene respuesta
  explícita.

## Modo revisión

Cuando la carta puesta no es la del restaurante de la identidad (sólo le puede
pasar a la administración), `getEmp()` devuelve un **perfil de revisión** propio
de esa carta (`DB.revision['<venue>|<nombre>']`). SRS, El Pase, recorridos y
diario van ahí, sólo en el móvil y nunca a la nube. La ficha real no se toca.
Al volver a Txoko todo está como estaba, y el perfil de revisión se conserva.

## Pendiente antes de abrir un restaurante nuevo al público

- `manage-content` (platos personalizados) no está atado al restaurante: la
  clave de `custom_dishes` es sólo `dish_id`, `venue` vale `'txoko'` por
  defecto, el borrado no filtra por restaurante y el PIN de cualquier
  supervisor vale para todos. Hasta corregirlo, el editor de carta sólo
  funciona en Txoko.
- Las fotos del equipo (`dish_photo_submissions`) se leen sin restricción; en
  modo revisión no se suben.
- Validar los alérgenos con cocina.
