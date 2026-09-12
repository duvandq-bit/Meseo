# Contraste de color — lo medido y lo que sigue sin saberse

Fase 0, 12 de septiembre de 2026, versión 7.446.
**No se ha cambiado ni un color.** Este documento es el resultado del punto 7
de la fase: medir de forma fiable y documentar.

---

## Qué se hizo

Tres métodos, en este orden, sobre las quince pantallas a 390 px de ancho y
**esperando a que cada una estuviera pintada del todo** (sin «Cargando…»), que
era el fallo del segundo intento de la auditoría.

| Método | Resultado | Por qué no vale |
|---|---|---|
| 1 · Colores calculados, subiendo por el árbol hasta encontrar un fondo | 159 de 214 por debajo de AA | No ve los fondos con **degradado**, que esta aplicación usa por todas partes. Daba 1,00:1 en textos que se leen perfectamente. |
| 2 · Píxeles del recorte, percentiles 5 y 95 | 82 de 132 | El **suavizado de las letras** falsea el color del texto. Medido: daba 2,25:1 en un chip donde el color real da 5,72:1. |
| 3 · Color exacto del texto contra el color más repetido del recorte | 24 de 131 | El más cercano, pero el fondo con degradado sigue engañándolo: en el bloque de XP midió 1,06:1 donde a la vista es dorado sobre verde oscuro. |

## Lo que sí se puede afirmar

Se comprobaron **a mano** dos casos, calculando el contraste de los colores
reales y mirando el recorte ampliado:

- **`.q-chip.on`** (chips de filtro de Quesos y Sala). Medido por píxeles:
  2,25:1. Color real: texto `rgb(28,42,34)` sobre `rgb(196,154,60)` →
  **5,72:1. Cumple.** El método era el que fallaba.
- **Bloque de nivel en Inicio.** El título «Vizconde de la Bandeja» es dorado
  `rgb(228,190,104)` sobre la tarjeta verde oscura y **se lee bien**. La línea
  de debajo, «1.200 XP · Faltan 220 para Lv.13», usa el mismo dorado **al 70%
  de opacidad**: compuesto sobre ese fondo queda alrededor de **3,5–4:1**, por
  debajo del 4,5:1 que pide el estándar para texto de 13,5 px. Es legible, pero
  es el caso más claro de incumplimiento real que ha aparecido.

## Candidatos, sin verificar uno a uno

Los 24 del tercer método quedan en `contraste-final.json`. Los más bajos, en
orden, y todos **pendientes de comprobar a mano** antes de tocar nada:

| Pantalla | Elemento | Texto | Medido |
|---|---|---|---|
| Inicio | — | «1.200 XP · Faltan 220 para Lv.13» | 1,06:1 ⚠ verificado: ~3,5–4:1 |
| Inicio | — | «Vizconde de la Bandeja» | 1,11:1 ⚠ verificado: cumple |
| Juegos | `gc-recommended-badge` | «★ Recomendado» | 1,14:1 |
| Examen | `exam-stat-lbl` | «Preguntas» | 1,51:1 |
| Repaso | `ri-cta-sub` | «5 casos de huésped…» | 2,07:1 |
| Inicio | — | «Acceso en 1 toque» | 2,09:1 |
| Examen | — | «TU DOMINIO» | 2,25:1 |
| Repaso | `ri-cta-top` | «Repaso inteligente» | 2,44:1 |
| Técnicas | `tec-fam-nm` | «Preparación y despiece» | 3,32:1 |
| Auditoría · Quesos · Sala · Ranking · Supervisor | `sup-hero-sub` | subtítulos de las cabeceras | 3,50–3,51:1 |

El grupo de `sup-hero-sub` a 3,5:1 aparece en cinco pantallas con el mismo
componente: si al comprobarlo resulta real, es **un solo arreglo** que las
corrige todas.

## Qué haría falta para cerrarlo

El obstáculo es siempre el mismo: **los fondos con degradado**. Ninguna medida
automática de las tres sabe con qué color exacto contrasta un texto que se
apoya en un degradado, porque cambia a lo largo del propio texto.

La forma de cerrarlo es al revés: en vez de medir lo que hay, **fijar los pares
de color permitidos** en el sistema de diseño —texto principal sobre superficie
oscura, texto secundario sobre superficie oscura, etcétera— y comprobar que
cada componente usa uno de esos pares. Eso convierte una medición imposible en
una comprobación trivial, y es trabajo de la fase del sistema de diseño.

Mientras tanto queda **un solo incumplimiento verificado**: la línea de XP al
70% de opacidad. Se documenta y no se toca, siguiendo la instrucción de no
cambiar colores en esta fase.
