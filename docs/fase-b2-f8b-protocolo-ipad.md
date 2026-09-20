# B2 · F8(b) · Protocolo de medición en el iPad

F8(b) es la única parte de B2 que **no se puede hacer desde aquí**. Necesita el
iPad del equipo, WebKit de iPadOS y, para una de las ocho, siete días reales.
Este documento es lo que tiene delante quien lo ejecuta.

**Estado: NOT VERIFIED.** No hay iPad en el entorno de desarrollo, y el criterio
de cierre no admite sustituto:

> **I8.1** — si WebKit demuestra una limitación estructural que impida la
> retención offline prevista, B2 NO se declara cerrada y se abre rediseño.
> *No hay excepción a esto y no se sustituye por una estimación.*

**Chromium, Playwright, un simulador o un emulador NO valen como evidencia.**
El motor tiene que ser el de iPadOS, en el aparato.

---

## El instrumento

**https://claude.ai/artifact/1JwUYr6qV7GkPqZNz595CH**

No toca Meseo: escribe y borra sus propias claves en su propio origen. El techo
de `localStorage` es una política del navegador **por origen**, así que el
número es representativo del que tendrá meseo.es.

No hace falta cambiar nada de B2 para ejecutarlo. La aplicación se queda como
está.

---

## Antes de empezar · lo que hay que anotar

En iPadOS el navegador se identifica como un Mac de escritorio, así que **el
modelo y la versión no se pueden leer por código**. La sonda tiene campos para
escribirlos y los incluye en los resultados que copies.

| Dato | Dónde se mira |
|---|---|
| Modelo exacto del iPad | Ajustes › General › Información › Nombre del modelo |
| Versión exacta de iPadOS | Ajustes › General › Información › Versión del software |
| Espacio libre aproximado | Ajustes › General › Almacenamiento del iPad |
| Navegación privada sí/no | si la pestaña está en modo privado |
| **Safari o PWA** | pestaña normal, o añadida a la pantalla de inicio |
| Versión de Meseo instalada | pie de la pantalla de login |
| Fecha y hora | la sonda la registra sola |
| Conexión utilizada | wifi del restaurante, 5G, modo avión… |

**Safari y la PWA son entornos separados y no se mezclan.** La sonda guarda un
sello distinto para cada uno y dice en cuál estás. Hay que ejecutarla **dos
veces**: una en pestaña y otra con la página en la pantalla de inicio.

---

## Las ocho mediciones

### En una sola sesión · M1, M2, M7, M8

Botón **«Medir M1 · M2 · M7 · M8»**.

| ID | Qué mide | Pasa si |
|---|---|---|
| **M1** | Techo real de `localStorage`, releyendo **cada** escritura y repasando al final todas las anteriores | comportamiento determinista, sin pérdida silenciosa ni corrupción |
| **M2** | Un evento B2 real guardado al 50, 75, 90, 95 y 99 % del techo, releído en el acto | `evento_id`, `uid`, `ts` y `datos` intactos en todos los niveles |
| **M7** | `navigator.locks`: presencia, `request()` y **exclusión mutua de verdad** con dos intentos concurrentes | disponible y sin solapamiento |
| **M8** | `crypto.randomUUID`: 100 identificadores | 100/100 válidos, 0 vacíos, 0 duplicados |

Que `setItem` no lance **no basta** en M1 ni en M2: lo que decide es la
relectura inmediata.

Si `navigator.locks` no existe, anótalo y no se fuerza nada: B2 cae entonces a
la bandera `_evDrenando`, que protege dentro de una pestaña pero **no cruza
pestañas**. Eso es un dato del informe, no un fallo que arreglar aquí.

### Con el aparato en la mano · M3, M4, M5

Botón **«Comprobar sello»**. El sello se escribe y se comprueba; la fila «escrito
hace» dice cuánto aguantó.

- **M4 · cerrar y reabrir** — escribe el sello, cierra Safari del todo (deslizar
  arriba en el selector de apps), reábrelo y comprueba **antes de nada**.
- **M3 · reinicio completo** — con el sello escrito, apaga y enciende el iPad.
  Vuelve a la página y comprueba antes de conectar nada.
- **M5 · Safari vs PWA** — repite M3 y M4 con la página añadida a la pantalla de
  inicio. La sonda enseña los dos sellos por separado; si se comportan distinto,
  se documenta.

### La que marca el calendario · M6

**Siete días reales. No se acelera, no se simula, no se toca `Date.now()`.**

- **Día 0** — escribe el sello, anota el entorno, y **no lo borres**. Déjalo en
  modo avión si puedes.
- **Día 7** — abre la página y comprueba **antes de conectar**. Si el sello sigue,
  el almacenamiento sobrevivió; si no, WebKit lo desalojó.

Conviene arrancarla **el mismo día** que las demás, en paralelo: es la que fija
la fecha de cierre de B2.

---

## Cómo se lee el resultado

Los números de M1 y M2 se contrastan contra los dos umbrales que hoy son cifras
de Chromium de escritorio:

| Constante | Valor actual | Qué decide |
|---|---|---|
| `EV_LIMITE_DURO` | 1000 eventos | cuántos caben antes de saturar |
| `EV_PRESUPUESTO` | 512 KB (UTF-16) | cuándo se considera llena la cola |

La sonda calcula qué porcentaje del techo real ocupan ambos. Si 512 KB resultan
ser una fracción grande del techo de WebKit, los umbrales están mal calibrados y
hay que ajustarlos — **pero eso es una fase posterior, no F8(b)**.

**El resultado de F8(b) es uno de estos tres, y no se aproxima:**

- `F8(b) — PASS — WEBKIT VERIFICADO` — las ocho con evidencia real de iPad,
  Safari y PWA diferenciados, sin pérdida silenciosa, y los siete días cumplidos.
- `F8(b) — FAIL — REVISAR PERSISTENCIA OFFLINE` — alguna demuestra una
  limitación estructural incompatible con la retención offline. Abre rediseño,
  probablemente a IndexedDB.
- `F8(b) — NOT VERIFIED — REQUIERE IPAD REAL` — falta alguna. Una medición que
  no se pudo hacer **no se convierte en PASS**.

---

## Qué NO hay que tocar para ejecutar esto

Nada de la aplicación. En concreto: la cola de eventos, `_eventoCrear`,
`_eventoEnviar`, `_eventosDrenar`, `txk_eventos_v1`,
`txk_eventos_sin_identidad`, `txk_eventos_cuarentena`, `EV_LIMITE_DURO`,
`EV_PRESUPUESTO`, Auth, RLS ni Supabase. La sonda es una página aparte y mide el
navegador, no Meseo.
