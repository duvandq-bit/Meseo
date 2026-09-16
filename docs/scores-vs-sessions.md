# ¿Sigue haciendo falta `scores`, o lo duplica `sessions_data`?

**Investigación. No se ha cambiado código, ni SQL, ni esquema; no se ha creado
nada ni se ha publicado.** Todas las consultas son de lectura.

B2 queda en pausa hasta responder esto.

---

## 1 · Mapa de escritores y lectores

### `scores` — 3 escritores, 4 lectores

| Escritor | Línea | Qué escribe | Disparado desde |
|---|---|---|---|
| `supaInsertScore(session, employee)` | 2833 | examen: `score, total, topic, cat, time_sec` | examen general (21897) y **simulacro de alérgenos** (25131) |
| `supaInsertTxokoRecord(employee, record)` | 2883 | `topic:'txoko'` | 32677 |
| `supaInsertEtRecord(employee, secs, orders)` | 2942 | `topic:'elturno'` | 32289 |

No hay ningún otro acceso de escritura: ni en Edge Functions, ni en los `.sql`
del repositorio.

| Lector | Línea | Qué lee | Para qué |
|---|---|---|---|
| `supaFetchLeaderboard()` | 2855 | `employee, score, total` (1000) | **ranking**: mejor % por persona |
| `supaFetchTxokoTop10()` | 2898 | `employee, score` de `topic=txoko` (200) | top del juego, fusionado con `employees.txoko_record` |
| `supaFetchEtTop()` | 2957 | `employee, score, total` de `topic=elturno` (200) | top de El Turno |
| `_supCargarHistorial()` | 25225 | `employee, score, total, topic, cat, time_sec, created_at` (5000) | **panel de Supervisor**, y filtra los juegos |

`_supCargarHistorial` alimenta a `_supPerfil(nombre, hist)` (25236), que calcula
**pruebas hechas, nota media, aprobadas, minutos dedicados, fecha de la primera y
la última, y tendencia** (media del último tercio menos la del primero). Se usa en
cinco sitios del panel (25293, 25299, 25370, 26279).

### `sessions_data` — 1 escritor, muchos lectores

**Escritor:** el upsert de la ficha (3215), `sessions_data: JSON.stringify(sess.slice(-20))`.
El origen es `emp.sessions`, y **sólo hay un sitio que empuje ahí**: la línea
**21888**, al terminar el **examen general**.

> Comprobado: el **simulacro de alérgenos no toca `emp.sessions`** (0 menciones
> en su bloque). Escribe en `scores` y en `actividad`, nunca en sesiones.

**Lectores** (una docena): el perfil del empleado (23561, 23616 «últimas 5»), el
calendario de actividad (24220, 24257), el panel de Supervisor (24065, 24524,
24608, 26376), el reto del día (9191), estadísticas (20926), la exportación
(24512), y sobre todo **`renderSupAnalytics`** (25430), que construye la
**precisión media por semana** usando `s.ts`.

**Qué conserva:** `{score, total, topic, cat, time, date, ts}` — las **últimas 20**
en la nube, las últimas 50 en local.
**Qué NO conserva:** nada anterior a esas 20; los simulacros de alérgenos, que
nunca entran; y el histórico de quien cambió de dispositivo, porque la fusión se
queda con **el array más largo**, no con la unión (3163).

---

## 2 · `scores` frente a `sessions_data`

| | `scores` | `sessions_data` |
|---|---|---|
| **Examen general** | sí | sí |
| **Simulacro de alérgenos** | **sí (80 filas)** | **nunca** |
| **Juego Txoko** | sí (236) | no |
| **El Turno** | sí (18) | no |
| **LQA, vinos, sala, fantasma…** | **no** | no |
| **Actividad (práctica)** | no | no |
| **Marca de tiempo** | `created_at`, del servidor | `ts` y `date`, del cliente |
| **score / total** | sí | sí |
| **topic / cat** | sí | sí |
| **duración** | `time_sec` | `time` |
| **metadatos** | ninguno | ninguno |
| **identidad** | `employee` (texto libre, sin clave ajena) | la ficha que lo contiene |
| **historial** | **completo desde el 11 de marzo** | **últimas 20** |
| **durabilidad offline** | **ninguna** | **sí**, vía la cola de B1 |

### La cobertura real, medida

| | |
|---|---|
| Exámenes en `scores` (sin juegos) | **173** |
| — de ellos, simulacros de alérgenos | **80** |
| — exámenes generales | 93 |
| Sesiones realmente guardadas | **77** |
| **Cobertura de `sessions_data` sobre el histórico de exámenes** | **45 %** |
| Empleados que superan el tope de 20 | 2 |

Y persona a persona, el desajuste no viene del tope:

| | exámenes en `scores` | sesiones guardadas |
|---|---|---|
| **Alexis** | **16** | **0** |
| **Dani** | 16 | 2 |
| **Daniel** | 8 | 1 |
| Duvan | 24 | 14 |
| Dian | 18 | 12 |
| Jenfry | 16 | 13 |

**Sólo dos personas superan las 20 sesiones.** El resto del hueco es pérdida:
simulacros que nunca entran, y sesiones desaparecidas al cambiar de dispositivo.
El caso de Alexis —16 exámenes en `scores`, cero sesiones— es el mismo nombre que
aparece en una prueba de la suite: *«jul 2026, pérdida de Alexis»*. **`scores`
conservó su historial; `sessions_data` no.**

---

## 3 · Clasificación de cada tipo de puntuación

| Tipo | Filas | Qué es | ¿Lo cubre `sessions_data`? | ¿Necesita durabilidad como evento? |
|---|---|---|---|---|
| `txoko` | **236** | récord del juego | no | **no**: el máximo vive en `employees.txoko_record`, y un récord perdido se vuelve a batir |
| `elturno` | **18** | récord del juego | no | **no**, por lo mismo |
| `mixed` | 66 | examen general | parcialmente | **sí** |
| `alergenos` | 60 | simulacro de alérgenos | **nunca** | **sí, y es el más crítico**: es seguridad alimentaria |
| `allergens` | 20 | ídem, nombre antiguo | **nunca** | **sí** |
| `protocolo` | 9 | examen | parcialmente | sí |
| `cutlery` | 8 | examen de un tema retirado | parcialmente | histórico |
| `ingredients` | 6 | examen | parcialmente | sí |
| `history` | 4 | examen | parcialmente | sí |

**254 de 427 filas (59 %) son récords de juego, no evaluaciones.**

---

## 4 · Los 254 récords de juego

**Qué utilidad tienen:** alimentan `supaFetchTxokoTop10()` y `supaFetchEtTop()`,
que calculan **el mejor por persona**. Ninguno de los dos lectores usa la
secuencia ni las fechas: sólo el máximo.

**¿Fuente histórica o sólo récord?** Sólo récord, **y ni siquiera hacen falta para
eso**: `supaFetchTxokoTop10` ya lee además `employees.txoko_record` y fusiona los
dos. El máximo ya está en la ficha.

**¿Duplicarlos sería inocuo?** **Sí.** Un récord repetido no cambia el máximo. Es
la diferencia con un examen, que sí falsea una media.

**Dónde se consulta su existencia:** sólo en esos dos lectores, y `_supCargarHistorial`
los **excluye explícitamente** (`_SUP_JUEGOS = ['txoko','elturno']`, línea 25221).

> **Conclusión:** los juegos no necesitan cola, no necesitan idempotencia y no
> necesitan `event_id`. Son **el 59 % del volumen de `scores` y el 0 % del
> problema.**

## 5 · Los 173 restantes

93 exámenes generales y **80 simulacros de alérgenos**.

- Los **93 generales** están cubiertos al 83 % por `sessions_data` (77 de 93), con
  las lagunas descritas.
- Los **80 de alérgenos** no están cubiertos en absoluto, **por diseño del
  código**: su función no toca `emp.sessions`.

Y los 80 son precisamente los que más importan: son la medida de si el equipo
sabe responder a un comensal alérgico.

## 6 · Los 58 huérfanos

**Quién los consulta:** `supaFetchLeaderboard()` (2855) — y **no cruza con
`employees`**: agrupa por el nombre que venga en `scores`.

**Consecuencia medida, visible hoy en la aplicación:**

```
  puesto  empleado          mejor %  filas   ¿existe la ficha?
     1    Ana Kurzweil        100      24          NO
```

**`Ana Kurzweil` empata en el primer puesto del ranking con 24 filas, y ya no
trabaja aquí.** No es una hipótesis: sale en la consulta.

**¿Tienen valor histórico?** Para el ranking, no: lo ensucian. Para el Supervisor,
tampoco los ve (`_supPerfil` filtra por nombre exacto y esos nombres no están en
la lista del equipo). Su valor es de archivo.

**Qué pasaría si nunca pudieran asociarse a una identidad Auth:** exactamente lo
que pasa hoy. Bajo la política propuesta (`venue = app.mi_venue()`) **seguirían
siendo legibles** y seguirían apareciendo en el ranking, porque el ranking no
filtra por ficha existente. **Atarlos a una identidad no es el arreglo; el arreglo
es que el ranking cruce con `employees`** — y eso es una línea, independiente de
RLS y de B2.

---

## 7 · Qué perderíamos si elimináramos `scores`

1. **El historial completo del panel de Supervisor.** `_supPerfil` calcula nota
   media, aprobadas, minutos, primera y última fecha y **tendencia** sobre el
   histórico entero. Con las últimas 20 sesiones la tendencia deja de existir
   para quien tiene más.
2. **Los 80 simulacros de alérgenos, íntegros.** No están en ningún otro sitio.
3. **El historial de quien cambió de dispositivo**: Alexis perdería 16 de 16.
4. **El ranking** (`supaFetchLeaderboard`), que hoy sale de `scores`.
5. **Los dos tops de juego**, aunque el de Txoko se podría reconstruir desde
   `employees.txoko_record`.
6. **Las fechas fiables**: `created_at` lo pone el servidor; `ts` lo pone el
   cliente y es manipulable.

## 8 · Qué duplicamos si lo mantenemos

**Poco, y sólo en un sentido.** Las 77 sesiones guardadas se solapan con 77 de las
93 filas de examen general: **unas 77 filas de 427, el 18 % de la tabla**, y
únicamente para el examen general.

`sessions_data` **no** duplica los alérgenos, ni los juegos, ni nada anterior a
las últimas 20.

Y la duplicación va en la dirección contraria a la que sugería la pregunta:
**`sessions_data` es un subconjunto degradado de `scores`**, no al revés. Todo lo
que tiene —`score`, `total`, `topic`, `cat`, `time`, `ts`— está en `scores` con
mejor cobertura y con fecha de servidor. Su única ventaja real es **que sobrevive
sin red**, y esa ventaja es accidental: viene de viajar dentro del snapshot de la
ficha, no de un diseño.

---

## 9 · Conclusión

**D — tienen semánticas distintas y deben coexistir**, pero conviene decir cuál es
cuál:

- **`scores` es el historial canónico de evaluaciones.** Es la única fuente
  completa, con fecha de servidor, y la única que tiene los simulacros de
  alérgenos.
- **`sessions_data` es una caché local del examen general**, últimas 20, con
  marca de tiempo del cliente, que alimenta la gráfica semanal y las «últimas 5».

**No es (B) «parcialmente redundante» en el sentido que sugería la pregunta**, ni
(C) sustituible. Si acaso, **el candidato a redundante sería `sessions_data`**, y
tampoco conviene tocarlo: es lo único que hoy sobrevive sin red.

### Recomendación de arquitectura

1. **`scores` se queda, y es la fuente canónica.** No se fusiona con
   `sessions_data` ni se sustituye.
2. **`sessions_data` se queda como caché local**, sin ampliarla. No se le añaden
   los simulacros ni los juegos: sería duplicar más.
3. **La gráfica semanal debería salir de `scores`**, no de `sessions_data`: hoy
   se calcula sobre el 45 % del historial y nadie lo sabe. Es un cambio pequeño y
   **mejora una métrica que el supervisor ya está mirando**. Fase propia.
4. **El ranking debe cruzar con `employees`** para que los huérfanos dejen de
   aparecer. Una línea, independiente de todo lo demás.

---

## 10 · Impacto sobre B2

**B2 sigue estando justificada, y se reduce a menos de la mitad.**

| | Decisión |
|---|---|
| **Juegos (254 filas, 59 %)** | **fuera de B2.** No necesitan cola, ni idempotencia, ni `event_id`. Duplicarlos es inocuo y perderlos es reversible |
| **Exámenes generales (93)** | **dentro**, pero con prioridad media: `sessions_data` ya recupera el 83 % |
| **Simulacros de alérgenos (80)** | **dentro, y es la prioridad.** No hay ninguna otra red: lo que se pierde sin cobertura, se pierde del todo. Y es seguridad alimentaria |
| **`actividad`** | **dentro**, sin cambios respecto al diseño anterior |

Es decir: **B2 pasa de «una cola para `scores`» a «una cola para las evaluaciones»**,
que son 173 de 427 filas y un único escritor relevante (`supaInsertScore`).

El **paso 0** del plan de B2 —que los escritores miren `res.ok`, dejen de usar
`return=minimal` y devuelvan estado— **no cambia** y sigue siendo lo primero.

## 11 · Impacto sobre la fase C y RLS

1. **Ninguna conclusión de aquí cambia el diseño de RLS.** Las políticas
   propuestas para `scores` siguen valiendo tal cual.
2. **Los 58 huérfanos siguen visibles** bajo `venue = app.mi_venue()`, como se
   decidió. Que salgan en el ranking **no lo causa RLS y no lo arregla RLS**: lo
   causa que el ranking no cruza con `employees`.
3. **`sessions_data` viaja dentro de `employees`**, así que queda cubierto por la
   política de `employees` sin necesitar nada propio. Una persona verá las
   sesiones de sus compañeros del mismo restaurante — igual que ve su XP.
4. **Un aviso:** si algún día la gráfica semanal pasa a leer de `scores` (punto 3
   de la recomendación), esa lectura **sí** quedará sujeta a la política de
   `scores`. Hoy no, porque lee de la ficha. Conviene tenerlo en cuenta al
   ordenar las fases.
