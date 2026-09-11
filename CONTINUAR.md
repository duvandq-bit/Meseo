# Por dónde seguir

Estado a **11 de septiembre de 2026** · versión **7.442** · 334 pruebas en verde ·
auditoría de alérgenos 0/0.

---

## 🔴 Lo único que bloquea algo ahora mismo

**M.B. no puede abrir hasta que cocina conteste las treinta y una preguntas.**

Su carta sigue en `docs/carta-mb-borrador.json`, fuera de `data/`. Ya son **30
fichas**: los 13 platos del degustación y la carta, los 7 de panes y
mantequillas y los 10 vegetarianos. En veintinueve casos la ficha declara un
alérgeno y no dice de dónde sale; en cuatro pasa lo contrario, y ésos son los
que corren prisa:

- el **ponzu** de la Remolacha se hace con katsuobushi (bonito) y el plato no
  declara Pescado ni Soja — y está en la carta **vegetariana**;
- las notas del **Puerro** dicen que el crujiente es de apio, y el plato no
  declara Apio;
- el **Apionabo** es raíz de apio, con crema de apio, y tampoco lo declara.

La lista completa está en `docs/mb-preguntas-cocina.md`, y el documento para
que cocina lo rellene, en `docs/MB-preguntas-cocina.docx`.

Mientras tanto **la cuenta de administración sí entra a M.B.**, con la carta
vacía, para poder revisar el carro de quesos (48, ya cargado). Un restaurante
sin carta se abre a cero, nunca con los platos del anterior.

**Cómo se entra a M.B.: NO desde la tarjeta del login** —ahí sale bloqueado y
seguirá bloqueado hasta que abra— sino entrando con la cuenta `Administrador`
y cambiando en **Ajustes → Restaurante (admin)**. Tocar la tarjeta del login
ahora lo explica en vez de no hacer nada.

El código de acceso de Txoko ya está generado (10 sep). Los nuevos pueden
registrarse.

---

## Qué es esto

Una PWA de formación de sala para **Txoko by Martín Berasategui** (Ritz-Carlton
Abama, Tenerife). Un solo archivo, `index.html`, con todo el JavaScript dentro;
sin framework y sin compilación. Los datos grandes viven en `data/*.json` y la
nube es Supabase.

**M.B.**, el dos estrellas del mismo grupo, está de camino: dado de alta como
«Próximamente» y esperando su carta.

---

## Cómo se trabaja aquí

1. Editar.
2. `node tests/smoke.mjs` → todo en verde.
3. `node tests/allergen-audit.mjs` → **0 NO DECLARADO · 0 SIN ORIGEN**.
4. Comprobar en navegador lo que se ve (hay Chromium y Playwright instalados).
5. Subir la versión en **tres sitios**: `APP_VERSION`, `<meta name="app-version">`
   y `VERSION` en `sw.js`. Un guard de CI comprueba que coinciden.
6. Commit en español, PR, esperar los dos checks, fusionar en squash.

**La rama de trabajo es `claude/check-app-version-rDp39`.** Después de fusionar:
`git fetch origin main && git reset --hard origin/main && git push --force-with-lease`.

---

## Trampas que ya han mordido

Cada una costó una reversión o una vergüenza. Están aquí para que no vuelva a
pasar.

### Proteger sólo los ascensos deja el mando por el otro lado

La regla era «sólo el propietario ASCIENDE». Un manager no podía nombrar a
nadie… pero **sí podía degradar a otro manager de su restaurante** y dejarlo sin
panel. Comprobado contra la base: devolvía `ok` y el rol cambiaba. Ahora
**cualquier** cambio de rol exige ser el propietario, y los botones ni se
pintan para quien no lo es. Al escribir un permiso, mirar las dos direcciones.

### Una columna sin permiso tumba la consulta ENTERA

El fallo más caro de septiembre y el más difícil de ver. `venue`,
`display_name`, `role` y `nda_version` se crearon **sin concederle lectura a la
clave anónima**. PostgREST no devuelve la fila con menos campos: rechaza la
consulta entera con «permission denied». Como `supaRestoreEmployee` las pide
todas en `_EMP_COLS`, fallaba SIEMPRE — y con ella se caían en silencio el rol,
el restaurante, el nombre visible y la firma. Desde fuera sólo se veía «la
cuenta de administración no tiene panel», reportado tres veces.

**Si se añade una columna a `_EMP_COLS`, hay que concederla** en
`supabase/permisos_columnas_empleados.sql`. Y comprobarlo como `anon`, no como
propietario de la base: `set local role anon;` y lanzar la consulta exacta.

Un `return false` en silencio ante un error de permisos es indistinguible de
«no hay datos». Ahora queda anotado en `window._syncFallo` y **sale en
Ajustes**, junto a la versión, el usuario, el rol y el restaurante.

### `getEmp` creaba fichas duplicadas por las mayúsculas

El rol y el restaurante los guarda la nube bajo el nombre **tal como está
allí** (`r.name`). Se entra con el que se teclea, o con el que quedó en la
sesión de hace noventa días. Si no coincidían en la caja, `getEmp` creaba una
ficha NUEVA, vacía y sin rol, bajo el nombre tecleado — y desde ahí la app leía
esa. La cuenta de administración perdía el panel y el selector de restaurante
**a mitad de sesión**, sin que nada pareciera roto.

Se reprodujo así: `_esAdmin()` daba `true`, se abría Ajustes, y pasaba a
`false`. Ahora `getEmp` y `_ficha` buscan sin mirar mayúsculas. Si se añade
algo que busque en `DB.employees` por clave exacta, vuelve el problema.

**La versión, el usuario, el rol y el restaurante salen en Ajustes**, abajo del
todo. Para no volver a perder una tarde preguntando «¿qué versión te corre?».

### La administración no puntúa: lo dice el SERVIDOR, no el móvil

`getEmp()` crea la ficha local **sin rol**, así que entre entrar y que baje la
ficha de la nube hay una ventana en la que `_esAdmin()` es falso y la escritura
se cuela. Por ahí entraron 50 XP en septiembre y otros 90 **después** de
«arreglarlo». Ahora lo recorta un trigger (`supabase/administracion_no_puntua.sql`)
y no hay ventana. El corte del cliente se queda, pero sólo para ahorrar viajes.

**La cuenta SÍ tiene panel de supervisor.** Estuvo un día sin él por una
extrapolación: el propietario pidió que no apareciera «en las puntuaciones» y se
escribió como «no deja rastro», que no es lo mismo. Mirar el panel no deja
rastro, y detrás hay un PIN de todas formas.

### Un control que rechaza en silencio parece roto

La tarjeta de M.B. en el login rechazaba el toque sin decir nada: sólo una
etiqueta diminuta de «Próximamente» que no parece un motivo. El propietario
intentó entrar por ahí varias veces y reportó tres veces que «no se puede
seleccionar M.B.». El código hacía exactamente lo que debía; lo que faltaba era
decirlo. Un `return` mudo en algo que se toca es un fallo de producto.

### Lo que se carga «siempre» se carga también en el restaurante equivocado

`data/wines.json` se pedía en SIETE sitios, sin restaurante y sin condición. El
día que M.B. entrara, su equipo habría abierto Vinos y visto los 149 vinos de
Txoko como suyos. Y no bastaba con cambiar la ruta: los 71 usos de `WINES`
preguntan «¿hay lista?», nunca «¿es de aquí?», así que la lista del anterior
sobrevivía al cambio de restaurante. Hace falta las dos cosas: ruta por
restaurante Y tirar lo cargado al cambiar (`_vinosVigilar`).

### Un campo que baja de la nube y no se guarda no existe

`role` viajaba en `_EMP_COLS` desde que se creó la cuenta de administración,
pero **ninguno de los dos sitios que convierten la fila en ficha local lo
copiaba**. Resultado: `_esAdmin()` era siempre falso en el móvil, así que la
cuenta que «no deja rastro» **estaba escribiendo XP como cualquiera** (50 XP
encontrados en la nube) y su selector de restaurante no aparecía nunca en
Ajustes. Se vio al ir a colgar el panel del rol. Si se añade una columna, hay
que seguirla hasta el objeto que usa la app.

### `scores` guarda dos cosas distintas con la misma forma

Evaluaciones (`score` sobre `total` preguntas) y MARCADORES de juego: récord
Txoko (`total`=1, `score` hasta 41) y El Turno (`total` hasta 2042). Son el 56%
de las filas. Mezclarlas daba **medias del 243%**. Cualquier cosa que calcule
una nota tiene que filtrar `_SUP_JUEGOS` — y el filtro está repetido a
propósito en la carga Y en `_supPerfil`, porque es la función que convierte
filas en nota y si un día le llegan en crudo el 243% vuelve en silencio.

### La fecha de alta no es la fecha de alta

`employees.registered_at` se rellenó el día que se creó la columna: da altas
POSTERIORES a la primera actividad (Dian figura de alta el 2 de septiembre y
entrena desde el 11 de marzo). La antigüedad del panel sale de su primera
prueba, y se rotula «en la app» — la antigüedad laboral la app no la sabe.

### Los alérgenos son una cadena, y se rompe por donde no se ve

`data/ingredients.json` → `DISH_COMPONENTS` → `DISH_ACTIONS` → `DISHES`. La
clave con la que la base encuentra un alérgeno **es el texto de la ficha tal
como queda al trocearla**, paréntesis incluidos: «Migas de Ibérico (Ibéricos y
miga de pan)» se convierte en `migas de iberico ibericos y miga de pan`, y ésa
es la entrada de la base.

Se intentó «limpiar» esos nombres y el plato 6 se quedó sin quien explicara su
Gluten. **Los nombres feos se limpian al PINTAR** (`_PASE_PEGADOS`), nunca en el
dato.

Peor: «Granadina» a secas **no lleva alérgeno** en la base, pero «Granadina
Vinagre de manzana» lleva Sulfitos. Acortarla los habría borrado en silencio.

### Un guard que no puede fallar no sirve

Ha pasado dos veces: escribir una comprobación que reproduce el mismo filtro que
el código en vez de comprobar el del código. **Siempre verificar que el guard
muerde**: romper la cosa a propósito y ver que salta.

Y una tercera, peor: un guard que **lee el código fuente con expresiones
regulares en vez de ejecutarlo**. El del resumen semanal comprobaba que el texto
de la función contuviera «Sin actividad»… y lo encontraba **en un comentario**.
Cuando el PR #433 borró de golpe las cinco líneas que construían el mensaje, las
seis comprobaciones siguieron en verde y `return L.join('\n')` se quedó
apuntando a una variable que ya no existía. **Dos días con la pantalla de
Análisis del supervisor reventada entera** —y con ella el Código de acceso, que
vive dentro— hasta que el propietario lo vio. Si un guard puede ejecutar la
función, que la ejecute.

Y un guard que mide algo aleatorio necesita margen: el del delator por insignia
tenía el umbral pegado al ruido y **fallaba el 2% de las tiradas sin que nada
estuviera roto**. Se mide la tasa real y se elige el umbral con ella.

### Cortar el HTML por texto lo corrompe

`DISH_COMPONENTS` es una sola línea larguísima. Cortarla buscando `]` la parte
por el primer corchete de un array de alérgenos. Si hay que trocear, contar
corchetes.

### Los tokens de diseño están al revés de lo que parecen

En `styles.css`, `--ink` (#f4ede2) es el **papel claro** y `--parchment`
(#1c2a22) la **tinta oscura**. En `data/themes.json` van al derecho. Poner
`--color-bg` de fondo deja texto oscuro sobre fondo oscuro.

### Las expresiones regulares se atragantan con los apóstrofos

`notes:'... cow\'s milk ...'` rompe un lector ingenuo y devuelve el campo vacío.
Eso produjo **dos falsas alarmas** («faltan las notas en inglés», «esta ficha es
de otro plato»). Para leer campos del HTML, usar un lector que respete los
escapes — o mejor, cargar las funciones reales de la app en un sandbox.

### Lo que se comprueba en el móvil no protege nada

La clave anónima de Supabase va escrita en el HTML. El código del restaurante,
la firma y el cambio de nombre visible **se validan en el servidor** con
funciones `security definer`. Si se mueve algo de eso al cliente, la puerta
vuelve a estar abierta.

---

## Dónde está cada cosa

| | |
|---|---|
| La carta de Txoko | dentro de `index.html`: `DISHES`, `DISHES_EN`, `DISH_COMPONENTS`, `DISH_ACTIONS` (172 KB) |
| La carta de otro restaurante | `data/carta-<id>.json` — ver `docs/carta-nuevo-restaurante.md` |
| Restaurantes, colores y nombres | `data/themes.json` |
| Ingredientes → alérgenos | `data/ingredients.json` (543 entradas) |
| Vinos | `data/wines.json` es la bodega de **Txoko**; otro restaurante trae `data/wines-<id>.json`. Sin archivo, no hay pestaña de Vinos |
| La carta de M.B. | `docs/carta-mb-borrador.json` — borrador, fuera de `data/` a propósito. 30 fichas |
| El marcaje (cubertería) | campo `marcaje` de cada plato de la carta. Txoko no lo tiene y no se inventa: sin campo, no se pinta el bloque |
| El acuerdo de confidencialidad | `data/nda.json` — **apagado** (`"activo": false`) |
| El acuerdo con el restaurante | `docs/acuerdo-restaurante-borrador.md` — no se enseña en la app |
| El PIN por restaurante | `supabase/supervisor_pin_por_restaurante.sql` — aplicado el 11 sep |
| Los avisos push | `supabase/functions/send-push/index.ts` — v4, filtra por restaurante |
| Permisos de columna | `supabase/permisos_columnas_empleados.sql` — **si añades una columna a `_EMP_COLS`, concédela ahí** |

No se toca la carta sin dato del propietario. **Nunca se inventa un plato, un
ingrediente, un vino ni un estándar.**

---

## Pendiente

### Del propietario — datos

- [ ] **M.B.: treinta y una preguntas para cocina.** Las 30 fichas están
      transcritas en `docs/carta-mb-borrador.json`, pero en 29 casos la ficha
      de cocina declara un alérgeno y no dice de dónde sale, y en 4 pasa lo
      contrario (ponzu con bonito en la Remolacha, apio sin declarar en el
      Puerro y en el Apionabo). La lista está en `docs/mb-preguntas-cocina.md`
      y el documento para rellenar en `docs/MB-preguntas-cocina.docx`.
      **Hasta que se contesten, la carta no puede pasar a `data/` — el guard
      de CI lo impide, y hace bien.**
- [ ] **[121] Ensalada vegetariana mixta** — su ficha entera es «Hojas verdes,
      Verduras de temporada, Vinagre, Aceite». No enseña nada.
- [ ] **[46] la miel** — el plato promete «VEGAN adaptable» y la comanda no
      quita la miel. Único plato de la carta con ese problema.
- [ ] **[24] la carrillera** — sus notas dicen «de ternera» y el plato se llama
      «de Wagyu»; y mencionan trufa de temporada que la ficha no lista.
- [ ] **«Crujiente de ibérico»** (Entrecot de Angus) no está en la base de
      alérgenos: si lleva pan, ese gluten no lo ve nadie.
- [ ] **18 ingredientes «deducido de la carta»** sin confirmar por cocina, de 468.
- [ ] **17 platos de 97 sin foto.**

### Del propietario — fuera del repositorio

- [ ] **La carta vegetariana impresa** sigue listando los «Tomates aliñados con
      granizado de gazpacho», que llevan pescado por el ponzu de la cebolla
      encurtida. En la app ya salieron de ahí.
- [ ] Los dos borradores legales, por un abogado. Y un **correo de contacto**
      para la parte de protección de datos.
- [ ] Que M.B. firme el acuerdo de restaurante **antes** de tener acceso, con la
      cláusula de autoría independiente.
- [ ] Borrar la Edge Function `mesa-infinita` en Supabase.
- [ ] Tres errores en los plating guides impresos.

### Técnico


- [ ] **`manage-content` no mira el restaurante al comprobar el PIN.** Es la
      Edge Function del editor de carta. `custom_dishes` ya tiene columna
      `venue` y su lectura ya filtra, así que ahora sí hay contra qué
      compararlo: falta pasarle el restaurante y que lo exija, igual que hace
      `send-push`.
- [ ] **`ai_usage` es la única tabla sin restaurante.** Es contabilidad interna
      de uso de IA, no datos de nadie; queda anotado para que no parezca un
      olvido.

- [x] ~~**PIN de supervisor por restaurante.**~~ Hecho (11 sep, v7.431). El PIN
      del propietario abre todos (ámbito `*`); el de un restaurante sólo el
      suyo. Comprobado contra el servidor: con el PIN de otro restaurante NO se
      ve ni se renueva el código de acceso, NO se cambia el rol de nadie y NO
      se escribe el cuadrante. Y sólo el propietario reparte `admin` y
      `manager` — si no, un manager se daría a sí mismo la llave de todos.
      **Para dar de alta el PIN de un restaurante**, desde el editor SQL:
      `select set_supervisor_venue_pin('mb','<pin>','Duvan');`
      Mientras no se dé ninguno de alta, nada cambia.
- [x] ~~**Managers desde el panel.**~~ Hecho (11 sep). Acciones → Cuentas: el
      propietario ve la plantilla de ese restaurante, nombra managers y pone su
      PIN. Sólo él: el servidor lo comprueba.
- [x] ~~**El panel sale por ROL.**~~ Hecho (11 sep, paso 3). Nace el rol
      `owner` (abre cualquier restaurante); `manager` abre sólo el suyo. La
      cuenta de administración NO tiene panel, por diseño. Duvan ya es `owner`
      en la nube. No se puede quitar el mando al último propietario.
- [x] ~~**Cada manager ve sólo lo suyo.**~~ Hecho (11 sep, paso 4). Barridas
      las 33 llamadas a Supabase: cuatro tablas no tenían restaurante. La peor,
      `push_subscriptions` — «todo el equipo» hacía sonar TODOS los móviles de
      la base. Hay un guard que recorre cada llamada y exige que filtre, selle,
      vaya por clave única, o esté en una lista de excepciones con su motivo
      escrito. **Los cuatro pasos del multi-restaurante están cerrados.** — pedido por el propietario el
      11 de septiembre. Hoy el supervisor está fijo en el código
      (`currentUser === 'Duvan'`) con un único PIN para toda la app; no hay
      forma de dar de alta a otro. La columna `role` está puesta para
      engancharlo. Va junto con esto: el propietario quiere que la sección
      «Cuenta de administración» **sólo la vea la cuenta de administración**, y
      hoy vive dentro del panel de supervisor, que esa cuenta no tiene — así
      que la sección se mueve de sitio al reordenar los roles.
- [ ] **Ver el acuerdo firmado** desde Ajustes: el propio texto lo promete y no
      existe.
- [ ] Nombres pegados que **no** se limpian, a propósito y con motivo escrito:
      Granadina (perdería los Sulfitos), Porto y Sake (son cebolla encurtida,
      falta confirmarlo para el Tataki) y Bisque (perdería «Langostino»).
- [ ] Ruido menor en el Pase: la lubina ofrece «Vainilla»; tres platos de un
      solo componente donde el título delata la respuesta.

---

## Lo que se cerró hace poco, por si hace falta contexto

- **El alta pasa por el servidor.** Antes, cualquiera con la clave anónima podía
  crearse una cuenta o pisar la de otro llamando a la API a mano.
- **Cada restaurante ve sólo lo suyo**: quince consultas de colección llevan
  filtro y once escrituras llevan sello. El cuadrante pasó a guardarse por
  (restaurante, semana).
- **El usuario se separó del nombre visible.** El usuario es la clave primaria y
  de ella cuelga todo el historial; el nombre visible se cambia en Ajustes.
- **El Pase enseña lo que va montado en el plato**, no sólo lo que lleva
  alérgeno: de 415 a 717 ingredientes.
- **«Topping» y «Guarnición» eran preparaciones** y escondían lo que va encima:
  la Croqueta de Jamón no enseñaba el jamón, y las cinco croquetas tenían la
  piscina idéntica.
- **Los tomates aliñados llevaban soja y pescado sin declarar**, por el ponzu de
  la cebolla encurtida. Y ofrecían una comanda que no funcionaba: quitar la
  ventresca y las anchoas no dejaba el plato sin pescado.
