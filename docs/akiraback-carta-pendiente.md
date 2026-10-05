# Akira Back — carta en borrador, pendiente de cocina

Carta de formación de **Akira Back** transcrita de dos documentos del restaurante:
- `Plating_Guide_AKIRABACK.pdf` (pick up chart, 11 páginas);
- `AB_MENU_DEGUSTACION_descriptions.pdf` (menú degustación, 2 páginas).

**Estado: BORRADOR — NO PUBLICADO.** Sigue el mismo camino que la carta de M.B.:
- vive en `docs/carta-akiraback-borrador.json`, que la app **no carga**;
- el restaurante está dado de alta en `data/themes.json` como `akiraback`, con `enabled: false`: no aparece en el login;
- no se ha tocado Supabase: el código de acceso y el PIN de supervisor del restaurante se crearán aparte, con autorización.

Para publicarse, la carta tiene que pasar a `data/carta-akiraback.json` y superar `node tests/allergen-audit.mjs` con 0 NO DECLARADO y 0 SIN ORIGEN. Eso exige primero las respuestas de cocina de este documento y dar de alta en `data/ingredients.json` los ingredientes nuevos con su origen.

## Lo que se ha decidido al transcribir

- **No se inventa ningún alérgeno.** Cada plato declara los de la guía, traducidos al vocabulario de la app solo cuando la equivalencia es exacta (Soja, Pescado, Gluten, Sésamo → Granos de sésamo, Huevo → Huevos, Lactosa/Lácteos → Lácteos, Mostaza, Apio, Sulfitos, Frutos secos, Cacahuete). El texto original queda en el campo `alergenos_guia` de cada ficha.
- **«Marisco» no se traduce.** La app distingue Crustáceos de Moluscos y la guía no lo dice. Esos platos llevan el aviso en sus notas y la duda abajo; **hasta que cocina conteste, su lista de alérgenos está incompleta**.
- **Sin precios**, como en la carta de Txoko.
- **Adaptaciones:** las columnas «Posibilidad cambio GF / Lactosa free», vegano y vegetariano van en el campo `adaptaciones`. Cuando la guía dice cómo se adapta un plato, eso pasa a `DISH_ACTIONS` como comanda (`r:1`). En el resto, `r:0` significa «la guía no indica adaptación», no que cocina haya confirmado que no se puede retirar.
- **`DISH_COMPONENTS` está vacío:** la guía no dice qué componente aporta cada alérgeno. Se rellena con las respuestas de cocina.
- **Categorías** (Snacks, Fríos, Calientes y vegetales, Rolls, Sushi y sashimi, Principales, Postres, Menú degustación): son una propuesta de orden, no salen de la guía.
- **Bento:** las filas sueltas de bento de la guía (Navajas, Bocado de atún, Bocado de nori y wagyu, Gazpacho de melón, Negi no miso, Hotate beurre blanc, Robata yakiniku) se han integrado en los pases del menú degustación. Sus alérgenos están en las dudas de cada pase.
- **Edamame** aparece dos veces en la guía: hay una sola ficha.
- **Traducciones:** el inglés es el de la guía y el del menú cuando existe. Las fichas que no lo traían (las últimas páginas de la guía) las he traducido yo.
- **Katakuri:** es fécula de patata, así que el «Tofu picante» sin gluten es coherente. No es una duda.
- **Colores de marca:** son los de la plantilla, provisionales hasta que haya identidad visual del restaurante.

## Dudas generales para cocina

1. La cabecera de la guía dice **«AKIRA BACK DUBAI»**, pero los precios están en euros y hay producto canario (papa canaria, vino canario, millo, gofio, ciruela de Tenerife). ¿Es la guía de este restaurante?
2. El **menú degustación** no tiene postre ni alérgenos. ¿Hay pase de postre? ¿Cuáles son los alérgenos de cada pase?
3. **«Marisco»:** en cada plato marcado, ¿crustáceos, moluscos o ambos?
4. Las **fichas sin cubierto** (snacks, novedades de la última página, bento): ¿con qué cubierto se marcan?

## Cruce con la base de ingredientes de la app

Al pasar el borrador por el mismo criterio que la auditoría:
- **5 avisos en la dirección peligrosa** (la base de ingredientes de la app implica un alérgeno que la guía no declara): Haru sashimi y Local sakana selection (ponzu → sulfitos; en Local sakana también pescado), Claypot de setas (sake → sulfitos) y Perfect storm (mirin → sulfitos). Están en las dudas de cada plato.
- **123 alérgenos declarados sin origen** y **203 ingredientes que aún no están en `data/ingredients.json`**. Es lo esperado en un borrador: se resuelve dando de alta esos ingredientes con su origen cuando cocina valide.

## Dudas por plato


### Snacks

**1 · Edamame** — guía: Soja
- La guía lo repite dos veces (pág. 1 y pág. 8); se deja una sola ficha.
- Sin cubierto indicado.

**2 · Chips de arroz** — guía: (sin alérgenos en la guía)
- La guía no declara ningún alérgeno: confirmar que el aceite de fritura y el sazonado no aportan ninguno.
- Sin cubierto indicado.

**3 · Koroke tuna kimchi** — guía: Lácteos, Gluten, Soja, Pescado, Mostaza, Huevo
- Sin cubierto indicado.

**4 · Panipuri** — guía: Soja, Gluten, Pescado
- La guía escribe «Panikuri» en la descripción y «Panipuri» en el nombre: confirmar el nombre de carta.
- Sin cubierto indicado.

**5 · Lab salmon** — guía: Pescado
- Sin cubierto indicado.


### Fríos

**10 · Toro caviar** — guía: Pescado, Soja, Sésamo
- Sin dudas.

**11 · Jeju Domi** — guía: Pescado, Soja, Gluten, Sésamo
- Sin dudas.

**12 · Hotate kiwi** — guía: Marisco y soja
- La guía dice «Marisco»: ¿crustáceos, moluscos o ambos? La app los distingue.
- Cantidad: el español dice 9 cortes de vieira y 9 de kiwi; el inglés, six. Confirmar.

**13 · AB salmon tataki** — guía: Soja, pescado y mostaza
- El nombre dice salmón y la descripción «atún/salmón»: confirmar si cambia según el día.

**14 · Kunsei** — guía: Soja, Pescado
- Sin dudas.

**15 · Haru sashimi** — guía: Pescado, soja
- La base de ingredientes de la app marca el ponzu con sulfitos (y pescado); la guía no declara sulfitos aquí. Confirmar.

**16 · Mystery box** — **⚠ alérgenos pendientes** — guía: Todos los alérgenos
- La guía dice «Todos los alérgenos» y que no es adaptable si hay alergias, porque se sirven seis preparaciones distintas. Hace falta la lista real por preparación.

**17 · Eringi kiwi** — guía: Soja
- Cantidad: el español dice 9 cortes y el inglés six. Confirmar.


### Calientes y vegetales

**20 · Tofu picante** — guía: Soja, sésamo (aceite de sésamo)
- Sin dudas.

**21 · Sopa miso** — guía: Soja y pescado
- Sin dudas.

**22 · Miso de carabinero picante** — guía: Soja, Pescado, Marisco
- La guía dice «Marisco»: ¿crustáceos, moluscos o ambos? La app los distingue.

**23 · Tempura de miniverduras** — guía: Soja y gluten
- Sin dudas.

**24 · Eggplant miso** — guía: Soja, sésamo
- Cocción: el español dice «a baja temperatura» y el inglés «grilled in Josper». Confirmar.
- Las columnas de adaptación están descolocadas en la guía: confirmar qué es adaptable a sin gluten, sin lactosa y vegano.

**25 · Endivias layu** — guía: gluten, frutos secos
- Sin cubierto ni columna de lactosa en la guía.

**26 · Horenso satay** — guía: Frutos secos, soja, sésamo, pescado y cacahuete
- Sin cubierto ni columna de lactosa en la guía.

**27 · Claypot de setas** — guía: soja, huevo, sésamo, gluten y lácteo
- La salsa bulgogi lleva sake: la guía no declara sulfitos. Confirmar.
- Sin cubierto indicado.


### Rolls

**30 · Brother from another mother** — guía: Gluten, Soja, Pescado, Huevo, mostaza
- Sin dudas.

**31 · Perfect storm** — guía: Gluten, Soja, Mariscos, pescado, huevo, mostaza y sésamo
- La guía dice «Marisco»: ¿crustáceos, moluscos o ambos? La app los distingue.
- Lleva mirin: la base de ingredientes de la app lo marca con sulfitos y la guía no los declara. Confirmar.

**32 · Spicy tuna roll** — guía: Sésamo, soja y pescado
- Sin dudas.

**33 · Sake futomaki** — guía: Pescado
- Solo declara pescado: confirmar si se sirve con soja en mesa y si el arroz lleva vinagre (sulfitos).

**34 · Cow-Wow roll** — guía: Gluten, Soja, Huevo, Lactosa, apio, sulfitos y mostaza
- Lleva salsa de anguila y no declara pescado. Confirmar.

**35 · Vegan spider roll** — guía: Gluten y soja
- La salsa tare suele llevar anguila; aquí el plato es vegano. Confirmar la receta de esta tare.


### Sushi y sashimi

**40 · AB sashimi** — guía: Pescado, marisco, soja y gluten
- La guía dice «Marisco»: ¿crustáceos, moluscos o ambos? La app los distingue.

**41 · AB sushi** — guía: Pescado, marisco, soja y gluten
- La guía dice «Marisco»: ¿crustáceos, moluscos o ambos? La app los distingue.

**42 · AB sushi vegetariano** — guía: Soja y gluten
- La guía deja vacías las columnas de sin gluten y sin lactosa.

**43 · Local sakana selection** — guía: Soja y gluten
- Es un plato de pescado y la guía no declara Pescado. Confirmar.
- La base de ingredientes de la app marca el ponzu con sulfitos; la guía no los declara. Confirmar.


### Principales

**50 · Carabinero** — guía: Soja, marisco, pescado y lácteos
- La guía dice «Marisco»: ¿crustáceos, moluscos o ambos? La app los distingue.

**51 · Cherne** — guía: Soja, Lactosa y Pescado
- El beurre blanc suele llevar vino: la guía no declara sulfitos aquí, y sí en el Hotate beurre blanc. Confirmar.

**52 · Miso black cod** — guía: Soja, gluten y pescado
- En el sistema de caja figura como «Guindara».
- Lleva sake (espuma): la guía no declara sulfitos. Confirmar.

**53 · Carrillera de wagyu** — guía: Gluten, soja, lácteos, apio y sulfitos
- Sin dudas.

**54 · Jidori chicken** — guía: Soja, gluten, lácteos, apio
- Declara lácteos y la guía dice «quitándole el puré», pero la descripción no menciona ningún puré. Confirmar.

**55 · Juku A4 wagyu** — guía: Gluten, soja, lácteos, apio
- Sin dudas.

**56 · Pokuribu (costilla de cerdo ibérica)** — guía: lactosa, apio, soja, pescado y sulfitos
- Sin cubierto ni columnas de adaptación en la guía.
- Es también el pase 6 del menú degustación; allí se describe con espuma de millo, coco y miso.


### Postres

**60 · Yuzu citrus** — guía: Huevo, Lactosa y gluten
- Habla de cambiar «la galleta», pero la descripción no menciona ninguna galleta. Confirmar.

**61 · The line** — guía: Huevo, Lactosa y Productos lácteos, Gluten
- Sin dudas.

**62 · Yuzu mochi** — guía: Huevo, Lactosa y gluten
- El gofio es de cereal: confirmar que «cambiando la galleta» quita también el gofio.
- La guía dice adaptable a sin lactosa y a vegano sin explicar cómo.

**63 · Apple harumaki** — guía: Gluten, lactosa, huevo
- El español dice masa brick y el inglés phyllo pastry. Confirmar.

**64 · Cremoso chocolate-miso** — guía: Soja, huevo, gluten, lácteos, sésamo
- Sin cubierto indicado.

**65 · Hikari no pine** — guía: Lactosa, gluten y frutos secos
- Sin cubierto indicado.


### Menú degustación

**70 · 1 · Mystery box (menú)** — **⚠ alérgenos pendientes** — guía: (el menú no declara alérgenos; ver las fichas de bento de la guía)
- El menú no declara alérgenos. La guía tiene fichas sueltas de bento: Navajas (marisco, soja, gluten), Bocado de atún, mojo y plátano (gluten, soja, pescado, frutos secos, huevo, lácteos), Bocado de nori y wagyu (huevo, pescado, sésamo, soja, gluten, mostaza) y Gazpacho de melón (pescado). Hace falta la lista completa del pase.
- El amaebi es una gamba (crustáceo) y la ficha de Gazpacho de melón solo declara pescado. Confirmar.
- Las navajas son moluscos y la guía dice «marisco». Confirmar.

**71 · 2 · Negi no miso** — guía: soja, frutos secos, sésamo, lácteos, huevo (ficha de bento)
- La ficha de bento declara lácteos y la receta del menú no menciona ningún lácteo. Confirmar.

**72 · 3 · Hotate beurre blanc** — guía: soja, sulfitos, marisco, pescado, lactosa (ficha de bento)
- La guía dice «Marisco»: ¿crustáceos, moluscos o ambos? La app los distingue.

**73 · 4 · Sushi omakase** — **⚠ alérgenos pendientes** — guía: (el menú no declara alérgenos)
- Sin alérgenos en el menú. El AB sushi de carta declara pescado, marisco, soja y gluten; confirmar si aplica igual.

**74 · 5 · Himeji no yakiniku** — **⚠ alérgenos pendientes** — guía: (el menú no declara alérgenos)
- Sin alérgenos en el menú. La ficha «Robata yakiniku» de la guía (pescado local, ciruela de Tenerife, pak choi) declara pescado, soja y sésamo, pero la receta no es la misma. Confirmar.
- El aliño lab/thai suele llevar fish sauce. Confirmar.

**75 · 6 · Pokuribu** — guía: lactosa, apio, soja, pescado y sulfitos (ficha de carta)
- La ficha de carta habla de puré de millo y el menú de espuma: confirmar que los alérgenos son los mismos.

## Trazabilidad

- `docs/carta-akiraback-borrador.json` · SHA-256 `5447bb7067f79781264ac2f2e835abb92b89b3f9e34567aaea852d1bf1a47e6d`
- 50 fichas, 4 con los alérgenos pendientes, 53 dudas.
