# Por dónde seguir

Estado a **11 de septiembre de 2026** · versión **7.433** · 330 pruebas en verde ·
auditoría de alérgenos 0/0.

---

## 🔴 Lo único que bloquea algo ahora mismo

**M.B. no puede abrir hasta que cocina conteste las diecisiete preguntas.**

Su carta sigue en `docs/carta-mb-borrador.json`, fuera de `data/`, porque en
diecisiete platos la ficha declara un alérgeno y no dice de dónde sale. La
lista está en `docs/mb-preguntas-cocina.md`, lista para reenviar.

Mientras tanto **la cuenta de administración sí entra a M.B.**, con la carta
vacía, para poder revisar el carro de quesos (48, ya cargado). Un restaurante
sin carta se abre a cero, nunca con los platos del anterior.

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
| Ingredientes → alérgenos | `data/ingredients.json` (468 entradas) |
| Vinos | `data/wines.json` — **común a los dos restaurantes, todavía sin separar** |
| La carta de M.B. | `docs/carta-mb-borrador.json` — borrador, fuera de `data/` a propósito |
| El acuerdo de confidencialidad | `data/nda.json` — **apagado** (`"activo": false`) |
| El acuerdo con el restaurante | `docs/acuerdo-restaurante-borrador.md` — no se enseña en la app |
| El PIN por restaurante | `supabase/supervisor_pin_por_restaurante.sql` — aplicado el 11 sep |

No se toca la carta sin dato del propietario. **Nunca se inventa un plato, un
ingrediente, un vino ni un estándar.**

---

## Pendiente

### Del propietario — datos

- [ ] **M.B.: diecisiete preguntas para cocina.** La carta ya está transcrita
      en `docs/carta-mb-borrador.json`, pero en diecisiete casos la ficha de
      cocina declara un alérgeno y no dice de dónde sale. La lista, lista para
      reenviar, está en `docs/mb-preguntas-cocina.md`. **Hasta que se
      contesten, la carta no puede pasar a `data/` — el guard de CI lo
      impide, y hace bien.**
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

- [ ] **La pestaña de supervisor sigue clavada a `Duvan`** (`currentUser==='Duvan'`).
      Hasta que salga por rol, un manager no puede ver el panel aunque ya tenga
      su PIN y su rol. Es el paso 3 de los cuatro.
- [ ] **Cada manager ve sólo a su equipo** (paso 4). Las consultas ya llevan
      filtro de restaurante; falta barrer que ninguna se escape.

- [ ] **`custom_dishes` no tiene restaurante.** Encontrado el 11 de septiembre
      mirando qué autoriza el PIN. La tabla de platos añadidos a mano no tiene
      columna `venue`, y la consulta que los lee no lleva filtro: cuando M.B.
      abra, sus platos y los de Txoko se mezclarían. Hoy es latente (la tabla
      está prácticamente vacía). La Edge Function `manage-content` tampoco mira
      el restaurante al comprobar el PIN, por lo mismo: no hay contra qué
      compararlo hasta que la tabla lo tenga.

- [ ] **Separar los vinos por restaurante.** M.B. tiene bodega propia y
      `wines.json` es común. Mismo patrón que la carta de platos.
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
- [ ] **Un manager por restaurante. EN MARCHA (falta el 3 y el 4)** — pedido por el propietario el
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
