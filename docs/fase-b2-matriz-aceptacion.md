# B2 · F7 · Matriz de aceptación, fila por fila

Cierre de la red de seguridad. El plan operativo (`docs/fase-b2-plan-operativo-F0-F8.md`)
define F7 como *«completar la matriz de §Aceptación; ejecutar todas las mutaciones
y dejar constancia de cuál cae con cada una; verificar que la CI sigue siendo Node
puro y que `allergen-audit` sigue en 0/0»*. Su invariante es **I7.1 — ninguna
invariante crítica sin mutación que la demuestre**.

Este documento es la constancia. No añade comportamiento: dice, para cada una de
las 26 filas de la matriz, **qué prueba la demuestra** y **qué mutación la mata**.

Se ejecuta con:

```
node tests/smoke.mjs              # 547 pruebas · ~1 min · es lo que corre la CI
node tests/mutaciones.mjs --lista # 57 anclas   · <1 s   · lo que se pudre
node tests/mutaciones.mjs         # 57 mutaciones · ~55 min
node tests/allergen-audit.mjs     # 0 / 0
```

---

## Las 26 filas

| # | Requisito | Prueba que lo demuestra | Mutación que la mata |
|---|---|---|---|
| 1 | Ana crea evento offline **con** JWT persistido | `C+D · 7 · FILA 1 cerrada · tras el arranque, la actividad SÍ tiene dueño` · `C+D · 6` | `AUTH-1`, `AUTH-3`, `AUTH-7` |
| 2 | Ana crea evento offline **sin** JWT | `SIN IDENTIDAD · el evento huérfano se guarda aparte y NO entra en la cola` · `F2 · sin ningún JWT el evento NO se envía y va a sin_identidad` | `F2-2` |
| 3 | Bruno entra después | `F3 · Bruno no drena lo de Ana` · `F2 · las CUATRO comprobaciones de envío` | `F3-1`, `F6-1` |
| 4 | **Bruno no puede enviar ni apropiarse del evento de Ana** | `F2 · Bruno no puede enviar ni apropiarse del evento de Ana` · `SIN IDENTIDAD · Bruno tampoco lo adopta` | `F3-1`, `F3-3` |
| 5 | Ana vuelve online y sincroniza | `F3 · pendiente + red → se sincroniza y sale de la cola` (y el orden por prioridad, alérgenos primero) | `F3-8` |
| 6 | **Cambio Ana → Bruno durante un `await`** | `F3 · si la identidad cambia A MITAD del ciclo, el resto no sale` | `F3-2` |
| 7 | Reintento del mismo `evento_id` | `F7 · fila 7 · tres fallos y un éxito: el MISMO evento_id las cuatro veces` | `F2-3` |
| 8 | Mismo `evento_id` usado por otro usuario | `F1 · el índice es PARCIAL y COMPUESTO con la identidad` · `F1 · NO existe un UNIQUE(evento_id) global` | `F1-1` |
| 9 | JWT **realmente** caducado | `F3 · exp caducado → renovación por la vía existente, y sin gastar petición` | `F3-7` |
| 10 | JWT **no** caducado pero inválido | `F3 · PGRST301 con exp vivo es credencial inválida, y NO hay bucle` · `F3 · la clasificación de PGRST301 NO se ha tocado` | `F3-7` |
| 11 | `23505` | `F3 · 23505 del índice esperado es ÉXITO idempotente` · `F3 · 23505 de OTRO índice NO es duplicado` | `F3-5` |
| 12 | `23503` | `F3 · 23503 y cualquier otro 409 van a cuarentena, no a éxito` | `F3-4` |
| 13 | `42501` | `F3 · 42501 no entra en bucle: cuarentena y no se vuelve a pedir` | `F3-4` |
| 14 | 400 determinista | `F3 · 400 determinista: 23514 y 23502 a cuarentena, PGRST204 a revisar` | `F3-4` |
| 15 | timeout / 5xx | `F3 · timeout y 5xx CONSERVAN el evento` · `F7 · fila 15 · backoff CRECIENTE, y nunca cuarentena` | `F3-6`, `F7-1` |
| 16 | **Fallo de `setItem`** | `F2 · QuotaExceededError no se oculta` · `F4 · un setItem que no lanza pero no guarda tampoco cuela` | `F2-1`, `F5-3` |
| 17 | Cola con 399 | `F4 · por debajo de 400 la práctica entra; a partir de 400 ya no` | `F4-4` |
| 18 | Cola con 400 | `F4 · por debajo de 400 …` · `F6 · los descartes por espacio se ven` | `F4-2` |
| 19 | Cola con 500 | `F7 · fila 19 · con 500 en cola hay aviso, y NADA se rechaza` | `F4-3` |
| 20 | **Cola llena sólo de evaluaciones** | `F4 · cola llena de EVALUACIONES: ninguna se desaloja, ni por FIFO` · `F4 · no existe ninguna ruta de desalojo` | `F4-1` |
| 21 | Cuarentena llena | `F5 · sin sitio, la prioridad 3 se COLAPSA` · `F5 · prioridad 1 y 2 NUNCA se colapsan` | `F5-1`, `F5-2` |
| 22 | Logout durante el vaciado | `F3 · si la identidad cambia A MITAD del ciclo` · `F0 · salir y entrar sustituyen el contexto ENTERO` | `F3-2`, `F0-2` |
| 23 | Recarga offline | `C+D · 10 · FILA 23 cerrada · pendiente + recarga + sesión válida → drena` · `C+D · 8` | `AUTH-2`, `AUTH-6` |
| 24 | **Versión antigua cargando la cola B2** | `F7 · fila 24 · una versión antigua no conoce las claves de B2 y no las borra` | — *(ver «Deuda»)* |
| 25 | Dos operaciones concurrentes | `F3 · dos drenajes a la vez no duplican el envío` · `F3 · un 2xx que no demuestra nada NO saca el evento` | `F3-9` |
| 26 | **Evento persistido y cierre inmediato** | `F7 · fila 26 · el evento está en disco ANTES de que salga la petición` | `F2-3` |

**Las 26 filas quedan demostradas por una prueba que se ejecuta.** Las dos que
faltaban —1 y 23— las cierra la corrección C+D; abajo queda el historial de lo
que estaba roto y cómo se arregló.

---

## Filas 1 y 23 · CERRADAS por la corrección C+D

*(Lo que sigue documenta el defecto tal como estaba. La corrección se describe al
final de esta sección.)*

**Diagnóstico original**, hecho durante F7 y dejado sin tocar entonces porque
arreglarlo significaba cambiar la identidad, que F7 tenía prohibido.

### Lo que dice la matriz

| # | Requisito | Fallo que haría B2 **NO APROBADA** |
|---|---|---|
| 1 | Ana crea evento offline **con** JWT persistido → evento en `txk_eventos_v1` con `uid` de Ana | **que nazca con `uid:null` teniendo JWT** |
| 23 | Recarga offline → `uid` recuperado del JWT persistido | que pierda el dueño |

### Lo que hace el código, medido

`index.html`, el manejador de `onAuthStateChange`:

```js
const t = (sesion && sesion.access_token) || null;
const a = _authCtx();
_authPoner({ uid: a.uid, empleado: a.empleado, token: t, … });
```

El `uid` se **conserva del contexto anterior**; no se deduce del token. En una
recarga el contexto arranca vacío, así que `a.uid` es `null`. Ejecutado sobre el
manejador real (`scratchpad/probe-uid.mjs`):

```
1 · pestaña recién abierta:
    {"uid":null,"token":null,"exp":0,"empleado":null,"estado":"anonimo"}
2 · GoTrue restaura de disco la sesión persistida de Ana:
    {"uid":null,"empleado":null,"token":"eyJ…","exp":2000000000,"estado":"activa"}

   sub del token restaurado : 11111111-1111-4111-8111-111111111111
   uid del contexto         : null
   estado                   : activa
```

El contexto queda **internamente incoherente**: `estado:'activa'`, un token válido
cuyo `sub` es Ana, y `uid:null`. El único sitio que sí deduce el `uid` del token
—`_authSesionEntrar`, con `s.uid || _jwtSub(s.access_token)`— sólo corre al
**entrar**, y necesita red.

### Qué se rompe

1. Un evento creado tras recargar va a `txk_eventos_sin_identidad`. La superficie
   de F6 dirá, con razón, *«no se pueden asignar a nadie… hay que repetirlas»*.
2. `_eventosDrenar` sale por `if(!ctx.uid) return 'sin-identidad'`, así que **la
   cola que Ana ya tenía tampoco se vacía** hasta que vuelva a entrar — y entrar
   necesita red, que es justo lo que no hay.

Es la fila 1 en negrita de la matriz: *«que nazca con `uid:null` teniendo JWT»*.

### Cómo se arregló (C+D)

- **`_authDeSesion(sesion, empleado)`** es ahora la única puerta por la que una
  sesión se vuelve identidad: exige token, usuario, `sub(token) === user.id` y
  `exp` en el futuro, y devuelve el contexto **entero o nada**.
- **`_authArrancar()`** reconstruye la identidad al arrancar desde
  `getSession()`, que **lee del disco y no de la red**: sin cobertura la
  identidad se recupera igual. Era el caso que fallaba para siempre.
- **Cuatro estados** en vez de dos: `initializing` ya no se confunde con
  `anonymous`.
- **`onAuthStateChange` distingue el evento**: `SIGNED_OUT` vacía; el resto
  reconstruye desde la sesión. Ya no existe «uid de antes con token nuevo».
- **El drenaje exige `authenticated`** y un token vivo; el **alta no se bloquea
  nunca**, y lo creado durante el arranque sigue siendo huérfano para siempre.
- **`_authTrasIdentidad`** da a la cola una oportunidad inmediata al pasar a
  `authenticated`, reutilizando el drenaje y su cerrojo.

Lo demuestran las 19 pruebas `C+D · …` y las mutaciones `AUTH-1` a `AUTH-10`.

---

## Lo que F7 destapó

F7 no añade comportamiento, así que su valor es lo que encuentra. Encontró seis
cosas, y **cinco eran fallos en la propia red de seguridad**, no en B2.

1. **Una prueba tautológica.** `assert(x.evento_id === x.evento_id, 'id estable')`
   comparaba un valor consigo mismo: no podía fallar. Cubría la fila 7, que
   ahora demuestra de verdad tres fallos y un éxito con el mismo identificador.
2. **Un ancla escrita de memoria.** La mutación del `23505` se agarraba a
   `_EV_INDICE[ev.destino] || ' '`, pero el centinela real es un **NUL literal**,
   no un espacio. Nunca se habría aplicado, y la garantía de la fila 12 habría
   quedado sin demostrar en silencio. Lo cazó el verificador de anclas.
3. **El verificador podía corromper lo que verifica.** El contenedor murió a
   mitad de una batería y dejó `index.html` **mutado** en el árbol de trabajo,
   con un texto de interfaz alterado. Un `finally` no para un SIGKILL. Ahora
   guarda una copia intacta y un centinela en disco, y se recupera al arrancar
   — antes de comprobar anclas, porque con el fichero corrupto el ancla no
   aparece y el verificador salía sin arreglar nada.
4. **La guarda de anclas se mordía la cola.** Vive dentro de la misma suite, y
   una mutación consiste justo en quitar el texto que ella vigila: se ponía roja
   con **todas**, así que el verificador veía la suite roja siempre y daba por
   «detectada» hasta una mutación que nadie protegía. Diez llegaron a contarse
   así. La señal `MUTANDO` la silencia mientras hay una mutación puesta, y una
   caída de I7.1 nunca cuenta como detección.
5. **La reanudación se tragaba un fallo.** Tras un reinicio, el centinela
   recordaba qué mutaciones se habían *ejecutado*, no su *veredicto*: una que
   había **sobrevivido** se dio por buena y la batería anunció «las 47
   detectadas» con un agujero dentro. Ahora sólo se saltan las que pasaron, la
   firma incluye el verificador y la suite, y las supervivientes se repiten.
6. **Fixturas frágiles que mataban la suite entera.** Dos escenarios asumían que
   siempre queda un evento en la cola; con ciertas mutaciones explotaban con un
   `TypeError` a nivel de módulo y **F3, F5, F6, F7 y F0 no llegaban a
   ejecutarse**. El verificador sólo veía «la suite no llegó a ejecutarse» y lo
   contaba como detección. Ahora fallan diciendo qué esperaban.

Y una sola cosa en B2 — y no es un fallo de comportamiento:

7. **Código muerto en F3.** La línea
   `if(res.estado === 'renovar') return 'credencial-no-renovable';` es
   **inalcanzable**: la rama anterior siempre retorna. Medido convirtiéndola en
   un `throw`, que no pone roja ni una prueba. La garantía de la fila 10 —una
   sola renovación por ciclo— la sostiene el `return 'renovada-sesion'`, y ésa
   es la línea que ahora muta F3-7. **La línea muerta se deja donde está:
   quitarla sería modificar F3, que F7 no puede tocar.** Queda apuntada aquí.

---

## Deuda y ambigüedades

- **Fila 24 sin mutación.** La prueba es estructural (ninguna clave de B2 se
  nombra fuera del bloque de eventos, y no hay `removeItem` ni `clear()`). Una
  mutación tendría que introducir código nuevo, no alterar el existente, y el
  catálogo sólo sustituye texto. La prueba sí cae si alguien añade ese código.
- **La línea muerta de F3** (punto 7 de arriba). Quitarla es trivial y seguro,
  pero es un cambio en F3 y necesita tu visto bueno.
- **La rama `renovar` DENTRO del bucle de drenaje ha quedado casi inalcanzable**
  tras C+D. La puerta detecta el token muerto antes de entrar, así que sólo se
  llegaría ahí si el `exp` cruza durante el propio ciclo —milisegundos—. No es
  un fallo: la renovación ocurre ahora antes y sin gastar una petición, y la
  mutación `F3-7` se ha mudado a donde vive la garantía. Queda apuntado porque
  es código que ya casi no corre.
- **`colapsados` crece sin tope** en la cuarentena (documentado en F5, no
  cerrado a propósito).
- **`_eventoQuitarDeCola` no comprueba el resultado de su escritura** (idem).
- **`employees_identidad_inmutable` no protege nada** — `current_user` dentro de
  una función `SECURITY DEFINER` es el dueño. Ajeno a B2.
- **El hash del PIN sigue siendo una credencial al portador.** Ajeno a B2.

---

## Estado de la CI

Node puro, sin dependencias y sin navegador, como exige el plan:

- `.github/workflows/ci.yml` ejecuta `npm test` y nada más — sin `npm install`,
  sin `npm ci`, sin Playwright.
- `package.json` no declara `dependencies` ni `devDependencies`.
- `tests/smoke.mjs` sólo importa de `node:`.

Lo vigila `F7 · la CI sigue siendo Node puro: ni Playwright ni dependencias`.
Las medidas con Chromium de F6 son herramientas de sesión, no parte de la suite.
