# Registro de actividad — cobertura, hueco de seguridad e incidencia abierta

Fase 1 cerrada, versión 7.447. Este documento responde a tres preguntas que
quedaron sin escribir: **qué registra cada actividad**, **si alguien puede
falsear a nombre de quién se registra** y **qué pasó con el error de 430 px**.

No se ha modificado ninguna funcionalidad para escribirlo.

---

## 1 · Las diecisiete actividades, una por una

**Catorce registran en `actividad`. Tres no, y las tres por un motivo
distinto.** El inventario original contaba diecisiete; aquí están las
diecisiete, más las tres que aparecieron al desglosarlas (el auditor LQA, el
maridaje y el reto del día iban implícitos).

### Las que registran

| Actividad | `activity` | Competencia | Tipo | Dónde se dispara |
|---|---|---|---|---|
| Examen IA | `examen` | según el tema | evaluación | `nextExamQ` |
| Simulacro de alérgenos | `simulacro_alergenos` | alérgenos | evaluación | `renderAllergenResults` |
| Examen LQA | `examen_lqa` | protocolo | evaluación | `_lqaCompleteExam` |
| Situaciones LQA | `situaciones_lqa` | protocolo | evaluación | `_lqaCompleteSituations` |
| Auditor LQA | `auditor_lqa` | protocolo | evaluación | `_lqaCompleteAuditor` |
| Servicio fantasma | `fantasma` | protocolo | evaluación | `renderGhostReport` |
| Examen de sala | `examen_sala` | sala | evaluación | `_salaExamCompletar` |
| Quiz de vinos | `quiz_vinos` | vinos | evaluación | `_renderWineQuiz` |
| Quiz de maridaje | `maridaje` | vinos | evaluación | `_mqResults` |
| Repaso inteligente | `repaso` | carta | práctica | `_renderSmartSummary` |
| Recorrido guiado | `recorrido` | carta | práctica | `_djPhaseMastery` |
| Reto del día | `reto_dia` | carta | práctica | `_dqPick` |
| Mr. Shoesmith | `mr_shoesmith` | — | juego | `txAnswer` (récord) |
| Camarero Survivors | `survivors` | — | juego | fin de partida |

El tema del Examen IA se traduce a competencia con `competenciaDeTema()`:
`alergenos` y `allergens` caen los dos en **alérgenos** —eran el mismo examen
registrado en dos idiomas—, `mixed`, `ingredients` e `history` en **carta**,
`cutlery` en **servicio**.

### Las que NO registran, y por qué no deben hacerlo

**Pase de cocina — porque ya llega al supervisor por otra vía.**
Su agregado (`emp.paseStats`: cuántos pases, cuántos perfectos, cuántos
fallados y en qué platos) viaja a la nube dentro de `employees.extras` y **el
panel del supervisor ya lo lee** — comprobado en el código: `allEmps[n].paseStats`.
Registrarlo otra vez en `actividad` daría dos cifras distintas del mismo
trabajo, y la primera vez que no coincidieran nadie sabría cuál creer.
Cuando el panel nuevo sustituya al actual (fase 3) hay que decidir si el pase
migra a `actividad` o se queda donde está; hasta entonces, duplicarlo es peor.

**Flashcards — porque no es una sesión, es un gesto.**
`fcRate` se dispara al puntuar **cada tarjeta**. Registrar una fila por tarjeta
llenaría la tabla de miles de filas de un evento que no significa nada por sí
solo: nadie puede decir si alguien «va bien en flashcards» mirando una tarjeta.
Lo que sí es una sesión con principio y final es el **Repaso inteligente**, que
usa el mismo motor de repetición espaciada y **sí registra** — con su acierto,
su total y su duración. El trabajo de las flashcards no se pierde: alimenta el
SRS, y el SRS se ve en el repaso.

**Duelos — porque su sitio es su propia tabla.**
Un duelo no es una evaluación de una persona: es un enfrentamiento entre dos,
con reto, defensa, caducidad y temporada. Eso ya vive completo en la tabla
`duels`, con las dos puntuaciones, los tiempos de ambos y el ganador. Meterlo
en `actividad` obligaría a inventar a quién se le atribuye la fila, y partiría
en dos un dato que sólo se entiende entero.

### Tres que no son actividades

**Código del camarero**, **Técnicas de cocina** y **Plating guide** son
material de consulta: se leen, no se hacen. No tienen acierto, ni total, ni
final. No hay nada que registrar salvo «lo abrió», que es una métrica de
visitas, no de formación. Si algún día interesa saber quién consulta qué, eso
es analítica de uso y va en otro sitio.

---

## 2 · Prueba negativa: ¿se puede registrar a nombre de otro?

**Sí. La protección no existe a nivel de servidor: depende enteramente del
cliente. Es un riesgo pendiente, y afecta también a las tablas anteriores.**

### Lo que se probó, y lo que salió

Desde el rol `anon` —el mismo con el que la aplicación escribe, y cuya clave
está en el código fuente de la página, a la vista de cualquiera:

| Prueba | Resultado |
|---|---|
| Insertar una fila a nombre de **otro empleado**, en **otro restaurante** | **SÍ, lo permite** |
| Insertar en un restaurante **que no existe** | **SÍ, lo permite** |
| Leer las filas de **otro restaurante** | **SÍ, lo permite** |
| Modificar una fila ajena | No — bloqueado |
| Borrar una fila ajena | No — bloqueado |

Y desde el navegador, con la aplicación cargada y la consola abierta:

| Ataque | Resultado |
|---|---|
| Reasignar `currentUser` a otro empleado | **Escribe a nombre de ese otro** |
| Cambiar el restaurante de la ficha local | **Escribe en ese otro restaurante** |
| Pasar `employee`/`venue` como argumento a `registrarActividad()` | Se ignoran: la función los toma de `currentUser` y de `_vSello()` |

Lo único que sí aguanta es que la firma de la función no acepta esos campos;
pero eso es una molestia, no una protección, porque las dos variables de las
que sí los toma son globales del navegador.

### Por qué está así

No es un descuido de la fase 1: **es el modelo de seguridad que ya tenía la
aplicación entera.** Las políticas de `scores` y de `employees` son igual de
abiertas —insertar cualquiera, leer todo— y el aislamiento entre restaurantes
se aplica **en el cliente**, con el filtro `venue` en cada consulta. La tabla
nueva replica ese modelo a propósito, para no cambiar las reglas a mitad de
plan; de hecho es algo más estricta, porque sí bloquea modificar y borrar.

### Qué haría falta para cerrarlo

La raíz es que **no hay sesión autenticada**: el empleado entra con un PIN que
valida el propio cliente, y a partir de ahí la única credencial que viaja es la
clave pública. Mientras eso siga así, ninguna política de base de datos puede
distinguir a Ana de alguien que dice ser Ana.

Cerrarlo de verdad son dos cosas, en este orden:

1. **Sesiones reales** (Supabase Auth, o un token firmado por una función de
   servidor al validar el PIN), de modo que cada petición lleve identidad.
2. **Políticas que la usen**: `employee = auth.jwt()->>'name'` al insertar, y
   `venue = (el del empleado autenticado)` al leer y al escribir.

Con eso, las tres filas que hoy pasan dejarían de pasar sin tocar una sola
línea del cliente.

### Qué riesgo real supone hoy

Hay que decirlo con proporción, sin minimizarlo ni inflarlo:

- **Quien puede hacerlo** es alguien con conocimientos técnicos y acceso a la
  aplicación; no es un descuido que pueda provocar un camarero sin querer.
- **Lo peor que puede hacer** es falsear su propio progreso o el de un
  compañero, o leer las notas de otro restaurante. No hay datos personales
  sensibles ni económicos en esta tabla.
- **Lo que no puede hacer** es borrar ni alterar el historial ya escrito.
- **Y crece con el plan**: en cuanto el panel del supervisor decida sobre estos
  datos (fase 3) y se asignen formaciones (fase 4), falsear una fila deja de
  ser una travesura y pasa a alterar la evaluación de una persona.

**Recomendación**: meter la autenticación antes de la fase 4, no después. No
bloquea la fase 2 —el plan del empleado usa datos locales— y en la fase 3 el
supervisor sólo mira. Pero la fase 4 asigna formación y hace seguimiento, y eso
sí exige saber quién es quién.

---

## 3 · Incidencia abierta: el error de JavaScript a 430 px

**Estado: no reproducida. Sin cambios especulativos.**

Qué pasó: en el barrido de verificación de la fase 1, una ejecución registró
**un** error de JavaScript a 430 px de ancho. El barrido recorre quince
pantallas en cinco anchos; las otras cuatro anchuras salieron limpias en esa
misma ejecución.

Qué se hizo después: **tres ejecuciones más del mismo barrido, todas con cero
errores a 430 px**, y una cuarta con captura del texto del error por pantalla,
también limpia. El texto del error original no llegó a capturarse.

Hipótesis más probable, **sin confirmar**: una llamada de red rechazada por el
proxy de la sesión de desarrollo —que bloquea `supabase.co` desde el
navegador— aflorando como promesa no capturada. Encaja con que sea
intermitente y con que no dependa del ancho de pantalla. No se ha tocado nada
por esto: cambiar código para perseguir un fallo que no se reproduce es la
forma más rápida de introducir uno que sí.

Qué hacer si reaparece: capturar el texto completo con
`page.on('pageerror')` **antes** de cambiar la pantalla, que es lo que faltó, y
mirar si coincide con alguna petición bloqueada en el mismo instante.
