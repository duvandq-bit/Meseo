// ═══════════════════════════════════════════════════════════════════════════
// B2 · F7 · LAS MUTACIONES, EN EL REPOSITORIO
// ═══════════════════════════════════════════════════════════════════════════
//
// POR QUÉ EXISTE ESTE FICHERO
//   Una prueba en verde no demuestra nada por sí sola: demuestra algo cuando,
//   al romper a propósito lo que protege, se pone roja. Hasta F7 las mutaciones
//   de B2 se ejecutaron a mano, en guiones de usar y tirar. Eso significa que
//   la garantía la tenía yo en la cabeza y no el repositorio, y que el día que
//   alguien reescriba una función nadie sabrá qué prueba debía caer.
//
//   I7.1 del plan: «ninguna invariante crítica sin mutación que la demuestre».
//   Aquí está el catálogo, y es ejecutable.
//
// CÓMO SE USA
//   node tests/mutaciones.mjs            ← todas. Tarda: cada una relanza la
//                                          suite entera (~1 min × N).
//   node tests/mutaciones.mjs --lista    ← sólo comprueba que cada ancla sigue
//                                          existiendo y siendo única. <1 s.
//   node tests/mutaciones.mjs F6         ← filtra por fase.
//
//   El modo `--lista` es el que puede ir en CI, y no es un sucedáneo: lo que
//   se pudre con el tiempo es el ANCLA. Una mutación cuyo texto ya no aparece
//   en el fichero no prueba nada y pasaría desapercibida para siempre; esto la
//   caza en un segundo. `tests/smoke.mjs` ejecuta esa misma comprobación.
//
// SEGURIDAD
//   Este guión ESCRIBE en ficheros versionados. El contenido original se
//   guarda en memoria antes de tocar nada y se restaura en un `finally` y
//   también ante SIGINT/SIGTERM. Si aun así algo quedara a medias, el propio
//   guión lo dice al terminar comparando con la copia.
//
// LO QUE NO HACE
//   No cambia comportamiento, no toca el servidor y no forma parte de `npm
//   test`. Es una herramienta de verificación, no una fase de B2.

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const leer = (p) => readFileSync(join(ROOT, p), 'utf8');

// ─── EL CATÁLOGO ───────────────────────────────────────────────────────────
//
// `rompe` dice qué garantía se destruye, en castellano y sin jerga: es lo que
// se lee cuando una mutación sobrevive, y tiene que bastar para entender qué
// dejó de estar protegido. `cae` es el trozo del nombre de la prueba que debe
// ponerse roja; si cae otra distinta, también cuenta, pero se avisa.
const MUTACIONES = [

  // ═══ F0 · identidad única e inmutable ═══
  { id:'F0-1', fase:'F0', fila:null,
    rompe:'el token deja de salir del contexto congelado y vuelve a ser un global',
    archivo:'index.html',
    de:"function _bearer(){ return _authCtx().token || SUPA_KEY; }",
    a:"function _bearer(){ return (typeof _authToken !== 'undefined' ? _authToken : null) || SUPA_KEY; }",
    cae:'no quedan lecturas sueltas de identidad' },

  { id:'F0-2', fase:'F0', fila:null,
    rompe:'el contexto deja de estar congelado y se puede mutar por error',
    archivo:'index.html',
    de:"function _authPoner(next){ _auth = Object.freeze(next); }",
    a:"function _authPoner(next){ _auth = next; }",
    cae:'el contexto está CONGELADO' },

  // ═══ F1 · idempotencia en el servidor ═══
  { id:'F1-1', fase:'F1', fila:8,
    rompe:'el índice pasa a ser GLOBAL: cualquiera puede quemar el evento_id de otro',
    archivo:'supabase/fase_c_identidad_servidor.sql',
    de:"create unique index scores_evt_uk\n  on public.scores (auth_user_id, evento_id) where evento_id is not null;",
    a:"create unique index scores_evt_uk\n  on public.scores (evento_id) where evento_id is not null;",
    cae:'el índice es PARCIAL y COMPUESTO' },

  { id:'F1-2', fase:'F1', fila:null,
    rompe:'se retira el permiso de evento_id: cada envío de B2 recibiría 42501',
    archivo:'supabase/fase_c_identidad_servidor.sql',
    de:"grant insert (evento_id) on public.scores    to authenticated;",
    a:"-- grant insert (evento_id) on public.scores    to authenticated;",
    cae:'evento_id se concede a authenticated' },

  { id:'F1-3', fase:'F1', fila:null,
    rompe:'se concede evento_id a anon: vuelve la escritura sin identidad',
    archivo:'supabase/fase_c_identidad_servidor.sql',
    de:"grant insert (evento_id) on public.actividad to authenticated;",
    a:"grant insert (evento_id) on public.actividad to anon, authenticated;",
    cae:'NUNCA a anon' },

  // ═══ F2 · alta, persistencia síncrona y capacidad ═══
  { id:'F2-1', fase:'F2', fila:16,
    rompe:'un fallo de setItem se traga y el llamante cree que se guardó',
    archivo:'index.html',
    de:"  const r = _evEscribir(_EV_KEY, prospectiva);\n  if(r !== true){",
    a:"  const r = _evEscribir(_EV_KEY, prospectiva);\n  if(false){",
    cae:'QuotaExceededError' },

  { id:'F2-2', fase:'F2', fila:2,
    rompe:'el evento sin identidad entra en la cola que drena',
    archivo:'index.html',
    de:"    const r = _evEscribir(_EV_SIN_ID, _evLeer(_EV_SIN_ID).concat([ev]));",
    a:"    const r = _evEscribir(_EV_KEY, _evLeer(_EV_KEY).concat([ev]));",
    cae:'sin_identidad' },

  { id:'F2-3', fase:'F2', fila:26,
    rompe:'el identificador se genera al ENVIAR, así que cada reintento crea uno nuevo',
    archivo:'index.html',
    de:"  const ev = { v:1, evento_id:_uuid(), destino, prioridad, uid: ctx.uid || null,",
    a:"  const ev = { v:1, evento_id:null, destino, prioridad, uid: ctx.uid || null,",
    cae:'evento_id' },

  // ═══ F3 · drenaje, identidad congelada y clasificación ═══
  { id:'F3-1', fase:'F3', fila:4,
    rompe:'desaparece el filtro por identidad: Bruno drena los eventos de Ana',
    archivo:'index.html',
    de:"    .filter(e => e.uid === ctx.uid && e.estado !== 'revisar'",
    a:"    .filter(e => e.estado !== 'revisar'",
    cae:'Bruno no drena lo de Ana' },

  { id:'F3-2', fase:'F3', fila:6,
    rompe:'se quita la comprobación de cambio de identidad a mitad del ciclo',
    archivo:'index.html',
    de:"        if(_authCtx() !== ctx) return 'identidad-cambiada';",
    a:"        if(false) return 'identidad-cambiada';",
    cae:'la identidad cambia A MITAD' },

  { id:'F3-3', fase:'F3', fila:4,
    rompe:'se quita la cuarta comprobación: el token podría no ser el del dueño',
    archivo:'index.html',
    de:"  if(_jwtSub(ctx.token) !== ctx.uid) return { estado:'token-no-coincide' };",
    a:"  if(false) return { estado:'token-no-coincide' };",
    cae:'CUATRO comprobaciones' },

  { id:'F3-4', fase:'F3', fila:12,
    rompe:'cualquier 409 se toma por duplicado: un 23503 se daría por bueno',
    archivo:'index.html',
    // OJO: el centinela del `||` es un NUL literal, no un espacio. El
    // verificador de anclas lo destapó; escrito con un espacio, esta mutación
    // no habría llegado a aplicarse nunca y la garantía habría quedado sin
    // demostrar en silencio.
    de:"if(code === '23505' && msg.indexOf(_EV_INDICE[ev.destino] || '\u0000') >= 0) return { estado:'duplicado' };",
    a:"return { estado:'duplicado' };",
    cae:'23503' },

  { id:'F3-5', fase:'F3', fila:11,
    rompe:'un 23505 de OTRO índice se toma por idempotencia y el evento se borra',
    archivo:'index.html',
    de:"    if(code === '23505') return { estado:'cuarentena', motivo:'unico-inesperado' };",
    a:"    if(code === '23505') return { estado:'duplicado' };",
    cae:'23505 de OTRO índice' },

  { id:'F3-6', fase:'F3', fila:15,
    rompe:'un 5xx se manda a cuarentena: una caída del servidor mata el evento',
    archivo:'index.html',
    de:"  if(st === 408 || st === 429 || st >= 500) return { estado:'reintentable', motivo:'http-' + st };",
    a:"  if(st === 408 || st === 429 || st >= 500) return { estado:'cuarentena', motivo:'http-' + st };",
    cae:'el evento rechazado SE QUEDA' },

  // La primera versión de esta mutación apuntaba a
  //   `if(res.estado === 'renovar') return 'credencial-no-renovable';`
  // y SOBREVIVÍA. No era una prueba que faltara: esa línea es INALCANZABLE —la
  // rama anterior siempre retorna—, y está medido: convertirla en un `throw` no
  // pone roja ni una prueba. La garantía de «una sola renovación por ciclo» la
  // sostiene el `return 'renovada-sesion'`, que es lo que hay que mutar. La
  // línea muerta se deja donde está: quitarla sería modificar F3.
  // ESTA MUTACIÓN SE HA MUDADO DOS VECES, y las dos por el mismo motivo: la
  // garantía «una sola renovación, sin bucle» ha ido cambiando de sitio.
  //   1ª · apuntaba a `return 'credencial-no-renovable'`, que resultó ser una
  //        línea INALCANZABLE (F7 lo midió con un `throw`).
  //   2ª · apuntaba al `return 'renovada-sesion'` del bucle. Con C+D la puerta
  //        del drenaje detecta el token muerto ANTES de entrar al bucle, así
  //        que esa rama dejó de ser el sitio donde vive la garantía.
  // Ahora apunta donde de verdad está: si la puerta no renueva, un token
  // caducado no se recupera nunca y la cola se queda parada para siempre.
  { id:'F3-7', fase:'F3', fila:10,
    rompe:'un token caducado deja de renovarse: la cola se queda parada para siempre',
    archivo:'index.html',
    de:"  if(!(ctx.exp * 1000 > Date.now())){ await _eventoRenovar(); return 'credencial-caducada'; }",
    a:"  if(!(ctx.exp * 1000 > Date.now())){ return 'credencial-caducada'; }",
    cae:'renovación por la vía existente' },

  { id:'F3-8', fase:'F3', fila:5,
    rompe:'se pierde el orden por prioridad: los alérgenos dejan de ir primero',
    archivo:'index.html',
    de:"    .sort((a, b) => (a.prioridad - b.prioridad) || (a.ts - b.ts));   // alérgenos primero",
    a:"    .sort((a, b) => (b.prioridad - a.prioridad) || (a.ts - b.ts));",
    cae:'un éxito elimina SÓLO su evento' },

  { id:'F3-9', fase:'F3', fila:25,
    rompe:'un 2xx sin filas se toma por éxito y el evento se borra sin haberse escrito',
    archivo:'index.html',
    de:"    return filas > 0 ? { estado:'confirmado' } : { estado:'cuarentena', motivo:'sin-fila' };",
    a:"    return { estado:'confirmado' };",
    cae:'2xx que no demuestra nada' },

  // ═══ F4 · capacidad ═══
  { id:'F4-1', fase:'F4', fila:20,
    rompe:'las evaluaciones pasan a descartarse por capacidad como las prácticas',
    archivo:'index.html',
    de:"  if(prioridad >= 3 && (cola.length >= EV_UMBRAL_P3 || tam > EV_PRESUPUESTO)){",
    a:"  if(prioridad >= 1 && (cola.length >= EV_UMBRAL_P3 || tam > EV_PRESUPUESTO)){",
    cae:'evaluación' },

  { id:'F4-2', fase:'F4', fila:18,
    rompe:'el descarte deja de contarse: vuelve el descarte silencioso',
    archivo:'index.html',
    de:"    _evContar('descartado_por_espacio', { destino, actividad: datos && datos.activity,",
    a:"    if(false) _evContar('descartado_por_espacio', { destino, actividad: datos && datos.activity,",
    cae:'descart' },

  { id:'F4-3', fase:'F4', fila:19,
    rompe:'el aviso de cola alta desaparece: 500 en cola deja de decirse',
    archivo:'index.html',
    de:"  else if(cola.length >= EV_UMBRAL_AVISO) _evContar('cola_alta', { n: cola.length });",
    a:"  else if(false) _evContar('cola_alta', { n: cola.length });",
    cae:'fila 19' },

  { id:'F4-4', fase:'F4', fila:17,
    rompe:'el umbral de prácticas baja y se descarta mucho antes de tiempo',
    archivo:'index.html',
    de:"const EV_UMBRAL_P3    = 400;",
    a:"const EV_UMBRAL_P3    = 4;",
    cae:'400' },

  // ═══ F5 · cuarentena ═══
  { id:'F5-1', fase:'F5', fila:21,
    rompe:'la cuarentena colapsa también P1 y P2: se pierde el detalle de una evaluación',
    archivo:'index.html',
    de:"    if(e.prioridad >= 3){",
    a:"    if(e.prioridad >= 1){",
    cae:'prioridad 1 y 2 NUNCA se colapsan' },

  { id:'F5-2', fase:'F5', fila:21,
    rompe:'una fecha ilegible en la cuarentena tumba el drenaje entero',
    archivo:'index.html',
    de:"const dia = (Number.isFinite(ts) && ts > 0) ? new Date(ts).toISOString().slice(0, 10) : 'desconocido';",
    a:"const dia = new Date(ts).toISOString().slice(0, 10);",
    cae:'fecha ilegible' },

  { id:'F5-3', fase:'F5', fila:16,
    rompe:'el aplazamiento se olvida cuando el disco está lleno: bucle de reintentos',
    archivo:'index.html',
    de:"  if(guardado){ _evAplazado.delete(_evClave(ev)); return true; }",
    a:"  if(true){ _evAplazado.delete(_evClave(ev)); return true; }",
    cae:'DISCO ENTERO lleno' },

  { id:'F5-4', fase:'F5', fila:null,
    rompe:'el aplazamiento deja de llevar identidad: Ana y Bruno se pisan la espera',
    archivo:'index.html',
    de:"function _evClave(ev){ return (ev.uid || '-') + '\\u0000' + ev.evento_id; }",
    a:"function _evClave(ev){ return ev.evento_id; }",
    cae:'atado a la identidad' },

  // ═══ F6 · superficie de incidencias ═══
  { id:'F6-1', fase:'F6', fila:3,
    rompe:'la superficie deja de filtrar por identidad: Bruno ve el estado de Ana',
    archivo:'index.html',
    de:"  const mio = (e) => !!(e && e.uid && ctx.uid && e.uid === ctx.uid);",
    a:"  const mio = (e) => !!e;",
    cae:'DISPOSITIVO COMPARTIDO' },

  { id:'F6-2', fase:'F6', fila:null,
    rompe:'cada sincronización normal se convierte en un aviso',
    archivo:'index.html',
    de:"  r.visible = !!(r.accionable || r.demorados);",
    a:"  r.visible = !!(r.accionable || r.pendientes);",
    cae:'es rutina y no se pinta nada' },

  { id:'F6-3', fase:'F6', fila:null,
    rompe:'un atasco con red vuelve a ser invisible',
    archivo:'index.html',
    de:"  r.visible = !!(r.accionable || r.demorados);\n  return r;",
    a:"  r.visible = !!r.accionable;\n  return r;",
    cae:'atascado' },

  { id:'F6-4', fase:'F6', fila:null,
    rompe:'un 401 sin código deja de contar como sesión no válida',
    archivo:'index.html',
    de:"                             || String(e.motivo || '').indexOf('auth-') === 0),",
    a:"                             ),",
    cae:'401 SIN código' },

  { id:'F6-5', fase:'F6', fila:null,
    rompe:'vuelve la promesa falsa de que lo que está en revisión se reenviará solo',
    archivo:'index.html',
    de:"              : 'Lo hecho está guardado en este dispositivo, pero no se enviará solo. Vuelve a entrar para que lo siguiente sí llegue, y díselo a tu responsable.',",
    a:"              : 'No se ha perdido nada. Vuelve a entrar y se enviará.',",
    cae:'dice la verdad' },

  { id:'F6-6', fase:'F6', fila:16,
    rompe:'quedarse sin espacio deja de avisarse en el acto',
    archivo:'index.html',
    // La primera versión de esta mutación AÑADÍA una línea muerta
    // (`if(false) _evPintarIncidencias();`) en vez de quitar el repintado, así
    // que no rompía nada y sobrevivía — pero durante un tiempo pareció morder,
    // porque la suite reventaba por una fixtura frágil y cualquier cosa salía
    // roja. Endurecidas las fixturas, la verdad salió sola. Ahora se quita el
    // repintado del camino que NO persiste, que es lo que se quiere proteger.
    de:"    // más importante de los seis no aparecía hasta la siguiente actividad.\n    _evPintarIncidencias();",
    a:"    // más importante de los seis no aparecía hasta la siguiente actividad.",
    cae:'EN EL ACTO' },

  { id:'F6-7', fase:'F6', fila:null,
    rompe:'el aviso de disco lleno no se abre solo y nadie lo ve',
    archivo:'index.html',
    de:"  if(fijo && !_evFijoMostrado){ _evFijoMostrado = true; _evPanelAbierto = true; }",
    a:"  if(false){ _evFijoMostrado = true; _evPanelAbierto = true; }",
    cae:'abre el panel una vez' },

  { id:'F6-8', fase:'F6', fila:null,
    rompe:'el panel deja de escapar el HTML de lo que pinta',
    archivo:'index.html',
    de:"    + '<strong>' + escapeHtml(x.texto) + '</strong>'",
    a:"    + '<strong>' + x.texto + '</strong>'",
    cae:'se escapa' },

  { id:'F6-9', fase:'F6', fila:null,
    rompe:'aparece una acción de recuperación que el sistema no sabe cumplir',
    archivo:'index.html',
    de:"onclick=\"logout()\">'",
    a:"onclick=\"_evReintentarTodo()\">'",
    cae:'frontera con F7' },

  { id:'F6-10', fase:'F6', fila:null,
    rompe:'la píldora de offline deja de decir cuántos resultados esperan',
    archivo:'index.html',
    de:"    txt.textContent = n",
    a:"    txt.textContent = false",
    cae:'píldora de offline' },

  { id:'F6-11', fase:'F6', fila:3,
    rompe:'la píldora cuenta la cola entera, también la de otra persona',
    archivo:'index.html',
    de:"    try{ n = (typeof _evResumen === 'function') ? _evResumen().pendientes : 0; }catch(_){}",
    a:"    try{ n = _evLeer(_EV_KEY).length; }catch(_){}",
    cae:'píldora de offline' },

  { id:'F6-12', fase:'F6', fila:null,
    rompe:'un texto de la interfaz empieza a enseñar el nombre de una tabla',
    archivo:'index.html',
    de:"              : `${n(r.cuarentena,'resultado no se ha podido enviar','resultados no se han podido enviar')}.`,",
    a:"              : `${n(r.cuarentena,'resultado no se ha podido enviar','resultados no se han podido enviar')} a scores.`,",
    cae:'tripa del sistema' },

  { id:'F6-13', fase:'F6', fila:null,
    rompe:'lo que está en revisión se cuenta ADEMÁS como pendiente: un resultado aparece dos veces',
    archivo:'index.html',
    de:"    pendientes:   pend.length,",
    a:"    pendientes:   cola.filter(e => mio(e)).length,",
    cae:'dice la verdad' },

  { id:'F6-14', fase:'F6', fila:null,
    rompe:'una marca de tiempo ilegible esconde el atasco en vez de enseñarlo',
    archivo:'index.html',
    de:"    return !(isFinite(t) && t > 0) || (ahora - t) >= EV_DEMORA_VISIBLE; };",
    a:"    return (isFinite(t) && t > 0) && (ahora - t) >= EV_DEMORA_VISIBLE; };",
    cae:'atascado' },

  { id:'F6-15', fase:'F6', fila:null,
    rompe:'el reflejo de la cola de fichas pisa el aviso de offline justo cuando hace falta',
    archivo:'index.html',
    de:"  if(navigator.onLine === false) return;\n  const l = _colaCargar();",
    a:"  const l = _colaCargar();",
    cae:'no pisa el aviso de offline' },

  { id:'F6-16', fase:'F6', fila:null,
    rompe:'el chip deja de ser tocable con el pulgar',
    archivo:'styles.css',
    de:"  min-width:44px;min-height:44px;padding:0 .7rem;",
    a:"  min-width:20px;min-height:20px;padding:0 .7rem;",
    cae:'44 px' },

  { id:'F6-17', fase:'F6', fila:null,
    rompe:'el detalle se sale de la pantalla en un móvil estrecho',
    archivo:'styles.css',
    de:"display:none;width:min(340px,calc(100vw - 28px));",
    a:"display:none;width:340px;",
    cae:'44 px' },

  { id:'F6-18', fase:'F6', fila:null,
    rompe:'el panel crece sin fin en vez de hacer scroll y tapa la pantalla',
    archivo:'styles.css',
    de:"max-height:min(46vh,340px);overflow-y:auto;",
    a:"",
    cae:'44 px' },

  { id:'F6-19', fase:'F6', fila:null,
    rompe:'el panel tapa la última opción del menú cuando está abierto',
    archivo:'styles.css',
    de:"body:has(#mainNavDD.open) .ev-aviso-panel,\n",
    a:"",
    cae:'DENTRO de la aplicación' },

  { id:'F6-20', fase:'F6', fila:null,
    rompe:'la acción de volver a entrar deja de ser tocable',
    archivo:'styles.css',
    de:"  margin-top:.45rem;min-height:44px;padding:0 1rem;",
    a:"  margin-top:.45rem;padding:0 1rem;",
    cae:'44 px' },

  // ═══ C+D · arranque en frío, filas 1 y 23 de la matriz ═══
  { id:'AUTH-1', fase:'CD', fila:1,
    rompe:'durante el arranque se deduce un uid a medias y el evento deja de ser huérfano',
    archivo:'index.html',
    // La primera versión de esta mutación NO cambiaba nada: durante el
    // arranque no hay token, así que `_jwtSub(null)` es null y la condición
    // seguía siendo la misma. Sobrevivía por inofensiva, no por desprotegida.
    // Ahora se fabrica un dueño de verdad, que es el fallo que hay que impedir.
    de:"function _eventoCrear(destino, prioridad, datos){\n  const ctx = _authCtx();",
    a:"function _eventoCrear(destino, prioridad, datos){\n  const _c0 = _authCtx();\n  const ctx = _c0.uid ? _c0 : { ..._c0, uid: _jwtSub(_c0.token) || 'uid-supuesto' };",
    cae:'una actividad durante el arranque va a los huérfanos' },

  { id:'AUTH-2', fase:'CD', fila:23,
    rompe:'el drenaje corre con la identidad todavía sin resolver',
    archivo:'index.html',
    de:"  if(ctx.estado !== 'authenticated'){\n    return ctx.estado === 'initializing'        ? 'arrancando'",
    a:"  if(false){\n    return ctx.estado === 'initializing'        ? 'arrancando'",
    cae:'el drenaje NO corre durante el bootstrap' },

  { id:'AUTH-3', fase:'CD', fila:1,
    rompe:'la identidad sale del `sub` del token sin comprobar que la sesión lo respalda',
    archivo:'index.html',
    de:"  if(_jwtSub(t) !== u) return null;",
    a:"  if(false) return null;",
    cae:'sujeto discordante' },

  { id:'AUTH-4', fase:'CD', fila:null,
    rompe:'se conserva el uid anterior con un token de otro sujeto',
    archivo:'index.html',
    de:"          _authPoner(nuevo);\n          _authTrasIdentidad(a);",
    a:"          _authPoner({ ...nuevo, uid: a.uid || nuevo.uid });\n          _authTrasIdentidad(a);",
    cae:'NO se mezcla con el uid anterior' },

  { id:'AUTH-5', fase:'CD', fila:null,
    rompe:'se conserva el token anterior al cambiar de identidad',
    archivo:'index.html',
    de:"  _authPoner({ ..._AUTH_VACIO });\n  // Salir RESUELVE el arranque",
    a:"  _authPoner({ ..._AUTH_VACIO, token: _authCtx().token });\n  // Salir RESUELVE el arranque",
    cae:'el contexto se vacía entero' },

  { id:'AUTH-6', fase:'CD', fila:null,
    rompe:'desaparece «initializing»: no se distingue «no sé quién eres» de «no hay nadie»',
    archivo:'index.html',
    de:"let _auth = Object.freeze({ ..._AUTH_INICIO });",
    a:"let _auth = Object.freeze({ ..._AUTH_VACIO });",
    cae:'initializing' },

  { id:'AUTH-7', fase:'CD', fila:null,
    rompe:'un JWT caducado se convierte en identidad activa',
    archivo:'index.html',
    de:"  if(!exp || exp * 1000 <= Date.now()) return null;",
    a:"  if(false) return null;",
    cae:'CADUCADA nunca llega a authenticated' },

  { id:'AUTH-8', fase:'CD', fila:2,
    rompe:'los eventos huérfanos se adoptan en cuanto hay identidad',
    archivo:'index.html',
    de:"function _authTrasIdentidad(anterior){\n  if(anterior && anterior.estado === 'authenticated') return;   // ya lo estaba",
    a:"function _authTrasIdentidad(anterior){\n  try{ const h=_evLeer(_EV_SIN_ID); if(h.length){ const c=_authCtx();\n    _evEscribir(_EV_KEY, _evLeer(_EV_KEY).concat(h.map(e=>({...e, uid:c.uid, estado:'pendiente'}))));\n    _evEscribir(_EV_SIN_ID, []); } }catch(_){}\n  if(anterior && anterior.estado === 'authenticated') return;   // ya lo estaba",
    cae:'huérfano' },

  { id:'AUTH-9', fase:'CD', fila:12,
    rompe:'el drenaje deja de filtrar por identidad tras una recarga',
    archivo:'index.html',
    de:"    .filter(e => e.uid === ctx.uid && e.estado !== 'revisar'",
    a:"    .filter(e => e.estado !== 'revisar'",
    cae:'Bruno' },

  { id:'AUTH-10', fase:'CD', fila:null,
    rompe:'se deja de comprobar que el token es del dueño del evento',
    archivo:'index.html',
    de:"  if(_jwtSub(ctx.token) !== ctx.uid) return { estado:'token-no-coincide' };",
    a:"  if(false) return { estado:'token-no-coincide' };",
    cae:'CUATRO comprobaciones' },

  // ═══ F7 · lo que esta fase acaba de cerrar ═══
  { id:'F7-1', fase:'F7', fila:15,
    rompe:'el backoff se aplana: un servidor caído recibe un martilleo constante',
    archivo:'index.html',
    de:"const _EV_ESPERA = [0, 5*60e3, 15*60e3, 60*60e3, 4*60*60e3, 24*60*60e3];",
    a:"const _EV_ESPERA = [0, 0, 0, 0, 0, 0];",
    cae:'fila 15' },

  { id:'F7-2', fase:'F7', fila:26,
    rompe:'el evento sale por la red ANTES de estar en disco',
    archivo:'index.html',
    de:"  _evPintarIncidencias();\n  return { estado:'persistido', evento: ev };",
    a:"  _evPintarIncidencias();\n  return { estado:'persistido', evento: ev };   // sin tocar",
    cae:null,   // mutación de control: NO debe caer nada (sólo cambia un comentario)
    control:true },

  // ═══ SONIDO · el botón contextual que sustituyó al flotante ═══
  { id:'SND-1', fase:'SND', fila:null,
    rompe:'una actividad con sonido se queda sin hueco y el botón no llega a ella',
    archivo:'index.html',
    de:'        <span class="exam-timer" id="examTimer">—</span>\n        <span class="snd-slot"></span>',
    a:'        <span class="exam-timer" id="examTimer">—</span>',
    cae:'Examen pinta exactamente un hueco' },

  { id:'SND-2', fase:'SND', fila:null,
    rompe:'el botón vuelve a flotar y puede sentarse encima del texto, que es el defecto de partida',
    archivo:'styles.css',
    de:'.sound-toggle{\n  width:36px;height:36px;border-radius:50%;',
    a:'.sound-toggle{\n  position:fixed;bottom:120px;left:12px;\n  width:36px;height:36px;border-radius:50%;',
    cae:'ya no flota' },

  { id:'SND-3', fase:'SND', fila:null,
    rompe:'se cae la guarda de idempotencia: cada mutación mueve el botón, y cada movimiento es otra mutación',
    archivo:'index.html',
    de:'  if(btn.parentNode === destino) return;\n  destino.appendChild(btn);',
    a:'  destino.appendChild(btn);',
    cae:'es idempotente' },

  // ═══ RESERVA INFERIOR · que el aviso de B2 no tape la última fila ═══
  { id:'RSV-1', fase:'RSV', fila:null,
    rompe:'desaparece la reserva extra y el aviso de B2 vuelve a tapar los últimos 27 px de contenido',
    archivo:'styles.css',
    de:'body:has(.ev-aviso-chip.visible) #screenApp .app-content{\n  padding-bottom:calc(161px + env(safe-area-inset-bottom,0px));\n}',
    a:'/* regla retirada por la mutación RSV-1 */',
    cae:'la reserva condicional alcanza al aviso de B2' },

  // ═══ COMPROMISO DE USO · la firma que protege ═══
  { id:'NDA-1', fase:'NDA', fila:null,
    rompe:'el compromiso se apaga: nadie firma y no hay prueba de aceptación de nada',
    archivo:'data/nda.json',
    de:'  "activo": true,',
    a:'  "activo": false,',
    cae:'está encendido y con versión nueva' },

  { id:'NDA-2', fase:'NDA', fila:null,
    rompe:'la traducción inglesa pierde una cláusula y quien firma en inglés acepta menos que quien firma en español',
    archivo:'data/nda.json',
    de:'      {\n        "t": "Access and changes",\n        "p": "Access may be suspended if you breach this or when you stop working at the restaurant. If this text changes, you will be asked to sign the new version; the version you sign is shown below and you can read it from the footer of the sign-in screen."\n      },\n',
    a:'',
    cae:'español e inglés van a la par' },

  { id:'NDA-3', fase:'NDA', fila:null,
    rompe:'la política de privacidad vuelve al correo personal: los derechos RGPD se ejercen contra un buzón que ya no es el de la empresa',
    archivo:'privacidad.html',
    de:'<strong>Contacto:</strong> <a href="mailto:contacto@meseo.es">contacto@meseo.es</a>',
    a:'<strong>Contacto:</strong> <a href="mailto:duvandq@gmail.com">duvandq@gmail.com</a>',
    cae:'contacto@meseo.es en todas partes' },

  { id:'PIE-1', fase:'NDA', fila:null,
    rompe:'el login vuelve a enseñar la columna Plataforma, que ahí no lleva a ningún sitio',
    archivo:'index.html',
    de:"  _pieRender('loginFoot', { plataforma:false });",
    a:"  _pieRender('loginFoot', { plataforma:true });",
    cae:'el login va sin Plataforma' },

  // ═══ FIRMA AUTENTICADA · la evidencia es atribuible y no se falsifica ═══
  // Mutan la MIGRACIÓN: la CI no tiene base de datos, así que lo que se
  // demuestra aquí es que el test vigila lo que el SQL dice. El
  // comportamiento real se ensayó contra la base (NDA-1..12, revertido).
  { id:'NDA-SEC-1', fase:'NDA', fila:null,
    rompe:'la RPC vuelve a buscar el empleado por un dato del navegador: se puede firmar en nombre de otro',
    archivo:'supabase/nda_firma_autenticada.sql',
    de:'    from public.employees e where e.auth_user_id = v_uid;',
    a:'    from public.employees e where e.name = p_full_name;',
    cae:'el empleado sale de auth.uid()' },

  { id:'NDA-SEC-2', fase:'NDA', fila:null,
    rompe:'la RPC vuelve a aceptar una versión del cliente: se puede firmar una versión inventada',
    archivo:'supabase/nda_firma_autenticada.sql',
    de:'create function public.nda_sign(p_full_name text, p_texto_sha256 text)\nreturns json',
    a:'create function public.nda_sign(p_full_name text, p_texto_sha256 text, p_version text)\nreturns json',
    cae:'el empleado sale de auth.uid()' },

  { id:'NDA-SEC-3', fase:'NDA', fila:null,
    rompe:'la firma deja de guardar la identidad autenticada: ya no prueba quién firmó',
    archivo:'supabase/nda_firma_autenticada.sql',
    de:'    (v_uid, v_emp, v_venue, v_full, v_vig.version, v_vig.texto_sha256, \'auth\', v_ip, v_ua)',
    a:'    (null, v_emp, v_venue, v_full, v_vig.version, v_vig.texto_sha256, \'auth\', v_ip, v_ua)',
    cae:'la evidencia lleva auth_user_id' },

  { id:'NDA-SEC-4', fase:'NDA', fila:null,
    rompe:'vuelve el ON DELETE CASCADE: borrar o renombrar la ficha destruye la evidencia',
    archivo:'supabase/nda_firma_autenticada.sql',
    de:'alter table public.nda_signatures drop constraint nda_signatures_employee_fkey;\n',
    a:'alter table public.nda_signatures drop constraint nda_signatures_employee_fkey;\nalter table public.nda_signatures add constraint nda_signatures_employee_fkey foreign key (employee) references public.employees(name) on update cascade on delete cascade;\n',
    cae:'sobrevive a la ficha' },
];

// ─── EJECUCIÓN ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const soloLista = args.includes('--lista');
const fase = args.find(a => /^(F\d|CD)$/i.test(a));
const lista = MUTACIONES.filter(m => !fase || m.fase === fase);

const SALA = join(ROOT, '.mutaciones-en-curso');
const cent = join(SALA, 'estado.json');

function recuperarSiHizoFalta() {
  if (!existsSync(cent)) return null;
  let e; try { e = JSON.parse(readFileSync(cent, 'utf8')); }
  catch (_) { console.error('✗ centinela ilegible en ' + SALA + ' — restaura a mano con git checkout.'); process.exit(2); }
  let tocados = 0;
  for (const [p, copia] of Object.entries(e.copias || {})) {
    const intacto = readFileSync(join(SALA, copia), 'utf8');
    if (leer(p) !== intacto) { writeFileSync(join(ROOT, p), intacto); tocados++; }
  }
  console.log(tocados
    ? `⚠ La batería anterior murió sin restaurar (en «${e.enCurso || '?'}»). ${tocados} fichero(s) recuperados.`
    : `⚠ La batería anterior no terminó (en «${e.enCurso || '?'}»), pero los ficheros estaban intactos.`);
  return e;
}
const previo = recuperarSiHizoFalta();

// La firma de TODO lo que influye en el veredicto: el catálogo, este mismo
// verificador y la suite que juzga. Si cambia cualquiera de los tres, lo ya
// verificado deja de valer y la reanudación se descarta entera.
//
// No basta con firmar el catálogo, y lo aprendí rompiéndolo: al arreglar la
// lógica que decidía si una mutación mordía, la reanudación dio por buenas
// once mutaciones juzgadas con la lógica anterior —que era justamente la que
// estaba mal—. Una reanudación que conserva veredictos de otro juez no es una
// optimización: es un resultado inventado.
function firmaDelCatalogo() {
  return createHash('sha256')
    .update(MUTACIONES.map(m => m.id + '\u0000' + m.archivo + '\u0000' + m.de + '\u0000' + m.a).join('\u0001'))
    .update('\u0002').update(readFileSync(fileURLToPath(import.meta.url), 'utf8'))
    .update('\u0002').update(leer('tests/smoke.mjs'))
    .digest('hex').slice(0, 16);
}

// Comprueba que cada ancla existe UNA sola vez. Es la parte que se pudre.
function revisarAnclas() {
  const cache = new Map();
  const malas = [];
  for (const m of lista) {
    if (!cache.has(m.archivo)) cache.set(m.archivo, leer(m.archivo));
    const n = cache.get(m.archivo).split(m.de).length - 1;
    if (n !== 1) malas.push({ id: m.id, archivo: m.archivo, veces: n });
  }
  return malas;
}

const malas = revisarAnclas();
if (malas.length) {
  console.error('\n✗ ANCLAS PODRIDAS — estas mutaciones ya no prueban nada:\n');
  for (const x of malas)
    console.error(`   ${x.id}  en ${x.archivo}: el texto aparece ${x.veces} veces (debe ser 1)`);
  console.error('\nUna mutación cuya ancla no existe es una garantía sin demostrar.\n');
  process.exit(1);
}
console.log(`✓ ${lista.length} anclas verificadas: todas presentes y únicas.`);
if (soloLista) {
  for (const m of lista)
    console.log(`   ${m.id.padEnd(6)} ${m.fila ? ('fila ' + String(m.fila).padStart(2)) : '       '}  ${m.rompe}`);
  process.exit(0);
}

// ─── RED DE SEGURIDAD DEL PROPIO VERIFICADOR ───────────────────────────────
//
// ESTO NO ES PARANOIA: ocurrió. Durante la primera batería completa el
// contenedor se reinició en mitad de la mutación F6-5 y dejó `index.html`
// MUTADO en el árbol de trabajo. Un `finally` no protege de un SIGKILL, y el
// texto alterado era un mensaje de la interfaz —habría pasado revisión
// perfectamente—. Un verificador que puede corromper lo que verifica no vale.
//
// Antes de tocar nada se escribe en disco una copia intacta y un centinela. Al
// arrancar, si el centinela existe, se restaura desde esa copia ANTES de nada
// más. El centinela guarda además lo ya hecho, así que la batería se reanuda
// donde se quedó en vez de volver a empezar.




const originales = new Map();
for (const m of lista) if (!originales.has(m.archivo)) originales.set(m.archivo, leer(m.archivo));
const restaurar = () => { for (const [p, c] of originales) writeFileSync(join(ROOT, p), c); };

mkdirSync(SALA, { recursive: true });
const copias = {};
for (const [p, c] of originales) {
  const nombre = p.replace(/[\/\\]/g, '_') + '.intacto';
  writeFileSync(join(SALA, nombre), c);
  copias[p] = nombre;
}
// Reanudación: sólo si el catálogo no ha cambiado desde la batería interrumpida.
// SE REANUDA LO QUE PASÓ, NUNCA LO QUE FALLÓ. El centinela guarda el VEREDICTO,
// no sólo el hecho de haberse ejecutado. La primera versión guardaba únicamente
// los identificadores, y tras un reinicio dio por buena una mutación que había
// SOBREVIVIDO —F3-7, la fila 10 de la matriz, en negrita— y terminó anunciando
// «las 47 detectadas» con un agujero dentro. Una reanudación que se traga un
// fallo no ahorra tiempo: falsifica el resultado. Las que sobreviven se repiten.
const previasOK = (previo && previo.firma === firmaDelCatalogo())
  ? new Map(Object.entries(previo.veredictos || {}).filter(([, v]) => v.paso))
  : new Map();
if (previasOK.size) console.log(`↻ Reanudando: ${previasOK.size} mutaciones ya detectadas se saltan (las que sobrevivieron se repiten).`);
const estado = { firma: firmaDelCatalogo(), copias,
                 veredictos: Object.fromEntries(previasOK), enCurso: null };
const anotar = () => writeFileSync(cent, JSON.stringify(estado, null, 1));
anotar();

const limpiar = () => { try { rmSync(SALA, { recursive: true, force: true }); } catch (_) {} };
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'])
  process.on(sig, () => { restaurar(); limpiar(); process.exit(130); });
process.on('uncaughtException', (e) => { restaurar(); limpiar(); console.error(e); process.exit(2); });

// MUTANDO no es un apaño: es lo que impide que esta herramienta se engañe a sí
// misma. La guarda de anclas de la suite (I7.1) comprueba que el texto de cada
// mutación sigue existiendo — y una mutación consiste justo en quitarlo. Sin
// esta señal, CUALQUIER mutación pondría la suite roja por I7.1 y el veredicto
// sería «detectada» siempre, incluso para una garantía que nadie protege. Con
// la señal puesta, I7.1 se calla y lo que se mide es lo que se quería medir.
function correrSuite(id) {
  const entorno = { ...process.env, MUTANDO: id };
  try {
    execFileSync(process.execPath, ['tests/smoke.mjs'], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe', env: entorno });
    return { ok: true, caidas: [] };
  } catch (e) {
    const salida = ((e.stdout || '') + (e.stderr || '')).replace(/\x1b\[[0-9;]*m/g, '');
    const todas = [...salida.matchAll(/^\s*✗\s*(.+)$/gm)].map(x => x[1].trim());
    // Cinturón y tirantes: aunque la señal MUTANDO fallara, una caída de I7.1
    // NUNCA cuenta como haber detectado la mutación — es la guarda de anclas
    // quejándose de la mutación misma, no una garantía rota.
    const caidas = todas.filter(c => !c.includes('I7.1'));
    if (!caidas.length) {
      // O sólo cayó I7.1 —y entonces la mutación SOBREVIVE—, o la suite ni
      // siquiera llegó a ejecutarse, que sí es una detección: la mutación
      // rompió algo tan básico que el fichero ya no se puede ni leer.
      const arrancó = /\d+ passed/.test(salida);
      return arrancó
        ? { ok: true, caidas: [] }
        : { ok: false, caidas: ['(la suite no llegó a ejecutarse)'] };
    }
    return { ok: false, caidas };
  }
}

console.log(`\nEjecutando ${lista.length} mutaciones. Cada una relanza la suite entera.\n`);
const sobreviven = [];
let hechas = 0;
try {
  for (const m of lista) {
    hechas++;
    const cab = `${m.id.padEnd(6)} ${String(hechas).padStart(2)}/${lista.length}`;
    const antes = previasOK.get(m.id);
    if (antes) { console.log(`  ${cab}  ${antes.marca} · ${antes.nota}  (verificada antes de la interrupción)`); continue; }
    const original = originales.get(m.archivo);
    estado.enCurso = m.id; anotar();           // ← por si la máquina muere ahora
    writeFileSync(join(ROOT, m.archivo), original.replace(m.de, m.a));
    const r = correrSuite(m.id);
    writeFileSync(join(ROOT, m.archivo), original);
    const apuntar = (paso, marca, nota) => {
      estado.veredictos[m.id] = { paso, marca, nota };
      estado.enCurso = null; anotar();
    };
    if (m.control) {
      if (r.ok) { console.log(`  ${cab}  CONTROL OK · un cambio inocuo no pone nada rojo`);
                  apuntar(true, 'CONTROL OK', 'un cambio inocuo no pone nada rojo'); }
      else { console.log(`  ${cab}  ✗ CONTROL ROTO · algo cae con un cambio inocuo: ${r.caidas[0]}`);
             apuntar(false, '✗ CONTROL ROTO', r.caidas[0]); sobreviven.push(m); }
      continue;
    }
    if (r.ok) {
      console.log(`  ${cab}  ✗ SOBREVIVE · ${m.rompe}`);
      apuntar(false, '✗ SOBREVIVE', m.rompe);
      sobreviven.push(m);
    } else {
      const esperada = m.cae && r.caidas.some(c => c.includes(m.cae));
      const marca = esperada ? 'MUERDE ' : 'MUERDE*';
      const nota = `cae «${r.caidas[0]}»${esperada ? '' : `  (esperaba una que dijera «${m.cae}»)`}`;
      console.log(`  ${cab}  ${marca} · ${nota}`);
      apuntar(true, marca, nota);
    }
  }
} finally {
  restaurar();
}

// Y se comprueba que los ficheros quedaron como estaban.
const sucios = [...originales].filter(([p, c]) => leer(p) !== c).map(([p]) => p);
console.log('');
if (sucios.length) {
  console.error(`✗ FICHEROS SIN RESTAURAR: ${sucios.join(', ')} — recupéralos con git checkout.`);
  process.exit(2);
}
console.log('✓ Todos los ficheros restaurados, idénticos al original.');
limpiar();   // la batería terminó: fuera el centinela y las copias

if (sobreviven.length) {
  console.error(`\n✗ ${sobreviven.length} de ${lista.length} mutaciones SOBREVIVEN:\n`);
  for (const m of sobreviven) console.error(`   ${m.id}  ${m.rompe}`);
  console.error('\nCada una es una garantía que nadie está protegiendo.\n');
  process.exit(1);
}
console.log(`\n✓ Las ${lista.length} mutaciones detectadas. Ninguna invariante quedó sin demostrar.`);
