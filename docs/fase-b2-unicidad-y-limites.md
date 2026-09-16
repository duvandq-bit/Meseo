# B2 — Cierre de los dos puntos abiertos: unicidad y límites

**Nada implementado, ningún SQL, ningún dato modificado, nada publicado, RLS sin
tocar.** Las mediciones de la parte 2 son de lectura y se hicieron en un
navegador real contra una copia local.

---

# 1 · Análisis de unicidad

## 1.1 · Los seis casos, contra los tres esquemas

`X` = un UUID v4 concreto. A y B son dos empleados con identidad Auth distinta.

> Nota de nombres: en la prosa uso `event_id` porque así lo planteaste; la columna
> real de la especificación se llama `evento_id`. Son la misma cosa.

### Esquema 1 — `UNIQUE (event_id)` global

| Caso | Qué ocurre | Qué lo produce | Idempotencia | ¿Puede A impedir a B? |
|---|---|---|---|---|
| A crea X | 201, fila de A | — | — | — |
| A reintenta X | **409 `23505`** → éxito idempotente | el índice global | **correcta** | — |
| **B manda X** | **409: el evento de B se rechaza** | el índice global | — | — |
| **B manda X ANTES que A** | B inserta; **el evento legítimo de A se rechaza para siempre** | el índice global | — | **SÍ. Éste es el fallo** |
| B manda X dos veces | segundo 409 | el índice global | correcta | — |
| Dos dispositivos, mismo UUID accidental | uno de los dos eventos **se pierde** sin que nadie lo sepa | el índice global | — | por accidente |
| Dos eventos distintos de A, UUID distintos | los dos insertan | — | — | — |

### Esquema 2 — `UNIQUE (auth_user_id, event_id)`

| Caso | Qué ocurre | Qué lo produce | Idempotencia | ¿Puede A impedir a B? |
|---|---|---|---|---|
| A crea X | 201, fila de A | — | — | — |
| A reintenta X | **409 `23505`** → éxito idempotente | el índice, dentro del espacio de A | **correcta** | — |
| **B manda X** | **201: fila de B.** La de A queda intacta | `auth_user_id` lo pone el `DEFAULT` | — | — |
| **B manda X antes que A** | B inserta lo suyo; A inserta lo suyo después **sin problema** | ídem | — | **NO** |
| B manda X dos veces | segundo 409 **dentro del espacio de B** | el índice | correcta | — |
| Dos dispositivos, mismo UUID accidental, **misma persona** | el segundo da 409 y se trata como duplicado: se pierde un hecho | el índice | — | probabilidad ~2⁻¹²² |
| Dos dispositivos, mismo UUID accidental, **personas distintas** | los dos insertan, cada uno el suyo | — | — | — |
| Dos eventos distintos de A, UUID distintos | los dos insertan | — | — | — |

### Esquema 3 — los dos a la vez

El índice global **domina**: cualquier colisión la corta él antes de que el
compuesto llegue a evaluarse. El compuesto queda **inútil**, y se pagan dos
escrituras de índice por fila en vez de una.

**Resultado: el comportamiento del esquema 1, con el coste del 2.** Estrictamente
peor que cualquiera de los dos por separado.

## 1.2 · El fallo del esquema 1 no es teórico en Meseo

«B manda X antes que A» exige que B **conozca** el UUID de A. Con un UUID v4
adivinarlo es imposible (2⁻¹²²).

**Pero en Meseo no hay que adivinarlo.** La cola vive en `localStorage`, y los
iPads son compartidos: B puede abrir las herramientas de desarrollo en el mismo
aparato, leer `txk_cola_v2` y **ver los `event_id` pendientes de Ana**. Entonces
los manda él primero, y cuando Ana sincronice, sus simulacros de alérgenos serán
rechazados como duplicados.

No es una hipótesis de laboratorio: es **exactamente el escenario de quiosco** que
esta fase entera existe para proteger. El esquema 1 convierte el `event_id` en un
recurso compartido y escribible por cualquiera que pase por ese aparato.

## 1.3 · Y lo que el esquema 2 «no rechaza» no hace falta rechazarlo

En el esquema 2, «B manda el `event_id` de A» produce una fila **de B**, con sus
datos. Parece que falta un rechazo, pero mirando qué gana B:

- No toca la fila de A.
- No impide que A registre la suya.
- No se atribuye nada de A: el `auth_user_id` lo pone el servidor.
- Sólo consigue **registrar un evento suyo** con un número que casualmente
  coincide con uno de A. Que es lo mismo que podría hacer con cualquier otro UUID.

**No hay apropiación que rechazar.** El ataque no existe porque la identidad no
viaja en el cuerpo, y por tanto no hace falta detectarlo.

---

# 2 · Decisión final de constraints

```sql
-- REQUISITO. NO EJECUTAR.
create unique index concurrently scores_evt_uk
  on public.scores (auth_user_id, evento_id) where evento_id is not null;
create unique index concurrently actividad_evt_uk
  on public.actividad (auth_user_id, evento_id) where evento_id is not null;

revoke insert (auth_user_id) on public.scores    from anon, authenticated;
revoke insert (auth_user_id) on public.actividad from anon, authenticated;
```

**Esquema 2, y sólo el 2.** Tres razones, por orden:

1. **Es el único que no permite que un empleado impida a otro registrar un
   evento** — y en un iPad compartido ese ataque es practicable, no teórico.
2. **Da la misma idempotencia** que el global para el caso que de verdad ocurre:
   A reintentando lo suyo.
3. **El índice parcial deja intactas** las 427 puntuaciones y las 5 actividades
   existentes: `NULL` no colisiona consigo mismo.

**El `revoke` no es accesorio: sin él el esquema 2 se degrada al 1 en el peor
sentido.** Si el cliente pudiera escribir `auth_user_id`, B podría mandar el
`event_id` de A **con el `auth_user_id` de A**, y entonces sí quemaría su espacio.
Es la línea que sostiene todo el análisis.

**Riesgo residual aceptado:** dos dispositivos de la misma persona generando el
mismo UUID v4. Probabilidad 2⁻¹²². No se mitiga.

**Pendiente de verificar (R2 de la especificación):** que PostgREST devuelva
`23505` en un `INSERT` duplicado contra un índice único **parcial**. Es el
comportamiento documentado; no lo he comprobado contra este servidor.

---

# 3 · Medición real de almacenamiento

Chromium, con una base local construida a los tamaños que tienen las fichas **en
producción** (medidos en la nube: `topic_scores` ~150 B, `known_dishes` hasta
830 B, `exam_correct` ~470 B, `sessions_data` hasta 1 400 B, `achievements`
~230 B, `extras` hasta 680 B), más las 50 sesiones locales y el diario de 14 días
de la fase 2, que no viaja a la nube.

### La base local

| | |
|---|---|
| **Una ficha** con 50 sesiones y diario | **11,7 KB** |
| **`txoko_data_v4` con 22 fichas** (el iPad de barra por el que ha pasado todo el equipo) | **258,2 KB** |

### Un evento y la cola

| | |
|---|---|
| Evento de `scores` | **263 bytes** |
| Evento de `actividad` (el mayor, con `meta`) | **357 bytes** |
| **100 eventos** | **35,0 KB** |
| **500 eventos** | **174,8 KB** |

### El techo real del navegador

| | |
|---|---|
| **`localStorage` reventó a los** | **5 100 KB** con `QuotaExceededError` |
| `navigator.storage.estimate().quota` | **818 MB** |

> **Cuidado con ese 818 MB:** es la cuota del origen para IndexedDB y CacheStorage,
> **no para `localStorage`**, cuyo techo medido es **5 MB**. Quien dimensione la
> cola mirando `estimate()` se equivocará por un factor de 160.

### El presupuesto, en claro

```
  techo de localStorage       5 100 KB   100 %
  txoko_data_v4 (22 fichas)     258 KB     5,1 %
  cola de 500 eventos           175 KB     3,4 %
  resto de claves (~10 KB)       10 KB     0,2 %
  ───────────────────────────────────────────────
  libre                       ~4 657 KB    91 %
```

**Los bytes no son el límite.** Ni de lejos.

### Lo que SÍ es el límite: el coste de encolar

`_colaCargar()` parsea la cola **entera** en cada encolado, y encolar ocurre en
cada guardado. Medido — leer + parsear + buscar + añadir + serializar + escribir:

| eventos | tamaño | coste de UN encolado | estimado en un móvil de gama media (×4) |
|---|---|---|---|
| 50 | 17,5 KB | 0,25 ms | ~1 ms |
| 100 | 35 KB | 0,28 ms | ~1 ms |
| 250 | 87,4 KB | **1,57 ms** | ~6 ms |
| **500** | **174,8 KB** | **3,27 ms** | **~13 ms** |
| 1 000 | 349,6 KB | 5,75 ms | ~23 ms |
| 2 000 | 699,2 KB | 10,21 ms | ~41 ms |

**El codo está entre 250 y 500.** A 500 eventos, incluso con una penalización de
×4 por ser un móvil viejo, un encolado cuesta ~13 ms: por debajo de los 16 ms de
un fotograma. A 1 000 ya se sale, y a 2 000 se nota.

> La extrapolación ×4 es una **estimación**, no una medida: he medido en Chromium
> de escritorio. Conviene confirmarla en un móvil del equipo antes de fijar el
> número. Aun así, el margen a 500 es cómodo.

---

# 4 · Decisión final de límites

| Parámetro | Valor | Por qué |
|---|---|---|
| **Máximo de eventos** | **500** | **Por CPU, no por bytes.** Es donde el coste de encolar se mantiene bajo un fotograma incluso con penalización de móvil |
| **Tope de tamaño** | **512 KB** | **Red de seguridad, no límite operativo.** A 500 eventos normales son 175 KB; sólo salta si un `meta` se dispara. Quien llegue antes, manda |
| **Reserva para evaluaciones** | **los últimos 100 huecos** (a partir de 400) | 100 evaluaciones son ~35 KB y cubren varias semanas de exámenes sin red |

**Los tres números se confirman, pero por una razón distinta a la que los propuso.**
En la especificación los justifiqué por espacio; la medición dice que el espacio
sobra (3,4 % de la cuota) y que **el binding constraint es el tiempo de CPU de
cada encolado**. Los números aguantan; el argumento cambia.

**Y una consecuencia de diseño que sale de aquí:** si algún día hiciera falta una
cola mayor, la respuesta **no** es subir el número, sino dejar de reparsear la cola
entera en cada encolado — un índice en memoria, o IndexedDB, que sí escala. Eso es
otra fase.

---

# 5 · Comportamiento exacto al llenarse

**Regla que no se rompe: nunca se descarta en silencio una evaluación ni un
simulacro de alérgenos.** Ni por antigüedad, ni por espacio, ni por nada.

| Situación | Comportamiento exacto |
|---|---|
| **399 eventos y entra uno** | Entra, sea de la prioridad que sea. Cola en 400 |
| **400 eventos** | Se cruza el umbral de reserva. A partir de aquí **los 100 huecos restantes son sólo para evaluaciones** (prioridad 1 y 2) |
| **400 y llega una práctica o un juego** (prioridad 3) | **No se encola.** Se incrementa `descartados_por_espacio`, se anota `{tipo, ts}` en un registro de descartes y **el chip de sincronización lo dice**. Explícito, visible y contado |
| **400 y llega una evaluación** | Entra. Sigue entrando hasta 500 |
| **500 eventos, todos evaluaciones** | Cola en estado **`bloqueada`**. **No se descarta nada** |
| **Bloqueada y llega otra evaluación** | **No se pierde el hecho, pero tampoco se encola.** Se avisa con un mensaje que no se puede descartar de un toque: *«Hay 500 pruebas sin enviar. Conecta el móvil a una red para no perderlas.»* El resultado del examen **sí se guarda en local** y el progreso de la ficha sigue sincronizándose por su propia cola, que es independiente |
| **Hay juegos o prácticas que podrían eliminarse** | **No se eliminan.** Sólo se descartan **al encolar**, nunca retroactivamente. Una vez dentro, un evento no se borra para hacer sitio: eso sería descarte silencioso con otro nombre |
| **Sólo quedan evaluaciones** | Es el estado `bloqueada`. La única salida es red |
| **Vuelve la conexión** | El vaciado drena por prioridad (alérgenos primero) y luego por antigüedad. Al bajar de 400 se vuelve a aceptar todo y el aviso desaparece |
| **Se supera 512 KB antes de los 500** | Mismo comportamiento que al llegar a 500: **bloqueada**. Y se registra, porque significa que algún `meta` está creciendo más de lo previsto |

### Una honestidad sobre el caso «bloqueada»

Cuando la cola está bloqueada y ocurre una evaluación más, **ese hecho no llega a
la nube**. No lo pinto de otro color: es pérdida. Lo que el diseño garantiza es
que:

1. **no es silenciosa** — el empleado lo ve antes de hacer el examen, no después;
2. **no sacrifica lo ya guardado** para hacerle sitio;
3. **hacen falta 500 evaluaciones sin una sola conexión** para llegar ahí, que con
   ~10 al día son **cincuenta días** de un móvil que nunca ve una red.

Si ese escenario se diera de verdad, el problema no es la cola.
