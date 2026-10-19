// Test gratuito «¿Cuánto sabe tu equipo de alérgenos?» · meseo.es/test/
//
// Tres vistas en una página ligera (sin index.html, sin sesión, sin supabase-js):
//   /test/                inicio del encargado (crear test) y calculadora
//   /test/?e=<id>         test del camarero (enlace del equipo)
//   /test/#r=<token>      resultados del encargado (enlace privado)
//   /test/#calculadora    calculadora suelta

import { PREGUNTAS, TEMAS, TEMA_NOMBRE } from './banco.js';
import {
  barajar, elegirPreguntas, corregir, nota, notaPorTema,
  masFalladas, notaMedia, calcularCoste, CALC_DEFECTO,
} from './logica.js';

// Contacto comercial: el mismo que ya publica meseo.es (pie del login y demo).
const CONTACTO = 'contacto@meseo.es';
const BASE_URL = 'https://meseo.es/test/';

const SUPA_URL = 'https://advkoujfgbrrjvqexrcu.supabase.co';
// Clave anónima pública (la misma que lleva la app). Solo permite insertar y
// llamar a las dos RPC del test: las tablas no se pueden leer con ella.
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkdmtvdWpmZ2Jycmp2cWV4cmN1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxODAxODgsImV4cCI6MjA4ODc1NjE4OH0.4MTKzEy_c5x3eWjWJPfS216TTVAVNNlP1Wo_-h1Nt4c';

const LS_LANG = 'meseo_test_lang';
const LS_MIOS = 'meseo_test_mios';
const LS_HECHO = 'meseo_test_hecho_';

// ─── utilidades ─────────────────────────────────────────────────────────
const $app = document.getElementById('app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function lsGet(k, def) { try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch (_) { return def; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* modo privado */ } }

let LANG = lsGet(LS_LANG, null) || 'es';
const en = () => LANG === 'en';
const t = (es, eng) => (en() ? eng : es);

function fmtNota(n) { return n == null ? '·' : (en() ? String(n) : String(n).replace('.', ',')); }
function fmtEur(n) {
  const loc = en() ? 'en-GB' : 'es-ES';
  try { return new Intl.NumberFormat(loc, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0, useGrouping: 'always' }).format(n); }
  catch (_) { return Math.round(n) + ' €'; }
}
function fmtFecha(iso) {
  try { return new Date(iso).toLocaleDateString(en() ? 'en-GB' : 'es-ES', { day: 'numeric', month: 'short' }); } catch (_) { return ''; }
}

function b64url(bytes) {
  let s = ''; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function nuevoToken() { const a = new Uint8Array(32); crypto.getRandomValues(a); return b64url(a); }
function nuevoId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const a = new Uint8Array(16); crypto.getRandomValues(a);
  a[6] = (a[6] & 0x0f) | 0x40; a[8] = (a[8] & 0x3f) | 0x80;
  const h = [...a].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;

async function supa(path, body, prefer) {
  const h = { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY, 'Content-Type': 'application/json' };
  if (prefer) h.Prefer = prefer;
  const r = await fetch(SUPA_URL + '/rest/v1/' + path, { method: 'POST', headers: h, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const txt = await r.text();
  return txt ? JSON.parse(txt) : null;
}

const enlaceEquipo = id => `${BASE_URL}?e=${id}`;
const enlaceResultados = tok => `${BASE_URL}#r=${tok}`;
function textoWhatsApp(restaurante, link) {
  return en()
    ? `${restaurante} allergen check: 10 questions, two minutes. Do it on your phone, a nickname is fine. ${link}`
    : `Test de alérgenos de ${restaurante}: 10 preguntas, dos minutos. Hazlo desde el móvil, puedes poner solo un apodo. ${link}`;
}
const urlWhatsApp = txt => 'https://wa.me/?text=' + encodeURIComponent(txt);

async function copiar(texto, btn) {
  let ok = false;
  try { await navigator.clipboard.writeText(texto); ok = true; } catch (_) {
    try {
      const ta = document.createElement('textarea'); ta.value = texto; ta.setAttribute('readonly', '');
      ta.className = 'oculto'; document.body.appendChild(ta); ta.select(); ok = document.execCommand('copy'); ta.remove();
    } catch (_) { ok = false; }
  }
  if (btn) { const o = btn.textContent; btn.textContent = ok ? t('Copiado', 'Copied') : t('No se pudo copiar', 'Could not copy'); setTimeout(() => { btn.textContent = o; }, 1600); }
}

function setLang(l, guardar = true) {
  LANG = l === 'en' ? 'en' : 'es';
  if (guardar) lsSet(LS_LANG, LANG);
  document.documentElement.lang = LANG;
  document.querySelectorAll('.idioma button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === LANG)));
  const pie = document.querySelector('.pie span'); if (pie) pie.textContent = t('Meseo · el oficio se entrena', 'Meseo · the craft is trained');
  const priv = document.querySelector('.pie a'); if (priv) priv.textContent = t('Privacidad', 'Privacy');
}
function anchos(root = $app) { root.querySelectorAll('[data-w]').forEach(el => { el.style.width = el.dataset.w + '%'; }); }
function arriba() { try { window.scrollTo({ top: 0 }); } catch (_) { /* nada */ } }

// ─── estado de la vista ─────────────────────────────────────────────────
const S = { vista: null, rerender: null };
function mostrar(fn) { S.rerender = fn; fn(); }

// ═══ 1. INICIO DEL ENCARGADO ════════════════════════════════════════════
function vistaInicio(err) {
  const mios = lsGet(LS_MIOS, []);
  $app.innerHTML = `
    <section class="hero">
      <p class="ceja">${t('Test gratuito para equipos de sala', 'Free test for front of house teams')}</p>
      <h1>${t('En dos minutos sabrás si tu equipo de sala sabe lo que tiene que saber de alérgenos.', 'In two minutes you will know if your floor team knows what it must know about allergens.')}</h1>
      <p class="sub">${t('Diez preguntas de sala, cada uno desde su móvil. Tú recibes la nota del equipo y lo que más falla.', 'Ten real floor questions, each person on their own phone. You get the team score and what they miss most.')}</p>
      <ol class="pasos">
        <li>${t('Pones el nombre del restaurante.', 'Enter your restaurant name.')}</li>
        <li>${t('Mandas el enlace al grupo de WhatsApp del equipo.', 'Send the link to your team WhatsApp group.')}</li>
        <li>${t('Ves la nota de tu equipo, tema por tema.', 'See your team score, topic by topic.')}</li>
      </ol>
    </section>
    ${mios.length ? `<section class="tarjeta oscura">
      <p class="ceja">${t('Tus tests en este móvil', 'Your tests on this phone')}</p>
      ${mios.slice(0, 5).map(m => `<p><a href="#r=${esc(m.token)}">${esc(m.restaurante)}</a> <span class="mini">${esc(fmtFecha(m.creado))}</span></p>`).join('')}
    </section>` : ''}
    <form class="tarjeta" id="fCrear" novalidate>
      <p class="ceja">${t('Crear el test', 'Create the test')}</p>
      <label class="campo"><span>${t('Nombre del restaurante', 'Restaurant name')}</span>
        <input type="text" id="iRest" maxlength="80" autocomplete="organization" required></label>
      <label class="campo"><span>${t('Tu nombre', 'Your name')} <small>(${t('opcional', 'optional')})</small></span>
        <input type="text" id="iEnc" maxlength="60" autocomplete="name"></label>
      ${err ? `<p class="error">${esc(err)}</p>` : ''}
      <button class="btn" type="submit" id="bCrear">${t('Crear el test de mi equipo', 'Create my team test')}</button>
      <p class="mini">${t('Gratis, sin cuenta y sin email. Solo guardamos el nombre del restaurante y el apodo que ponga cada uno.', 'Free, no account, no email. We only store the restaurant name and the nickname each person enters.')}</p>
    </form>
    <p class="mini"><a href="#calculadora">${t('¿Cuánto te cuesta un camarero sin formar? Haz la cuenta', 'What does an untrained server cost you? Do the maths')}</a></p>`;
  const f = document.getElementById('fCrear');
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const rest = document.getElementById('iRest').value.trim().slice(0, 80);
    const enc = document.getElementById('iEnc').value.trim().slice(0, 60);
    if (!rest) { vistaInicio(t('Pon el nombre del restaurante.', 'Enter the restaurant name.')); document.getElementById('iEnc').value = enc; return; }
    const b = document.getElementById('bCrear'); b.disabled = true; b.textContent = t('Creando…', 'Creating…');
    const reg = { id: nuevoId(), token_resultados: nuevoToken(), restaurante: rest, encargado: enc || null, idioma: LANG };
    try {
      await supa('test_equipos', reg, 'return=minimal');
    } catch (_) {
      vistaInicio(t('No se pudo crear. Revisa la conexión y prueba otra vez.', 'Could not create it. Check your connection and try again.'));
      document.getElementById('iRest').value = rest; document.getElementById('iEnc').value = enc;
      return;
    }
    const m = lsGet(LS_MIOS, []).filter(x => x.token !== reg.token_resultados);
    m.unshift({ id: reg.id, token: reg.token_resultados, restaurante: rest, creado: new Date().toISOString() });
    lsSet(LS_MIOS, m.slice(0, 20));
    mostrar(() => vistaCreado(reg));
    arriba();
  });
}

function vistaCreado(reg) {
  const le = enlaceEquipo(reg.id), lr = enlaceResultados(reg.token_resultados);
  const wa = textoWhatsApp(reg.restaurante, le);
  $app.innerHTML = `
    <section class="hero">
      <p class="ceja">${esc(reg.restaurante)}</p>
      <h1>${t('Listo. Ahora mándalo al equipo.', 'Done. Now send it to the team.')}</h1>
    </section>
    <section class="tarjeta">
      <p class="ceja">${t('1 · Para el grupo del equipo', '1 · For the team group')}</p>
      <h2>${t('Enlace del equipo', 'Team link')}</h2>
      <div class="link-caja" id="lEq">${esc(le)}</div>
      <a class="btn wa" href="${esc(urlWhatsApp(wa))}" target="_blank" rel="noopener">${t('Enviar por WhatsApp', 'Send on WhatsApp')}</a>
      <button class="btn sec fino" type="button" id="cEq">${t('Copiar enlace', 'Copy link')}</button>
    </section>
    <section class="tarjeta oscura">
      <p class="ceja">${t('2 · Solo para ti', '2 · Just for you')}</p>
      <h2>${t('Tus resultados', 'Your results')}</h2>
      <div class="link-caja">${esc(lr)}</div>
      <p class="aviso">${t('Guarda este enlace: es la única forma de ver las notas. No lo mandes al grupo.', 'Keep this link: it is the only way to see the scores. Do not send it to the group.')}</p>
      <button class="btn fino" type="button" id="cRes">${t('Copiar enlace de resultados', 'Copy results link')}</button>
      <a class="btn sec fino" href="#r=${esc(reg.token_resultados)}">${t('Ver resultados', 'See results')}</a>
      <p class="mini">${t('También queda guardado en este móvil: si vuelves a meseo.es/test lo encontrarás.', 'It is also saved on this phone: come back to meseo.es/test and it will be there.')}</p>
    </section>`;
  document.getElementById('cEq').onclick = e => copiar(le, e.currentTarget);
  document.getElementById('cRes').onclick = e => copiar(lr, e.currentTarget);
}

// ═══ 2. TEST DEL CAMARERO ═══════════════════════════════════════════════
const T = { id: null, restaurante: '', nombre: '', preguntas: [], i: 0, detalle: [], enviado: false, idiomaTest: null };

async function iniciarEquipo(id) {
  T.id = id;
  $app.innerHTML = `<p class="cargando">${t('Cargando…', 'Loading…')}</p>`;
  try {
    const r = await supa('rpc/test_equipo_publico', { p_id: id });
    const fila = Array.isArray(r) ? r[0] : null;
    if (!fila) { mostrar(() => vistaNoExiste()); return; }
    T.restaurante = fila.restaurante;
    if (!lsGet(LS_LANG, null) && fila.idioma) setLang(fila.idioma, false);
  } catch (_) {
    $app.innerHTML = `<p class="error">${t('No se pudo cargar el test. Revisa la conexión y recarga.', 'Could not load the test. Check your connection and reload.')}</p>`;
    return;
  }
  mostrar(vistaEntrada);
}

function vistaNoExiste() {
  $app.innerHTML = `<section class="hero"><h1>${t('Este test no existe', 'This test does not exist')}</h1>
    <p class="sub">${t('Puede que el enlace esté incompleto. Pídele a tu encargado que lo vuelva a mandar.', 'The link may be incomplete. Ask your manager to send it again.')}</p>
    <a class="btn" href="./">${t('Crear un test para mi equipo', 'Create a test for my team')}</a></section>`;
}

function vistaEntrada() {
  const hecho = lsGet(LS_HECHO + T.id, null);
  $app.innerHTML = `
    <section class="hero">
      <p class="ceja">${t('Test de alérgenos', 'Allergen test')} · ${esc(T.restaurante)}</p>
      <h1>${t('Diez preguntas de sala. Unos dos minutos.', 'Ten floor questions. About two minutes.')}</h1>
      <p class="sub">${t('Lo que pasa de verdad en sala: los 14 alérgenos, los que van escondidos, la freidora compartida y qué hacer si alguien se pone malo.', 'What really happens on the floor: the 14 allergens, the hidden ones, the shared fryer and what to do if someone reacts.')}</p>
    </section>
    <form class="tarjeta" id="fEntrar" novalidate>
      ${hecho ? `<p class="ok-nota">${t('Ya lo hiciste en este móvil', 'You already did it on this phone')}: ${fmtNota(hecho.nota)}/10. ${t('Si lo repites, cuenta como otra persona.', 'If you repeat it, it counts as another person.')}</p>` : ''}
      <label class="campo"><span>${t('Tu nombre o apodo', 'Your name or nickname')} <small>(${t('opcional', 'optional')})</small></span>
        <input type="text" id="iNom" maxlength="40" autocomplete="nickname" value="${esc(T.nombre)}"></label>
      <p class="mini">${t('Tu encargado verá tu nota con el nombre que pongas. Si lo dejas vacío, saldrás como «Anónimo».', 'Your manager will see your score with the name you enter. Leave it empty to show as "Anonymous".')}</p>
      <button class="btn" type="submit">${t('Empezar', 'Start')}</button>
    </form>`;
  document.getElementById('fEntrar').addEventListener('submit', ev => {
    ev.preventDefault();
    T.nombre = document.getElementById('iNom').value.trim().slice(0, 40);
    T.preguntas = elegirPreguntas(PREGUNTAS, 10).map(p => p.id);
    T.orden = {}; T.i = 0; T.detalle = []; T.enviado = false;
    mostrar(vistaPregunta);
  });
}

function preguntaActual() {
  const p = PREGUNTAS.find(x => x.id === T.preguntas[T.i]);
  // El orden de las opciones se fija una vez por pregunta, aunque cambie el idioma.
  if (!T.orden[p.id]) T.orden[p.id] = barajar(p.o.es.map((_, i) => i));
  const ord = T.orden[p.id];
  return { p, ord, o: ord.map(i => p.o[LANG][i]), c: ord.indexOf(p.c) };
}

function vistaPregunta() {
  const { p, o } = preguntaActual();
  const n = T.preguntas.length;
  $app.innerHTML = `
    <div class="progreso"><span>${T.i + 1} / ${n}</span><div class="barra"><i data-w="${Math.round((T.i / n) * 100)}"></i></div><span>${esc(TEMA_NOMBRE[p.tema][LANG])}</span></div>
    <p class="pregunta">${esc(p.q[LANG])}</p>
    <div class="opciones" id="ops">
      ${o.map((txt, k) => `<button type="button" class="opcion" data-k="${k}">${esc(txt)}</button>`).join('')}
    </div>`;
  anchos();
  const ops = document.getElementById('ops');
  ops.addEventListener('click', ev => {
    const b = ev.target.closest('.opcion'); if (!b || ops.classList.contains('bloqueado')) return;
    ops.classList.add('bloqueado'); b.classList.add('elegida');
    const k = Number(b.dataset.k);
    const { p: pp, ord, c } = preguntaActual();
    T.detalle.push({ id: pp.id, tema: pp.tema, ok: k === c, r: ord[k] });
    setTimeout(() => {
      T.i++;
      if (T.i < T.preguntas.length) mostrar(vistaPregunta); else { mostrar(vistaFinal); enviarRespuesta(); }
      arriba();
    }, 260);
  });
}

async function enviarRespuesta() {
  if (T.enviado) return;
  const { aciertos, total } = corregir(T.detalle);
  const body = { test_id: T.id, nombre: T.nombre || null, aciertos, total,
    detalle: T.detalle.map(d => ({ id: d.id, tema: d.tema, ok: d.ok })) };
  T.envio = 'enviando'; pintarEnvio();
  try {
    await supa('test_respuestas', body, 'return=minimal');
    T.enviado = true; T.envio = 'ok';
    lsSet(LS_HECHO + T.id, { nota: nota(aciertos, total), fecha: new Date().toISOString() });
  } catch (_) { T.envio = 'error'; }
  pintarEnvio();
}
function pintarEnvio() {
  const el = document.getElementById('envio'); if (!el) return;
  if (T.envio === 'ok') el.innerHTML = `<p class="ok-nota">${t('Nota enviada a tu encargado.', 'Score sent to your manager.')}</p>`;
  else if (T.envio === 'error') {
    el.innerHTML = `<p class="error">${t('No se pudo enviar la nota.', 'Could not send the score.')}</p><button class="btn fino" type="button" id="bReenv">${t('Reintentar', 'Try again')}</button>`;
    document.getElementById('bReenv').onclick = enviarRespuesta;
  } else el.innerHTML = `<p class="mini">${t('Enviando la nota…', 'Sending score…')}</p>`;
}

function mensajeNota(n) {
  if (n >= 9) return t('Muy bien. Esto es saber de alérgenos.', 'Very good. This is knowing your allergens.');
  if (n >= 6) return t('Bien, pero hay cosas que en sala no pueden fallar.', 'Good, but some of these cannot go wrong on the floor.');
  return t('Toca repasar. En alérgenos un fallo no es un punto menos: es un cliente en riesgo.', 'Time to review. With allergens a mistake is not a lost point: it is a guest at risk.');
}

function vistaFinal() {
  const { aciertos, total } = corregir(T.detalle);
  const n = nota(aciertos, total);
  const fallos = T.detalle.filter(d => !d.ok).map(d => ({ d, p: PREGUNTAS.find(x => x.id === d.id) }));
  $app.innerHTML = `
    <section class="hero">
      <p class="ceja">${t('Tu nota', 'Your score')} · ${esc(T.restaurante)}</p>
      <div class="nota-grande"><b>${aciertos}</b><span>/ ${total}</span></div>
      <p class="sub">${mensajeNota(n)}</p>
      <div id="envio"></div>
    </section>
    ${fallos.length ? `<section class="tarjeta">
      <p class="ceja">${t('Lo que has fallado', 'What you missed')}</p>
      ${fallos.map(({ d, p }) => `<div class="fallo">
        <span class="etq">${esc(TEMA_NOMBRE[p.tema][LANG])}</span>
        <h3>${esc(p.q[LANG])}</h3>
        <p class="tuya">${t('Tu respuesta', 'Your answer')}: ${esc(p.o[LANG][d.r])}</p>
        <p class="correcta">${t('Correcta', 'Correct')}: ${esc(p.o[LANG][p.c])}</p>
        <p>${esc(p.x[LANG])}</p>
      </div>`).join('')}
    </section>` : `<section class="tarjeta"><p>${t('Sin un solo fallo. Enséñaselo a quien te pregunte por alérgenos en el próximo servicio.', 'Not a single miss. Show it to whoever asks you about allergens next service.')}</p></section>`}
    <section class="cta">
      <h2>${t('Meseo entrena esto con la carta de tu restaurante', 'Meseo trains this with your own menu')}</h2>
      <p>${t('Plato por plato: qué lleva, qué se puede cambiar y qué se comanda. Un rato al día, desde el móvil.', 'Dish by dish: what is in it, what can be changed and how to put it through. A few minutes a day, on your phone.')}</p>
      <a class="btn sec fino" href="../">${t('Conocer Meseo', 'Discover Meseo')}</a>
    </section>`;
  pintarEnvio();
}

// ═══ 3. RESULTADOS DEL ENCARGADO ════════════════════════════════════════
const R = { token: null, datos: null };

async function iniciarResultados(token) {
  R.token = token;
  $app.innerHTML = `<p class="cargando">${t('Cargando resultados…', 'Loading results…')}</p>`;
  try {
    R.datos = await supa('rpc/test_equipo_resultados', { p_token: token });
  } catch (_) {
    $app.innerHTML = `<p class="error">${t('No se pudieron cargar los resultados. Revisa la conexión y recarga.', 'Could not load the results. Check your connection and reload.')}</p>`;
    return;
  }
  if (!R.datos) {
    $app.innerHTML = `<section class="hero"><h1>${t('No encontramos este test', 'We could not find this test')}</h1>
      <p class="sub">${t('Revisa que el enlace de resultados esté completo.', 'Check the results link is complete.')}</p>
      <a class="btn" href="./">${t('Crear un test nuevo', 'Create a new test')}</a></section>`;
    return;
  }
  const m = lsGet(LS_MIOS, []);
  if (!m.some(x => x.token === token)) { m.unshift({ id: R.datos.id, token, restaurante: R.datos.restaurante, creado: R.datos.created_at }); lsSet(LS_MIOS, m.slice(0, 20)); }
  mostrar(vistaResultados);
}

function claseNota(n) { return n == null ? '' : n < 6 ? 'baja' : n < 8 ? 'media' : 'alta'; }

function vistaResultados() {
  const d = R.datos;
  const rs = Array.isArray(d.respuestas) ? d.respuestas : [];
  const media = notaMedia(rs);
  const temas = notaPorTema(rs);
  const top = masFalladas(rs, 3);
  const le = enlaceEquipo(d.id);
  const wa = textoWhatsApp(d.restaurante, le);
  $app.innerHTML = `
    <section class="hero">
      <p class="ceja">${t('Resultados', 'Results')} · ${t('solo para ti', 'just for you')}</p>
      <h1>${esc(d.restaurante)}</h1>
      <div class="cifras">
        <div class="cifra"><b>${fmtNota(media)}</b><small>${t('nota media sobre 10', 'average score out of 10')}</small></div>
        <div class="cifra"><b>${rs.length}</b><small>${rs.length === 1 ? t('persona lo ha hecho', 'person has done it') : t('personas lo han hecho', 'people have done it')}</small></div>
      </div>
      <button class="btn sec fino" type="button" id="bRecargar">${t('Actualizar', 'Refresh')}</button>
    </section>
    ${rs.length ? `
    <section class="tarjeta">
      <p class="ceja">${t('Nota por tema', 'Score by topic')}</p>
      ${TEMAS.map(k => { const x = temas[k]; return `<div class="tema">
        <div class="tema-fila"><span>${esc(TEMA_NOMBRE[k][LANG])}</span><em>${x.nota == null ? t('sin datos', 'no data') : fmtNota(x.nota)}</em></div>
        <div class="barra"><i class="${claseNota(x.nota)}" data-w="${x.nota == null ? 0 : x.nota * 10}"></i></div></div>`; }).join('')}
    </section>
    ${top.length ? `<section class="tarjeta">
      <p class="ceja">${t('Lo que más falla tu equipo', 'What your team misses most')}</p>
      ${top.map(f => { const p = PREGUNTAS.find(x => x.id === f.id); if (!p) return ''; return `<div class="fallo">
        <span class="etq">${f.fallos} ${t('de', 'of')} ${f.veces} ${t('fallan', 'miss it')}</span>
        <h3>${esc(p.q[LANG])}</h3>
        <p class="correcta">${t('Correcta', 'Correct')}: ${esc(p.o[LANG][p.c])}</p>
        <p>${esc(p.x[LANG])}</p></div>`; }).join('')}
    </section>` : ''}
    <section class="tarjeta">
      <p class="ceja">${t('Quién lo ha hecho', 'Who has done it')}</p>
      <ul class="personas">
        ${rs.slice().reverse().map(r => `<li><span>${esc(r.nombre || t('Anónimo', 'Anonymous'))}<small>${esc(fmtFecha(r.created_at))}</small></span><em>${fmtNota(nota(r.aciertos, r.total))}</em></li>`).join('')}
      </ul>
    </section>` : `
    <section class="tarjeta vacio">
      <h2>${t('Todavía no lo ha hecho nadie', 'Nobody has done it yet')}</h2>
      <p>${t('Manda el enlace al grupo del equipo y vuelve aquí en un rato.', 'Send the link to the team group and come back in a while.')}</p>
    </section>`}
    <section class="tarjeta oscura">
      <p class="ceja">${t('Enlace del equipo', 'Team link')}</p>
      <div class="link-caja">${esc(le)}</div>
      <a class="btn wa fino" href="${esc(urlWhatsApp(wa))}" target="_blank" rel="noopener">${t('Enviar por WhatsApp', 'Send on WhatsApp')}</a>
      <button class="btn sec fino" type="button" id="cEq">${t('Copiar enlace', 'Copy link')}</button>
    </section>
    ${htmlCta()}
    ${htmlCalculadora()}`;
  anchos();
  document.getElementById('bRecargar').onclick = () => iniciarResultados(R.token);
  document.getElementById('cEq').onclick = e => copiar(le, e.currentTarget);
  enlazarCalculadora();
}

function htmlCta() {
  const asunto = encodeURIComponent(t('Meseo para mi restaurante', 'Meseo for my restaurant'));
  return `<section class="cta">
    <h2>${t('Meseo entrena a tu equipo con tu propia carta', 'Meseo trains your team with your own menu')}</h2>
    <p>${t('Cargamos tu carta, tus alérgenos, tu bodega y tu manual de sala, y tu equipo entrena con ellos desde el primer día.', 'We load your menu, allergens, wines and service manual, and your team trains with them from day one.')}</p>
    <a class="btn" href="mailto:${CONTACTO}?subject=${asunto}">${t('Escríbenos', 'Write to us')}</a>
    <p class="mini">${CONTACTO}</p>
  </section>`;
}

// ═══ 4. CALCULADORA ═════════════════════════════════════════════════════
const CALC_CAMPOS = [
  { k: 'costeMes', es: 'Coste de empresa de un camarero al mes (€)', en: 'Monthly employer cost of a server (€)', paso: 1 },
  { k: 'nuevos', es: 'Personas nuevas en sala al año', en: 'New floor staff per year', paso: 1, sup: true },
  { k: 'semanas', es: 'Semanas hasta rendir al cien por cien', en: 'Weeks until fully productive', paso: 1, sup: true },
  { k: 'rendimiento', es: 'Rendimiento medio mientras aprende (%)', en: 'Average output while learning (%)', paso: 5, sup: true },
  { k: 'ticket', es: 'Ticket medio por mesa (€)', en: 'Average spend per table (€)', paso: 1, sup: true },
  { k: 'mesas', es: 'Mesas que lleva por servicio', en: 'Tables per server per service', paso: 1, sup: true },
  { k: 'servicios', es: 'Servicios a la semana', en: 'Services per week', paso: 1, sup: true },
  { k: 'perdida', es: 'Venta sugerida que se pierde (% del ticket)', en: 'Upsell lost (% of spend)', paso: 1, sup: true },
];
const CALC = Object.assign({}, CALC_DEFECTO);

function htmlCalculadora() {
  return `<section class="tarjeta" id="calculadora">
    <p class="ceja">${t('Calculadora', 'Calculator')}</p>
    <h2>${t('Lo que te cuesta un camarero sin formar', 'What an untrained server costs you')}</h2>
    <p class="mini">${t('Cambia cualquier número por el de tu restaurante. Lo marcado como «supuesto» no sale de un dato publicado.', 'Change any number to your own. Anything marked "assumption" is not from published data.')}</p>
    <div class="calc-grid">
      ${CALC_CAMPOS.map(c => `<label class="campo"><span>${esc(c[LANG])}${c.sup ? ` <i class="supuesto">${t('supuesto', 'assumption')}</i>` : ''}</span>
        <input type="number" inputmode="decimal" min="0" step="${c.paso}" data-k="${c.k}" value="${CALC[c.k]}"></label>`).join('')}
    </div>
    <div class="calc-total" id="calcRes"></div>
    <p class="fuentes">${t('Fuentes', 'Sources')}: ${t('salario base de camarero (grupo 4) del convenio de hostelería de Santa Cruz de Tenerife, tabla 2026-2027, BOP n.º 108 de 9/9/2026, 1.320,04 € × 14 pagas ÷ 12, sin plus de transporte ni antigüedad', 'base pay for a server (group 4) in the Santa Cruz de Tenerife hospitality agreement, 2026-2027 table, BOP no. 108 of 9/9/2026, €1,320.04 × 14 payments ÷ 12, no transport allowance or seniority')}; ${t('cotización de empresa 32,15 % (23,60 contingencias comunes, 0,75 MEI, 5,50 desempleo, 0,20 FOGASA, 0,60 FP, 1,50 AT/EP del CNAE 56), Seguridad Social 2026', 'employer social security 32.15% (23.60 common contingencies, 0.75 MEI, 5.50 unemployment, 0.20 FOGASA, 0.60 training, 1.50 accident rate for NACE 56), 2026')}; ${t('rotación del sector del 63,7 % (Randstad, citado en el informe de RR. HH. de Pascual Profesional), aplicada a un supuesto de 6 camareros', 'sector turnover of 63.7% (Randstad, cited in the Pascual Profesional HR report), applied to an assumed team of 6')}; ${t('27 € por persona a la carta (TheFork, 2025) por dos personas por mesa', '€27 per person à la carte (TheFork, 2025) times two guests per table')}.</p>
    <p class="fuentes">${t('Es una estimación orientativa, no una auditoría. Las ventas que no se hacen son facturación, no beneficio.', 'This is a rough estimate, not an audit. Lost sales are revenue, not profit.')}</p>
  </section>`;
}

function pintarCalc() {
  const el = document.getElementById('calcRes'); if (!el) return;
  const r = calcularCoste(CALC);
  const v = r.valores;
  const pct = x => (en() ? x : String(x).replace('.', ',')) + ' %';
  el.innerHTML = `
    <p class="ceja">${t('Coste estimado al año', 'Estimated cost per year')}</p>
    <div class="nota-grande"><b>${fmtEur(r.total)}</b></div>
    <div class="calc-desglose">
      <div><span>${t('Curva de aprendizaje', 'Learning curve')}</span><b>${fmtEur(r.curva)}</b></div>
      <div><span>${t('Ventas que no se hacen', 'Sales not made')}</span><b>${fmtEur(r.ventas)}</b></div>
    </div>
    <div class="formula">
      ${t('Curva', 'Curve')} = ${v.nuevos} × ${fmtEur(v.costeMes)} × (${v.semanas} ${t('sem.', 'wk')} ÷ ${t('4,33', '4.33')}) × (1 − ${pct(v.rendimiento)}) = ${fmtEur(r.curva)}<br>
      ${t('Ventas', 'Sales')} = ${v.nuevos} × ${v.semanas} ${t('sem.', 'wk')} × ${v.servicios} × ${v.mesas} ${t('mesas', 'tables')} × ${fmtEur(v.ticket)} × ${pct(v.perdida)} = ${fmtEur(r.ventas)}
    </div>`;
}

function enlazarCalculadora() {
  document.querySelectorAll('#calculadora input[data-k]').forEach(inp => {
    inp.addEventListener('input', () => {
      const n = parseFloat(String(inp.value).replace(',', '.'));
      CALC[inp.dataset.k] = Number.isFinite(n) ? n : 0;
      pintarCalc();
    });
  });
  pintarCalc();
}

function vistaCalculadoraSuelta() {
  $app.innerHTML = `
    <section class="hero">
      <p class="ceja">Meseo</p>
      <h1>${t('¿Cuánto te cuesta al año un camarero que todavía no rinde?', 'How much does a server who is not up to speed cost you a year?')}</h1>
    </section>
    ${htmlCalculadora()}
    <a class="btn" href="./">${t('Hacer el test de alérgenos a mi equipo', 'Run the allergen test with my team')}</a>
    ${htmlCta()}`;
  enlazarCalculadora();
}

// ─── enrutado ───────────────────────────────────────────────────────────
function rutear() {
  const q = new URLSearchParams(location.search);
  const h = new URLSearchParams(location.hash.slice(1));
  const e = q.get('e'), r = h.get('r');
  if (r && TOKEN_RE.test(r)) return iniciarResultados(r);
  if (e && UUID_RE.test(e)) return iniciarEquipo(e.toLowerCase());
  if (e) return mostrar(vistaNoExiste);
  if (location.hash === '#calculadora') { mostrar(vistaCalculadoraSuelta); return; }
  mostrar(() => vistaInicio());
}

document.querySelectorAll('.idioma button').forEach(b => b.addEventListener('click', () => {
  setLang(b.dataset.lang);
  if (S.rerender) S.rerender();
}));
window.addEventListener('hashchange', () => { arriba(); rutear(); });
setLang(LANG, false);
rutear();
