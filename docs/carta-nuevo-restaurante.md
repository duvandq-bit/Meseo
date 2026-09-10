# Dar de alta la carta de un restaurante nuevo

La carta de **Txoko** vive dentro de `index.html`, en cuatro bloques: `DISHES`,
`DISHES_EN`, `DISH_COMPONENTS` y `DISH_ACTIONS`. Se queda ahí a propósito: 42
puntos de las pruebas y de la auditoría de alérgenos los leen del propio HTML, y
sacarlos obligaría a reescribir todo eso sin ganar nada.

La carta de **cualquier otro restaurante** llega en un archivo y sustituye a esas
cuatro cuando entra alguien de ese restaurante.

## El archivo

`data/carta-<restaurante>.json`, donde `<restaurante>` es el mismo `id` que el
venue tiene en `data/themes.json` y en la columna `venue` de la base de datos.

```json
{
  "venue": "mb",
  "DISHES":          [ … los platos, en español … ],
  "DISHES_EN":       [ … los mismos, traducidos … ],
  "DISH_COMPONENTS": { "1": [ {"n":"Nata","a":["Lácteos"],"m":0} ], … },
  "DISH_ACTIONS":    { "1": { "Lácteos": {"r":0} }, … }
}
```

El campo `venue` no es decorativo: si no coincide con el restaurante de quien
entra, el archivo se rechaza. Soltar la carta equivocada en la carpeta no puede
acabar en enseñársela a nadie.

### Un plato

```json
{
  "id": 1,
  "cat": "Entrantes",
  "name": "Nombre del plato",
  "allergens": ["Lácteos", "Gluten"],
  "ingredients": "Rótulo: hijo, hijo. Suelto, Suelto.",
  "history": "De dónde viene el plato, para contárselo al huésped.",
  "notes": "⚠ Avisos de servicio y de alérgenos."
}
```

`ingredients` sigue la convención de la ficha: `«Rótulo: hijo, hijo.»` para lo
que va dentro de una preparación, y suelto para lo que va montado en el plato.
De ahí sale el Pase: lo de nivel superior se ve, lo que cuelga de un rótulo no.

### Componentes y comanda

- `DISH_COMPONENTS[id]` — sólo los componentes que **aportan alérgeno**.
  `n` nombre · `a` alérgenos · `m` 1 si se puede retirar.
- `DISH_ACTIONS[id][alérgeno]` — qué se hace con ese alérgeno.
  `r:0` no retirable · `r:1` retirable, y entonces `c` es la comanda
  («SIN MANTEQUILLA») y `c_en` su traducción.

## Lo que hay que comprobar antes de darlo por bueno

1. **`node tests/allergen-audit.mjs`** — audita las cartas de `data/` con el
   mismo rasero que la de Txoko. Tiene que salir **0 NO DECLARADO** y
   **0 SIN ORIGEN**. Un alérgeno sin verificar es un alérgeno sin verificar,
   esté el dato donde esté.
2. **`node tests/smoke.mjs`** — todo en verde.
3. Que cada ingrediente nuevo esté en `data/ingredients.json` con su origen. Si
   falta, la auditoría lo canta como «sin origen».

## Lo que además hace falta para estrenar el restaurante

- Su entrada en `data/themes.json` con `enabled: true` y sus colores.
- Su código de acceso, generado desde el panel de supervisor.
- Sus vinos, si tiene carta propia (hoy `data/wines.json` es común).
- Sus fotos de platos.

## Lo que NO cambia por restaurante

Los estándares LQA, el código del camarero, el servicio fantasma y las
situaciones reales son oficio de sala y estándar del hotel, no receta. Si algún
restaurante necesitara los suyos, eso es otro trabajo distinto a éste.
