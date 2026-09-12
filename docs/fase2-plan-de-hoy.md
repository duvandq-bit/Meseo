# Fase 2 — El plan de hoy

Versión 7.448. Checkpoint de partida: `v7.447-pre-fase2`, 342 pruebas verdes,
auditoría de alérgenos 0/0.

La aplicación tenía dieciocho sitios a los que ir y ninguna respuesta a «¿qué
hago hoy?». Esta fase la da: **como mucho tres tareas, entre ocho y doce
minutos, cada una con el motivo por el que está ahí.**

No se ha quitado nada. La sección «Hoy» que ya existía —reto del día, Line Up,
reto semanal, misiones, práctica enfocada— sigue entera y debajo; el plan se
pone delante porque es lo primero que hay que contestar.

---

## 1 · Qué se ve

En el inicio, justo debajo del título «Hoy»:

```
◈ TU PLAN DE HOY                                    1/2
1 tarea · unos 4 min
────────────────────────────────────────────────
✓  Simulacro de alérgenos                    5 min  ›
   1 fallo de alérgenos esta semana
2  Repaso inteligente                        4 min  ›
   5 fichas vencidas de repaso
```

Cada fila dice **qué** es, **por qué** está ahí, **cuánto** dura y **si está
hecha**. La cabecera dice cuántas quedan y cuánto suman. Al tocar, se abre la
actividad concreta —no un índice desde el que haya que buscarla.

Sin nada pendiente, la tarjeta no desaparece: dice «Todo al día».

---

## 2 · Cómo decide

`planDeHoy(datos)` es una función **pura**: no mira el DOM, no lee variables
globales y no escribe nada. Se le dan datos y devuelve un plan. Las pruebas la
ejecutan con datos inventados, sin navegador de por medio.

Es **determinista a propósito**: ni aprendizaje automático, ni azar. Si a
alguien le sale un plan raro se puede señalar la regla exacta que lo puso ahí.

### Las seis prioridades, en orden

| # | Regla | Se dispara cuando | Tarea |
|---|---|---|---|
| 1 | Lo que mande el supervisor | **nunca hoy** — ver abajo | la que él diga |
| 2 | Seguridad: alérgenos | mejor marca < 90%, o fallos esta semana | Simulacro de alérgenos |
| 3 | Repaso vencido | hay fichas con la fecha pasada | Repaso inteligente |
| 4 | Contenido sin ver | quedan platos sin estudiar (o vistos sin dominar) | Recorrido guiado |
| 5 | Competencia más floja | la peor de las seis está por debajo del 90% | su examen |
| 6 | Proteger la racha | hay racha, y hoy no se ha estudiado | Reto del día |

**La prioridad 1 no tiene fuente y no se ha inventado una.** Las asignaciones
son fase 4: no existe tabla donde se guarden ni pantalla donde se creen, así
que la lista llega siempre vacía y la rama no se dispara. Está escrita —y
probada— porque el orden importa: el día que existan, lo que manda una persona
tiene que entrar por delante de lo que decide el motor, no detrás.

**La seguridad va la segunda porque es lo único de esta aplicación que puede
hacer daño.** Un fallo de carta es una anécdota; un fallo de alérgenos manda a
alguien al hospital.

### Las reglas de calidad, y qué las hace cumplir

- **Máximo tres tareas.** Cuatro ya no es un plan, es una lista.
- **Máximo doce minutos.** Es un plan para un descanso, no un curso.
- **Nunca la misma actividad dos veces.** Hay un caso real en que dos reglas
  distintas piden lo mismo: quien va flojo en alérgenos dispara la regla de
  seguridad **y** la de competencia más floja, y las dos abren el simulacro.
- **Nunca tres tareas de la misma competencia**, salvo que lo justifique la
  seguridad. Tres cosas de carta seguidas es una tarde de carta.
- **No hay debilidad por encima del 90%.** Mandar a practicar la «menos buena»
  de seis sobresalientes es ruido, no formación.
- **El plan no cambia a mitad de día.** Se fija la primera vez que se mira.

Sobre lo último: sin fijarlo, terminar la primera tarea reordenaba las otras
dos —el repaso deja de estar vencido justo *por haberlo hecho*— y el plan
parecía otro cada vez que se volvía al inicio, que es lo contrario de un plan.
Se fija en cuanto las fuentes han contestado (`listo`): fijarlo antes dejaría a
alguien sin vinos todo el día sólo porque la precarga no había terminado.

La semilla del plato concreto que toca estudiar sale de **fecha + nombre**: el
mismo empleado ve el mismo plato todo el día, y dos compañeros no reciben el
mismo. Medido: ocho personas caen en al menos seis platos distintos.

---

## 3 · Qué cuenta como «completado»

**Abrir una actividad no es completarla.** Nada se infiere de la navegación, de
abrir una pantalla, de que algo se pinte ni del primer toque. Una actividad
abandonada a la mitad sigue pendiente.

Lo único que marca una tarea es que la actividad **registre** por la puerta de
la fase 1 — `registrarActividad()`, la misma llamada que escribe en la nube.

Para eso la fase 2 añade **el diario**: la misma señal, guardada también en el
móvil. Se anota **antes** de salir a internet, a propósito: la actividad ha
ocurrido igual si el envío falla, y el móvil de un camarero en mitad de un
servicio se queda sin cobertura a menudo. Comprobado: con la red caída el envío
devuelve `false` y la línea queda anotada igual.

El diario guarda **catorce días** y se poda solo. El histórico completo vive en
la nube; guardar un año en el mismo `localStorage` donde viven las fichas de
todo el equipo sería miles de líneas por nada.

Lo que el registro rechaza —competencia fuera del vocabulario, tipo inventado,
total cero— tampoco se anota. Y **la cuenta de administración no deja rastro**,
igual que en `scores`; por eso tampoco tiene plan: sus tareas no se marcarían
nunca por bien que las hiciera, y un plan que no se puede terminar es peor que
ninguno.

### Verificado en el navegador

| Acción | Tareas completadas |
|---|---|
| Abrir la tarea (se abre la actividad de verdad) | **0** |
| Registrar la actividad | **1** |

Y el plan **no se recolocó** al borrar después el estado que lo había generado.

---

## 4 · De dónde salen los datos

Todo es local. El plan no hace ni una petición de red.

| Dato | Origen |
|---|---|
| Fichas vencidas | `emp.srs` — sólo se lee |
| Mejor marca de alérgenos | `emp.allergenBest` |
| Fallos recientes de alérgenos | el diario, últimos 7 días |
| Platos sin ver / sin dominar | `DISHES` contra `srs`, `knownDishes`, `journeyMastered` |
| Nota por competencia | el diario; y `topicScores` donde el diario no llega |
| Racha | `emp.streak` y `emp.lastStudyDay` — la definición de siempre |
| Reto hecho | `emp.dqLastDay` |
| Qué se puede entrenar | las mismas cachés que enseñan u ocultan los botones de Sala y Vinos |

**La nota por competencia no suma los dos orígenes**, y es deliberado: el examen
escribe en los dos —una línea por pregunta en `topicScores`, una por sesión en
el diario—, así que sumarlos contaría dos veces las mismas preguntas. Manda el
diario cuando tiene al menos cinco respuestas; si no, el histórico de antes.

**«Fallos recientes» son de verdad recientes.** `adaptive.allergenMiss` es
acumulado desde el primer día y no baja nunca: usarlo habría dejado la tarea de
seguridad clavada para siempre en el plan de cualquiera que fallara una vez en
marzo.

---

## 5 · Lo que NO se ha hecho, y por qué

**Nada del SRS.** No se han tocado intervalos, facilidad, repeticiones, errores
ni fechas. El plan sólo *lee* cuántas fichas están vencidas, con la misma
definición que ya usaba el inicio.

**Ni una asignación.** Ver la prioridad 1.

**Nada del supervisor.** Es fase 3.

**Ni autenticación.** Ver el apartado 7.

**Sin «seguir donde lo dejaste».** Se valoró y se descartó: ninguna actividad
guarda su progreso al salir —el estado de examen, simulacro y repaso vive en
memoria y se pierde al recargar—, así que **no hay fuente fiable de la que
sacarlo**. Una tarjeta que promete continuar algo y empieza de cero es peor que
no tenerla.

**Sin rediseño.** Ni de la navegación ni visual. La tarjeta usa los tokens que
ya existían —el mismo oro, el mismo pergamino, las mismas tres tipografías— y el
mismo alto de fila (52 px) que las filas numeradas de debajo, para que no haya
dos tamaños de fila en la misma pantalla. Ni un color nuevo.

**Sin cambios de contenido.** Ni un plato, ni un vino, ni una pregunta.

---

## 6 · Comprobado

**354 pruebas verdes** (342 antes de empezar, 12 nuevas) y auditoría de
alérgenos 0/0.

Las pruebas nuevas **ejecutan** el motor y la tarjeta, no leen el código
buscando texto. Es la lección del fallo de `dd`: aquel día la pantalla más usada
de la aplicación no pintaba nada y las 338 pruebas pasaron en verde, porque
ninguna llegaba a ejecutar la función.

Y se han verificado **rompiendo a propósito lo que protegen**: 22 mutaciones,
las 22 detectadas. Cuatro no mordían a la primera y se arreglaron:

| Fallo del guard | Por qué pasaba en verde | Arreglo |
|---|---|---|
| Subir el tope a 30 min | la prueba comparaba contra la propia constante | el 12 va escrito en la prueba |
| Quitar el filtro de actividad repetida | el escenario no llegaba a disparar dos reglas a la vez | escenario que sí lo dispara |
| Borrar el motivo de la tarjeta | el motivo también va en la etiqueta de accesibilidad | se cuentan los huecos visibles |
| Dejar de anotar en el diario | no había ninguna prueba del diario | prueba del enlace fase 1 → fase 2 |

### En el navegador

| Ancho | Se pinta | Desborde | Recorte | Tapado por el menú | Alto de fila | `h1` visibles | Errores |
|---|---|---|---|---|---|---|---|
| 320 | sí | no | no | no | 74 px | 1 | 0 |
| 390 | sí | no | no | no | 58 px | 1 | 0 |
| 430 | sí | no | no | no | 58 px | 1 | 0 |
| 768 | sí | no | no | no | 52 px | 1 | 0 |
| 1280 | sí | no | no | no | 52 px | 1 | 0 |

Y **las siete tareas abren lo suyo**: el simulacro y el reto del día pintan su
pantalla, el repaso y el recorrido abren su capa, y el examen de carta, el LQA y
el quiz de vinos cambian de pestaña. Ninguna deja el toque sin efecto.

> Nota sobre el barrido: los tres primeros intentos dieron «el plan no se
> pinta». Era la prueba, no la aplicación: `showTab('dashboard')` no repinta si
> ya estás en el inicio, así que se estaba midiendo una pantalla en blanco. Se
> deja escrito porque volverá a pasar.

---

## 7 · Riesgos y cosas pendientes

**De dónde depende el plan, en claro.** Todo sale de `currentUser` y del
restaurante activo (`_venueActual()`), las dos variables del navegador. Quien
las cambie desde la consola ve —y escribe— el plan de otro. **No es un problema
nuevo de esta fase: es el modelo de seguridad de toda la aplicación**, medido y
documentado en `registro-actividad-cobertura.md`. La fase 2 no lo empeora: no
añade ningún punto de escritura nuevo, no copia datos entre empleados y no crea
identidades. Pero tampoco lo arregla.

**La recomendación sigue siendo la misma: autenticación antes de la fase 4.** No
bloquea esto —el plan es local— ni la fase 3 —el supervisor sólo mira—. Pero la
fase 4 asigna formación, y ahí falsear una fila deja de ser una travesura.

**Inconsistencias del SRS, documentadas sin tocar.** El plan cuenta como
vencidas las fichas con `reps > 0` y fecha pasada, que es lo que ya hacía el
inicio. `_srsDueCount()` cuenta otra cosa —también las que no se han empezado
nunca—, y `_adaptiveSelectDishes()` elige con un tercer criterio. Son tres
definiciones de «pendiente» conviviendo. **No se ha unificado ninguna**: tocar
el SRS estaba explícitamente fuera de esta fase. La consecuencia práctica es
acotada: si el repaso no encontrara material, ya avisa con un mensaje claro en
vez de dejar el toque muerto.

**El diario es sólo local.** No viaja a la nube y no sobrevive a un borrado de
datos del navegador. El histórico sí está en la nube, en `actividad`; el diario
es una copia de trabajo de catorce días para que el plan funcione sin cobertura.

**El plan no se fija hasta que Sala y Vinos han contestado.** En la primera
carga del día, si la precarga aún no ha terminado, el plan se ve pero no se
congela; se congela en la siguiente vuelta al inicio. Es deliberado, y el
precio de no dejar a nadie sin vinos por una carrera de arranque.

**`servicio` es la sexta competencia y no tiene actividad.** Su único tema,
`cutlery`, está retirado: queda en datos viejos y el propio código lo ignora al
calcular medias. Mientras no exista una actividad que entrene el servicio, el
motor no puede mandar a nadie a hacer nada sobre él. **Es un hueco de contenido,
no de código**, y hay que decidirlo con el restaurante.

**Sigue abierto de antes**: los 16 `confirm()` del navegador, el contraste sin
medir, el ancho de los controles de la cabecera por debajo de 400 px y el error
de JavaScript de 430 px no reproducido.
