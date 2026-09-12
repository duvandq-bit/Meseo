#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// TXOKO Formación — Smoke tests (zero-dependency, Node ≥18)
// ═══════════════════════════════════════════════════════════════
// Purpose: a safety net for a single-file PWA that has no build step
// and no unit tests. These checks catch the classes of mistake that
// are easy to make when hand-editing a 31k-line index.html and would
// otherwise only surface in production:
//
//   1. JS syntax errors in the main inline <script> (white screen).
//   2. Malformed JSON data files (lazy-loaded tabs crash on open).
//   3. Dangling tab routes — showTab() pointing at a missing render fn.
//   4. Lazy-load paths pointing at files that don't exist.
//   5. Service-worker version drift (stale cache served forever).
//   6. CDN <script>/<link> tags missing crossorigin (blocks SRI).
//   7. Leftover git conflict markers.
//
// Run:  node tests/smoke.mjs        (or: npm test)
// Exit: 0 = all green, 1 = at least one failure.
// ═══════════════════════════════════════════════════════════════

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

// ─── tiny test harness ──────────────────────────────────────────
let passed = 0, failed = 0;
const fails = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  catch (e) { failed++; fails.push(`${name}: ${e.message}`); console.log(`  \x1b[31m✗\x1b[0m ${name}\n      ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

const html = read('index.html');

// ─── 1. Main inline <script> parses ─────────────────────────────
console.log('\nJS syntax');
test('Situaciones LQA: la correcta no es la más larga ni la única que cita un estándar', () => {
  // Auditoría de sep 2026: «elegir la más larga» acertaba el 44% con un azar
  // del 25% (67% en la categoría vino), porque la correcta medía 100 caracteres
  // y las incorrectas 69. Y había un segundo tell: en cuatro situaciones la
  // correcta era la ÚNICA que citaba un estándar («Incumple el estándar #50…»),
  // así que se acertaba buscando el número — el 67% en montaje.
  const l = JSON.parse(read('data/lqa-situations.json'));
  assert(l.length > 40, `esperaba ~59 situaciones, hay ${l.length}`);
  for (const [campo, etiqueta] of [['opts', 'es'], ['opts_en', 'en']]) {
    let masLarga = 0, conNumero = 0, n = 0;
    for (const s of l) {
      const o = s[campo]; if (!Array.isArray(o) || o.length < 2) continue;
      n++;
      const L = o.map(x => String(x || '').length), m = Math.max(...L);
      if (L.filter(x => x === m).length === 1 && L[s.corr] === m) masLarga++;
      const cita = o.map((x, k) => /#\d+|est[áa]ndar \d+|standard \d+/i.test(String(x)) ? k : -1).filter(k => k >= 0);
      if (cita.length === 1 && cita[0] === s.corr) conNumero++;
    }
    assert(n > 40, `${etiqueta}: solo ${n} situaciones con opciones`);
    assert(masLarga / n <= 0.28,
      `${etiqueta}: «elegir la más larga» acierta el ${(100*masLarga/n).toFixed(0)}%: la correcta se ve sin leer`);
    assert(conNumero === 0,
      `${etiqueta}: en ${conNumero} situaciones solo la correcta cita el estándar — el número la delata`);
  }
});

test('Auditoría completa: la opción correcta no es la más larga', () => {
  // Auditoría de sep 2026: «elegir la opción más larga» acertaba el 99% de las
  // 95 escenas con respuesta única, sin leer nada. La correcta medía 140
  // caracteres de media y las incorrectas 64, porque la correcta enumeraba la
  // secuencia entera de acciones y las falsas eran una frase de descarte.
  // Se reescribieron los 187 distractores al mismo nivel de detalle, sin tocar
  // ni un `effects`: el error de cada opción es el mismo, contado entero.
  const g = JSON.parse(read('data/ghost-scenarios.json'));
  const esc = [];
  for (const e of g) for (const sc of e.scenes || []) {
    const p = (sc.options || []).map(o => (o.effects || []).filter(x => x.met).length);
    const m = Math.max(...p);
    const idx = p.map((x, i) => x === m ? i : -1).filter(i => i >= 0);
    // Ninguna escena puede tener empate: si dos opciones suman los mismos
    // estándares cumplidos, no hay «la correcta» y el ejercicio no puede
    // corregir. Pasaba en [1.3] Aniversario/Retirada, donde la opción de
    // preguntar «¿puedo retirar?» tenía un {std:19, met:true} — el estándar de
    // saber responder sobre alérgenos, que no pinta nada en una retirada, y que
    // además contradecía su propio feedback («preguntar es el error»).
    assert(idx.length === 1,
      `la escena «${sc.title || sc.prompt || ''}» tiene ${idx.length} opciones empatadas: no hay respuesta correcta`);
    esc.push({opts: sc.options, c: idx[0]});
  }
  // Y todo estándar citado tiene que existir en LQA_STANDARDS: su texto se le
  // enseña al camarero en la corrección, así que un id suelto pinta una línea
  // vacía donde debería explicarse qué se esperaba de él.
  const ids = new Set();
  for (const e of g) for (const sc of e.scenes || []) for (const o of sc.options || [])
    for (const x of o.effects || []) ids.add(x.std);
  for (const id of ids) assert(new RegExp('\\{id:' + id + ', cat:').test(html),
    `la Auditoría cita el estándar #${id}, que no está en LQA_STANDARDS`);
  assert(esc.length > 80, `esperaba ~95 escenas con respuesta única, hay ${esc.length}`);
  for (const idioma of ['label', 'label_en']) {
    const unicaMax = (L, c) => { const m = Math.max(...L);
      return L.filter(x => x === m).length === 1 && L[c] === m; };
    let gana = 0;
    for (const e of esc) if (unicaMax(e.opts.map(o => String(o[idioma] || '').length), e.c)) gana++;
    const pct = gana / esc.length;
    // El azar con tres opciones es 33%. Se exige que el truco no lo supere.
    assert(pct <= 0.36,
      `en ${idioma}, «elegir la más larga» acierta el ${(100*pct).toFixed(0)}% de las escenas: la Auditoría se aprueba sin leer`);
  }
  // Y ninguna opción puede quedarse sin su versión en inglés.
  for (const e of esc) for (const o of e.opts)
    assert(String(o.label_en || '').trim(), 'hay una opción sin texto en inglés');
});

test('Pregunta del día: no se pregunta el turno de un plato que lo lleva en el nombre', () => {
  // El propietario, el 9 de septiembre: «¿En qué servicio se ofrece "Fish and
  // chips (Almuerzo)"?» con opciones Solo almuerzo / Solo cena / Almuerzo y
  // cena. La respuesta está en el enunciado. Son cuatro platos de la carta y
  // medido sobre un año salía 6 días.
  //
  // Mi propia auditoría dio esta pregunta por limpia, y era un punto ciego del
  // medidor: sólo contaba un tell cuando señalaba UNA opción, y aquí
  // «almuerzo» aparece en dos («Solo almuerzo» y «Almuerzo y cena»), así que
  // reduce de tres a dos sin decidir. Este guard mide el enunciado, no el tell.
  const dq = html.slice(html.indexOf('function _dqQuestion('), html.indexOf('function _dqRender'));
  assert(dq.includes('(almuerzo|cena|lunch|dinner)') && dq.includes('.test(d.name)'),
    'la pregunta del turno debe excluir los platos que lo dicen en su nombre');
  // Y el barrido sobre el año entero, que es lo que de verdad lo prueba.
  const cut = (ini, fin) => { const i = html.indexOf(ini); return html.slice(i, html.indexOf(fin, i) + fin.length); };
  const fn = n => { const i = html.indexOf('function ' + n + '('); let d = 0;
    for (let k = html.indexOf('{', i); k < html.length; k++) {
      if (html[k] === '{') d++; else if (html[k] === '}') { d--; if (!d) return html.slice(i, k + 1); } } };
  const src = `var LANG='es', _djIngBase=null;
    function getDish(d){return d;} function escapeHtml(s){return String(s);}
    const _DJ_SECCION = /^(masa|topping|base|relleno|guarnicion|sabores disponibles|salsa base|sazonador|marinada|elaboracion)$/;`
    + cut('const DISHES = [', '\n];') + cut('const DISH_SERVICE = ', '};') + cut('const DISH_COMPONENTS = ', '};')
    + html.slice(html.indexOf('const _djNorm ='), html.indexOf('async function _djLoadIngBase'))
    + fn('_djTrozos') + fn('_djSplitIngredients') + fn('_djSameThing') + fn('_djIngName') + fn('_djIngredients')
    + fn('_mulberry32') + fn('_dqSample') + fn('_simExtractIngredients') + fn('_djAlEn') + fn('_dqQuestion')
    + `
    const malas=[], repes=[];
    let n=0;
    for(let i=0;i<365;i++){
      const dia=new Date(2026,0,1+i).toISOString().slice(0,10);
      let q; try{ q=_dqQuestion(dia); }catch(e){ continue; }
      if(!q) continue; n++;
      if(q.type==='service' && /\((almuerzo|cena|lunch|dinner)\)/i.test(q.q)) malas.push(dia+': '+q.q);
    }
    // Y de paso: la ficha no puede repetir el mismo ingrediente. El Goxua
    // pintaba «Azúcar» cuatro veces y «Vainilla» otras cuatro — 26 fichas para
    // 17 ingredientes. Pasaba en 15 de los 98 platos.
    for(const d of DISHES){
      const its=_djIngredients(d,false);
      const claves=its.map(x=>_djClave(x.t));
      if(new Set(claves).size !== claves.length) repes.push(d.name);
    }
    return {n, malas, repes};`;
  const R = new Function(src)(); // eslint-disable-line no-new-func
  assert(R.n > 250, `esperaba ~285 preguntas en el año, hay ${R.n}`);
  assert(R.malas.length === 0,
    `hay preguntas del turno con la respuesta en el enunciado: ${R.malas.slice(0,3).join(' | ')}`);
  assert(R.repes.length === 0,
    `hay fichas que repiten el mismo ingrediente: ${R.repes.slice(0,5).join(', ')}`);
});

test('Cuestionario del Viaje: no se aprueba con trucos, sin mirar el plato', () => {
  // Auditoría de sep 2026, a petición del propietario: «caza de preguntas y
  // respuestas absurdas, sobre todo respuestas trampa fáciles de predecir».
  // Se midió qué acertaba un camarero perezoso que no lee el plato. Lo que
  // salió, sobre el generador real:
  //   · «¿qué alérgenos declara?»  → la correcta era la única negada Y la más
  //     larga: 100% de 168. Además el propio enunciado sólo aparecía en platos
  //     sin alérgenos, así que leerlo ya daba la respuesta.
  //   · «¿cuántos declara?»        → las opciones eran siempre [n-1,n,n+1,n+2]:
  //     la correcta era SIEMPRE la segunda más pequeña, 100% de 420.
  //   · «¿se puede adaptar?»       → «No, es estructural» era la más larga y es
  //     la verdad el 73% de las veces en esta carta: 73% eligiendo la larga.
  // Este guard vuelve a medirlo cada vez, sobre el dato real, en vez de fiarse
  // de que el texto del código siga diciendo lo que decía.
  const cut = (ini, fin) => { const i = html.indexOf(ini); return html.slice(i, html.indexOf(fin, i) + fin.length); };
  const fn = n => { const i = html.indexOf('function ' + n + '('); let d = 0;
    for (let k = html.indexOf('{', i); k < html.length; k++) {
      if (html[k] === '{') d++; else if (html[k] === '}') { d--; if (!d) return html.slice(i, k + 1); } } };
  const src = `
    var LANG='es', _djState={};
    function getDish(d){return d;} function escapeHTML(s){return String(s);}
    const _DJ_SECCION = /^(masa|topping|base|relleno|guarnicion|sabores disponibles|salsa base|sazonador|marinada|elaboracion)$/;
    `
    + cut('const DISHES = [', '\n];') + cut('const DISH_COMPONENTS = ', '};') + cut('const DISH_ACTIONS = ', '};')
    + cut('const DJ_ALERGENOS_EN = ', '};')
    + html.slice(html.indexOf('const _djNorm ='), html.indexOf('async function _djLoadIngBase'))
    + fn('_djTrozos') + fn('_djSplitIngredients') + fn('_djSameThing') + fn('_djIngName') + fn('_djIngredients')
    + fn('_djShuffle') + fn('_djAlEn')
    + fn('_djQComponente') + fn('_djQAdaptar') + fn('_djQSinAlergenos')
    + fn('_djQCualSinAlergenos') + fn('_djQCuantos') + fn('_djQIngredienteAusente')
    + fn('_djGenerateQuiz')
    + `
    var allergenData_en = Object.assign({}, DJ_ALERGENOS_EN,
      {'Mariscos':'Shellfish','Sésamo':'Sesame','Cacahuetes':'Peanuts'});
    const P=[];
    for(let r=0;r<10;r++) for(const d of DISHES){
      let qs=[]; try{ qs=_djGenerateQuiz(d)||[]; }catch(e){ }
      for(const q of qs) if(q && q.options && q.correctIdx>=0) P.push(q);
    }
    const num = o => Number(String(o).trim());
    const largo = o => String(o).length;
    const uni = (q,f)=>{ const v=q.options.map(f); const m=Math.max(...v);
      const c=v.map((x,i)=>x===m?i:-1).filter(i=>i>=0); return c.length===1?c[0]:-1; };
    const uniMin = (q,f)=>{ const v=q.options.map(f); const m=Math.min(...v);
      const c=v.map((x,i)=>x===m?i:-1).filter(i=>i>=0); return c.length===1?c[0]:-1; };
    const trucos = {
      larga:  q=>uni(q,largo),
      corta:  q=>uniMin(q,largo),
      negada: q=>{ const c=q.options.map((o,i)=>/\b(no|ning|nunca|sin)\b/i.test(String(o))?i:-1).filter(i=>i>=0);
                   return c.length===1?c[0]:-1; },
      segundoMenor: q=>{ const v=q.options.map(num); if(v.some(x=>!Number.isFinite(x))) return -1;
        const o=[...v].sort((a,b)=>a-b)[1];
        const c=v.map((x,i)=>x===o?i:-1).filter(i=>i>=0); return c.length===1?c[0]:-1; },
    };
    const res={n:P.length}; 
    for(const k of Object.keys(trucos)) res[k]=P.filter(q=>trucos[k](q)===q.correctIdx).length/P.length;
    // ¿algún molde de enunciado tiene una sola respuesta posible? Leerlo bastaría.
    const por={};
    for(const q of P){ const m=String(q.q).replace(/"[^"]*"/g,'«X»'); (por[m]=por[m]||[]).push(q); }
    res.moldesQueDelatan = Object.entries(por)
      .filter(([m,qs])=>qs.length>=20 && new Set(qs.map(x=>String(x.options[x.correctIdx]).toLowerCase())).size===1)
      .map(([m])=>m.slice(0,60));
    // Y por tipo, que es donde se esconden
    res.porTipo={};
    for(const t of [...new Set(P.map(q=>q.tipo))]){
      const s=P.filter(q=>q.tipo===t);
      res.porTipo[t]=Object.fromEntries(Object.keys(trucos).map(k=>[k, s.filter(q=>trucos[k](q)===q.correctIdx).length/s.length]));
      res.porTipo[t].n=s.length;
    }
    return res;
  `;
  const R = new Function(src)(); // eslint-disable-line no-new-func
  assert(R.n > 2000, `esperaba miles de preguntas para medir, hay ${R.n}`);
  assert(R.moldesQueDelatan.length === 0,
    `hay enunciados con una sola respuesta posible: leerlos ya da el punto — ${R.moldesQueDelatan.join(' | ')}`);
  // El azar es 25% con cuatro opciones. Se deja margen (45%) porque algunas
  // distribuciones reales de la carta no se pueden aplanar sin falsear el dato;
  // lo que no puede volver es un truco que acierte casi siempre.
  for(const [tipo, m] of Object.entries(R.porTipo)){
    for(const truco of ['larga','corta','negada','segundoMenor']){
      assert(m[truco] <= 0.45,
        `en «${tipo}» (${m.n} preguntas) el truco «${truco}» acierta el ${(100*m[truco]).toFixed(0)}%: la respuesta se predice sin mirar el plato`);
    }
  }
});

test('main inline <script> block parses without syntax errors', () => {
  // The app's logic lives in the last, largest <script> block. Slice from
  // the final `<script>` (no src) to the final `</script>` and verify the
  // engine can compile it. new Function only parses — it never executes —
  // so browser globals (document, window) are irrelevant here.
  const open = html.lastIndexOf('<script>');
  const close = html.lastIndexOf('</script>');
  assert(open !== -1 && close > open, 'could not locate main <script> block');
  const js = html.slice(open + '<script>'.length, close);
  assert(js.length > 100000, `main script suspiciously small (${js.length} bytes)`);
  // throws SyntaxError with line/col if the JS is malformed
  new Function(js); // eslint-disable-line no-new-func
});

// ─── 2. JSON data files valid + structurally sound ──────────────
console.log('\nData files');
test('data/wines.json is a non-empty array with id/name/type', () => {
  const wines = JSON.parse(read('data/wines.json'));
  assert(Array.isArray(wines) && wines.length > 0, 'not a non-empty array');
  for (const w of wines) {
    assert(typeof w.id === 'number', `wine missing numeric id: ${JSON.stringify(w).slice(0,80)}`);
    assert(typeof w.name === 'string' && w.name, `wine ${w.id} missing name`);
    assert(typeof w.type === 'string' && w.type, `wine ${w.id} missing type`);
  }
  const ids = wines.map(w => w.id);
  assert(new Set(ids).size === ids.length, 'duplicate wine ids');
});

test('carta de vinos 19.07.26: vinos nuevos y bilingües', () => {
  const wines = JSON.parse(read('data/wines.json'));
  assert(wines.length >= 134, 'faltan vinos de la carta 19.07.26');
  const names = wines.map(w => w.name);
  for (const n of ['Dom Pérignon 2015', 'Roda Reserva 2021', 'Miraval', 'El Grifo Seco', 'Hey Malbec',
    'Col d’Orcia 2020', 'Clós Pepín', 'Almirez', 'Paco García «Seis»', 'Petra Hebo 2023',
    'Alion 2019 3L Doble Magnum', 'Valtravieso', 'El Grifo «Ariana»', 'Fenomenal'])
    assert(names.includes(n), 'falta el vino ' + n);
  for (const w of wines)
    for (const f of ['story_en', 'notes_en', 'grapeSelection_en', 'winemaking_en'])
      assert(w[f] && String(w[f]).trim(), `vino ${w.id} sin ${f}`);
  // La copa y los recomendados rotan con el stock: la app ya no los almacena.
  assert(!wines.some(w => 'glass' in w || 'recommended' in w),
    'los vinos no deben llevar copa ni recomendado (rotan con el stock)');
  // El juego sensorial cubre también los nuevos
  const vc = JSON.parse(read('data/vinos-content.json'));
  for (const w of wines) if (w.id >= 121) assert(vc.WINE_SNS[String(w.id)], 'WINE_SNS sin vino ' + w.id);
});

test('carta de vinos 11.08: altas y precios', () => {
  const wines = JSON.parse(read('data/wines.json'));
  const by = n => wines.find(w => w.name === n);
  assert(wines.length >= 143, 'faltan vinos de la carta 11.08');
  assert(new Set(wines.map(w => w.id)).size === wines.length, 'ids de vino duplicados');
  assert(new Set(wines.map(w => w.name.toLowerCase())).size === wines.length, 'nombres de vino duplicados');
  // Altas de la carta 11.08 con su precio (o su copa cuando no hay botella).
  for (const [n, price] of [['Hermanos Lurton', 65], ['Convento Santissima Annunciata', 140],
       ['Trevejos', null], ['Finca Vegas', 60], ['Valdepoleo 2017', 90], ['Viña Sastre 2023', null],
       ['Valduero I Cepa', 90], ["Syrah d'Ogier", 75], ['Roger de Flor', null]]) {
    const w = by(n);
    assert(w, 'falta el vino nuevo ' + n);
    assert((w.price ?? null) === price, `${n}: precio ${w.price} ≠ carta ${price}`);
  }
  // Precios corregidos contra la carta.
  for (const [n, price] of [['La Fita Els Alpriots', 55], ['Los Loros Tinto', 60], ['Vallegarcía', 75],
       ['Amaren Selección de Viñedos 2021', 75], ['Remelluri Reserva 2017', 130], ['Corimbo', 95]])
    assert(by(n) && by(n).price === price, `${n} debe costar ${price} (carta 11.08)`);
  // La ficha no puede anunciar copa ni recomendación: rotan con el stock.
  for (const w of wines)
    for (const f of ['notes', 'notes_en', 'story', 'story_en'])
      assert(!/por copa|by the glass|house pick/i.test(String(w[f] || '')),
        `${w.name}: ${f} menciona la copa o la recomendación`);
  // Ficha completa: los nuevos entran con maridajes reales y perfil sensorial.
  const vc = JSON.parse(read('data/vinos-content.json'));
  const dishes = new Set((html.match(/name:'([^']+)'/g) || []).map(m => m.slice(6, -1)));
  for (const w of wines) {
    assert(Array.isArray(w.pairings) && w.pairings.length, `${w.name}: sin maridajes`);
    assert(vc.WINE_SNS[String(w.id)], `${w.name}: sin perfil sensorial`);
    if (w.id >= 135) for (const d of w.pairings)
      assert(dishes.has(d), `${w.name}: maridaje inexistente «${d}»`);
  }
});

test('carta de vinos 12.08: altas', () => {
  const wines = JSON.parse(read('data/wines.json'));
  const by = n => wines.find(w => w.name === n);
  assert(wines.length >= 149, 'faltan vinos de la carta 12.08');
  assert(new Set(wines.map(w => w.id)).size === wines.length, 'ids de vino duplicados');
  assert(new Set(wines.map(w => w.name.toLowerCase())).size === wines.length, 'nombres de vino duplicados');
  for (const [n, price] of [['Chivite «Las Fincas» Rosado', 64], ['Bolet Brut', 55],
       ['Albahra 2024 (Envínate)', 45], ['Althay Viticultores 2024', 110],
       ['Guiberteau Saumur Blanc 2024', 120], ['Foresta Macabeu Ancestral 2021', 75]]) {
    const w = by(n);
    assert(w, 'falta el vino nuevo ' + n);
    assert(w.price === price, `${n}: precio ${w.price} ≠ carta ${price}`);
  }
  // La app no debe llevar copa ni recomendado (petición del propietario, ago 2026).
  assert(!wines.some(w => 'glass' in w || 'recommended' in w),
    'los vinos no deben llevar copa ni recomendado');
  // Ficha completa: maridajes reales y perfil sensorial también en los nuevos.
  const vc = JSON.parse(read('data/vinos-content.json'));
  const dishes = new Set((html.match(/name:'([^']+)'/g) || []).map(m => m.slice(6, -1)));
  for (const w of wines.filter(w => w.id >= 144)) {
    for (const f of ['story_en', 'notes_en', 'grapeSelection_en', 'winemaking_en'])
      assert(w[f] && String(w[f]).trim(), `${w.name} sin ${f}`);
    assert(Array.isArray(w.pairings) && w.pairings.length, `${w.name}: sin maridajes`);
    for (const d of w.pairings) assert(dishes.has(d), `${w.name}: maridaje inexistente «${d}»`);
    assert(vc.WINE_SNS[String(w.id)], `${w.name}: sin perfil sensorial`);
  }
});

test('el precio en pantalla aguanta vinos sin botella (nada de «null €»)', () => {
  assert(/function _wPx\(w, spaced\)/.test(html), 'falta el helper _wPx');
  assert(!/\$\{r\.wine\.price\}€/.test(html), 'queda un ${r.wine.price}€ sin guarda');
  for (const line of html.split('\n'))
    if (line.includes('${w.price}€') || line.includes('${w.price} €'))
      assert(/w\.price\?/.test(line), 'precio sin guarda de nulo: ' + line.trim().slice(0, 80));
  assert(!/\+ w\.price \+ '€<\/div>'/.test(html), 'queda una concatenación de precio sin guarda');
  assert(!/\|\| a\.price-b\.price/.test(html) && !/\|\| a\.price - b\.price;/.test(html)
      && !/return a\.price - b\.price;/.test(html),
    'las ordenaciones por precio deben caer a la copa cuando no hay botella');
});

test('la app no almacena copa ni recomendados (rotan con el stock)', () => {
  // Petición del propietario (ago 2026): «no especifiques qué es por copa y qué
  // es recomendado porque eso cambia para rotar stock, solo la información de
  // los vinos». Ni datos, ni distintivos, ni ordenaciones que lo presupongan.
  const wines = JSON.parse(read('data/wines.json'));
  for (const w of wines) {
    assert(!('glass' in w), `${w.name} conserva el campo glass`);
    assert(!('recommended' in w), `${w.name} conserva el campo recommended`);
  }
  assert(!/w\.glass/.test(html) && !/\.recommended\b/.test(html),
    'el código sigue leyendo glass o recommended de los vinos');
  // («house pick'» con comilla: «house pickles» del tataki no debe dar falso positivo)
  for (const t of ['Vinos por Copa', 'Wines by Glass', 'By Glass', 'RECOMENDADO', "house pick'"])
    assert(!html.includes(t), `sigue apareciendo el rótulo «${t}»`);
  // «RECOMMENDED» solo puede sobrevivir dentro de «RECOMMENDED GLASS» (cristalería).
  assert((html.match(/RECOMMENDED/g) || []).length === (html.match(/RECOMMENDED GLASS/g) || []).length,
    'queda un rótulo RECOMMENDED que no es el de la cristalería');
  // «Descubre hoy» rota por toda la carta, no por una lista de recomendados.
  assert(/const featured = \[\.\.\.WINES, \.\.\.WINES\]\.slice\(offset, offset \+ 3\)/.test(html),
    'la rotación diaria debe recorrer toda la carta');
  // La copa RECOMENDADA (cristalería) sí se mantiene: es servicio, no stock.
  assert(/RECOMMENDED GLASS|COPA RECOMENDADA/.test(html),
    'la copa recomendada (cristalería) debe seguir existiendo');
});

test('vinos EN: enciclopedia bilingüe, copa recomendada resucitada, origen traducido', () => {
  // Auditoría EN jul 2026 («no está todo traducido»): examples/guest de la
  // enciclopedia se pintaban siempre en español; una _wineGlassType duplicada
  // (nombres en español) machacaba a la de claves y el panel «Copa
  // recomendada» nunca aparecía; el origen salía como «Hungría» en inglés.
  const vc = JSON.parse(read('data/vinos-content.json'));
  for (const e of vc.WINE_ENCYCLOPEDIA) {
    if (e.examples) assert(e.examples_en, 'ficha ' + e.id + ' sin examples_en');
    if (e.guest) assert(e.guest_en, 'ficha ' + e.id + ' sin guest_en');
  }
  assert(/e\.examples_en\|\|e\.examples/.test(html) && /e\.guest_en\|\|e\.guest/.test(html),
    'el render de la enciclopedia debe usar los campos _en');
  assert((html.match(/function _wineGlassType\(/g) || []).length === 1,
    'sigue habiendo una _wineGlassType duplicada');
  const g = html.slice(html.indexOf('function _wineGlassType('), html.indexOf('function _wineGlassType(') + 1200);
  assert(/'flute'/.test(g) && /'borgona'/.test(g), '_wineGlassType debe devolver claves de GLASS_TYPES');
  for (const gt of Object.values(vc.GLASS_TYPES)) assert(gt.use_en, 'GLASS_TYPES sin use_en');
  assert(/glass\.use_en\|\|glass\.use/.test(html), 'el panel de copa debe usar use_en');
  assert(/const _ORIGIN_EN = \{'Francia':'France'/.test(html) && /function _wineOrigin\(/.test(html),
    'falta el traductor de origen _wineOrigin');
  // Eran 5 sitios hasta que se eliminó el Modo Servicio, que pintaba uno.
  assert((html.match(/_wineOrigin\(w\.origin\)/g) || []).length >= 4,
    'las tarjetas deben pintar el origen con _wineOrigin');
  assert(/'Crianza en barrica':'Barrel-aged'/.test(html), '_wineStoryTags debe traducir las etiquetas');
  // El radar del perfil de cata pintaba Cuerpo/Acidez/Especias también en
  // inglés («el tasting profile no está en inglés», propietario jul 2026).
  assert(/const DIM_EN = \{'Cuerpo':'Body','Acidez':'Acidity'/.test(html),
    'el radar debe traducir las dimensiones');
  assert((html.match(/dimLbl\(scores\[i\]\.name\)|dimLbl\(s\.name\)/g) || []).length >= 2,
    'ejes y leyenda del radar deben pasar por dimLbl');
});

test('data/vinos-content.json keys match what loadVinosContent() assigns', () => {
  const content = JSON.parse(read('data/vinos-content.json'));
  const jsonKeys = Object.keys(content).sort();
  assert(jsonKeys.length === 10, `expected 10 constants, got ${jsonKeys.length}`);
  // Each value must be a non-empty object/array (no accidental nulls)
  for (const k of jsonKeys) {
    const v = content[k];
    assert(v && typeof v === 'object', `${k} is not an object/array`);
    const len = Array.isArray(v) ? v.length : Object.keys(v).length;
    assert(len > 0, `${k} is empty`);
  }
  // Cross-check against the assignments in loadVinosContent() so the JSON and
  // the loader can't drift apart (key added to one but not the other).
  const loader = html.match(/async function loadVinosContent\([^)]*\)\s*\{[\s\S]*?\n\}/);
  assert(loader, 'could not find loadVinosContent()');
  const assigned = [...loader[0].matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*data\.\1\s*;/gm)].map(m => m[1]).sort();
  assert(JSON.stringify(assigned) === JSON.stringify(jsonKeys),
    `loader assigns [${assigned}] but JSON has [${jsonKeys}]`);
});

test('data/lqa-situations.json is valid JSON (non-empty array)', () => {
  const lqa = JSON.parse(read('data/lqa-situations.json'));
  assert(Array.isArray(lqa) && lqa.length > 0, 'not a non-empty array');
});

test('LQA situations coherence: own venue only, 24h Spanish clock, bilingual', () => {
  // Revisión de coherencia (jul 2026): las situaciones se ambientan en el
  // restaurante de formación; no deben nombrar otros outlets del hotel
  // (Akira Back, etc.), la hora en español va en formato 24h (no AM/PM), y
  // cada escena debe estar completa en ES + EN.
  const lqa = JSON.parse(read('data/lqa-situations.json'));
  for (const s of lqa) {
    assert(!/Akira/i.test(s.scn) && !/Akira/i.test(s.scn_en || ''),
      `situación ${s.id} nombra un outlet ajeno (Akira)`);
    assert(!/\b(?:AM|PM)\b/.test(s.scn),
      `situación ${s.id} usa AM/PM en español — el reloj va en 24h`);
    for (const k of ['scn', 'scn_en', 'q', 'q_en', 'expl', 'expl_en']) {
      assert(typeof s[k] === 'string' && s[k].trim(), `situación ${s.id} sin ${k}`);
    }
    assert(Array.isArray(s.opts) && Array.isArray(s.opts_en) && s.opts.length === s.opts_en.length,
      `situación ${s.id}: opts ES/EN descuadradas`);
    assert(Number.isInteger(s.corr) && s.corr >= 0 && s.corr < s.opts.length,
      `situación ${s.id}: índice correcto fuera de rango`);
  }
});

test('data/themes.json venue registry is well-formed', () => {
  // Multi-restaurant registry: every venue needs a name and the 8 brand hexes
  // that applyTheme() injects; at least one venue must be enabled or the app
  // would boot without an identity.
  const themes = JSON.parse(read('data/themes.json'));
  assert(Array.isArray(themes.venues) && themes.venues.length > 0, 'venues array missing/empty');
  const enabled = themes.venues.filter(v => v.enabled);
  assert(enabled.length >= 1, 'at least one venue must be enabled');
  const keys = ['primary','secondary','accent','accentHi','accent2','accentDeep','ink','paper'];
  for (const v of themes.venues) {
    assert(v.id && v.name, `venue missing id/name: ${JSON.stringify(v).slice(0,60)}`);
    for (const k of keys) {
      assert(v.brand && /^#[0-9a-fA-F]{6}$/.test(v.brand[k]),
        `venue ${v.id}: brand.${k} must be a 6-digit hex`);
    }
  }
  // The default (first enabled) venue must match the CSS Txoko defaults, so
  // first paint and the themed state agree.
  assert(enabled[0].brand.accent.toLowerCase() === '#c49a3c',
    'first enabled venue accent must match the CSS default (#c49a3c)');
});

test('multi-restaurant theming is wired (applyTheme + login picker)', () => {
  for (const fn of ['applyTheme','initVenues','renderVenuePicker','selectVenue']) {
    assert(new RegExp(`function ${fn}\\(`).test(html), `${fn}() missing`);
  }
  assert(/initVenues\(\);/.test(html), 'initVenues() must run at DOMContentLoaded');
  // Picker exists and ships hidden — single-venue installs must never flash it.
  assert(/id="loginVenue"[^>]*style="display:none"/.test(html),
    'login venue picker must exist and be hidden by default');
  // applyTheme must cover all 8 brand tokens and validate hex before injecting.
  for (const t of ['--brand-primary','--brand-secondary','--brand-accent','--brand-accent-hi',
                   '--brand-accent-2','--brand-accent-deep','--brand-ink','--brand-paper']) {
    assert(html.includes(`'${t}'`), `applyTheme token map missing ${t}`);
  }
  assert(/\^#\[0-9a-fA-F\]\{6\}\$/.test(html), 'applyTheme must validate hex values');
  // Venue fields are injected with escapeHtml (registry is data, not code).
  assert(/escapeHtml\(v\.name \|\| ''\)/.test(html), 'venue name must go through escapeHtml');
  // Dropdown shape: trigger + panel, closes on outside tap like the other dropdowns.
  assert(/id="loginVenueTrigger"/.test(html), 'venue dropdown trigger missing');
  assert(/\.nav-dd\.open, \.login-venue-dd\.open/.test(html),
    'click-outside handler must also close the venue dropdown');
  // Locked venues: rendered with a padlock + aria-disabled, and selectVenue
  // only accepts enabled venues (registry is the gate, not just the styling).
  assert(/aria-disabled="true" tabindex="-1"/.test(html), 'locked venues must be aria-disabled');
  assert(/Próximamente/.test(html), 'locked venues must read Próximamente');
  // Se EJECUTA selectVenue en vez de mirar su forma: lo que hay que demostrar
  // es que un restaurante cerrado NO se aplica, y eso no se lee en el código.
  {
    const src = html.slice(html.indexOf('function selectVenue(id){'), html.indexOf('async function initVenues('));
    const THEMES = { venues: [ { id:'txoko', name:'TXOKO', enabled:true, brand:{} },
                               { id:'mb',    name:'M.B.',  enabled:false, brand:{} } ] };
    const correr = (id) => {
      const puesto = [];
      const avisos = [];
      const doc = { querySelectorAll: () => [], getElementById: () => null };
      const F = new Function('THEMES', '_enabledVenues', 'applyTheme', '_venueTriggerSync', // eslint-disable-line no-new-func
        'document', 'showToast', 'LANG',
        src + '; return selectVenue;');
      F(THEMES, () => THEMES.venues.filter(v => v.enabled), v => puesto.push(v.id),
        () => {}, doc, m => avisos.push(m), 'es')(id);
      return { puesto, avisos };
    };
    const abierto = correr('txoko');
    assert(abierto.puesto.join() === 'txoko', 'un restaurante abierto sí se aplica');
    const cerrado = correr('mb');
    assert(cerrado.puesto.length === 0,
      'selectVenue must reject venues that are not enabled');
    // Y rechazar EN SILENCIO era un toque muerto: el propietario intentó entrar
    // a M.B. desde el login varias veces y la app no decía nada.
    assert(cerrado.avisos.length === 1 && /M\.B\./.test(cerrado.avisos[0]) && /Ajustes/.test(cerrado.avisos[0]),
      `tocar un restaurante cerrado tiene que explicar por qué y dónde ir; dijo: ${JSON.stringify(cerrado.avisos)}`);
    assert(abierto.avisos.length === 0, 'un restaurante abierto no tiene nada que explicar');
  }
  // El héroe del login ya no muestra nombres de venue (siempre «Meseo», jul
  // 2026, arreglo del parpadeo de marca) — el auto-ajuste .long del logo se
  // fue con esa responsabilidad y no debe volver.
  assert(!/classList\.toggle\('long'/.test(html),
    'applyTheme must not scale venue names into the login logo (the hero is always Meseo)');
  assert(/\.login-venue-card\.on\{/.test(read('styles.css')), 'selected venue card style missing');
});

test('data/ghost-scenarios.json scenarios have scenes with options', () => {
  const ghost = JSON.parse(read('data/ghost-scenarios.json'));
  assert(Array.isArray(ghost) && ghost.length > 0, 'not a non-empty array');
  for (const sc of ghost) {
    assert(typeof sc.id === 'string' && sc.id, 'scenario missing id');
    assert(Array.isArray(sc.scenes) && sc.scenes.length > 0, `scenario ${sc.id} has no scenes`);
    for (const [i, scene] of sc.scenes.entries()) {
      assert(Array.isArray(scene.options) && scene.options.length > 0,
        `scenario ${sc.id} scene ${i} has no options`);
    }
  }
});

// Ghost (Servicio Fantasma) full schema + integrity guard.
// Locks the 12 Forbes-inspection scenarios added Jul 2026 (g_reserva, g_idioma,
// g_acceso, g_bebe, g_ebrio, g_halal, g_derrame, g_vino, g_sobremesa, g_terraza,
// g_cuenta, g_olvido) plus the shared invariants of the whole bank.
test('data/ghost-scenarios.json full schema + std ids + ES/EN parity', () => {
  const ghost = JSON.parse(read('data/ghost-scenarios.json'));
  assert(ghost.length >= 22, `expected >= 22 scenarios, got ${ghost.length}`);
  const NEW = new Set(['g_reserva','g_idioma','g_acceso','g_bebe','g_ebrio','g_halal',
    'g_derrame','g_vino','g_sobremesa','g_terraza','g_cuenta','g_olvido']);
  const ids = new Set();
  const topStr = ['id','title','title_en','role','role_en','tagline','tagline_en','icon','ctx','ctx_en'];
  const scStr = ['title','title_en','role','role_en','situation','situation_en','prompt','prompt_en'];
  for (const s of ghost) {
    assert(!ids.has(s.id), `duplicate scenario id ${s.id}`);
    ids.add(s.id);
    for (const f of topStr) assert(typeof s[f] === 'string' && s[f].trim(), `${s.id}: empty/missing ${f}`);
    for (const [i, sc] of s.scenes.entries()) {
      for (const f of scStr) assert(typeof sc[f] === 'string' && sc[f].trim(), `${s.id} sc${i}: empty/missing ${f}`);
      assert(sc.options.length === 3, `${s.id} sc${i}: expected 3 options, got ${sc.options.length}`);
      let allMet = 0;
      for (const o of sc.options) {
        for (const f of ['label','label_en','feedback','feedback_en'])
          assert(typeof o[f] === 'string' && o[f].trim(), `${s.id} sc${i}: option empty/missing ${f}`);
        assert(Array.isArray(o.effects) && o.effects.length > 0, `${s.id} sc${i}: option has no effects`);
        for (const e of o.effects) {
          assert(Number.isInteger(e.std) && e.std >= 1 && e.std <= 80, `${s.id} sc${i}: std ${e.std} out of range 1..80`);
          assert(typeof e.met === 'boolean', `${s.id} sc${i}: effect met not boolean`);
        }
        if (o.effects.every(e => e.met)) allMet++;
      }
      // One correct answer per scene, for ALL scenarios (owner-reviewed fix,
      // Jul 2026: the three farewell/clearing scenes that scored two options
      // as fully correct now have exactly one). Sole documented exception:
      // g_family scene 4 — the kitchen-chain failure is an intentional no-win
      // crisis with ZERO perfect options.
      if (s.id === 'g_family' && i === 3) {
        assert(allMet === 0, `${s.id} sc${i}: the no-win crisis must have 0 all-met options, got ${allMet}`);
      } else {
        assert(allMet === 1, `${s.id} sc${i}: expected exactly 1 all-met option, got ${allMet}`);
      }
    }
    // New scenarios: arc of 4-5 scenes.
    if (NEW.has(s.id)) assert(s.scenes.length >= 4 && s.scenes.length <= 5, `${s.id}: expected 4-5 scenes, got ${s.scenes.length}`);
  }
  for (const id of NEW) assert(ids.has(id), `missing new scenario ${id}`);
});

// ─── 3. Every showTab route resolves to a defined function ──────
console.log('\nRouting integrity');
test('every renderMap route points to a function that exists', () => {
  const m = html.match(/renderMap\s*=\s*\{([^}]*)\}/);
  assert(m, 'could not find renderMap');
  // entries look like  key:renderSomething
  const routes = m[1].split(',').map(s => s.trim()).filter(Boolean);
  assert(routes.length >= 5, `renderMap suspiciously small (${routes.length} routes)`);
  for (const r of routes) {
    const fn = r.split(':')[1]?.trim();
    assert(fn, `malformed route entry: "${r}"`);
    const defined = new RegExp(`(?:async\\s+)?function\\s+${fn}\\s*\\(`).test(html);
    assert(defined, `route target "${fn}" is not defined anywhere`);
  }
});

// ─── 4. Lazy-load data paths exist on disk ──────────────────────
test('every loadLazyData("data/…") path exists on disk', () => {
  const paths = [...html.matchAll(/loadLazyData\(\s*['"`](data\/[^'"`]+)['"`]/g)].map(x => x[1]);
  assert(paths.length > 0, 'no loadLazyData paths found (did the API change?)');
  for (const p of new Set(paths)) {
    assert(existsSync(join(ROOT, p)), `lazy-loaded file missing: ${p}`);
  }
});

// ─── 4b. Extracted stylesheet wired + precached ─────────────────
console.log('\nStylesheet');
test('styles.css is linked, non-trivial, and not duplicated inline', () => {
  assert(/<link\s+rel="stylesheet"\s+href="styles\.css">/.test(html), 'styles.css <link> missing');
  assert(existsSync(join(ROOT, 'styles.css')), 'styles.css file missing');
  const css = read('styles.css');
  assert(css.length > 50000, `styles.css suspiciously small (${css.length} bytes)`);
  // The big inline <style> block must be gone (no regression to inline CSS).
  assert(!/<style>/.test(html), 'an inline <style> block is back in index.html');
  // SW must precache it so first paint after install is instant + offline-safe.
  const sw = read('sw.js');
  assert(/['"`]\.\/styles\.css['"`]/.test(sw), 'styles.css not in SW SHELL_URLS');
});

// ─── 4c. Design system token layer is coherent ─────────────────
console.log('\nDesign system');
test('styles.css defines the formalized token scales', () => {
  const css = read('styles.css');
  // Spacing scale (1..8), type scale, radius/elevation aliases, motion.
  for (let i = 1; i <= 8; i++) assert(css.includes(`--space-${i}:`), `--space-${i} missing`);
  for (const t of ['--text-micro','--text-base','--text-3xl']) assert(css.includes(`${t}:`), `${t} missing`);
  for (const t of ['--radius-sm','--radius-md','--radius-lg','--radius-full']) assert(css.includes(`${t}:`), `${t} missing`);
  for (const t of ['--elev-1','--elev-2','--elev-3']) assert(css.includes(`${t}:`), `${t} missing`);
  for (const t of ['--motion-fast','--motion-base','--ease-standard']) assert(css.includes(`${t}:`), `${t} missing`);
  for (const t of ['--font-sans','--font-serif','--font-mono','--font-read']) assert(css.includes(`${t}:`), `${t} missing`);
});

test('tokenization phase 2: no raw brand hexes in CSS contexts of index.html', () => {
  // Inline styles and template-literal CSS must reference the brand tokens,
  // not raw hexes, so applyTheme() reskins them. Quoted JS strings and SVG
  // presentation attributes are exempt (phase 3 — var() in SVG attributes is
  // not Safari-safe).
  const cssCtx = html.match(/[:,]#(c49a3c|e4be68|d4aa4c|7d5c2f|1c2a22|f4ede2|4d8a5e|2d6a3e)/gi) || [];
  assert(cssCtx.length === 0,
    `found ${cssCtx.length} raw brand hexes in CSS contexts: ${cssCtx.slice(0,4).join(' ')}`);
  // The dashboard greeting eyebrow follows the active venue.
  assert(/dash-hero-label">\$\{\(typeof ACTIVE_VENUE/.test(html),
    'dashboard hero label must be venue-aware');
});

test('brand-token layer drives the palette (multi-restaurant ready)', () => {
  const css = read('styles.css');
  // The 8 brand tokens must be defined with the Txoko identity values so a new
  // venue is a theme swap, not a find-and-replace. The dark ones must stay dark
  // (WCAG): --brand-primary #2d6a3e and --brand-accent-deep #7d5c2f.
  assert(/--brand-primary:\s*#2d6a3e/.test(css), '--brand-primary must be #2d6a3e (dark green)');
  assert(/--brand-accent:\s*#c49a3c/.test(css), '--brand-accent must be #c49a3c (gold)');
  assert(/--brand-accent-deep:\s*#7d5c2f/.test(css), '--brand-accent-deep must be #7d5c2f (dark gold)');
  assert(/--brand-ink:\s*#1c2a22/.test(css), '--brand-ink must be #1c2a22');
  assert(/--brand-paper:\s*#f4ede2/.test(css), '--brand-paper must be #f4ede2');
  // Primitives must derive from the brand layer, and the migration targets exist.
  assert(/--gold:\s*var\(--brand-accent\)/.test(css), '--gold must derive from --brand-accent');
  assert(/--green-deep:\s*var\(--brand-primary\)/.test(css), '--green-deep must derive from --brand-primary');
  assert(/--gold-deep:\s*var\(--brand-accent-deep\)/.test(css), '--gold-deep must derive from --brand-accent-deep');
  // The migration must have removed the raw brand hexes from the sheet: only the
  // 8 --brand-* definitions should still carry them (comments may add a couple).
  const rawGold = (css.match(/#c49a3c/gi) || []).length;
  assert(rawGold <= 1, `#c49a3c should survive only in --brand-accent (found ${rawGold})`);
});

test('semantic color tokens reference existing primitives (no dangling var())', () => {
  const css = read('styles.css');
  const root = css.slice(css.indexOf(':root{'), css.indexOf('}', css.indexOf(':root{')) + 1);
  const defined = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map(m => m[1]));
  // Every var(--x) used INSIDE a token definition must itself be defined.
  for (const m of root.matchAll(/var\((--[a-z0-9-]+)\)/gi)) {
    assert(defined.has(m[1]), `token references undefined ${m[1]}`);
  }
  // Spot-check the semantic aliases exist and point somewhere.
  for (const t of ['--color-bg','--color-accent','--color-danger','--color-success']) {
    assert(new RegExp(`${t}:\\s*var\\(--`).test(css), `${t} should alias a primitive`);
  }
});

test('prefers-reduced-motion guard freezes the atmospheric layer', () => {
  const css = read('styles.css');
  const idx = css.indexOf('@media (prefers-reduced-motion: reduce)');
  assert(idx !== -1, 'no prefers-reduced-motion media query');
  const block = css.slice(idx, css.indexOf('}', css.lastIndexOf('animation: none', css.length)) + 1);
  // Must freeze ambient decoration and not just exist empty.
  assert(/body::before/.test(block), 'guard should freeze body::before ambient layer');
  assert(/animation:\s*none/.test(block), 'guard should set animation:none on decoration');
  // Must NOT disable the finite self-removing feedback effects (they clean up
  // on animationend; freezing them would leave elements stuck on screen).
  for (const finite of ['.xp-burst', '.ripple-circle', '.sr-xp-float']) {
    assert(!new RegExp(`\\${finite}\\b`).test(block), `${finite} must stay animated (animationend cleanup)`);
  }
});

test('DESIGN_SYSTEM.md exists and documents the scales', () => {
  const doc = read('DESIGN_SYSTEM.md');
  for (const s of ['Color', 'Typography', 'Spacing', 'Motion', 'Atmospheric', 'Dual mode']) {
    assert(doc.includes(s), `DESIGN_SYSTEM.md missing section: ${s}`);
  }
});

// ─── 5. Service-worker version hygiene ──────────────────────────
console.log('\nService worker');
test('sw.js VERSION is well-formed and drives CACHE_NAME', () => {
  const sw = read('sw.js');
  const v = sw.match(/const VERSION\s*=\s*['"`](v\d+\.\d+)['"`]/);
  assert(v, 'VERSION missing or not in vN.N form');
  assert(/CACHE_NAME\s*=\s*`txoko-shell-\$\{VERSION\}`/.test(sw),
    'CACHE_NAME must derive from VERSION so old caches are dropped on bump');
});

test('sw.js serves the shell network-first (no HTML/CSS version skew)', () => {
  // Stale-while-revalidate on the shell caused mismatched HTML/CSS after a
  // deploy. The shell (navigation + styles.css) must be network-first so an
  // online user always gets a matching, freshly-deployed pair.
  const sw = read('sw.js');
  assert(/function isShellRequest\(/.test(sw),
    'sw must classify shell requests (navigation + styles.css)');
  assert(/if \(isShellRequest\(req, url\)\)/.test(sw),
    'the fetch handler must branch on shell requests');
  assert(sw.includes('index\\.html|styles\\.css|manifest\\.json'),
    'styles.css must be treated as part of the shell');
  // and the page reloads once when a new SW takes control
  assert(/addEventListener\('controllerchange'/.test(html) && /_swReloaded/.test(html),
    'a guarded controllerchange reload must apply new deploys in-session');
  // an installed PWA must actively check for updates on load + on refocus,
  // otherwise a frozen standalone page never sees a new deploy.
  assert(/function _checkForAppUpdate\(/.test(html) && /reg\.update\(\)/.test(html),
    'must force a SW update check');
  assert(/visibilitychange'[^]*?_checkForAppUpdate|_checkForAppUpdate[^]*?visibilitychange/.test(html),
    'update check must run when the app returns to the foreground');
});

test('sw.js keeps a STABLE runtime cache so updates never drop the images', () => {
  // Bug "se perdieron los gráficos al actualizar": el activate borraba TODA la
  // caché por versión (incluidos sprites), y con red floja no se redescargaban.
  // Los assets perezosos (sprites/data) deben vivir en una caché de nombre FIJO
  // (sin la versión) que el activate NO borra.
  const sw = read('sw.js');
  const m = sw.match(/const RUNTIME_CACHE = '([^']+)'/);
  assert(m, 'debe existir un RUNTIME_CACHE con nombre estable');
  assert(!/\$\{VERSION\}|`/.test(m[1]) && !m[1].includes('shell'),
    'RUNTIME_CACHE debe ser fijo (sin la versión) para sobrevivir a los bumps');
  // la rama stale-while-revalidate (assets) usa la caché estable, no la del shell
  assert(/caches\.open\(RUNTIME_CACHE\)/.test(sw),
    'los assets perezosos deben cachearse en RUNTIME_CACHE');
  // el activate solo borra cachés de shell → la runtime se conserva
  assert(/keys\.filter\(k => k\.startsWith\('txoko-shell-'\) && k !== CACHE_NAME\)/.test(sw),
    'el activate solo debe borrar cachés de shell (conservar la runtime)');
});

// ─── 6. CDN tags carry crossorigin (SRI prerequisite) ───────────
console.log('\nSupply chain');
test('all third-party CDN <script>/<link> tags set crossorigin', () => {
  const cdnTags = [...html.matchAll(/<(?:script|link)\b[^>]*(?:unpkg\.com|jsdelivr\.net)[^>]*>/g)].map(x => x[0]);
  assert(cdnTags.length > 0, 'expected at least one CDN tag');
  for (const tag of cdnTags) {
    assert(/crossorigin/.test(tag), `CDN tag missing crossorigin (blocks SRI): ${tag.slice(0,90)}…`);
  }
});

// ─── 6b. Content-Security-Policy present + covers critical origins ──
console.log('\nContent-Security-Policy');
test('CSP meta tag is present with core hardening directives', () => {
  const m = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i);
  assert(m, 'CSP meta tag missing');
  const csp = m[1];
  for (const dir of ["default-src 'self'", 'script-src', 'connect-src', "object-src 'none'", "base-uri 'self'"]) {
    assert(csp.includes(dir), `CSP missing directive: ${dir}`);
  }
});

test('Los iconos de pantalla son SVG, no emoji a color', () => {
  // Auditoría ago 2026: recorriendo la app se pintaban 7 emoji a color (103
  // instancias, 100 de ellas el 📷 del botón de subir foto). Cada sistema los
  // dibuja a su manera y rompen la estética de oro y serif — el sobre azul del
  // diálogo de correo era el ejemplo más visible.
  // Se cambian los que salen A COLOR. Los glifos tipográficos monocromos
  // (★ ✦ ◆ ✕ ⚙) son parte del vocabulario de la app y se quedan.
  const aColor = /[\u{1F300}-\u{1FAFF}]|[\u{26A1}\u{2B50}\u{2705}\u{274C}]/u;
  const sitios = [
    ['botón de subir foto',      /class="empl-upload-btn"[^>]*>(.{0,400}?)\$\{_en\?'Upload photo'/s],
    ['subir foto desde la ficha',/class="empl-ov-upload"[^>]*>(.{0,400}?)\$\{_en\?'Got a better photo/s],
    ['aviso de fotos que faltan',/class="empl-missing">(.{0,400}?)\$\{_en\?'No photo yet'/s],
    ['diálogo de correo',        /text-align:center;margin-bottom:\.4rem;color:var\(--gold\)">(.{0,400}?)<\/div>/s],
    ['banner de instalar',       /class="install-banner-ic"[^>]*>(.{0,400}?)<\/div>/s],
    ['reto del día',             /<div class="pdd-eyebrow"><span>(.{0,400}?)\$\{en\?'Daily quiz'/s],
    ['atajo de horarios',        /<span aria-hidden="true">(<svg.{0,400}?)<\/span>/s],
  ];
  for (const [nombre, re] of sitios) {
    const m = html.match(re);
    assert(m, `no encuentro el icono de: ${nombre}`);
    assert(!aColor.test(m[1]), `${nombre} sigue usando un emoji a color`);
    // Y el sustituto sigue el estilo de la casa: viewBox 24, grosor 1,5, hereda
    // el color del texto y se oculta al lector de pantalla (es decorativo).
    const svg = (m[1].match(/<svg[^>]*>/) || [])[0];
    assert(svg, `${nombre} debería llevar un SVG`);
    assert(/viewBox="0 0 24 24"/.test(svg), `el icono de ${nombre} debe usar el viewBox 24 de la casa`);
    assert(/stroke="currentColor"/.test(svg), `el icono de ${nombre} debe heredar el color del texto`);
    assert(/stroke-width="1\.5"/.test(svg), `el icono de ${nombre} debe usar el grosor 1,5 de la casa`);
    assert(/aria-hidden="true"/.test(svg), `el icono de ${nombre} es decorativo: debe ocultarse al lector de pantalla`);
  }
});

test('Cambiar de idioma repinta los diálogos abiertos', () => {
  // Auditoría ago 2026: el diálogo del correo está bien traducido en el código,
  // pero se construye con el idioma que hubiera en ese momento y nadie lo vuelve
  // a pintar. Medido: tras poner LANG='es' y applyLangToApp(), seguía en inglés
  // dentro de una app en español.
  const al = _xFn('applyLangToApp');
  assert(/_langRemountOverlays\(\)/.test(al), 'applyLangToApp debe repintar los overlays abiertos');
  const rm = _xFn('_langRemountOverlays');
  assert(/'recEmailOverlay'/.test(rm) && /'onboardingOverlay'/.test(rm),
    'el repintado debe cubrir el diálogo de correo y la guía');
  // El de correo necesita sus argumentos para reconstruirse.
  assert(/_recEmailArgs = \{ name, pinHash \}/.test(html),
    '_recEmailShow debe guardar sus argumentos para poder repintarse');
  // La guía se repinta sobre su propio overlay; quitarlo re-dispararía su
  // animación de entrada, así que solo el de correo lleva quitar:true.
  assert(/id:'onboardingOverlay', quitar:false/.test(rm),
    'la guía no debe desmontarse: se repinta en su sitio');
});

test('La marca del producto es Meseo; TXOKO es el restaurante', () => {
  // Auditoría ago 2026: el título y el manifiesto ya decían Meseo, pero la
  // PRIMERA pantalla que ve un empleado nuevo seguía diciendo «¡Bienvenido a
  // TXOKO!», y lo mismo el aviso de instalación. La distinción importa: «Txoko
  // by Martín Berasategui» como nombre del restaurante es correcto y se queda;
  // lo que sobra es TXOKO usado como nombre de la app.
  assert(/title_es:'¡Bienvenido a Meseo!',title_en:'Welcome to Meseo!'/.test(html),
    'la guía debe dar la bienvenida a Meseo, no a TXOKO');
  for (const frag of ['Añade Meseo a tu pantalla de inicio', 'Instala Meseo en tu móvil',
                      'Meseo aparece como una app', 'Install Meseo on your phone']) {
    assert(html.includes(frag), `el flujo de instalación debe decir Meseo: falta «${frag}»`);
  }
  assert(/<title>[^<]*Meseo/.test(html), 'el <title> debe llevar Meseo');
  const mf = JSON.parse(read('manifest.json'));
  assert(/Meseo/.test(mf.name) && /Meseo/.test(mf.short_name), 'el manifiesto debe llevar Meseo');
  // Y el aviso legal CONSERVA la protección de marcas de terceros: el nombre del
  // restaurante y el del chef no son nuestros y deben seguir reconocidos.
  assert(/incluidos TXOKO y Martín Berasategui\) son marcas/.test(html),
    'el aviso legal debe seguir reconociendo las marcas del restaurante y del chef');
  assert(/no está afiliada, patrocinada ni respaldada/.test(html),
    'el aviso legal debe mantener el descargo de no afiliación');
});

test('Suelo de 12px en texto y 44px en zonas táctiles', () => {
  // Auditoría ago 2026, medido en 390×844 recorriendo 9 pantallas:
  //   580 elementos de texto por debajo de 12px (273 solo la franja de datos de
  //   la ficha de vino, a 10px) y 61 botones por debajo de 44px de alto.
  //   Región, precio y perfil son justo lo que se consulta de pie y en segundos
  //   antes de entrar a mesa, y eran lo más pequeño de la pantalla.
  // Tras el arreglo: 0 y 0. Este guard vigila las reglas que lo causaban.
  const css = read('styles.css');
  // Anclado a principio de línea: si no, `.game-card-badge` casaría dentro de
  // `.tx-rh-hub .game-card-badge`, que es otra regla y no lleva font-size.
  const ruleOf = (sel) => {
    const re = new RegExp('^' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}', 'm');
    const m = css.match(re);
    assert(m, `no encuentro la regla ${sel}`);
    // Sin comentarios: un comentario que mencione «min-height:34px» explicando
    // por qué se quitó no puede hacer fallar la comprobación del valor real.
    return m[1].replace(/\/\*[\s\S]*?\*\//g, '');
  };
  const sizeOf = (sel) => {
    const m = ruleOf(sel).match(/font-size:([\d.]+)rem/);
    assert(m, `${sel} no declara font-size`);
    return parseFloat(m[1]) * 16;
  };
  for (const sel of ['.wcms-stat', '.wc-region', '.wc-price-sub', '.wc-rec', '.dash-index-meta',
                     '.game-card-label', '.game-card-badge', '.tunic-divider span', '.xp-bar-sub',
                     '.hoy-numrow-meta', '.sup-hero-sub', '.hub-banner-sub', '.chat-eyebrow',
                     '.dash-row-meta', '.ri-cta-sub', '.act-foot']) {
    const px = sizeOf(sel);
    assert(px >= 11.5, `${sel} se lee a ${px.toFixed(1)}px — el suelo es 12px`);
  }
  const minH = (sel) => {
    const hits = [...ruleOf(sel).matchAll(/min-height:(\d+)px/g)].map(m => +m[1]);
    assert(hits.length, `${sel} no declara min-height`);
    // La ÚLTIMA declaración gana: .chat-presence-toggle llevaba un 44 seguido de
    // un 34 en el mismo bloque, así que el arreglo no hacía nada.
    return hits[hits.length - 1];
  };
  for (const sel of ['.empl-upload-btn', '.wine-filter-pill', '.chat-presence-toggle',
                     '.dash-hero-hor', '.install-banner-btn']) {
    assert(minH(sel) >= 44, `${sel} mide ${minH(sel)}px de alto — el mínimo táctil es 44px`);
  }
  // Y ninguna media query puede volver a bajarlos por debajo del suelo.
  for (const m of css.match(/@media[^{]*\{[\s\S]*?\n\}/g) || []) {
    for (const r of m.match(/\.(wine-filter-pill|empl-upload-btn|chat-presence-toggle)[^{]*\{[^}]*\}/g) || []) {
      const h = r.match(/min-height:(\d+)px/);
      if (h) assert(+h[1] >= 44, `una media query baja a ${h[1]}px: ${r.slice(0, 70)}`);
      const f = r.match(/font-size:([\d.]+)rem/);
      if (f) assert(parseFloat(f[1]) * 16 >= 11.5,
        `una media query baja el texto a ${(parseFloat(f[1]) * 16).toFixed(1)}px: ${r.slice(0, 70)}`);
    }
  }
});

test('Contraste: la tinta secundaria y el oro de texto son legibles', () => {
  // Auditoría ago 2026. Midiendo sobre el fondo real de cada elemento salían 37
  // fallos AA repartidos por 8 pantallas, todos de 10 reglas. Comprobado además
  // píxel a píxel sobre captura: el texto que va sobre degradado o foto estaba
  // bien; los fallos eran los de fondo sólido. Tras el arreglo: 0.
  const css = read('styles.css');
  const srgb = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const lum = (c) => { const f = v => (v /= 255) <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4);
                       return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]); };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)]; return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  const over = (c, a, bg) => c.map((v, i) => v * a + bg[i] * (1 - a));
  const CREAM = srgb('#f4ede2'), CARD = srgb('#f4e4c1'), INK = [28, 42, 34];

  const alpha = (tok) => {
    const m = css.match(new RegExp('--' + tok + ':\\s*rgba\\(28,42,34,\\.(\\d+)\\)'));
    assert(m, `no encuentro el token --${tok}`);
    return parseFloat('.' + m[1]);
  };
  for (const tok of ['parch3', 'parch4']) {
    const r = ratio(over(INK, alpha(tok), CREAM), CREAM);
    assert(r >= 4.5, `--${tok} da ${r.toFixed(2)} sobre pergamino — el mínimo legible es 4,5`);
  }
  // El oro de marca vale para filetes y titulares, no para texto pequeño: por eso
  // existe --gold-ink. Debe pasar 4,5 sobre pergamino Y sobre la tarjeta crema.
  // Se resuelve la cadena de tokens (--gold-ink → --gold-deep → --brand-accent-deep)
  // para que siga midiendo el color real si se re-tematiza el restaurante.
  const resolve = (tok, depth = 0) => {
    assert(depth < 6, `cadena de tokens demasiado profunda en --${tok}`);
    const m = css.match(new RegExp('--' + tok + ':\\s*([^;]+);'));
    assert(m, `falta el token --${tok}`);
    const v = m[1].trim();
    const ref = v.match(/^var\(--([\w-]+)\)$/);
    return ref ? resolve(ref[1], depth + 1) : v;
  };
  const goldInk = resolve('gold-ink');
  assert(/^#[0-9a-f]{6}$/i.test(goldInk), `--gold-ink no resuelve a un color sólido: ${goldInk}`);
  for (const [bg, name] of [[CREAM, 'pergamino'], [CARD, 'tarjeta crema']]) {
    const r = ratio(srgb(goldInk), bg);
    assert(r >= 4.5, `--gold-ink (${goldInk}) da ${r.toFixed(2)} sobre ${name} — el mínimo es 4,5`);
  }
  // Toda tarjeta de juego declara tinta propia junto a su acento vivo: si el
  // acento va sin --gc-ink, el título se pinta con el color vivo y pierde
  // contraste. Se cuentan las que hay, no un número fijo — la Ruleta se retiró
  // (sept 2026) y quedaron tres.
  const acentos = (html.match(/--gc-accent:/g) || []).length;
  const conTinta = (html.match(/--gc-accent:[^;"]+;--gc-ink:[^;"]+;/g) || []).length;
  assert(acentos >= 3, `esperaba al menos 3 tarjetas de juego, encontradas ${acentos}`);
  assert(conTinta === acentos,
    `${acentos - conTinta} tarjeta(s) de juego declaran --gc-accent sin --gc-ink`);
  assert(/\.game-card-label\{[^}]*color:var\(--gc-ink,var\(--gold-ink\)\)/s.test(css),
    'la etiqueta de tarjeta debe usar --gc-ink, no el acento vivo');
  assert(!/\.game-card-label\{[^}]*opacity:\.85/s.test(css),
    'la etiqueta de tarjeta no puede llevar opacity: rebaja el contraste ya ajustado');
  // El rótulo de sección sale 14 veces en INICIO: con --gold daba 2,25.
  assert(/\.tunic-divider span\{[^}]*color:var\(--gold-ink\)/s.test(css),
    'el rótulo de sección debe usar --gold-ink');
});

test('Una pestaña desconocida abre INICIO, no una traza de JavaScript', () => {
  // Auditoría ago 2026: los push abren la app con #tab=… Si el nombre ya no
  // existe (hemos renombrado pestañas varias veces), se pintaba en rojo
  // «Error en tab X: renderMap[tab] is not a function» — en inglés, a un
  // camarero. Medido: showTab('estaNoExiste') producía exactamente eso.
  const st = _xFn('showTab');
  assert(/if\(!TAB_ROUTES\.includes\(tab\)\)/.test(st), 'showTab debe validar la pestaña contra TAB_ROUTES');
  assert(/tab = 'dashboard';/.test(st), 'una pestaña desconocida debe caer en INICIO');
  // La validación va ANTES de tocar estado (currentTab, track, teardown).
  assert(st.indexOf('TAB_ROUTES.includes') < st.indexOf('currentTab=tab'),
    'la pestaña debe validarse antes de fijar currentTab');
  // TAB_ROUTES y renderMap no pueden separarse al añadir una pestaña.
  const routes = JSON.parse(_xConst('TAB_ROUTES', '];').match(/\[[^\]]*\]/)[0].replace(/'/g, '"'));
  const mapKeys = (st.match(/const renderMap = \{([^}]*)\}/)[1].match(/(\w+):/g) || [])
    .map(k => k.slice(0, -1));
  assert(routes.slice().sort().join() === mapKeys.slice().sort().join(),
    `TAB_ROUTES y renderMap se han separado:\n  solo en TAB_ROUTES: ${routes.filter(r => !mapKeys.includes(r))}\n  solo en renderMap: ${mapKeys.filter(k => !routes.includes(k))}`);
  // Si una pantalla conocida revienta, tampoco se enseña la traza.
  assert(/Esta pantalla no se ha podido abrir/.test(st) && /This screen could not open/.test(st),
    'el fallo de render debe explicarse en el idioma del usuario');
  assert(/showTab\(\\?'dashboard\\?'\)/.test(st), 'el fallo de render debe ofrecer una salida a INICIO');
  assert(/DEBUG \? '<pre/.test(st), 'la traza solo puede verse con DEBUG activado');
});

test('Reducir movimiento: la red general no puede desaparecer', () => {
  // DESIGN_SYSTEM §7 dejaba el guard general como «fase pendiente», y al ir a
  // hacerlo resultó que YA existía y YA funcionaba: medido con la métrica
  // correcta (movimiento perceptible, >50 ms), la app detiene el 100 % de la
  // animación cuando el sistema pide reducir movimiento — 180 elementos → 0,
  // en 5 pantallas, sin perder contenido en ninguna de las 10 comprobadas.
  // Este guard no añade nada: impide que esa red se borre por descuido, porque
  // sin ella vuelven 180 elementos en movimiento.
  const css = read('styles.css');
  const bloques = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\n\}/g) || [];
  const red = bloques.find((b) => /\*,\s*\*::before,\s*\*::after/.test(b) && /animation-iteration-count/.test(b));
  assert(red, 'falta la red general de reducir movimiento (cubre lo que la lista de selectores no alcanza)');
  for (const prop of ['animation-duration', 'animation-iteration-count', 'transition-duration']) {
    assert(new RegExp(prop + ':\\s*[^;]*!important').test(red),
      `la red debe neutralizar ${prop} con !important`);
  }
  // Duración mínima y NO «none»: los efectos finitos «forwards» se auto-retiran
  // en animationend, y con «none» ese evento no llegaría a dispararse nunca.
  // Es la excepción que documenta §7 y que hay que respetar.
  assert(/animation-duration:\s*\.?0*\.?00?1ms/.test(red),
    'debe usar una duración mínima, no «none»: si no, lo que se limpia en animationend se queda pegado');
  assert(/animation-iteration-count:\s*1\s*!important/.test(red),
    'iteration-count:1 es lo que detiene los bucles infinitos del ambiente');
  assert(/addEventListener\('animationend'/.test(html),
    'si ya no hay efectos que se limpien en animationend, revisa si la duración mínima sigue siendo lo correcto');
});

test('Afinado: equilibrado de línea, alto real de pantalla y foco de teclado', () => {
  const css = read('styles.css');
  // Titulares equilibrados y prosa sin palabra huérfana: la app tiene 40+
  // clases de titular y ninguna lo hacía.
  assert(/text-wrap:\s*balance/.test(css), 'los titulares deben equilibrar el corte de línea');
  assert(/text-wrap:\s*pretty/.test(css), 'la prosa debe evitar la palabra huérfana');
  // 100vh no descuenta la barra del navegador móvil. Se deja como respaldo.
  const alto = css.match(/body,\s*\.screen\{[^}]*\}/);
  assert(alto, 'falta la regla de alto de pantalla');
  assert(/min-height:\s*100vh/.test(alto[0]) && /min-height:\s*100dvh/.test(alto[0]),
    'debe declarar 100vh como respaldo y 100dvh después');
  assert(alto[0].indexOf('100vh') < alto[0].indexOf('100dvh'), 'el respaldo va primero');
  // Foco: NO estaba roto — medido con TAB real, 19 de 20 elementos ya
  // mostraban el anillo del navegador. Lo que cambia es que ahora es el oro de
  // la app y solo sale al navegar con teclado, no al tocar en la tablet.
  assert(/:focus-visible\{[^}]*outline:\s*2px solid var\(--gold\)/.test(css),
    'el anillo de foco debe ser el oro de la app');
  assert(/:focus-visible\{[^}]*outline-offset/.test(css), 'el anillo necesita separación');
});

test('Repaso: poco que leer antes de poder empezar', () => {
  // Reporte del propietario (sept 2026): «los usuarios son camareros que
  // normalmente están cansados o entre horarios; mucha información agobia».
  // Medido en un móvil de 390 px: había 55 palabras ANTES del botón de
  // empezar, que quedaba a 628 px de una pantalla de 844 — tres cuartos de
  // pantalla para poder actuar. Tras aligerar: 32 palabras y 512 px, y la
  // pantalla entera cabe sin scroll (939 → 791 px).
  const sr = html.slice(html.indexOf('function renderSmartReview'), html.indexOf('function _startSmartSession'));
  // La nota de entrada es una frase, no un párrafo: era de 36 palabras.
  const brief = sr.match(/class="ri-brief">\$\{_en\s*\?\s*'([^']+)'\s*:\s*'([^']+)'/);
  assert(brief, 'no encuentro la nota de entrada del Repaso');
  for (const t of [brief[1], brief[2]]) {
    const n = t.split(/\s+/).length;
    assert(n <= 20, `la nota de entrada tiene ${n} palabras: se lee de pie y cansado, máximo 20`);
  }
  // El botón principal decide con cuántos casos y cuánto dura. Con la
  // dificultad dentro, la línea partía en TRES en 390 px y parecía roto.
  const cta = sr.match(/class="ri-cta-sub">([^<]*)</);
  assert(cta, 'no encuentro la línea del botón de empezar');
  assert(!/_srDiffLabel/.test(cta[1]),
    'la dificultad no cabe en el botón: la línea partía en tres en un móvil');
  // Y no vuelven ni el saludo con nombre ni el turno/fecha, que ya salen en
  // INICIO: eran cuatro datos más que atravesar.
  assert(!/ri-greet-name/.test(sr), 'el saludo con nombre repite lo que ya dice INICIO');
  assert(!/ri-shift-date/.test(sr), 'el turno y la fecha ya salen en INICIO y en el móvil');
});

test('Repaso Inteligente no es otro simulacro de alérgenos', () => {
  // Reporte del propietario (sept 2026): «en Repaso hay muchas opciones y son
  // casi lo mismo — por ejemplo Repaso Inteligente y Simulacro de Alérgenos».
  // Lo eran: medido sobre 900 casos generados, el 71 % hablaba de alérgenos,
  // porque de las ~30 papeletas del sorteo 20 eran escenarios de alérgeno. Al
  // lado de un simulacro que es 100 % alérgenos, se sentían iguales.
  // Los demás escenarios YA existían y funcionaban (vegetariano en 22 platos,
  // embarazo en 69, infantil en 92, picante en 31): solo no salían nunca.
  // Tras reequilibrar: 47 % alérgenos y 7 familias vivas en vez de 5.
  const fn = _xFn('_srGenerateQuiz');
  const peso = (nombre) => {
    const m = fn.match(new RegExp('_scenario' + nombre + '\\(dish, dd, _en\\), (\\d+)'));
    assert(m, `no encuentro el peso de ${nombre} en el sorteo`);
    return parseInt(m[1], 10);
  };
  // Ningún escenario de la familia de alérgenos puede pesar más que el mayor
  // de los que NO lo son: es lo que volvía a ahogar la variedad.
  const alerg = ['DeclaredAllergy', 'SafeAlternative', 'SharedAllergen', 'Modification',
                 'CrossContamination', 'MultipleAllergies', 'WhichAdaptable',
                 'AllergenSource', 'ComponentAllergen'].map(peso);
  const otros = ['IngredientCheck', 'Vegetarian', 'WaitTime', 'IngredientWhere',
                 'Pregnancy', 'ChildFriendly', 'Spicy'].map(peso);
  assert(Math.max(...alerg) <= Math.max(...otros),
    `un escenario de alérgeno pesa ${Math.max(...alerg)} y el mayor de los demás ${Math.max(...otros)}: vuelve a ahogar la variedad`);
  // Los tres que estaban dormidos a peso 1 no pueden volver a quedarse ahí.
  for (const n of ['Pregnancy', 'ChildFriendly', 'Spicy', 'Vegetarian']) {
    assert(peso(n) >= 2, `${n} vuelve a estar a peso ${peso(n)}: no saldría nunca`);
  }
  // Y los textos deben decir de qué va cada uno: es lo que hace visible la
  // diferencia entre los dos ejercicios.
  // La lista pasó de prosa a línea escaneable y de ahí a etiquetas (reporte:
  // «mucha información agobia»), pero debe seguir nombrando las familias: es
  // lo que distingue este ejercicio del Simulacro. Se comprueba el contenido,
  // no la forma en que se dibuja.
  const sr2 = html.slice(html.indexOf('function renderSmartReview'),
                         html.indexOf('function _startSmartSession'));
  const fams = (sr2.match(/class="ri-fams">([\s\S]*?)<\/div>/) || [])[1] || '';
  for (const f of ['Alergias','Vegetarianos','Embarazo','Niños','Picante','Esperas']) {
    assert(fams.includes(f), `el Repaso ya no nombra «${f}» entre sus familias de casos`);
  }
  for (const f of ['Allergies','Vegetarians','Pregnancy','Children','Spice','Wait times']) {
    assert(fams.includes(f), `the English families list dropped «${f}»`);
  }
  assert(/Solo alérgenos, con trampas/.test(html),
    'el texto del Simulacro debe decir que es solo de alérgenos');
});

test('Buscador de alérgenos: primero lo que LLEVA el alérgeno', () => {
  // Peticion del propietario (sept 2026), con la app ya en uso en sala. Yo lo
  // habia puesto al reves pensando que en mesa interesa «que puede tomar»,
  // pero medido en el movil el bloque rojo quedaba a 4.066 px de scroll: habia
  // que bajar por 59 platos en seis grupos para llegar a el. Ademas suele ser
  // la lista mas corta (43 frente a 59 con gluten) y es la que se consulta
  // para descartar un plato concreto. Ahora se ve de entrada.
  const fn = _xFn('_gsAllergenAnswer');
  const iLleva = fn.indexOf("gs-al-band danger");
  const iLibre = fn.indexOf("gs-al-band safe");
  assert(iLleva !== -1 && iLibre !== -1, 'faltan las dos bandas de la respuesta');
  assert(iLleva < iLibre,
    'el bloque «Lleva» debe pintarse ANTES que el de «No declara» (petición del propietario)');
  // Las dos bandas siguen etiquetadas sin ambigüedad: es lo que impide leer
  // una lista por la otra, y no el orden.
  assert(/'Declares':'Lleva'/.test(fn) && /'Does not declare':'No declara'/.test(fn),
    'las dos bandas deben seguir nombrando qué son');
});

test('Buscador de alérgenos: el bloque «no declara» nunca miente', () => {
  // El propietario (ago 2026) reporta que la plantilla usa el buscador en sala,
  // con el cliente delante, y que ha puesto la app en tablets para eso. Medido
  // entonces, fallaba justo en ese uso — y de forma peligrosa:
  //   «sin gluten» ... 6 platos, LOS 6 CON GLUTEN (la lista contraria)
  //   «celiaco» ...... 0 · «marisco» ... 0 · «lactosa» ... 1 (hay 50 con Lácteos)
  // Este guard ejecuta la detección REAL sobre los datos REALES.
  const cut = (a, b) => { const i = html.indexOf(a); assert(i !== -1, 'missing ' + a); return html.slice(i, html.indexOf(b, i)); };
  const dishesSrc = cut('const DISHES = [', '\n];') + '\n];';
  const M = new Function( // eslint-disable-line no-new-func
    'let LANG="es";\n' + dishesSrc + '\n'
    + _xConst('GS_ALLERGEN_VOCAB', '\n};') + '\n'   // _xConst ya incluye el cierre
    + _xConst('GS_INTENT_WORDS', ']);') + '\n'
    + _xFn('_gsAllergenIntent')
    + '\nreturn {DISHES, _gsAllergenIntent, GS_ALLERGEN_VOCAB, setLang:(l)=>{LANG=l;}};')();

  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const pregunta = (q) => M._gsAllergenIntent(norm(q).trim().split(/\s+/).filter(Boolean));

  // ── El invariante de seguridad ────────────────────────────────────────
  // Para CADA término del vocabulario: ningún plato del bloque «no declara»
  // puede declarar el alérgeno. Es la promesa que se lee en voz alta al cliente.
  for (const termino of Object.keys(M.GS_ALLERGEN_VOCAB)) {
    const algs = pregunta(termino);
    assert(algs, `«${termino}» está en el vocabulario pero no se detecta como alérgeno`);
    const libres = M.DISHES.filter((d) => !algs.some((a) => (d.allergens || []).includes(a)));
    const mentira = libres.find((d) => algs.some((a) => (d.allergens || []).includes(a)));
    assert(!mentira, `«${termino}»: «${mentira && mentira.name}» aparecería como que no declara ${algs.join('/')}`);
  }

  // ── Los términos que fallaban ─────────────────────────────────────────
  const debeDetectar = {
    'sin gluten': ['Gluten'], 'celiaco': ['Gluten'], 'alergia gluten': ['Gluten'],
    'lactosa': ['Lácteos'], 'frutos secos': ['Frutos secos'], 'cacahuete': ['Cacahuete'],
    'no puede comer huevo': ['Huevos'], 'marisco': ['Crustáceos', 'Moluscos'],
  };
  for (const [q, esperado] of Object.entries(debeDetectar)) {
    const got = pregunta(q);
    assert(got && esperado.every((a) => got.includes(a)) && got.length === esperado.length,
      `«${q}» debería dar ${esperado.join('+')}, dio ${got ? got.join('+') : 'nada'}`);
  }
  // «soy» en español es el verbo, no la soja: convertía «soy alergico al
  // pescado» en «Soja o Pescado». Solo cuenta como alérgeno en inglés.
  assert(JSON.stringify(pregunta('soy alergico al pescado')) === JSON.stringify(['Pescado']),
    '«soy alergico al pescado» no puede añadir Soja');
  M.setLang('en');
  assert((pregunta('soy') || []).includes('Soja'), 'en inglés «soy» sí es soja');
  M.setLang('es');

  // ── Y una búsqueda normal sigue siendo una búsqueda normal ────────────
  for (const q of ['croqueta', 'rioja', 'cebolla', 'croqueta gluten', 'wagyu']) {
    assert(pregunta(q) === null, `«${q}» debe ir a la búsqueda normal, no a la respuesta de alérgeno`);
  }

  // ── Cobertura: todo alérgeno de la carta debe poder preguntarse ────────
  const enCarta = new Set();
  M.DISHES.forEach((d) => (d.allergens || []).forEach((a) => enCarta.add(a)));
  const alcanzables = new Set();
  Object.values(M.GS_ALLERGEN_VOCAB).forEach((v) => v.forEach((a) => alcanzables.add(a)));
  for (const a of enCarta) {
    assert(alcanzables.has(a), `el alérgeno «${a}» está en la carta pero ninguna palabra lo encuentra`);
  }
});

test('En una consulta de sala nada tapa la respuesta', () => {
  // Visto en captura sobre la respuesta de «sin gluten»: el aviso de logro, el
  // confeti y el +50 XP encima de la lista que hay que leer al cliente.
  assert(/function _gsIsOpen\(\)/.test(html), 'debe existir _gsIsOpen');
  for (const fn of ['showXPToast', 'showLevelUpModal', 'showAchievementToast']) {
    const body = _xFn(fn);
    assert(/_gsIsOpen\(\)/.test(body) && /_uiWhenClear/.test(body),
      `${fn} debe aplazarse mientras el buscador está abierto`);
  }
  // El confeti se corta en el ORIGEN: hay cinco sitios que lo lanzan y cerrarlos
  // uno a uno se presta a olvidar alguno (pasó con el aviso de logro).
  assert(/_gsIsOpen\(\) *\) *return;/.test(_xFn('launchConfetti')),
    'launchConfetti debe cortarse en el origen, no en cada llamada');
  // Y lo que YA estuviera en pantalla se retira al abrir la consulta: la
  // celebración puede haberse disparado justo antes.
  const clear = _xFn('_gsClearCelebrations');
  for (const id of ['achToastStack', 'xpToast', 'luOverlay', 'confettiCanvas']) {
    assert(clear.includes(id), `_gsClearCelebrations debe retirar #${id}`);
  }
  assert(/_gsClearCelebrations\(\)/.test(_xFn('openGlobalSearch')),
    'openGlobalSearch debe limpiar lo que ya estuviera puesto');
});

test('El escáner de precarga no puede pedir plantillas sin evaluar', () => {
  // Auditoría ago 2026, hallazgo 09. El escáner de precarga del navegador lee
  // por adelantado el bloque de código de 2 MB. Cuando el analizador se para
  // —esperando una hoja de estilos, p. ej.— llega a las plantillas de HTML,
  // cree que `src="${…}"` es una ruta real y la pide.
  // Medido: v7.344 fallaba en 10/10 cargas con 82 peticiones 404; con el
  // atributo escrito a través de SRC, 0/10 en esa MISMA condición adversa.
  assert(/^const SRC = 'src';$/m.test(html), "debe existir la constante SRC = 'src'");

  // Ningún atributo precargable puede llevar una plantilla o una concatenación
  // pegada al nombre del atributo: es lo único que el escáner sabe reconocer.
  const precargables = [
    ['img', 'src'], ['img', 'srcset'], ['source', 'srcset'], ['link', 'href'],
    ['script', 'src'], ['video', 'poster'],
  ];
  for (const [tag, attr] of precargables) {
    // Sin tope de longitud entre la etiqueta y el atributo (pero sin cruzar un
    // '>'): con una ventana corta se escapaba el sprite de Mr. Shoesmith, que
    // lleva class= y alt= largos delante del src. Lo cazó la prueba en la
    // condición adversa, no el guard — de ahí que ahora no tenga tope.
    const re = new RegExp(`<${tag}(?:(?!>)[\\s\\S]){0,400}?${attr}="(?=\\$\\{|'\\+|"\\+)`, 'g');
    const hits = html.match(re) || [];
    assert(hits.length === 0,
      `${hits.length} <${tag}> con ${attr}=" seguido de plantilla: el escáner los pedirá. ` +
      `Escribe el atributo con \${SRC} (plantilla) o '+SRC+' (concatenación). Ej: ${hits[0]}`);
  }

  // Y las rutas ESTÁTICAS de verdad siguen literales: esas SÍ deben precargarse.
  const literales = (html.match(/<img src="img\//g) || []).length;
  assert(literales >= 3,
    `las rutas estáticas del carrusel deben seguir con src= literal para que se precarguen (hay ${literales})`);
});

test('Arranque: nada externo puede bloquear el primer pintado', () => {
  // Auditoría ago 2026, medido con Chromium en 390×844:
  //   red normal ................ primer pintado 12 748 ms
  //   fonts.googleapis colgado .. NUNCA (>20 s), blanco total
  //   solo dominio propio ....... 256 ms
  // La causa era un <link rel="stylesheet"> a fonts.googleapis.com, que bloquea
  // el pintado. Un portal cautivo de wifi de hotel no rechaza la petición: la
  // deja colgada, así que la app no dibujaba nada. Tras alojarlas: 632 ms en red
  // normal y 424 ms con Google caído. Este guard impide que vuelva a entrar.
  const head = html.slice(0, html.indexOf('</head>'));
  const blocking = head.match(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi) || [];
  for (const tag of blocking) {
    const href = (tag.match(/href=["']([^"']+)["']/) || [])[1] || '';
    assert(!/^https?:\/\//.test(href),
      `hoja de estilos externa que BLOQUEA el pintado: ${href} — alójala o cárgala sin bloquear`);
  }
  // Las cuatro familias del sistema de diseño deben existir en disco.
  for (const f of ['Cinzel-400-latin.woff2', 'CormorantGaramond-400-latin.woff2',
                   'Quicksand-300-latin.woff2', 'DMMono-400-latin.woff2']) {
    assert(existsSync(join(ROOT, 'fonts', f)), `falta la tipografía propia fonts/${f}`);
  }
  // Y estar declaradas en styles.css apuntando a fonts/ (no a un CDN).
  const css = read('styles.css');
  const faces = css.match(/@font-face\s*\{[^}]*\}/g) || [];
  assert(faces.length >= 8, `esperaba las @font-face propias en styles.css, hay ${faces.length}`);
  for (const f of faces) {
    assert(/url\(fonts\//.test(f), '@font-face debe cargar desde fonts/ del propio dominio');
  }
  // TODA referencia debe existir en disco. Cinzel y Quicksand son fuentes
  // VARIABLES: Google sirve el mismo woff2 para todos los pesos, así que
  // nombrar los archivos por peso creó 5 rutas inexistentes y las negritas
  // caían a la fuente del sistema sin avisar. Lo cazó el chequeo de 404.
  const refs = [...new Set([...css.matchAll(/url\(fonts\/([^)]+)\)/g)].map(m => m[1]))];
  assert(refs.length >= 8, `esperaba varias referencias a fonts/, hay ${refs.length}`);
  for (const r of refs) {
    assert(existsSync(join(ROOT, 'fonts', r)), `styles.css referencia fonts/${r} y no existe`);
  }
  // Y ningún archivo huérfano: peso muerto en cada despliegue.
  for (const f of readdirSync(join(ROOT, 'fonts'))) {
    assert(refs.includes(f), `fonts/${f} no lo referencia nadie — sobra`);
  }
  // Las dos caras del primer pintado se precargan.
  assert(/<link rel="preload" as="font"[^>]*Quicksand-300-latin\.woff2[^>]*crossorigin>/.test(head)
      && /<link rel="preload" as="font"[^>]*Cinzel-400-latin\.woff2[^>]*crossorigin>/.test(head),
    'Quicksand y Cinzel deben precargarse (crossorigin es obligatorio en preload de fuentes)');
});

test('CSP does not break critical paths (Supabase, CDNs, fonts, map)', () => {
  // A too-narrow CSP would silently break login/sync or the map. Assert the
  // origins the app genuinely loads from are still allow-listed, so a future
  // CSP edit can't quietly cut them off.
  const csp = html.match(/Content-Security-Policy"\s+content="([^"]+)"/i)[1];
  const required = [
    'advkoujfgbrrjvqexrcu.supabase.co', // login + all data sync (connect-src)
    'cdn.jsdelivr.net',                 // supabase-js (script-src)
    'unpkg.com',                        // maplibre + topojson (script/style)
    'basemaps.cartocdn.com',            // wine map tiles — CARTO Voyager (img/connect)
    'www.youtube.com'                   // video embeds (frame-src)
  ];
  for (const o of required) assert(csp.includes(o), `CSP no longer allows ${o} — would break a feature`);
  // Las tipografías son propias desde v7.345: font-src no necesita terceros.
  assert(/font-src 'self';/.test(csp), "font-src debe ser 'self' — las fuentes se sirven del propio dominio");
  // The team chat needs the realtime WebSocket + storage images.
  assert(/wss:\/\/advkoujfgbrrjvqexrcu\.supabase\.co/.test(csp),
    'CSP connect-src must allow the Supabase realtime WebSocket (wss) for the chat');
  assert(/img-src[^;]*advkoujfgbrrjvqexrcu\.supabase\.co/.test(csp),
    'CSP img-src must allow Supabase storage so chat photos (and wine images) render');
});

test('Team chat: nav wired, realtime teardown, safe render, moderation', () => {
  // Nav button + route so the tab is reachable and renders.
  assert(/showTab\('chat'\)/.test(html) && html.includes('navChat'), 'chat nav entry missing');
  assert(/chat:renderChat/.test(html), 'chat route not registered in renderMap');
  assert(/function renderChat\(/.test(html), 'renderChat() missing');
  // Realtime must be torn down when leaving the tab (no socket/presence leak).
  assert(/currentTab==='chat' && tab!=='chat'/.test(html) && /function _chatDisconnect\(/.test(html),
    'chat realtime teardown on tab change missing');
  // User content must be escaped (no XSS via message/name/photo url).
  const rc = html.slice(html.indexOf('function _chatRenderStream'), html.indexOf('function _chatRenderStream') + 8000);
  assert(/_chatEsc\(m\.message\)/.test(rc) && /_chatEsc\(m\.image_url\)/.test(rc) && /_chatEsc\(m\.employee\)/.test(rc),
    'chat message/photo/author must be HTML-escaped');
  // Moderación: cada uno borra lo suyo; quien MANDA borra cualquiera. Iba por
  // nombre («Duvan» escrito en el código) y ahora por rol: con dos
  // restaurantes, el manager del otro no podía moderar su propio chat.
  assert(/m\.employee===currentUser \|\| _esMando\(\)/.test(html),
    'chat delete gate (author or supervisor) missing');
  assert(!/currentUser\s*===?\s*'Duvan'/.test(html),
    'no puede quedar ningún permiso atado al nombre del propietario');
  // Photos are downscaled client-side before upload (mobile bandwidth).
  assert(/function _chatDownscale\(/.test(html) && /\.toBlob\(/.test(html) && /'image\/webp'/.test(html),
    'chat photo downscale-to-webp missing');
});

test('Team chat: WhatsApp features (mentions, replies, reactions, typing)', () => {
  // @Mentions: autocomplete + parse + notify (in-app bell AND lock-screen push)
  assert(/function _chatMentionScan\(/.test(html) && /function _chatParseMentions\(/.test(html),
    'mention autocomplete/parse missing');
  const send = html.slice(html.indexOf('async function _chatSend'), html.indexOf('async function _chatSend') + 2200);
  assert(/te ha mencionado/.test(send) && /send-push/.test(send),
    'mentioned teammates must get in-app notification + push');
  // Mention highlighting must operate on ALREADY-ESCAPED text (no XSS door).
  assert(/_chatDecorateMentions\(_chatEsc\(m\.message\)/.test(html),
    'mention decoration must wrap the escaped message, never raw');
  // Replies: composer bar + reply_to persisted + quote block + tap-to-jump.
  assert(/function _chatStartReply\(/.test(html) && /fields\.reply_to = _chatReplyTo\.id/.test(html)
    && /chat-quote/.test(html) && /_chatScrollToMsg/.test(html), 'reply-quoting incomplete');
  // Reactions: toggle own name per emoji, optimistic PATCH, pills with count.
  assert(/function _chatReact\(/.test(html) && /chat-react-pill/.test(html),
    'emoji reactions missing');
  // Typing: broadcast (no DB writes) + throttle + expiry.
  assert(/event:'typing'/.test(html) && /_chatNotifyTyping/.test(html) && /_chatTypingSentAt < 2200/.test(html),
    'typing indicator must use throttled realtime broadcast');
  // New-message push: absent teammates only, sender/present/mentioned excluded,
  // rate-limited so a lively conversation can't machine-gun phones.
  const bp = html.slice(html.indexOf('function _chatBroadcastPush'), html.indexOf('function _chatBroadcastPush') + 1600);
  assert(/_chatPresence/.test(bp) && /mentioned/.test(bp) && /currentUser, \.\.\.present, \.\.\.mentioned/.test(bp),
    'chat broadcast push must exclude sender, present users and mentioned users');
  assert(/3\*60\*1000/.test(bp), 'chat broadcast push must be rate-limited (3 min gate)');
  assert(/_chatBroadcastPush\(body\)/.test(html), 'broadcast push must fire on successful insert');
  // The typing dots respect reduced motion.
  const css = read('styles.css');
  assert(/prefers-reduced-motion[^}]*\{[^}]*chat-typing-dots/s.test(css) || /chat-typing-dots i, \.chat-row\.sel/.test(css),
    'chat animations need a reduced-motion gate');
});

test('update push is silent (no vibration/sound) — quiet banner only', () => {
  // Petición del propietario: el aviso de actualización lo más discreto
  // posible. iOS obliga a mostrar un banner en todo push, pero podemos
  // callarlo: sin vibración, sin sonido, sin re-alerta para tag 'app-update'.
  const sw = read('sw.js');
  assert(/const _quiet = data\.tag === 'app-update'/.test(sw), 'update push must be flagged quiet');
  assert(/silent: _quiet/.test(sw), 'update push must set silent');
  assert(/vibrate: _quiet \? \[\]/.test(sw), 'update push must not vibrate');
  assert(/renotify: _quiet \? false/.test(sw), 'update push must not re-alert');
  assert(/tag:'app-update', renotify:false/.test(html), 'sender must not request renotify for updates');
  // los avisos de chat/menciones conservan su vibración (no rompimos eso)
  assert(/data\.renotify \? \[200, 100, 200, 100, 200\] : \[200, 100, 200\]/.test(sw),
    'chat/mention notifications must keep their vibration');
});

test('push notifications: raster icons, deep links, rich payload', () => {
  // Android renders an SVG notification icon as a generic grey circle — the
  // logo must be raster (icon-192.png) plus a white-on-transparent status-bar
  // badge (badge-96.png). Taps deep-link into the app (chat pushes land in
  // the chat tab), mentions re-alert through a coalesced tag, photo messages
  // show the picture itself. Deep link works even through the v2 send-push
  // fn (title/body/tag only): the SW infers data.tab from tag === 'chat'.
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  for (const f of ['icon-192.png', 'badge-96.png']) {
    assert(existsSync(join(ROOT, f)), `${f} missing`);
    assert(readFileSync(join(ROOT, f)).subarray(0, 4).equals(PNG), `${f} is not a PNG`);
  }
  const sw = read('sw.js');
  assert(sw.includes("'./icon-192.png'") && sw.includes("'./badge-96.png'"), 'SW must use raster icon + badge');
  assert(/icon-192\.png/.test(sw.match(/const SHELL_URLS = \[[^\]]*\]/)[0]), 'raster icons must be pre-cached in the shell');
  assert(/renotify: _quiet \? false : data\.renotify/.test(sw) && /options\.image = data\.image/.test(sw),
    'SW push handler must support renotify (chat) + big-picture image');
  assert(/data\.tag === 'chat'\) data\.data\.tab = 'chat'/.test(sw), 'chat tag must infer the deep link (v2 fn compatibility)');
  assert(/postMessage\(\{ type: 'openTab', tab \}\)/.test(sw), 'notification click must deep-link an open window');
  assert(sw.includes("'#tab=' + encodeURIComponent(tab)"), 'cold-start deep link (#tab= hash) missing from click handler');
  // Client side: SW message listener, boot hash consumption, post-login landing.
  assert(/type !== 'openTab'/.test(html) && /_pendingDeepTab/.test(html), 'client deep-link plumbing missing');
  assert(html.includes("icon: 'icon-192.png'"), 'in-page Notification must use the raster icon too');
  assert(/renotify:true, data:\{tab:'chat'\}/.test(html), 'mention push must renotify + deep-link to chat');
  assert(/extra\.image = body\.image_url/.test(html), 'photo chat pushes must attach the image');
  const manifest = JSON.parse(read('manifest.json'));
  assert(manifest.icons.some(i => i.src === 'icon-192.png' && i.type === 'image/png'), 'manifest missing the PNG icon');
});

test('wine map is real cartography (Voyager basemap, no fake 3D or DO shapes)', () => {
  // Basemap must be CARTO Voyager retina raster served untouched — no hue/
  // saturation filters that make real cartography look artificial.
  assert(html.includes('basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png'),
    'CARTO Voyager retina tiles missing from map init');
  assert(!/raster-hue-rotate|raster-saturation/.test(html),
    'raster color filters are back — the basemap should render untouched');
  // The old "3D terrain" pointed at a DEM endpoint that does not exist
  // (demotiles.maplibre.org/terrain-tiles) — it must stay removed.
  assert(!html.includes('demotiles.maplibre.org'), 'dead demotiles DEM endpoint is back in the map');
  assert(!/setTerrain\(/.test(html), 'fake 3D terrain is back in the wine map');
  // Hand-approximated DO rings must not render as filled areas over real
  // cartography: each DO is a precise centroid point + label instead.
  assert(html.includes("id: 'do-points', type: 'circle'"), 'do-points circle layer missing');
  assert(!html.includes("id: 'do-fill'"), 'hand-drawn DO polygon fill layer is back');
  assert(/function _mlDOCentroid\(/.test(html), '_mlDOCentroid centroid helper missing');
  // OSM/CARTO tile usage requires visible attribution on the map.
  assert(/new maplibregl\.AttributionControl\(\{ compact: true \}\)/.test(html),
    'map attribution control missing (required by OSM/CARTO tile terms)');
});

test('recorrido guiado: nada por debajo de 12 px ni fuera de contraste', () => {
  // Auditoría (sept 2026), medida sobre los píxeles pintados: 30 elementos por
  // debajo del mínimo de contraste y 32 por debajo de 12 px. El peor de los
  // dos: «■ Estructural — no apto para esta alergia» a 9,4 px y 3,25:1 — la
  // frase que decide si un plato se le puede servir a un alérgico.
  const css = read('styles.css');
  const rem = v => v.endsWith('rem') ? parseFloat(v) * 18 : parseFloat(v);
  const px = sel => {
    const b = (css.match(new RegExp('^\\' + sel + '\\{([^}]*)\\}', 'm')) || [])[1] || '';
    const m = b.match(/font-size:\s*([^;]+)/);
    return m ? rem(m[1].trim()) : null;
  };
  for (const sel of ['.dj-dot', '.dj-phase-label', '.dj-ing-al', '.dj-ing-count',
                     '.dj-allerg-info', '.dj-service-label', '.dj-mastery-label',
                     '.dj-qrv-ans', '.dj-next-cat', '.dj-next-label']) {
    const v = px(sel);
    assert(v !== null, `no encuentro el tamaño de ${sel}`);
    assert(v >= 12, `${sel} va a ${v.toFixed(1)} px: no se lee de pie y cansado`);
  }
  // Los dos veredictos de la fase de alérgenos van en estilo en línea.
  for (const m of html.matchAll(/font-size:\.(\d+)rem;color:#[0-9a-f]{6};background:rgba\((?:160,72,72|77,138,94)/g))
    assert(parseFloat('.' + m[1]) * 18 >= 12,
      `el veredicto de adaptación vuelve a ${(parseFloat('.' + m[1]) * 18).toFixed(1)} px`);
  // Y la comanda resaltada debe poder partirse: con white-space:nowrap las
  // largas («SIN HUEVO DE CODORNIZ, SIN YEMA Y SIN MAYONESA DE CÍTRICOS»)
  // sacaban la fase 110 px fuera de un móvil de 360.
  // Sin comentarios: el que explica el arreglo cita el nowrap que se retiró.
  const cmd = ((css.match(/^\.dj-comanda\{([^}]*)\}/m) || [])[1] || '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert(!/white-space:\s*nowrap/.test(cmd), 'la comanda con nowrap desborda la pantalla');
  assert(/overflow-wrap/.test(cmd), 'la comanda debe poder partirse en varias líneas');
});

test('reducir movimiento significa SIN movimiento, también sin retardo', () => {
  // Auditoría (sept 2026): la red global anulaba la duración pero NO el
  // retardo, así que «reducir movimiento» se convertía en «aparecer a saltos».
  // Medido en el recorrido: con la preferencia activada las fichas de Servicio
  // seguían desplazadas 60 px a la derecha —desbordando 38 px— hasta que
  // vencía su retardo escalonado, unos 0,7 s.
  const css = read('styles.css');
  const i = css.indexOf('@media (prefers-reduced-motion: reduce){');
  assert(i !== -1, 'falta la red global de movimiento reducido');
  const bloque = css.slice(i, css.indexOf('\n}', css.indexOf('{', i + 40)));
  for (const prop of ['animation-duration', 'animation-delay', 'transition-duration', 'transition-delay'])
    assert(new RegExp(prop + ':[^;]*!important').test(bloque),
      `la red de movimiento reducido no anula ${prop}: el contenido sigue moviéndose`);
});

test('ninguna ficha de plato tiene una clave repetida que se trague el contenido', () => {
  // El Rejo de pulpo tenía su historia escrita Y un segundo history:'' al final
  // del mismo objeto: en JavaScript gana el último, así que el capítulo I
  // llevaba quién sabe cuánto diciendo «No hay historia disponible» con el
  // texto delante. No se ve leyendo la ficha, solo midiendo.
  for (const lista of ['DISHES', 'DISHES_EN']) {
    const i = html.indexOf('const ' + lista + ' = ['), j = html.indexOf('\n];', i);
    const bloque = html.slice(i, j);
    for (const m of bloque.matchAll(/\{id:(\d+),[\s\S]*?\n/g)) {
      for (const k of ['id', 'cat', 'name', 'allergens', 'ingredients', 'history', 'notes']) {
        const n = (m[0].match(new RegExp('(?:^|[,{])' + k + ':', 'g')) || []).length;
        assert(n <= 1, `${lista}: el plato ${m[1]} repite la clave «${k}» ${n} veces — la última anula a la primera`);
      }
    }
  }
  // Y ninguna ficha se queda sin historia: es un capítulo entero del recorrido.
  const iD = html.indexOf('const DISHES = ['), jD = html.indexOf('\n];', iD);
  const DISHES = new Function(html.slice(iD, jD + 3) + '; return DISHES;')(); // eslint-disable-line no-new-func
  const sin = DISHES.filter(d => !d.history || !d.history.trim());
  assert(sin.length === 0,
    `platos sin historia (el capítulo I les dice «No hay historia disponible»): ${sin.map(d => d.id + ' ' + d.name).join(', ')}`);
});

test('la croqueta de boletus sale en las dos cartas, y cat2 no se cuela en la lógica', () => {
  // Confirmado por el propietario (sept 2026): la croqueta de boletus es
  // vegetariana Y entrante del menú normal. El campo cat2 la lista en las dos
  // cartas; para todo lo demás —quiz, detección de vegetariano, platos
  // hermanos— manda cat, que sigue siendo «Vegetariano».
  const iD = html.indexOf('const DISHES = ['), jD = html.indexOf('\n];', iD);
  const DISHES = new Function(html.slice(iD, jD + 3) + '; return DISHES;')(); // eslint-disable-line no-new-func
  const cats = new Set(DISHES.map(d => d.cat));
  const con2 = DISHES.filter(d => d.cat2);
  assert(con2.length >= 1, 'la croqueta de boletus debe llevar cat2');
  for (const d of con2) {
    assert(cats.has(d.cat2), `${d.id}: cat2 «${d.cat2}» no es una categoría real de la carta`);
    assert(d.cat2 !== d.cat, `${d.id}: cat2 repite la categoría principal`);
  }
  const bol = DISHES.find(d => d.id === 50);
  assert(bol && bol.cat === 'Vegetariano' && bol.cat2 === 'Entrantes',
    'la croqueta de boletus debe ser Vegetariano (principal) + Entrantes (segunda carta)');
  // cat2 SOLO puede usarse para listar. Si se colara en la lógica de quiz o de
  // platos hermanos, un plato vegetariano empezaría a comportarse como entrante.
  const usos = [...html.matchAll(/cat2/g)].length;
  assert(usos <= 3, `cat2 aparece ${usos} veces: solo debe declararse y usarse en el filtro de la lista`);
});

test('ningún plato de la carta vegetariana lleva pescado, carne ni marisco', () => {
  // Corrección del propietario (sept 2026): «el tartar de tomate y queso
  // stracciatella no es un plato vegetariano». Y era cierto por una razón que
  // salió el día antes: su aliño lleva Salsa Perrins, y la Perrins lleva
  // anchoas. Estaba en cat:'Vegetariano' declarando Pescado — el único de los
  // nueve. No es cosmético: hay un escenario que construye la respuesta
  // correcta con el primer plato de esa lista y se la ofrece a un huésped
  // vegano, así que la app podía enseñar a ofrecer un plato con anchoas.
  const iD = html.indexOf('const DISHES = ['), jD = html.indexOf('\n];', iD);
  const DISHES = new Function(html.slice(iD, jD + 3) + '; return DISHES;')(); // eslint-disable-line no-new-func
  const veg = DISHES.filter(d => d.cat === 'Vegetariano' || d.cat2 === 'Vegetariano');
  assert(veg.length >= 5, `esperaba una carta vegetariana con varios platos, hay ${veg.length}`);
  const PROHIBIDOS = ['Pescado', 'Crustáceos', 'Moluscos'];
  for (const d of veg)
    for (const a of PROHIBIDOS)
      assert(!(d.allergens || []).includes(a),
        `${d.id} «${d.name}» está en la carta vegetariana y declara ${a}`);
  // Y tampoco por el texto de sus ingredientes: un alérgeno puede no declararse
  // (la carne no es alérgeno) pero seguir siendo un producto animal.
  const CARNE = /\b(pollo|ternera|cerdo|jam[oó]n|chorizo|panceta|morcilla|wagyu|cecina|cordero|solomillo|at[uú]n|bacalao|pulpo|anchoa|boquer[oó]n|mero|langostino|gamba)\b/i;
  for (const d of veg)
    assert(!CARNE.test(d.ingredients || ''),
      `${d.id} «${d.name}» está en la carta vegetariana y sus ingredientes citan un producto animal`);
});

test('ningún plato con pescado se DESCRIBE como vegetariano, esté en la carta que esté', () => {
  // El mismo error que traen impresos los plating guides: la página 53 marca
  // como VEGANO un tartar con huevo, lácteos y anchoas. En la app el 15 ya no
  // estaba en la carta vegetariana, pero su historia seguía llamándolo «este
  // tartar vegetariano» («this vegetarian version» en inglés) declarando
  // Pescado. La categoría estaba corregida y la prosa no, que es la que lee
  // el camarero en el Viaje y en las preguntas de historia.
  //
  // Ojo con lo que NO es un fallo: decir que un plato PUEDE HACERSE
  // vegetariano quitando algo es correcto y accionable (la Niçoise sin atún,
  // los tomates ecológicos sin anchoas). Lo que no vale es afirmarlo del
  // plato tal como se sirve.
  const PESCADO = { es: ['Pescado', 'Crustáceos', 'Moluscos'], en: ['Fish', 'Crustaceans', 'Molluscs'] };
  const AFIRMA = [
    /\beste?\s+\w*\s*vegetarian[oa]\b/i,      // «este tartar vegetariano»
    /\bthis\s+\w*\s*vegetarian\b/i,           // «this vegetarian version»
    /\bes\s+(un|una)\s+plato\s+vegetarian/i,
    /\bis\s+(a\s+)?vegetarian\s+dish\b/i,
  ];
  for (const [lista, idioma] of [['DISHES', 'es'], ['DISHES_EN', 'en']]) {
    const i = html.indexOf(`const ${lista} = [`), j = html.indexOf('\n];', i);
    const arr = new Function(html.slice(i, j + 3) + `; return ${lista};`)(); // eslint-disable-line no-new-func
    for (const d of arr) {
      if (!PESCADO[idioma].some(a => (d.allergens || []).includes(a))) continue;
      const prosa = [d.history || '', d.notes || '', d.name || ''].join(' ');
      for (const re of AFIRMA)
        assert(!re.test(prosa),
          `${lista} ${d.id} «${d.name}» declara pescado y su texto lo llama vegetariano: ${(prosa.match(re) || [])[0]}`);
    }
  }
});

test('el recorrido en inglés no mezcla idiomas: cada ingrediente tiene su nombre', () => {
  // Auditoría (sept 2026): en el recorrido en inglés los nombres de
  // ingrediente salían en español —«Leche», «aderezo césar»— dentro de una
  // ficha en inglés. Se traducen en data/ingredients.json, que es la fuente
  // única: el nombre inglés vive donde vive el alérgeno y no se duplica.
  const base = JSON.parse(read('data/ingredients.json')).ingredientes;
  const nombres = Object.entries(base);
  assert(nombres.length > 400, `esperaba los ~465 ingredientes, hay ${nombres.length}`);
  const sin = nombres.filter(([, v]) => !v.nombre_en || !String(v.nombre_en).trim());
  assert(sin.length === 0,
    `${sin.length} ingredientes sin nombre en inglés: ${sin.slice(0, 5).map(x => x[0]).join(', ')}`);
  // En vez de adivinar por los acentos —«Comté», «crudité» y «purée» son
  // inglés culinario perfectamente correcto— se comprueban dos cosas concretas.
  // 1 · Los ingredientes que más salen en pantalla, traducidos de verdad.
  const ESPERADO = {
    'leche': 'Milk', 'harina': 'Flour', 'huevo': 'Egg', 'nata': 'Cream',
    'mantequilla': 'Butter', 'pepinillo': 'Gherkin', 'cebolla': 'Onion',
    'salsa perrins': 'Worcestershire sauce', 'aderezo cesar': 'Caesar dressing',
    'yema de huevo': 'Egg yolk', 'anchoas': 'Anchovies', 'papa': 'Potato',
    'vinagre de jerez': 'Sherry vinegar', 'queso de cabra': 'Goat cheese',
    'tostas de pan carasau': 'Carasau bread toasts'
  };
  for (const [k, en] of Object.entries(ESPERADO)) {
    assert(base[k], `falta el ingrediente «${k}» en la base`);
    assert(base[k].nombre_en === en,
      `«${k}» debería traducirse como «${en}» y pone «${base[k].nombre_en}»`);
  }
  // 2 · Y los nombres propios y de producto siguen SIN traducir, a propósito:
  //     inventarles un nombre inglés sería inventar algo que no existe en cocina.
  for (const k of ['gofio', 'ras al hanout', 'stracciatella', 'pedro ximenez', 'chistorra', 'tabasco'])
    assert(base[k] && base[k].nombre_en === base[k].nombre,
      `«${k}» es un nombre propio y no debe traducirse (pone «${base[k] && base[k].nombre_en}»)`);
  // Y el recorrido debe usarlas: si no, la traducción no llega a la pantalla.
  assert(/function _djIngName\(/.test(html) && /_djIngredients\(dish, _en\)/.test(html),
    'el recorrido no está usando los nombres en inglés de la base');
});

test('recorrido guiado: la ficha de servicio no corta ninguna comanda', () => {
  // Auditoría (sept 2026): el capítulo de Servicio cortaba la nota con
  // substring(0,200)+'...'. Medido: 69 fichas cortadas, 8.302 caracteres
  // ocultos, y en 30 de ellas se perdía AL MENOS UNA COMANDA de alérgeno. El
  // peor, el Entrecot de Angus: 0 de 1 visibles, y el corte caía en «la
  // mermelada NO...», que leído a medias dice lo contrario de lo que pone.
  // Instrucción del propietario: «no cortes información cuando es información
  // valiosa o importante».
  // Se busca por el código que cortaba, no por la frase: el comentario que
  // explica el arreglo cita el substring.
  assert(!/shortNotes/.test(html), 'vuelve el corte a 200 caracteres de la ficha de servicio');
  assert(/value:_djNotasHTML\(dd\.notes\)/.test(html),
    'la ficha de servicio debe dibujar la nota entera con _djNotasHTML');
  const fn = _xFn('_djNotasHTML');
  // escapeHtml es una dependencia de la función; se inyecta equivalente.
  const build = new Function('escapeHtml', fn + '; return _djNotasHTML;'); // eslint-disable-line no-new-func
  const notas = build(s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'));
  const quitar = t => t.replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
  const norm = t => t.replace(/[⚠·\s]+/g,'');

  const iD = html.indexOf('const DISHES = ['), jD = html.indexOf('\n];', iD);
  const DISHES = new Function(html.slice(iD, jD + 3) + '; return DISHES;')(); // eslint-disable-line no-new-func
  const iE = html.indexOf('const DISHES_EN = ['), jE = html.indexOf('\n];', iE);
  const EN = new Function(html.slice(iE, jE + 3) + '; return DISHES_EN;')(); // eslint-disable-line no-new-func
  const enById = new Map(EN.map(d => [d.id, d]));

  let fichas = 0, comandas = 0;
  for (const d of DISHES) {
    for (const dd of [d, enById.get(d.id)]) {
      if (!dd || !dd.notes) continue;
      fichas++;
      const out = notas(dd.notes);
      // 1 · NADA de la nota puede desaparecer.
      assert(norm(quitar(out)) === norm(dd.notes),
        `la ficha de servicio de ${d.id} pierde texto: la nota debe salir entera`);
      // 2 · Y la comanda queda resaltada, sin invadir la frase siguiente.
      for (const m of out.matchAll(/<b class="dj-comanda">([^<]*)<\/b>/g)) {
        comandas++;
        assert(!/[.;]/.test(m[1]), `el resaltado invade la frase siguiente: «${m[1]}»`);
      }
      if (/\b(Comandar|Order)\s+(SIN|WITHOUT)/.test(dd.notes))
        assert(/dj-comanda/.test(out), `la comanda de ${d.id} no queda resaltada`);
    }
  }
  assert(fichas > 150, `esperaba ~180 fichas con notas (ES+EN), medidas ${fichas}`);
  assert(comandas > 100, `esperaba >100 comandas resaltadas, medidas ${comandas}`);
});

test('recorrido guiado: las preguntas van de alérgenos e ingredientes y no se regalan', () => {
  // Reporte del propietario (sept 2026): «hay preguntas absurdas según los
  // usuarios», y el recorrido había que reforzarlo «sobre todo en alérgenos e
  // ingredientes». Medido sobre 102 platos × 10 tiradas (3.060 preguntas):
  //   · una de cada TRES era «¿a qué categoría pertenece este plato?», y en 25
  //     platos el nombre la regalaba («Croqueta de Jamón» → Entrantes);
  //   · el 5 % era «¿tiene este plato una historia asociada?», cuya respuesta
  //     es siempre «Sí» y cuyas otras opciones («Solo para VIP») no significan
  //     nada — relleno puro.
  // Ahora la categoría solo aparece cuando el plato no tiene ni componentes ni
  // matriz de adaptación, y entran dos preguntas de las que sí se hacen en la
  // mesa: de qué componente sale el alérgeno, y si el plato se adapta.
  // Se busca por sus opciones, que no existían en ninguna otra pregunta: la
  // frase del enunciado la cita el comentario que explica por qué se retiró.
  assert(!/'Solo para VIP'|'Only for VIP'|'Solo en cena'/.test(html),
    'vuelve la pregunta de relleno del storytelling (respuesta siempre «Sí»)');
  assert(/function _djQComponente\(/.test(html) && /function _djQAdaptar\(/.test(html),
    'faltan las preguntas de componente y de adaptación');
  // La categoría se retiró entera a petición del propietario: «son muy fáciles
  // y obvias». Lo eran — en 25 de los 102 platos el nombre daba la respuesta.
  // Los 14 platos que caían ahí no declaran NINGÚN alérgeno (guarniciones y
  // carnes a la brasa); ahora se les pregunta justo eso, y cuál se le puede
  // ofrecer a un alérgico — que es la habilidad que se usa en la mesa.
  // Se busca por el código que la construía, no por su enunciado: la frase la
  // cita el comentario que explica por qué se retiró.
  // Reporte del propietario (sept 2026): «también se están repitiendo
  // preguntas» — la Paletilla y el Jamón mostraban DOS veces seguidas la misma
  // «¿Se puede adaptar a Gluten?». Era un fallo del ensamblado: Q2 y Q3
  // llamaban cada una por su cuenta al mismo generador. Ahora salen de una
  // lista ordenada que no admite ni el mismo tipo ni el mismo enunciado.
  assert(/tipos\.has\(q\.tipo\) \|\| enunciados\.has\(q\.q\)/.test(html),
    'el ensamblado del cuestionario debe rechazar tipo y enunciado repetidos');
  for (const g of ['_djQComponente', '_djQIngredienteAusente', '_djQAdaptar',
                   '_djQCualSinAlergenos', '_djQCuantos', '_djQSinAlergenos']) {
    const i = html.indexOf('function ' + g + '(');
    assert(i !== -1, `falta ${g}`);
    const cuerpo = html.slice(i, html.indexOf('\nfunction ', i + 10));
    assert(/\btipo\s*:\s*'[a-z-]+'/.test(cuerpo), `${g} no etiqueta su tipo: no se puede evitar que se repita`);
  }
  const zonaQuiz = html.slice(html.indexOf('function _djDistractores'), html.indexOf('function _djShuffle'));
  assert(!/_djQCategoria/.test(html) && !/catLocal/.test(zonaQuiz),
    'vuelve la pregunta de categoría, que el propietario retiró por obvia');
  assert(/function _djQSinAlergenos\(/.test(html) && /function _djQCualSinAlergenos\(/.test(html),
    'faltan las dos preguntas de los platos sin alérgenos declarados');
  // Y el cuestionario no se rellena: si un plato solo da para dos preguntas
  // honestas, se quedan dos y el contador las sigue.
  assert(/_djState\.quizTotal = _djState\.quizQuestions\.length/.test(html),
    'el contador del test debe seguir al número real de preguntas');
  // El pool de distractores es el vocabulario de la casa: «Mariscos» y
  // «Sésamo» no existen en ninguna otra pantalla de la app.
  const pool = (html.match(/const allergenPool = \[([\s\S]*?)\];/) || [])[1] || '';
  const canon = new Set(JSON.parse(read('data/ingredients.json')).eu14.map(e => e.app));
  const usados = [...pool.matchAll(/'([^']+)'/g)].map(m => m[1]);
  assert(usados.length === 14, `el pool debe ser el canon UE-14, tiene ${usados.length}`);
  for (const a of usados) assert(canon.has(a), `«${a}» no es un alérgeno del vocabulario de la app`);
});

test('recorrido guiado: ningún ingrediente con alérgeno se pinta como seguro', () => {
  // Reporte del propietario (sept 2026): «algunos ingredientes no están
  // marcados como Alérgenos», con capturas de sala. Medido sobre los 102
  // platos con ficha, la fase llevaba 83 falsos NEGATIVOS — el peor, «aderezo
  // césar» de la Croqueta de Pollo, que aporta CINCO alérgenos y salía sin
  // aviso — y 10 falsos POSITIVOS absurdos: «Pimiento palmero» marcado como
  // PESCADO porque contiene «mero», y «Polvo de aceitunas» porque «aceitunas»
  // contiene «tuna». Causa: un mapa de trece palabras clave que buscaba
  // subcadenas, teniendo la app la base única de 460 ingredientes.
  // Este guard reconstruye la fase con SUS funciones y comprueba tres cosas.
  const src = html.slice(html.indexOf('let _djIngBase = null;'), html.indexOf('function _djPhaseIngredients'));
  const F = new Function(src + `
    return {n:_djNorm, split:_djSplitIngredients, same:_djSameThing,
            base:function(b){ _djIngBase = b; },
            ing:function(dish,COMP){ globalThis.DISH_COMPONENTS=COMP; return _djIngredients(dish); }};`)(); // eslint-disable-line no-new-func
  // Índice de la base única, montado igual que en la app.
  const crudo = JSON.parse(read('data/ingredients.json')).ingredientes;
  const idx = new Map();
  for (const [k, v] of Object.entries(crudo)) {
    for (const key of [v.nombre, k]) {
      const nk = F.n(key);
      if (nk && !idx.has(nk)) idx.set(nk, v.alergenos);
      if (/-/.test(key)) { const sk = nk.replace(/ /g, ''); if (sk && !idx.has(sk)) idx.set(sk, v.alergenos); }
    }
  }
  const BASE = { idx, claves: [...idx.keys()].sort((a, b) => b.length - a.length) };
  // El mapa de palabras clave no puede volver.
  assert(!/allergenIngredients\s*=/.test(html),
    'vuelve el mapa de palabras clave: marcaba «Pimiento palmero» como pescado');

  const iD = html.indexOf('const DISHES = ['), jD = html.indexOf('\n];', iD);
  const DISHES = new Function(html.slice(iD, jD + 3) + '; return DISHES;')(); // eslint-disable-line no-new-func
  const iC = html.indexOf('const DISH_COMPONENTS = {'), jC = html.indexOf('};', iC);
  const COMP = new Function(html.slice(iC, jC + 2) + '; return DISH_COMPONENTS;')(); // eslint-disable-line no-new-func

  let medidos = 0, fuera = [], ocultos = [];
  // Los dos modos: sin la base (primer arranque / sin red) y con ella.
  for (const conBase of [false, true]) {
   F.base(conBase ? BASE : null);
   medidos = 0;
   for (const d of DISHES) {
    if (!d.ingredients) continue;
    const declarados = new Set(d.allergens || []);
    const items = F.ing(d, COMP);
    medidos++;
    // 1 · Ningún componente validado puede quedar sin su aviso. Es la
    //     invariante de seguridad: DISH_COMPONENTS lo cierra el CI contra
    //     data/ingredients.json, así que si algo lleva alérgeno, se ve.
    for (const c of (COMP[d.id] || [])) {
      const visto = items.some(i => F.same(i.t, c.n) && (c.a || []).every(a => i.a.includes(a)));
      if (!visto) ocultos.push(`${d.id} ${d.name}: «${c.n}» (${(c.a || []).join('+')})`);
    }
    // 2 · Y nunca un alérgeno que el plato no declare: la ficha, el buscador y
    //     el recorrido tienen que decir lo mismo.
    for (const i of items) for (const a of i.a) if (!declarados.has(a)) fuera.push(`${conBase?'con base':'sin base'} ${d.id} «${i.t}» → ${a}`);
   }
  }
  assert(medidos > 90, `esperaba los ~102 platos con ficha, medidos ${medidos}`);
  assert(ocultos.length === 0,
    `componentes con alérgeno pintados como seguros (${ocultos.length}): ${ocultos.slice(0, 4).join(' · ')}`);
  assert(fuera.length === 0,
    `el recorrido enseña alérgenos que el plato no declara: ${fuera.slice(0, 4).join(' · ')}`);

  // 3 · Los casos concretos que reportó el propietario, uno por uno.
  const caso = (id, chip, esperado) => {
    const d = DISHES.find(x => x.id === id);
    const it = F.ing(d, COMP).find(i => F.n(i.t).includes(F.n(chip)));
    assert(it, `no encuentro «${chip}» en los ingredientes de ${id}`);
    if (esperado === null) assert(it.a.length === 0, `«${chip}» vuelve a marcarse sin motivo (${it.a.join('+')})`);
    else for (const a of esperado) assert(it.a.includes(a), `«${chip}» (plato ${id}) ya no avisa de ${a}`);
  };
  // Los sets salen de la ETIQUETA del bote que usa la casa (Lea & Perrins 2 L
  // de Heinz Foodservice, foto aportada por el propietario): «vinagre de malta
  // (cebada) … anchoas (pescado)». Dos alérgenos, cebada y pescado. Ni soja
  // —que el plating guide sí le atribuía— ni sulfitos. Los sulfitos del aliño
  // de los tartares vienen del pepinillo, confirmado por el propietario.
  caso(128, 'aderezo césar', ['Huevos', 'Lácteos', 'Mostaza', 'Pescado', 'Gluten']);
  caso(15, 'Salsa Perrins', ['Pescado', 'Gluten']);
  caso(15, 'Pepinillo', ['Sulfitos']);
  caso(15, 'Stracciatella', ['Lácteos']);
  caso(80, 'Burrata', ['Lácteos']);
  caso(80, 'Piñones', ['Frutos secos']);
  caso(5, 'Pimiento palmero', null);   // «pal-MERO-» no es pescado
  // Reporte del propietario, textual: «la salsa césar contiene anchoas y
  // debería tener alergia al pescado, y la salsa Perrins también tiene
  // pescado». La base ya lo decía y la carta ya lo declaraba: fallaba SOLO el
  // recorrido. Se fija en los seis platos donde aparecen las dos salsas.
  let salsas = 0;
  for (const d of DISHES) {
    for (const c of (COMP[d.id] || [])) {
      if (!/aderezo c[eé]sar|salsa perrins/i.test(c.n)) continue;
      salsas++;
      assert(c.a.includes('Pescado'), `«${c.n}» (plato ${d.id}) ha perdido el Pescado de las anchoas`);
      assert(c.a.includes('Gluten'), `«${c.n}» (plato ${d.id}) ha perdido el Gluten del vinagre de malta`);
      assert(!c.a.includes('Soja'), `«${c.n}» (plato ${d.id}) vuelve a declarar Soja: la etiqueta del bote no la lleva`);
      const it = F.ing(d, COMP).find(i => F.n(i.t).includes(F.n(c.n)));
      assert(it && it.a.includes('Pescado'),
        `${d.id} «${c.n}» vuelve a pintarse sin el aviso de Pescado`);
    }
  }
  assert(salsas >= 6, `esperaba las 6 apariciones de césar/Perrins, encontradas ${salsas}`);
  caso(15, 'Polvo de aceitunas', null); // «acei-TUNA-s» no es atún
  F.base(BASE);
  caso(125, 'alioli de tinta', ['Huevos']); // la base lo tiene como «Ali-oli»
  // Y los rótulos de sección ya no se pegan al ingrediente.
  const chips = F.split('Masa: Leche, Harina. Topping: loncha de jamón.');
  assert(chips.includes('Leche') && !chips.some(c => /^Masa/.test(c)),
    `el rótulo de sección vuelve pegado al ingrediente: ${JSON.stringify(chips)}`);
});

test('ingredient-allergen base: valid schema + no NEW undeclared allergens', () => {
  // data/ingredients.json is the single source of truth for ingredient →
  // allergen tags (EU-14, app vocabulary). The audit (tests/allergen-audit.mjs)
  // cross-checks it against every dish's hand-written allergen list.
  const base = JSON.parse(read('data/ingredients.json'));
  assert(Array.isArray(base.eu14) && base.eu14.length === 14, 'eu14 canon must have exactly 14 entries');
  const canon = new Set(base.eu14.map(e => e.app));
  for (const [key, e] of Object.entries(base.ingredientes)) {
    assert(Array.isArray(e.alergenos) && e.alergenos.every(a => canon.has(a)),
      `ingredient "${key}" carries a tag outside the EU-14 canon`);
    assert(['certeza culinaria', 'notas del plato', 'deducido de la carta', 'propuesta', 'pendiente', 'confirmado por propietario'].includes(e.fuente),
      `ingredient "${key}" has invalid fuente`);
  }
  // PHASE-3 LOCK (partial): declared === computed, both directions.
  // Direction 1 at ZERO tolerance: any dish whose tagged ingredients imply
  // an allergen it does not declare fails CI immediately.
  const audit = JSON.parse(execSync('node tests/allergen-audit.mjs --json', { cwd: ROOT }).toString());
  for (const f of audit.no_declarado) {
    assert(false,
      `UNDECLARED allergen: dish ${f.id} "${f.plato}" is missing ${f.alergeno} (from: ${f.por.join(', ')})`);
  }
  // Direction 2 at ZERO: every declared allergen has a component origin.
  // The kitchen (Mónica, Jul 2026) resolved the final 14 gaps — vinegars in
  // mojo/citrus mayo, wine in fillings and mushroom sauce, the demi butter
  // (removable!), the tocinillo crisps, the sea bass added to its own list,
  // and three over-declarations removed (oysters are MOLLUSCS not
  // crustaceans; pisto and bao carry no sulphites). Declared ≡ computed is
  // now total, both directions, no exceptions.
  for (const f of audit.sin_origen) {
    assert(false,
      `ORPHAN declaration: dish ${f.id} "${f.plato}" declares ${f.alergeno} but no tagged ingredient explains it`);
  }
});

test('DISH_ACTIONS matrix: full coverage, comandas present, Trifasi fix locked', () => {
  // FASE 3b: retirability is DATA (DISH_ACTIONS), not prose parsing. Lock:
  // every declared allergen of every dish has a matrix entry; every removable
  // has its comanda; consumers read the matrix first; and the one intentional
  // divergence from the old prose parser (Trifasi Huevos = structural, the
  // veg-shortcut bug) stays fixed.
  const iM = html.indexOf('const DISH_ACTIONS = {');
  assert(iM !== -1, 'DISH_ACTIONS matrix missing');
  const jM = html.indexOf('};', iM);
  const M = JSON.parse(html.slice(iM + 'const DISH_ACTIONS = '.length, jM + 1));
  const iEs = html.indexOf('const DISHES = ['), jEs = html.indexOf('\n];', iEs);
  const dishBlock = html.slice(iEs, jEs);
  let pairs = 0, removables = 0;
  for (const m of dishBlock.matchAll(/\{id:(\d+),cat:'[^']*',name:'((?:[^'\\]|\\.)*)',allergens:\[([^\]]*)\]/g)) {
    const id = m[1], name = m[2];
    const allergens = [...m[3].matchAll(/'([^']+)'/g)].map(x => x[1]);
    assert(M[id], `dish ${id} "${name}" has no DISH_ACTIONS entry`);
    for (const a of allergens) {
      pairs++;
      const e = M[id][a];
      assert(e && (e.r === 0 || e.r === 1), `dish ${id} "${name}": allergen ${a} missing from matrix`);
      if (e.r === 1) { removables++; assert(e.c, `dish ${id} "${name}": removable ${a} has no comanda`); }
    }
  }
  // Medido tras fusionar el 49 en el 15 (260 pares) y tras eliminar los dos
  // Ben & Jerry's (254 pares, sep 2026). Los seis pares que faltan son los del
  // 103 y el 119, platos retirados de la carta; los 63 adaptables no se mueven
  // porque ninguno de los dos tenía comanda. No se ha perdido cobertura: todos
  // los pares que quedan siguen teniendo entrada en la matriz, que es lo que
  // este guard protege de verdad.
  assert(pairs >= 249 && removables >= 60, `matrix coverage shrank (pairs=${pairs}, removables=${removables})`);
  assert(M['89'] && M['89']['Huevos'] && M['89']['Huevos'].r === 0,
    'Trifasi Huevos must stay STRUCTURAL (veg version keeps the fried egg; brioche egg is structural)');
  // Vitello tonnato (owner, jul 2026): la salsa tonnata es ingrediente
  // principal — retirarla desarma el plato. Pescado/Huevos/Sulfitos NUNCA
  // vuelven a ser adaptables aquí; solo el brioche (Gluten) se retira.
  for (const a of ['Pescado', 'Huevos', 'Sulfitos']) {
    assert(M['8'] && M['8'][a] && M['8'][a].r === 0, `Vitello ${a} must stay STRUCTURAL (tonnato is core)`);
  }
  assert(M['8']['Gluten'] && M['8']['Gluten'].r === 1, 'Vitello Gluten (brioche) must stay removable');
  // Consumers must consult the matrix before the prose parser.
  const nr = html.slice(html.indexOf('function _simNonRemovableAllergens'), html.indexOf('function _simNonRemovableAllergens') + 1200);
  assert(/DISH_ACTIONS\[dish\.id\]/.test(nr), '_simNonRemovableAllergens must read DISH_ACTIONS first');
  const drill = html.slice(html.indexOf('function buildAllergenQuestions'), html.indexOf('function startAllergenTest'));
  assert(/DISH_ACTIONS\[dish\.id\]/.test(drill), 'allergen drill comanda must read DISH_ACTIONS first');
});

test('dish detail + immersive journey read verdicts from DISH_ACTIONS', () => {
  // The service-facing surfaces must show the MATRIX verdict (adaptable with
  // its exact comanda / structural), never the old word-sniffing heuristic
  // ("Posiblemente eliminable bajo petición" guessed from notes keywords).
  const detail = html.slice(html.indexOf('function renderRepasoDishDetail'), html.indexOf('function changeRepasoTopic'));
  assert(/DISH_ACTIONS\[dish\.id\]/.test(detail), 'dish detail panel must read DISH_ACTIONS');
  assert(/SE ADAPTA/.test(detail) && /ESTRUCTURAL/.test(detail), 'dish detail must show both verdicts');
  const dj = html.slice(html.indexOf('function _djPhaseAllergens'), html.indexOf('function _djPhaseAllergens') + 7000);
  assert(/DISH_ACTIONS\[dish\.id\]/.test(dj), 'immersive journey allergen cards must read DISH_ACTIONS');
  assert(!/Posiblemente eliminable bajo petición/.test(html), 'heuristic "maybe removable" chip must stay retired');
});

test('DISH_COMPONENTS: dish allergens derive exactly from components, zero drift vs base', () => {
  // FASE 4: cada plato = lista de componentes y sus alérgenos se CALCULAN
  // como la unión de los de sus componentes — la declaración manual queda
  // como espejo verificado, no como fuente editable. Tres candados:
  //   1. unión(componentes) == allergens declarados, EXACTA, por plato;
  //   2. cada componente existe en data/ingredients.json con el MISMO set
  //      de alérgenos (la base única sigue siendo la única fuente);
  //   3. el rol m=1 (modificable) coincide con DISH_ACTIONS (r=1 en todos
  //      sus alérgenos), y la ficha de plato muestra la procedencia.
  const iC = html.indexOf('const DISH_COMPONENTS = {');
  assert(iC !== -1, 'DISH_COMPONENTS missing');
  const jC = html.indexOf('};', iC);
  const C = new Function(html.slice(iC, jC + 2) + '; return DISH_COMPONENTS;')(); // eslint-disable-line no-new-func
  const iM = html.indexOf('const DISH_ACTIONS = {');
  const M = JSON.parse(html.slice(iM + 'const DISH_ACTIONS = '.length, html.indexOf('};', iM) + 1));
  const base = JSON.parse(read('data/ingredients.json')).ingredientes;
  const byName = {};
  for (const e of Object.values(base)) byName[e.nombre] = e.alergenos;
  // Pseudo-components (multi-variant dishes): allergens that depend on the
  // chosen variant — real provenance, but no single base ingredient and no
  // per-comanda role, so locks 2 and 3 don't apply to them.
  const PSEUDO = new Set(['Base de todas las variantes', 'Según la variante elegida']);
  const iEs = html.indexOf('const DISHES = ['), jEs = html.indexOf('\n];', iEs);
  let checked = 0, modeled = 0;
  for (const m of html.slice(iEs, jEs).matchAll(/\{id:(\d+),cat:'[^']*',name:'((?:[^'\\]|\\.)*)',allergens:\[([^\]]*)\]/g)) {
    const id = m[1], name = m[2];
    const declared = [...m[3].matchAll(/'([^']+)'/g)].map(x => x[1]).sort();
    checked++;
    if (!declared.length) continue;
    const comps = C[id];
    assert(comps && comps.length, `dish ${id} "${name}" declares allergens but has no components`);
    modeled++;
    const union = [...new Set(comps.flatMap(c => c.a))].sort();
    assert(JSON.stringify(union) === JSON.stringify(declared),
      `dish ${id} "${name}": derived [${union}] != declared [${declared}]`);
    for (const c of comps) {
      if (PSEUDO.has(c.n)) continue;
      assert(byName[c.n], `dish ${id}: component "${c.n}" not in ingredient base`);
      assert(JSON.stringify([...c.a].sort()) === JSON.stringify([...byName[c.n]].sort()),
        `dish ${id}: component "${c.n}" allergens drifted from base`);
      const allRemovable = c.a.every(a => M[id] && M[id][a] && M[id][a].r === 1);
      assert((c.m === 1) === allRemovable,
        `dish ${id}: component "${c.n}" role m=${c.m} contradicts DISH_ACTIONS`);
    }
  }
  assert(checked >= 85 && modeled >= 75, `coverage shrank (dishes=${checked}, modeled=${modeled})`);
  // Runtime derivation + service-facing provenance in the dish card.
  assert(/function computeDishAllergens/.test(html), 'computeDishAllergens helper missing');
  const detail = html.slice(html.indexOf('function renderRepasoDishDetail'), html.indexOf('function changeRepasoTopic'));
  assert(/DISH_COMPONENTS\[dish\.id\]/.test(detail), 'dish detail must read DISH_COMPONENTS for provenance');
  assert(/'From':'Por'/.test(detail), 'allergen provenance line missing from dish detail');
});

test('repaso inteligente: nota de la casa en vez de briefing de terminal', () => {
  // Rediseño jul 2026 (propietario + su novia: «rompe la estética»): fuera
  // el briefing tecleado de terminal; dentro una nota elegante en serif que
  // explica qué es la sesión, presente en ambos idiomas.
  const sr = html.slice(html.indexOf("c.innerHTML = `\n    <div class=\"ri-console\">"), html.indexOf('function _startSmartSession'));
  assert(/class="ri-brief"/.test(sr), 'la nota de la casa falta en la consola');
  assert(/estás a punto de olvidar/.test(sr) && /about to forget/.test(sr),
    'la nota debe explicar la repetición espaciada en ambos idiomas');
  assert(!/riBriefText/.test(sr) && !/_srBriefTyped/.test(html),
    'el efecto de tecleo de terminal debe quedar retirado');
  const css = read('styles.css');
  // La serif de la casa es Cormorant Garamond (DESIGN_SYSTEM §3). Georgia solo
  // vale como respaldo: era la única pantalla de la app que la usaba de
  // primaria.
  const brf = (css.match(/\.ri-brief\{[^}]*\}/) || [''])[0];
  assert(/\.ri-brief\{/.test(css) && /'Cormorant Garamond'/.test(brf),
    'la nota va en la serif de la casa (Cormorant Garamond), no en Georgia ni en monoespaciada');
  assert(!/monospace/.test(brf), 'la nota no puede volver a la monoespaciada de terminal');
});

test('supervisor panel: realtime employees channel + silent refresh + live pill', () => {
  // Reporte del propietario: el panel cargaba de la nube UNA vez y quedaba
  // congelado. Ahora: canal realtime sobre employees (tabla añadida a la
  // publicación supabase_realtime), refresco silencioso con debounce, sondeo
  // de respaldo, desconexión al salir, y el refresco NUNCA saca al
  // supervisor de una subpantalla (guard por presencia de supLivePill).
  assert(/function _supConnectLive/.test(html) && /table:'employees'/.test(html),
    'realtime subscription to employees missing');
  assert(/function _supDisconnect/.test(html), '_supDisconnect missing');
  const q = html.slice(html.indexOf('function _supQueueRefresh'), html.indexOf('function _supQueueRefresh') + 900);
  assert(/supLivePill/.test(q) && /renderSupDashboard\(true\)/.test(q) && /4000/.test(q),
    'silent refresh must be debounced and gated on the dashboard view');
  assert(/function renderSupDashboard\(silent\)/.test(html), 'renderSupDashboard must accept silent mode');
  assert(/currentTab==='supervisor' && tab!=='supervisor'/.test(html), 'showTab must tear down the supervisor channel');
  assert(/currentTab==='supervisor'\) _supDisconnect\(\)/.test(html.replace(/typeof _supDisconnect==='function'\) _supDisconnect/g, "currentTab==='supervisor') _supDisconnect")) || /pagehide/.test(html),
    'pagehide must drop the supervisor channel');
  assert(/id="supLivePill"/.test(html) && /_supStampLive/.test(html), 'live pill + timestamp missing');
  const css = read('styles.css');
  assert(/\.sup-live-dot\{/.test(css) && /prefers-reduced-motion:reduce\)\{\.sup-live-dot\{animation:none\}/.test(css.replace(/\s+/g, '')),
    'live dot pulse must respect reduced motion');
  assert(/\.sup-emp-card\{background:transparent/.test(css), 'employee cards must be de-boxed (ledger rows)');

  // Reorganización (petición del propietario: "hay que deslizar mucho"):
  // 4 secciones con pestañas y fichas de empleado PLEGADAS (details/summary).
  // El estado (sección activa + fichas abiertas) sobrevive al refresco EN VIVO.
  assert(/class="sup-seg"/.test(html) && (html.match(/_supSetSection\('/g) || []).length >= 3,
    'segmented control missing');
  // Auditoría jul 2026: la pestaña Análisis abre DIRECTAMENTE la pantalla
  // Analítica (había dos «análisis» con casi el mismo nombre).
  assert(/data-sec="analisis" onclick="_supTool\('analitica'\)"/.test(html),
    'la pestaña Análisis debe abrir la pantalla Analítica (puerta única)');
  for (const sec of ['hoy', 'equipo', 'analisis', 'acciones']) {
    assert(html.includes(`data-sec="${sec}"`), `section ${sec} missing`);
  }
  assert(/<details class="sup-emp-card"/.test(html) && /<summary class="sup-emp-header">/.test(html),
    'employee cards must be collapsible details/summary');
  assert(/_supOpenEmps/.test(html) && /_supApplySection\(\)/.test(html),
    'section + open-cards state must survive silent refreshes');
  const css2 = read('styles.css');
  assert(/\.sup-sec\{display:none\}/.test(css2) && /\.sup-seg button\.active/.test(css2),
    'section visibility CSS missing');

  // iOS se comía los toques: el refresco EN VIVO reemplazaba el DOM cada ~4 s
  // con el equipo activo, destruyendo el botón bajo el dedo. Tres candados:
  // hash (sin cambios → solo sello), guard de toque (<1.2 s → esperar) y
  // herramientas envueltas con toast de error.
  assert(/window\._supLastHash === _hash/.test(html), 'silent refresh must skip re-render when data is unchanged');
  assert(/window\._supLastTouch\|\|0\) < 1200/.test(html), 'refresh must yield to a recent touch');
  // 5 herramientas envueltas: carta, analítica, aviso, fotos, stats LQA.
  // (La antigua "Stats Protocolo" se retiró al fusionar Protocolo→LQA; el
  // quiz en vivo se retiró en jul 2026 — lo sustituye el Quiz del Día.)
  assert(/function _supTool/.test(html) && (html.match(/_supTool\('/g) || []).length >= 5,
    'supervisor tools must go through the error-surfacing wrapper');
  assert(/function renderSupLqaStats/.test(html),
    'the LQA Stats supervisor view (renderSupLqaStats) must be defined');
  assert(!/renderSupProtocolStats/.test(html),
    'dead renderSupProtocolStats reference must not linger (Protocolo was removed)');
  // Analítica enriquecida (jul 2026): dónde y cuánto falla el equipo por tema,
  // rendimiento por empleado (peor primero) y la categoría LQA más floja de
  // cada persona.
  const ana = html.slice(html.indexOf('function renderSupAnalytics'), html.indexOf('function renderSupLqaStats'));
  assert(/const topicAgg = \{\}/.test(ana) && /topicScores\|\|\{\}\)\.forEach/.test(ana),
    'la analítica debe agregar topicScores por tema');
  assert(/Dónde falla el equipo — por tema/.test(ana) && /Where the team fails — by topic/.test(ana),
    'debe existir la sección «Dónde falla el equipo» (ES+EN)');
  assert(/const perEmp = empNames\.map/.test(ana) && /Rendimiento por empleado/.test(ana),
    'debe existir el rendimiento por empleado');
  assert(/wrong':'fallos'/.test(ana), 'la analítica debe mostrar el número de fallos');
  const lqaFn = html.slice(html.indexOf('function renderSupLqaStats'), html.indexOf('function renderSupNotifSender'));
  assert(/const empWeakCat=\(e\)=>/.test(lqaFn) && /empWeakCat\(r\.e\)/.test(lqaFn),
    'la vista LQA debe mostrar la categoría más floja de cada empleado');
  // Analítica profunda de exámenes, platos y alérgenos (jul 2026).
  assert(/const allergenRows = empNames\.map/.test(ana) && /Alérgenos — seguridad/.test(ana) && /allergenBest/.test(ana),
    'debe existir la seguridad de alérgenos por empleado');
  assert(/const examCatAgg=\{\}/.test(ana) && /Exámenes — resumen del equipo/.test(ana) && /Precisión por categoría de carta/.test(ana),
    'debe existir el resumen de exámenes y la precisión por categoría de carta');
  assert(/const dishTeamCorrect=\{\}/.test(ana) && /const neverRight = DISHES\.filter/.test(ana) && /sin ningún acierto del equipo/.test(ana),
    'debe existir el punto ciego de platos sin aciertos');
  // La agregación por tema solo debe contar temas VIGENTES (allergens/
  // ingredients/history). Temas retirados que quedan en datos viejos (p. ej.
  // "cutlery") no deben aparecer en «Dónde falla el equipo» ni en «más flojo».
  assert((ana.match(/if\(!_TL\[k\]\) return;/g)||[]).length >= 2,
    'topicAgg y perEmp deben ignorar los temas fuera de _TL (excluye "cutlery")');
  // «Platos con más fallo»: ordenar por tasa de fallo REAL (intentos por
  // plato), no por dominado auto-marcado (petición del propietario jul 2026).
  assert(/const dishSeen = \{\}, dishCorr = \{\};/.test(ana) && /allEmps\[n\]\.examSeen\|\|\{\}/.test(ana),
    'la analítica debe sumar intentos por plato (examSeen) para la tasa de fallo');
  assert(/const corr = Math\.min\(dishCorr\[d\.id\]\|\|0, seen\)/.test(ana),
    'los aciertos deben caparse a los intentos (examCorrect no puede exceder intentos)');
  assert(/fail: seen \? Math\.round\(\(seen-corr\)\/seen\*100\) : null/.test(ana),
    'la tasa de fallo = (intentos-aciertos)/intentos');
  assert(/const byFail = failData\.length > 0;/.test(ana) && /failData\.sort\(\(a,b\) => \(b\.fail-a\.fail\)/.test(ana),
    'debe ordenar por fallo desc cuando hay datos, con respaldo a menos-dominado');
  assert(/Platos con más fallo \(examen\)/.test(ana) && /Dishes with the highest fail rate/.test(ana),
    'el título debe reflejar el modo tasa de fallo (ES+EN)');
  // Los intentos se registran en el examen y se sincronizan por extras.es
  assert(/emp\.examSeen\[q\.dish\.id\]=\(emp\.examSeen\[q\.dish\.id\]\|\|0\)\+1;/.test(html),
    'el examen debe contar intentos por plato (aciertos y fallos)');
  assert(/es: emp\.examSeen\|\|\{\}/.test(html) && /emp\.examSeen\[id\]=Math\.max\(emp\.examSeen\[id\]\|\|0, x\.es\[id\]\|\|0\)/.test(html),
    'examSeen debe sincronizarse por extras (compose + merge por máximo)');
  assert(/examSeen: \(\(\) => \{ try \{ const x=JSON\.parse\(r\.extras\|\|'\{\}'\);/.test(html),
    'el fetch del supervisor debe exponer examSeen desde extras.es');
  // Ficha individual del empleado (jul 2026): tocar un nombre abre su perfil.
  assert(/function renderSupEmployee\(name\)/.test(html), 'debe existir renderSupEmployee');
  const emp = html.slice(html.indexOf('function renderSupEmployee(name)'), html.indexOf('function renderSupNotifSender'));
  assert(/Perfil de desarrollo de \$\{escapeHTML\(_dispName\(name\)\)\}/.test(emp),
    'la ficha se titula con el nombre VISIBLE de la persona, no con una etiqueta genérica');
  assert(/Alérgenos \(seguridad\)/.test(emp) && /Preparación LQA/.test(emp) && /a repasar/.test(emp),
    'la ficha debe reunir alérgenos, LQA y platos a repasar');
  // el nombre en la cabecera oscura debe ir en claro (no var(--parchment) invisible)
  assert(/font-family:'Cinzel',serif;font-size:1\.15rem;color:var\(--ink\)">\$\{escapeHTML\(name\)\}/.test(emp),
    'el nombre en la cabecera oscura debe ir en color claro');
  // los nombres en la analítica y el ranking LQA deben abrir la ficha
  assert((html.match(/onclick="renderSupEmployee\(this\.dataset\.emp\)"/g) || []).length >= 3,
    'los nombres deben ser tocables (analítica + alérgenos + ranking LQA)');
});

test('auditoría panel supervisor (jul 2026): datos reales, push, LQA, a11y, marca', () => {
  // ── Push: auth + marca Meseo (antes sin apikey → 401 silencioso; título TXOKO) ──
  assert(!/TXOKO Formación/.test(html), 'los títulos de push no deben usar la marca vieja «TXOKO Formación»');
  const pushIdx = [...html.matchAll(/functions\/v1\/send-push/g)].map(m => m.index);
  assert(pushIdx.length >= 2 && pushIdx.every(i => {
    const seg = html.slice(i, i + 180);
    return /'apikey':\s*SUPA_KEY/.test(seg) && /Authorization/.test(seg);
  }), 'las llamadas a send-push deben mandar apikey + Authorization como el resto');
  assert(/title:'📲 Meseo · v'/.test(html) && /title: `\$\{typeIcons\[type\]\|\|'◆'\} Meseo`/.test(html),
    'los push deben titularse Meseo');
  // ── Sincronización de datos que el supervisor necesita ──
  assert(/ab: emp\.allergenBest\|\|0/.test(html) && /emp\.allergenBest=Math\.max\(emp\.allergenBest\|\|0, x\.ab\|\|0\)/.test(html),
    'allergenBest debe sincronizarse por extras (compose + merge por máximo)');
  assert(/allergenBest: \(\(\) => \{ try \{ const x=JSON\.parse\(r\.extras/.test(html),
    'el fetch del supervisor debe exponer allergenBest');
  assert(/avatar: r\.avatar \|\| null,/.test(html), 'el fetch del supervisor debe mapear el avatar (antes se descartaba)');
  assert(/const emp = \(window\._supAllEmps && window\._supAllEmps\[name\]\) \|\| getEmp\(name\);/.test(html),
    'renderSmallAvatar debe priorizar _supAllEmps para el equipo remoto');
  // ── Analytics: semana cronológica real + contador de exámenes sin rellenos ──
  const ana = html.slice(html.indexOf('function renderSupAnalytics'), html.indexOf('function renderSupLqaStats'));
  assert(/const _weekKey = ts =>/.test(ana) && /d\.setDate\(d\.getDate\(\)-day\)/.test(ana),
    'la gráfica semanal debe agrupar por el lunes de la semana (no por semana del mes)');
  assert(/const _realSess = s => s && \(s\.ts \|\| s\.total\)/.test(ana) && /\.filter\(_realSess\)\.length/.test(ana),
    'el total de exámenes debe excluir las sesiones de relleno vacías');
  // ── Heatmap: solo datos sincronizados (sin fcHistory local) ──
  const heat = html.slice(html.indexOf('function renderSupActivityHeatmap'), html.indexOf('function renderSupActivityHeatmap')+900);
  assert(!/\.fcHistory/.test(heat), 'el heatmap no debe contar fcHistory (local, no sincronizado)');
  // ── LQA: un solo umbral (hero+ranking) y estado sin datos ──
  const lqa = html.slice(html.indexOf('function renderSupLqaStats'), html.indexOf('function renderSupEmployee'));
  assert(/const _lqaCut = s => s>=75\?'ok':s>=55\?'mid':'low';/.test(lqa),
    'los umbrales LQA deben venir de una única fuente (75/55)');
  assert(!/r\.score>=80\?'#4d8a5e':r\.score>=60/.test(lqa), 'el ranking LQA no debe usar los umbrales viejos 80/60');
  assert(/_hasReady\?teamReadyAvg\+'%':'—'/.test(lqa), 'el hero LQA debe mostrar «—» cuando no hay datos, no 0% rojo');
  // ── Borrado: nube primero, ilike, comprueba respuesta ──
  const del = html.slice(html.indexOf('function supDeleteExecute'), html.indexOf('function supDeleteExecute')+900);
  assert(/name=ilike\./.test(del) && /cloudOk = res\.ok/.test(del) && /if \(cloudOk\)/.test(del),
    'el borrado debe ir a la nube primero con ilike y comprobar la respuesta');
  // ── El widget de reto ya no vive en el panel de supervisor ──
  const dash = html.slice(html.indexOf('function renderSupDashboard'), html.indexOf('function renderSupDeleteEmployee'));
  assert(!/renderWeeklyChallenge\(\)/.test(dash), 'el widget de reto semanal (de empleado) no debe estar en el panel de supervisor');
  // ── i18n: sin literales fijos ──
  assert(/history:LANG==='en'\?'Story':'Historia'/.test(html), 'la etiqueta de tema Historia debe estar traducida');
});

test('panel supervisor Fase 2: objetivos táctiles ≥44px y roles de pestaña', () => {
  const css = read('styles.css');
  // Las pestañas de sección deben respetar el objetivo táctil de 44px.
  assert(/\.sup-seg button\{[^}]*min-height:44px/.test(css), 'las pestañas de sección deben ser ≥44px');
  // El botón «Resetear PIN» ya no depende de hover (invisible en móvil) y es ≥44px.
  assert(/\.sup-pin-reset\{[^}]*min-height:44px/.test(css) && /\.sup-pin-reset\{[^}]*border:1px solid var\(--gold-a\)/.test(css),
    'el botón Resetear PIN debe tener afordancia visible y objetivo táctil ≥44px');
  const resetBtn = html.slice(html.indexOf('class="sup-pin-reset"')-10, html.indexOf('RESETEAR PIN'));
  assert(/class="sup-pin-reset"/.test(resetBtn) && !/onmouseover/.test(resetBtn),
    'el botón Resetear PIN debe usar la clase, sin onmouseover inline');
  // Semántica de pestañas: role=tab + aria-selected + tabpanel.
  assert(/<button role="tab" aria-selected="false" data-sec="hoy"/.test(html),
    'las pestañas de sección deben declarar role=tab y aria-selected');
  assert(/b\.setAttribute\('aria-selected', on \? 'true' : 'false'\)/.test(html),
    'aria-selected debe sincronizarse con la pestaña activa');
  assert((html.match(/class="sup-sec" role="tabpanel"/g)||[]).length >= 3,
    'los paneles de sección deben ser role=tabpanel');
});

test('panel supervisor Fase 2b: cabecera de KPIs con impacto', () => {
  const css = read('styles.css');
  assert(/\.sup-kpis\{[^}]*grid-template-columns:1fr 1fr/.test(css), 'debe existir la rejilla .sup-kpis (2 columnas)');
  assert(/\.sup-kpi\.good\{--kpi-accent:var\(--sage\)\}/.test(css) && /\.sup-kpi\.bad\{--kpi-accent:var\(--rose\)\}/.test(css),
    'las KPIs deben tener color semántico (good/warn/bad/info) por variable');
  const band = html.slice(html.indexOf('function _supKpiBand'), html.indexOf('function renderSupDashboard'));
  assert(/const acc = tot \? Math\.round\(corr\/tot\*100\) : null;/.test(band),
    'la KPI de precisión media debe calcularse de topicScores (aciertos/total)');
  assert(/const risk = empNames\.filter\(n => \(allEmps\[n\]\.allergenBest\|\|0\) < 80\)\.length;/.test(band),
    'la KPI de alertas de seguridad debe contar allergenBest < 80');
  assert(/Alertas seguridad/.test(band) && /Safety alerts/.test(band) && /Precisión media/.test(band),
    'las etiquetas de KPI deben ser bilingües');
  // La sección Hoy debe usar el band, no las stat-tiles viejas.
  const dash = html.slice(html.indexOf('data-sec="hoy">'), html.indexOf('data-sec="equipo">'));
  assert(/\$\{_supKpiBand\(allEmps, empNames\)\}/.test(dash) && !/class="stats-row"/.test(dash),
    'la sección Hoy debe pintar la cabecera de KPIs en lugar de las stat-tiles pequeñas');
});

test('panel supervisor Fase 2c: analytics KPI, tarjeta con dominio, heatmap visual', () => {
  const css = read('styles.css');
  // ── Analytics: cabecera de KPIs (no las 3 stat-tiles planas) ──
  const ana = html.slice(html.indexOf('function renderSupAnalytics'), html.indexOf('function renderSupLqaStats'));
  // Auditoría jul 2026: la cabecera de KPIs duplicaba la banda de «Hoy» y se
  // retiró; la analítica abre con la actividad (heatmap + tendencia +
  // inactivos, antes en la sección Análisis del panel).
  assert(!/class="sup-kpis"/.test(ana) && /renderSupActivityHeatmap\(Object\.values\(allEmps\)\)/.test(ana)
    && /renderSupScoreTrend\(Object\.values\(allEmps\)\)/.test(ana) && /Inactive 3\+ days/.test(ana),
    'la analítica abre con la actividad del equipo, sin KPIs duplicados');
  assert(!/Ranking XP/.test(ana), 'el Ranking XP duplicado (pestaña Ranking) no puede volver a la analítica');
  assert((html.match(/_supTool\('analitica'\)/g)||[]).length===1,
    'una sola puerta a la Analítica (el botón duplicado de Acciones se retiró)');
  assert(/if\(!document\.querySelector\(`\.sup-sec\[data-sec="\$\{cur\}"\]`\)\) cur = window\._supSection = 'hoy';/.test(html),
    'un _supSection guardado de versiones viejas no puede dejar el panel en blanco');
  assert(!/<div class="stat-tile"><div class="stat-num">\$\{empNames\.length\}<\/div><div class="stat-lbl">Empleados/.test(ana),
    'las 3 stat-tiles planas de la analítica deben haberse sustituido');
  // ── Tarjeta de empleado: barra de dominio ──
  assert(/\.sup-emp-dominio\{/.test(css) && /\.sup-emp-dominio-fill\{/.test(css), 'debe existir el CSS de la barra de dominio');
  assert(/class="sup-emp-dominio"/.test(html) && /sup-emp-dominio-fill/.test(html),
    'cada tarjeta de empleado debe mostrar la barra de dominio (platos dominados)');
  // ── Heatmap: día pico destacado + total de 14 días ──
  const heat = html.slice(html.indexOf('function renderSupActivityHeatmap'), html.indexOf('function renderSupScoreTrend'));
  assert(/const total14=/.test(heat) && /const peak=/.test(heat), 'el heatmap debe calcular total y día pico');
  assert(/const isPeak=d\.count>0 && d\.count===maxCount;/.test(heat) && /linear-gradient\(180deg,var\(--gold\),var\(--gold-deep\)\)/.test(heat),
    'el heatmap debe destacar el día más activo en dorado sólido');
});

test('notification panel: fixed header, 44px close, mark-all-read', () => {
  // Reporte del propietario (iOS/Android): la ✕ vivía DENTRO del área con
  // scroll (desaparecía al desplazarse), sin área táctil ni safe-area, y no
  // existía "marcar todas como leídas".
  const p = html.slice(html.indexOf('async function renderNotifPanel'), html.indexOf('async function markNotifRead'));
  assert(/flex-direction:column/.test(p) && /flex-shrink:0/.test(p) && /id="notifList"[^>]*flex:1;overflow-y:auto/.test(p),
    'panel header must be fixed with only the list scrolling');
  assert(/min-width:44px;min-height:44px/.test(p), 'close button needs a 44px touch target');
  assert(/env\(safe-area-inset-top/.test(p), 'panel header must respect the notch');
  assert(/min\(340px,86vw\)/.test(p), 'drawer must always leave a tappable backdrop strip');
  assert(/markAllNotifsRead\(\)/.test(p) && /function markAllNotifsRead/.test(html),
    'mark-all-read button/function missing');
  const f = html.slice(html.indexOf('async function markAllNotifsRead'), html.indexOf('async function markAllNotifsRead') + 1200);
  assert(/readNotifIds/.test(f) && /Promise\.allSettled/.test(f) && /notifBadge/.test(f),
    'mark-all must persist locally, sync to Supabase and clear the badge');
});

test('wine detail: opaque overlay, dark hero band, SVG bottle by type', () => {
  // "El diseño es pobre" (propietario): el overlay al 97% dejaba sangrar el
  // dashboard como texto fantasma y la botella era una caja pálida con un
  // icono diminuto. Ahora: fondo opaco INLINE (a prueba de CSS viejo), banda
  // hero TUNIC oscura y botella SVG dibujada por tipo.
  assert(/overlay\.style\.background = '#f4ede2'/.test(html), 'wine overlay must be opaque inline');
  assert(/function _wineBottleSvg/.test(html), 'SVG bottle renderer missing');
  const b = html.slice(html.indexOf('function _wineBottleSvg'), html.indexOf('function _wineImgHtml'));
  for (const t of ['tinto', 'blanco', 'rosado', 'espumoso', 'dulce']) assert(b.includes(t), `bottle color for ${t} missing`);
  assert(/class="wd-hero"/.test(html), 'dark hero band missing from wine detail');
  const hero = html.slice(html.indexOf('class="wd-hero"') - 40, html.indexOf('class="wd-hero"') + 600);
  assert(/var\(--brand-ink\)/.test(hero), 'hero band must use the brand token background');
  assert(/background:transparent;border:none;box-shadow:none/.test(html.slice(html.indexOf('function _wineImgHtml'), html.indexOf('function _wineImgHtml') + 1600)),
    'bottle wrap must be transparent (no pale box on the dark band)');

  // Los chips de "Vinos similares" llevaban emojis (🍇, 🛢) — fuera:
  // micro-SVGs monolínea con currentColor.
  assert(/CHIP_ICO_GRAPE/.test(html) && /CHIP_ICO_TANK/.test(html), 'chip SVG icons missing');
  const chips = html.slice(html.indexOf('function _consolidateChips'), html.indexOf('function _renderSimilarWinesSection'));
  assert(!/[\u{1F347}\u{1F6E2}]/u.test(chips), 'emoji found in similar-wine chips — banned');
});

test('logo taps home + persistent search pill under the nav', () => {
  // Peticiones del propietario: el logo TXOKO vuelve al inicio (accesible:
  // role button + Enter/Espacio) y la búsqueda global vive a UN toque bajo
  // la barra de Inicio (antes estaba escondida dentro del desplegable).
  const logo = html.slice(html.indexOf('id="headerLogo"') - 40, html.indexOf('id="headerLogo"') + 400);
  assert(/onclick="showTab\('dashboard'\)"/.test(logo) && /role="button"/.test(logo) && /onkeydown/.test(logo),
    'header logo must navigate home, accessibly');
  const pill = html.slice(html.indexOf('id="globalSearchPill"') - 40, html.indexOf('id="globalSearchPill"') + 700);
  assert(/onclick="openGlobalSearch\(\)"/.test(pill), 'search pill must open the global search');
  assert(/min-height:44px/.test(pill), 'search pill needs a touch-friendly height');
  // Y se esconde donde no busca nada: en el panel, en horarios, en el chat o
  // en el ranking no hay platos ni vinos, y en Aprender, Vinos, Quesos y Sala
  // la pantalla ya trae su propio buscador. La capacidad NO se pierde: sigue
  // a un toque desde el menú.
  assert(/const _SIN_BUSCADOR = new Set\(/.test(html) && /_buscadorSync\(tab\);/.test(html),
    'la píldora tiene que esconderse donde no tiene función');
  assert(/id="navSearchEntry"[^>]*onclick="openGlobalSearch\(\)"/.test(html),
    'la búsqueda global tiene que seguir accesible desde el menú en todas las pantallas');
  assert(/globalSearchPillLbl/.test(html.slice(html.indexOf('const _gsLbl'), html.indexOf('const _gsLbl') + 600)),
    'pill label must be localized with the rest');
});

test('update push: SW pre-installs new build on tag app-update', () => {
  // "¿Qué se necesita para enviar la actualización a los dispositivos?" —
  // el push despierta al SW aunque la app esté cerrada: con tag 'app-update'
  // dispara registration.update(), cuyo install precachea el shell FRESCO
  // (no-cache), y muestra la notificación (obligatoria en iOS). El botón
  // vive en el panel del supervisor.
  const sw = read('sw.js');
  assert(/new Request\(u, \{ cache: 'no-cache' \}\)/.test(sw), 'shell precache must bypass the HTTP cache');
  assert(/data\.tag === 'app-update'/.test(sw) && /self\.registration\.update\(\)/.test(sw),
    'push handler must background-update on tag app-update');
  assert(/Promise\.all\(jobs\)/.test(sw), 'notification and update must both be awaited');
  assert(/function sendAppUpdatePush/.test(html), 'supervisor sendAppUpdatePush missing');
  const fn = html.slice(html.indexOf('async function sendAppUpdatePush'), html.indexOf('async function sendAppUpdatePush') + 1400);
  assert(/tag:'app-update'/.test(fn) && /target:'all'/.test(fn) && /confirm\(/.test(fn),
    'update push must target all with the app-update tag, behind a confirm');
  assert(/onclick="sendAppUpdatePush\(\)"/.test(html), 'supervisor panel button missing');
});

test('every dish has name, ingredients and story in ES and EN', () => {
  // El Capítulo I del Viaje Inmersivo muestra dish.history; 26 platos lo
  // tenían vacío (relleno "no disponible"). Redactados desde su ficha + el
  // producto local canario. Candado: ninguna ficha sin historia, en ningún
  // idioma — así el Viaje nunca abre con un capítulo hueco.
  for (const arr of ['DISHES', 'DISHES_EN']) {
    const i = html.indexOf('const ' + arr + ' = [');
    const j = html.indexOf('\n];', i);
    const blk = html.slice(i, j);
    const starts = [...blk.matchAll(/\{id:(\d+),/g)];
    for (let k = 0; k < starts.length; k++) {
      const obj = blk.slice(starts[k].index, k + 1 < starts.length ? starts[k + 1].index : blk.length);
      const h = obj.match(/history:'((?:[^'\\]|\\.)*)'/);
      assert(h && h[1].trim().length > 0, `${arr} dish ${starts[k][1]} has no story`);
      // Los ingredientes se muestran en flashcards/ficha en AMBOS idiomas —
      // 6 platos los tenían vacíos en EN (reporte del propietario). Nunca
      // más un plato sin ingredientes, en ningún idioma.
      const ing = obj.match(/ingredients:'((?:[^'\\]|\\.)*)'/);
      assert(ing && ing[1].trim().length > 0, `${arr} dish ${starts[k][1]} has no ingredients`);
      const nm = obj.match(/name:'((?:[^'\\]|\\.)*)'/);
      assert(nm && nm[1].trim().length > 0, `${arr} dish ${starts[k][1]} has no name`);
    }
  }
});

test('las dos cartas cuadran: ninguna ficha inglesa sin plato español (sep 2026)', () => {
  // DISHES_EN arrastraba cuatro fichas (55 ensalada verde, 56 y 65 pimientos
  // del padrón, 58 patatas fritas) cuyo plato español ya no existía: copias
  // viejas de los platos 27, 30 y 32 con una numeración anterior, olvidadas al
  // renumerar la carta. Nadie las veía —el resto de la app busca la ficha
  // inglesa por id desde DISHES— pero eran dato caducado y peor que el
  // original: la 55 declaraba Sulfitos habiendo perdido la comanda «SIN
  // ADEREZO», y la 58 la de la freidora aparte.
  const ids = lista => {
    const i = html.indexOf(`const ${lista} = [`);
    return new Set([...html.slice(i, html.indexOf('\n];', i)).matchAll(/\{id:(\d+),/g)].map(m => +m[1]));
  };
  const es = ids('DISHES'), en = ids('DISHES_EN');
  const huerfanas = [...en].filter(id => !es.has(id));
  assert(huerfanas.length === 0, `DISHES_EN keeps dishes with no Spanish card: ${huerfanas.join(', ')}`);
});

test('el buscador global habla el idioma activo: categoría e índices (sep 2026)', () => {
  // Dos fallos medidos en el buscador, que es lo único que quedó del Modo
  // Servicio y por tanto la herramienta de consulta en sala.
  //
  // 1 · La categoría salía SIEMPRE en español: «Padrón peppers · Guarniciones
  //     y Salsas». Y como el índice sólo guardaba la española, en inglés no se
  //     podía buscar por categoría: «sides» y «desserts» devolvían 0 platos
  //     mientras «guarniciones» daba 13 y «postres» 9.
  const idx = html.slice(html.indexOf('function _gsDishIndex()'), html.indexOf('function _gsWineIndex()'));
  assert(/catEn:\s*catIng/.test(idx), 'the dish index must store the English category');
  assert(/_gsNorm\(\[[^\]]*\bcatIng\b/.test(idx), 'the search string must include the English category');
  assert(/function catEn\b|const catEn\s*=/.test(html), 'catEn() must exist to translate the category');
  for (const uso of [/const sub = \[\(en\?it\.catEn:it\.cat\), alg\]/, /const c=\(en\?it\.catEn:it\.cat\)\|\|/])
    assert(uso.test(html), `a search renderer still prints the Spanish category: ${uso}`);
  //
  // 2 · Los índices se cachean y los de vinos y LQA hornean el texto en el
  //     idioma activo, así que al pulsar EN sin recargar las situaciones
  //     seguían en español. setLang los invalida.
  const sl = html.slice(html.indexOf('function setLang(lang)'), html.indexOf('function setLang(lang)') + 1400);
  assert(/_gsDishIdx = null; _gsWineIdx = null; _gsLqaIdx = null;/.test(sl),
    'setLang must drop the cached search indexes so they rebuild in the new language');
  assert(/try \{ _gsDishIdx/.test(sl),
    'the invalidation must be guarded — setLang runs at boot, inside the let temporal dead zone');
});

test('el Modo Servicio no vuelve: se eliminó y sólo queda el buscador (sep 2026)', () => {
  // El propietario retiró el Modo Servicio hace tiempo, pero sólo se quitó su
  // botón: quedaban 311 líneas de JS, 70 reglas de CSS y el div del overlay,
  // inalcanzables desde la interfaz. Era la única parte de la app que recorría
  // DISHES_EN por su cuenta, así que era también donde el dato caducado podía
  // reaparecer. Fuera entero — el buscador global es el que se usa.
  const css = read('styles.css');
  for (const [f, t] of [[html, 'index.html'], [css, 'styles.css']]) {
    const restos = [...f.matchAll(/(?<!hor-)svc-[a-z-]+|toggleServiceMode|_svc[A-Z]/g)].map(m => m[0]);
    assert(restos.length === 0, `${t} still carries Service Mode leftovers: ${[...new Set(restos)].join(', ')}`);
  }
  assert(!html.includes('SERVICE COMPANION MODE'), 'the Service Mode block must stay deleted');
  assert(!html.includes('id="svcOverlay"'), 'the Service Mode overlay must stay out of the markup');
});

test('audit fixes: exam empty-pool guard + journey/txoko option de-dup', () => {
  // Auditoría jul 2026 (55k preguntas ejecutadas). Tres arreglos de robustez:
  // 1) el Examen crasheaba con pool vacío (categoría mono-turno en el turno
  //    contrario — Hamburguesas en Cena — o Guarniciones + tema≠historia);
  // 2) el quiz del Viaje daba opciones duplicadas (ingredientes repetidos) y
  //    3 opciones (Chateaubriand: su nombre largo no cabe);
  // 3) el Juego Txoko duplicaba opciones al truncar el display a 90 car.
  // Guard 1 — Examen protege el pool vacío en vez de pintar roto:
  const se = html.slice(html.indexOf('function startExam'), html.indexOf('function renderExamQuestion'));
  assert(/if\(validQuestions\.length === 0\)\{/.test(se), 'startExam must guard empty pool');
  assert(/renderExam\(\);\s*\n\s*return;/.test(se), 'startExam must return to setup on empty pool');
  const rq = html.slice(html.indexOf('function renderExamQuestion'), html.indexOf('function renderExamQuestion') + 400);
  assert(/!examDishes\[examIndex\]/.test(rq), 'renderExamQuestion must guard missing question');
  // Guard 2 — Viaje: pool de ingredientes reales ÚNICOS, exige 3:
  const dj = html.slice(html.indexOf('const _seenIng = new Set()'), html.indexOf('const _seenIng = new Set()') + 700);
  assert(/realIngPool\.length >= 3/.test(dj) && /_seenIng\.has\(il\)/.test(dj),
    'journey Q3 must require 3 unique real ingredients');
  // Guard 3 — Juego Txoko: dedupe por display truncado, no por texto completo:
  const tx = html.slice(html.indexOf('const seenDisplay=new Set'), html.indexOf('const seenDisplay=new Set') + 700);
  assert(/seenDisplay\.has\(dn\)/.test(tx), 'txoko game must de-dup on the truncated display');
});

test('dish journey: overlay persists across phases (no white flash)', () => {
  // Reporte del propietario: pantallazos blancos al pulsar "Continuar" en el
  // Viaje Inmersivo. Causa: _djRender destruía el overlay oscuro y creaba uno
  // nuevo en cada fase → se veía el fondo claro del dashboard entre medias, y
  // el fade de 0.4s se repetía. Fix: el overlay se crea UNA vez; los cambios
  // de fase solo refrescan el contenedor interior.
  const dj = html.slice(html.indexOf('function _djRender'), html.indexOf('function _djNext'));
  assert(/const existing = document\.getElementById\('djOverlay'\);/.test(dj), '_djRender must look for existing overlay');
  assert(/cont\.innerHTML = containerHtml;\s*return;/.test(dj),
    'phase change must update the container in place and return (never recreate the overlay)');
  // La destrucción incondicional del overlay (el bug) no debe volver.
  assert(!/const existing = document\.getElementById\('djOverlay'\);\s*\n\s*if\(existing\) existing\.remove\(\);\s*\n\s*const overlay/.test(dj),
    'unconditional overlay remove+recreate is back — the flash bug returns');
  assert(/overlay\.innerHTML = `<div class="dj-container">\$\{containerHtml\}<\/div>`/.test(dj),
    'first open must wrap the container once');
});

test('shift change refreshes in place without the fade flicker', () => {
  // Reporte del propietario: cambiar de turno hacía parpadear el dashboard.
  // Causa: _setStudyShift llamaba a showTab(currentTab), que hace un fundido
  // de salida a blanco (120ms) + re-anima la entrada. Fix: showTab(tab, true)
  // refresca en el sitio, sin fundido ni re-entrada, y solo en las pantallas
  // que dependen del turno.
  assert(/function showTab\(tab, instant\)/.test(html), 'showTab must accept an instant flag');
  assert(/if\(instant\)\{[\s\S]{0,120}no-entrance-anim/.test(html), 'instant path must suppress entrance animation');
  assert(/setTimeout\(_doRender, 120\)/.test(html), 'normal tab change keeps its fade');
  // El recuadro verde (héroe) parpadeaba porque el path instantáneo QUITABA
  // no-entrance-anim de forma síncrona, y quitar animation:none re-dispara la
  // animación slideUp del héroe. El fix: dejar la clase puesta (return sin
  // remove) y retirarla solo en la siguiente navegación real.
  // Cuerpo REAL de la función (con emparejado de llaves): recortar por número
  // fijo de caracteres se rompía en cuanto se añadía un comentario arriba.
  const stBody = _xFn('showTab');
  const _instStart = stBody.indexOf('if(instant){');
  const instBlock = stBody.slice(_instStart, stBody.indexOf('return;', _instStart) + 7);
  assert(!/classList\.remove\('no-entrance-anim'\)/.test(instBlock),
    'instant path must NOT remove no-entrance-anim (removing it re-triggers the hero slideUp = flicker)');
  assert(/classList\.remove\('no-entrance-anim'\)/.test(stBody),
    'the non-instant path must clear no-entrance-anim so real navigations animate');
  const ss = html.slice(html.indexOf('function _setStudyShift'), html.indexOf('function _setStudyShift') + 700);
  assert(/showTab\(currentTab, true\)/.test(ss), 'shift change must refresh instantly');
  assert(/_shiftTabs = \{ dashboard:1/.test(ss), 'shift refresh must be limited to shift-dependent tabs');
  const css = read('styles.css');
  assert(/#appContent\.no-entrance-anim [^{]*\{animation:none!important/.test(css.replace(/\s+/g,' ')),
    'no-entrance-anim must disable animations for the instant refresh');
  // El brillo decorativo del héroe se exime para que no se congele mientras la
  // clase permanece puesta entre un cambio de turno y la siguiente navegación.
  assert(/#appContent\.no-entrance-anim \.dash-hero-shine::after\{animation:dashHeroShine/.test(css.replace(/\s+/g,' ')),
    'hero shine must keep looping while no-entrance-anim lingers');
});

test('study shift filter: DISH_SERVICE complete + all generators route by shift', () => {
  // Petición del propietario: estudiar los platos de almuerzo con los de
  // almuerzo y los de cena con los de cena, en TODO (exámenes, flashcards,
  // repaso, simulacro, quiz, fantasma). El guard EJECUTA el filtro: en modo
  // almuerzo no puede salir ningún plato solo-cena y viceversa.
  const cut = (a, b) => { const i = html.indexOf(a); assert(i !== -1, 'missing ' + a); return html.slice(i, html.indexOf(b, i) + b.length); };
  const dishesSrc = cut('const DISHES = [', '\n];');
  const svcSrc = cut('const DISH_SERVICE = {', '};') + ';';
  const helpers = html.slice(html.indexOf('let _studyShift'), html.indexOf('function computeDishAllergens'));
  const stub = 'function _renderShiftBar(){} var currentTab=null; function showTab(){}; var localStorage={getItem:()=>null,setItem:()=>{}};';
  const M = new Function(stub + dishesSrc + svcSrc + helpers + 'return {DISHES, DISH_SERVICE, _shiftDishes, setShift:(s)=>{_studyShift=s;}};')(); // eslint-disable-line no-new-func
  const bad = M.DISHES.filter(d => !['a', 'c', 'ambos'].includes(M.DISH_SERVICE[d.id]));
  assert(bad.length === 0, `dishes without a valid service: ${bad.map(d => d.id).join(',')}`);
  // El Fish and chips de cena (109) salió de la carta en sep 2026: queda un
  // solo Fish and chips, el del almuerzo. Los Tataki siguen siendo gemelos.
  const twins = { 9: 'c', 78: 'a', 69: 'a' };
  assert(!M.DISHES.some(d => d.id === 109), 'el plato 109 se retiró de la carta');
  assert(M.DISH_SERVICE[109] === undefined, 'DISH_SERVICE no puede conservar el 109');
  for (const [id, exp] of Object.entries(twins))
    assert(M.DISH_SERVICE[id] === exp, `twin ${id} must be shift ${exp}, got ${M.DISH_SERVICE[id]}`);
  for (const shift of ['a', 'c']) {
    M.setShift(shift);
    const leak = M._shiftDishes(M.DISHES).filter(d => { const s = M.DISH_SERVICE[d.id]; return s !== 'ambos' && s !== shift; });
    assert(leak.length === 0, `shift ${shift} leaks ${leak.length} wrong-shift dishes`);
  }
  M.setShift('todo');
  assert(M._shiftDishes(M.DISHES).length === M.DISHES.length, "'todo' must pass every dish");
  const raw = (html.match(/DISHES\[Math\.floor\(Math\.random\(\)\*DISHES\.length\)\]/g) || []);
  assert(raw.length === 0, `${raw.length} raw random DISHES[...] access left unrouted by shift`);
  assert(/const dishes = _lqaShuffle\(_shiftDishes\(DISHES\)/.test(html), 'Txoko game must shuffle a shift-filtered pool');
  assert(/let pool=_shiftDishes\(examConfig\.cat/.test(html), 'exam pool must be shift-filtered');
  assert(/const pool = _shiftDishes\(\(cat && cat/.test(html), 'allergen drill pool must be shift-filtered');
  assert(/let pool=_shiftDishes\(cat&&cat/.test(html), 'flashcards pool must be shift-filtered');
  assert(/function _simDishes\(\)\{ return DISHES\.filter\(d=>!d\.archived && _shiftDishOk\(d\)\)/.test(html), '_simDishes must apply shift');
  assert(/id="shiftBar"/.test(html) && /function _renderShiftBar/.test(html), 'shift selector bar missing');
  const rsb = html.slice(html.indexOf('function _renderShiftBar'), html.indexOf('function _renderShiftBar') + 900);
  assert(/\['a',[^\]]*\], \['c',[^\]]*\], \['todo',/.test(rsb) && /onclick="_setStudyShift/.test(rsb),
    'shift bar must offer Lunch/Dinner/All');
  assert(/localStorage\.setItem\('txoko_shift'/.test(html), 'shift choice must persist');
  // Regresión (jul 2026): la barra de turno se veía en TODAS las secciones
  // («no tiene uso en inicio», propietario). Nace oculta y showTab solo la
  // muestra en Aprender y sus subpestañas.
  const sbIx = html.indexOf('id="shiftBar"');
  const sbTag = html.slice(html.lastIndexOf('<div', sbIx), html.indexOf('>', sbIx) + 1);
  assert(/display:none/.test(sbTag), 'shiftBar must start hidden (display:none inline)');
  assert(/_sb\.style\.display = \(navTab==='aprender' && _hayTurnos\(\)\) \? 'flex' : 'none'/.test(html),
    'showTab must show shiftBar only for the Aprender section, and only where the menu has shifts');
});

test('study shift filter: subject AND distractor pools route by shift (no wrong-shift leaks)', () => {
  // Regresión (jul 2026): el propietario detectó que, con turno almuerzo/cena,
  // algunos generadores mostraban platos del OTRO turno como opción-distractor
  // o como sugerencia. El sujeto ya iba filtrado; el pool de distractores no.
  // Guards estructurales por cada fuga corregida + guard empírico en txBuildQuestion.

  // #1 txBuildQuestion — distractores por turno con fallback seguro (≥3)
  assert(/const _wpShift=_shiftDishes\(_wpBase\)/.test(html) &&
    /const wrongPool=_lqaShuffle\(_wpShift\.length>=3\?_wpShift:_wpBase\)/.test(html),
    'txBuildQuestion distractor pool must be shift-filtered with a safe fallback');
  // #2 Dish Journey — sugerencia de próximo plato por turno con fallback
  assert(/const _sameCatSh = _shiftDishes\(_sameCatAll\)/.test(html) &&
    /const _anyUnSh   = _shiftDishes\(_anyUnAll\)/.test(html),
    'journey next-dish suggestion must be shift-filtered with a fallback');
  // #3 renderRepasoTopic — lista por categoría por turno + estado vacío
  // El filtro admite ahora cat2: un plato puede salir en dos cartas (la
  // croqueta de boletus es vegetariana Y entrante del menú normal). Lo que
  // este guard protege sigue igual: la lista se filtra por turno.
  assert(/const _repAll=DISHES\.filter\(d=>d\.cat===repasoCat \|\| d\.cat2===repasoCat\);\s*\n\s*const dishes=_shiftDishes\(_repAll\)/.test(html),
    'renderRepasoTopic per-category list must be shift-filtered');
  assert(/\$\{dishes\.length\?rows:/.test(html),
    'renderRepasoTopic must show an empty state when the shift leaves no dishes');
  // #4 (Live Quiz Host: retirado en jul 2026 con el quiz de supervisor; su
  //     sucesor, el Quiz del Día, NO filtra por turno a propósito — la
  //     competición compartida exige un pool idéntico para todo el equipo)
  // #5 Servicio Fantasma — los fallbacks mantienen el turno antes de relajarlo
  assert(/if\(!safe\.length\) safe = DISHES\.filter\(function\(d\)\{ return _shiftDishOk\(d\) && _sfOfr\(d\)/.test(html),
    'Ghost service "safe" fallback must keep shift before dropping it');
  assert(/if\(!dangerDish\.length\) dangerDish = DISHES\.filter\(function\(d\)\{return _shiftDishOk\(d\) && _sfOfr\(d\)/.test(html),
    'Ghost service "danger" fallback must keep shift before dropping it');
  assert(/var safeAlt = safeDishes\.length \? safeDishes\[0\] : \(DISHES\.find\(function\(d\)\{return _shiftDishOk\(d\)/.test(html),
    'Ghost service "safeAlt" fallback must keep shift before dropping it');

  // Guard empírico: extraer txBuildQuestion real y comprobar que en modo a/c
  // ninguna opción-distractor pertenece EXCLUSIVAMENTE a platos de otro turno.
  const cut = (a, b) => { const i = html.indexOf(a); assert(i !== -1, 'missing ' + a); return html.slice(i, html.indexOf(b, i) + b.length); };
  const fn = (name) => { const sig = 'function ' + name + '('; const i = html.indexOf(sig); let depth = 0, j = html.indexOf('{', i), k = j;
    while (true) { const ch = html[k]; if (ch === '{') depth++; else if (ch === '}') { depth--; if (depth === 0) return html.slice(i, k + 1); } k++; } };
  const dishesSrc = cut('const DISHES = [', '\n];');
  const svcSrc = cut('const DISH_SERVICE = {', '};') + ';';
  const helpers = html.slice(html.indexOf('let _studyShift'), html.indexOf('function computeDishAllergens'));
  // ingredients/history son ahora preguntas INVERTIDAS (fix legibilidad jul 2026):
  // el pasaje va en la burbuja y las opciones son NOMBRES DE PLATO. El generador
  // real usa _examRedact/_examNameTokens/_EXAM_STOP y WAITER_MSGS_REV/_txRevBubble,
  // así que hay que extraerlos e integrarlos aquí (antes solo truncaba texto).
  const wmRev = cut('const WAITER_MSGS_REV={', '  ]};');
  const examStop = cut('const _EXAM_STOP = new Set', ']);') + ';';
  const stub = 'function _renderShiftBar(){} var localStorage={getItem:()=>null,setItem:()=>{}};'
    + 'var LANG="es"; function getDish(d){return d;} function allergenLocal(a){return a;} function t(k){return k;}'
    + 'function escapeHTML(s){return String(s);}'
    + 'function _isDishQuizableForTopic(d,tk){ if(d.cat===\'Guarniciones y Salsas\') return tk===\'history\'; return true; }'
    + 'var DISHES_EN=[]; var TOPICS=[{key:"allergens",label:"al"},{key:"ingredients",label:"in"},{key:"history",label:"hi"}];'
    + 'var WAITER_MSGS={allergens:[n=>n],ingredients:[n=>n],history:[n=>n]};'
    + 'var TX_VOICE_MSGS={}; var TX_VOICE_MSGS_REV={};';
  const M = new Function(stub + dishesSrc + svcSrc + helpers + wmRev + examStop // eslint-disable-line no-new-func
    + fn('_txRevBubble') + fn('_examNameTokens') + fn('_examRedact')
    + fn('_lqaShuffle') + fn('txNorm') + fn('txGetAnswer') + fn('txTruncate') + fn('_txNameWords') + fn('_txNameTwin') + fn('txBuildQuestion')
    + 'return {DISHES, DISH_SERVICE, txBuildQuestion, txGetAnswer, txTruncate, txNorm, setShift:(s)=>{_studyShift=s;}};')();
  const svc = M.DISH_SERVICE;
  // Mapea una opción a los platos que la producen. Las opciones invertidas son
  // NOMBRES DE PLATO; las de alérgenos son la cadena de alérgenos.
  const optDishes = (optText) => {
    const on = M.txNorm(optText); const res = [];
    for (const d of M.DISHES) { if (M.txNorm(d.name) === on) res.push(d); }         // ing/history → nombre
    for (const d of M.DISHES) { const raw = M.txGetAnswer(d, 'allergens'); if (raw && M.txNorm(raw) === on && !res.includes(d)) res.push(d); } // alérgenos
    return res;
  };
  // Gemelo de nombre (fix legibilidad/ambigüedad jul 2026 — tomates con/sin
  // ventresca): el corto es prefijo POR PALABRAS del largo tras quitar acentos
  // y «(Cena)/(Almuerzo)». Detector independiente para no auto-validar el del
  // código con su propio bug.
  const twinCheck = (a, b) => {
    const w = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
    const wa = w(a), wb = w(b); if (!wa.length || !wb.length) return false;
    const [s, l] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
    for (let i = 0; i < s.length; i++) if (s[i] !== l[i]) return false;
    return true;
  };
  for (const shift of ['a', 'c']) {
    M.setShift(shift);
    let n = 0, leak = 0, trunc = 0, tooLong = 0, twinPairs = 0;
    for (let i = 0; i < 1500; i++) {
      const q = M.txBuildQuestion(); if (!q) continue; n++;
      const rev = (q.topicKey === 'ingredients' || q.topicKey === 'history');
      if (rev) {
        const ch = q.choices || [];
        for (let a = 0; a < ch.length; a++) for (let b = a + 1; b < ch.length; b++)
          if (twinCheck(ch[a], ch[b])) twinPairs++;
      }
      for (const o of (q.choices || [])) {
        // Guard de legibilidad (fix jul 2026): ninguna opción puede quedar
        // truncada con «...» ni, en preguntas invertidas, exceder 60 car.
        if (/(\.\.\.|…)\s*$/.test(o)) trunc++;
        if (rev && o.length > 60) tooLong++;
        const cand = optDishes(o); if (!cand.length) continue;
        if (cand.every(d => { const s = svc[d.id]; return s !== 'ambos' && s !== shift; })) leak++;
      }
    }
    assert(n > 1000, `txBuildQuestion produced too few questions in shift ${shift} (${n}) — over-filtered?`);
    assert(leak === 0, `txBuildQuestion leaked ${leak} wrong-shift distractor options in shift ${shift}`);
    assert(trunc === 0, `txBuildQuestion produced ${trunc} truncated «...» options in shift ${shift} — options must stay short & fully legible`);
    assert(tooLong === 0, `txBuildQuestion produced ${tooLong} over-long (>60 char) inverted options in shift ${shift}`);
    // Ningún par de opciones invertidas puede ser gemelo de nombre (variante
    // veg / turno / prefijo): «Tomates aliñados» ⟷ «… con granizado de gazpacho»
    // se leen mal y el pasaje de uno describe al otro. Medido antes: 0.91% de
    // las invertidas; después: 0.
    assert(twinPairs === 0, `txBuildQuestion produced ${twinPairs} name-twin inverted option pairs in shift ${shift} — variant/veg twins must never co-occur as options`);
  }
});

test('Mr. Shoesmith habla en 1ª persona y las carnes de autor van por storytelling', () => {
  // Directriz del propietario (jul 2026): Mr. Shoesmith es UN cliente sentado a
  // SU mesa (la 501) que interroga él mismo al camarero — un enunciado que nombra
  // «Mesa 304», a otro huésped o que narra en 3ª persona rompe la ficción.
  // Medido ANTES: 41% de los enunciados nombraban otra mesa y 83% no estaban en
  // su voz. Además, en los cortes de Carnes de Autor la pregunta invertida de
  // ingredientes filtraba la respuesta por el eco del peso («(300 g)» ↔ «300g»
  // del nombre) en el 100% de los casos — incluso con doble-correcta plausible
  // (Entrecot de Angus 300g vs Entrecot de Wagyu 300g). DESPUÉS: 0 en todo.
  // (1) El juego pide la voz de la persona activa (Shoesmith por defecto si no
  //     hay ninguna sembrada); Duelos/Retos conservan la neutra sin voz.
  const txNextSrc = html.slice(html.indexOf('function txNext('), html.indexOf('function txAnimTick('));
  assert(/const _voice=\(txokoState\.persona\)\|\|'shoesmith'/.test(txNextSrc) && /q=txBuildQuestion\(_voice\)/.test(txNextSrc),
    'txNext must build questions in the active persona\'s voice (defaulting to Shoesmith)');
  // (2) Gate estructural: platos con ingredientes vacuos no preguntan ingredientes.
  assert(/topicKey === 'ingredients' && _txIngredientsVacuous\(d\)/.test(html),
    'vacuous-ingredients gate missing from _isDishQuizableForTopic');
  // (3) _examNameTokens debe emitir la parte numérica de los pesos del nombre
  //     para que _examRedact enmascare «(300 g)» en el pasaje (anti-eco).
  assert(/w\.match\(\/\\d\{2,\}\/g\)/.test(html), '_examNameTokens must emit numeric weight stems');
  // (4) Empírico con el generador y los pools REALES.
  const cut = (a, b) => { const i = html.indexOf(a); assert(i !== -1, 'missing ' + a); return html.slice(i, html.indexOf(b, i) + b.length); };
  const fn = (name) => { const sig = 'function ' + name + '('; const i = html.indexOf(sig); assert(i !== -1, 'missing fn ' + name); let depth = 0, k = html.indexOf('{', i);
    while (true) { const ch = html[k]; if (ch === '{') depth++; else if (ch === '}') { depth--; if (depth === 0) return html.slice(i, k + 1); } k++; } };
  const stub = 'function _renderShiftBar(){} var localStorage={getItem:()=>null,setItem:()=>{}};'
    + 'var LANG="es"; function allergenLocal(a){return a;} function t(k){return k==="noHistory"?"✦ Storytelling próximamente":k;}'
    + 'function escapeHTML(s){return String(s);}'
    + 'function getDish(d){ if(LANG!=="en") return d; const en=DISHES_EN.find(x=>x.id===d.id); return en?Object.assign({},d,en):d; }'
    + 'var TOPICS=[{key:"allergens",label:"al"},{key:"ingredients",label:"in"},{key:"history",label:"hi"}];';
  const M = new Function(stub // eslint-disable-line no-new-func
    + cut('const DISHES = [', '\n];') + cut('const DISHES_EN = [', '\n];') + cut('const DISH_SERVICE = {', '};') + ';'
    + html.slice(html.indexOf('let _studyShift'), html.indexOf('function computeDishAllergens'))
    + cut('const WAITER_MSGS={', '  ]};') + cut('const WAITER_MSGS_REV={', '  ]};')
    + cut('const SHOESMITH_MSGS={', '  ]};') + cut('const SHOESMITH_MSGS_REV={', '  ]};')
    + 'var TX_VOICE_MSGS={shoesmith:SHOESMITH_MSGS}; var TX_VOICE_MSGS_REV={shoesmith:SHOESMITH_MSGS_REV};'
    + cut('const _EXAM_STOP = new Set', ']);') + ';' + cut('const _ING_GENERIC = new Set', ']);') + ';'
    + fn('_txIngredientsVacuous') + fn('_isQuizableDish') + fn('_isDishQuizableForTopic')
    + fn('_txRevBubble') + fn('_examNameTokens') + fn('_examRedact')
    + fn('_lqaShuffle') + fn('txNorm') + fn('txGetAnswer') + fn('txTruncate') + fn('_txNameWords') + fn('_txNameTwin') + fn('txBuildQuestion')
    + 'return {DISHES, SHOESMITH_MSGS, SHOESMITH_MSGS_REV, txBuildQuestion, txNorm, _txIngredientsVacuous,'
    + '  setShift:(s)=>{_studyShift=s;}, setLang:(l)=>{LANG=l;}, dishByName:(n)=>DISHES.find(d=>getDish(d).name===n)};')();
  // Todo enunciado del pool de Shoesmith, en ambos idiomas, debe estar en SU voz:
  // sin mesas numeradas, sin terceros (huésped/compañero/cocina) y sin 3ª persona.
  const NOT_HIS_VOICE = /\b(mesa|table)\s*\d+|hu[eé]sped|guest|compa[ñn]ero|colleague|cocina|kitchen|Mr\.?\s*Shoesmith|VIP/i;
  for (const lang of ['es', 'en']) {
    M.setLang(lang);
    const stems = [
      ...M.SHOESMITH_MSGS.allergens.map(f => f('PLATO')),
      ...M.SHOESMITH_MSGS_REV.ingredients.map(f => f()),
      ...M.SHOESMITH_MSGS_REV.history.map(f => f()),
    ];
    assert(stems.length >= 12, `Shoesmith stem pool too small (${stems.length}) — keep variety`);
    for (const s of stems) assert(!NOT_HIS_VOICE.test(s), `Shoesmith stem out of voice (${lang}): «${s}»`);
  }
  // Barrido del generador real (voz shoesmith): el TALLO (antes del pasaje
  // citado) nunca menciona mesas/terceros, y ninguna pregunta de ingredientes
  // cae en un plato vacuo ni deja eco de peso hacia la opción correcta.
  for (const lang of ['es', 'en']) {
    M.setLang(lang);
    for (const shift of ['a', 'c']) {
      M.setShift(shift);
      let n = 0;
      for (let i = 0; i < 1200; i++) {
        const q = M.txBuildQuestion('shoesmith'); if (!q) continue; n++;
        const stem = String(q.msg).split('<div')[0].replace(/<[^>]+>/g, ' ');
        assert(!NOT_HIS_VOICE.test(stem), `stem out of Shoesmith voice (${lang}/${shift}): «${stem}»`);
        if (q.topicKey === 'ingredients') {
          const dish = M.dishByName(q.dishName);
          assert(dish && !M._txIngredientsVacuous(dish),
            `vacuous-ingredients dish reached an ingredients question: ${q.dishName}`);
          const pass = String(q.msg).replace(/<[^>]+>/g, ' ');
          const w = pass.match(/(\d[\d.,]{1,})\s*(?:g|kg)\b/i);
          if (w) {
            const digits = w[1].replace(/[.,]/g, '');
            assert(!String(q.choices[q.correctIdx]).replace(/[.,]/g, '').includes(digits),
              `weight echo leaks the answer (${lang}/${shift}): «${w[0]}» → «${q.choices[q.correctIdx]}»`);
          }
        }
      }
      assert(n > 800, `Shoesmith voice produced too few questions (${n}) in ${lang}/${shift} — over-filtered?`);
    }
  }
});

test('La Crítica: segundo personaje jugable — selector, ficha, voz propia sin mesas ajenas (jul 2026)', () => {
  // «vamos con eso» (propietario): un segundo cliente para Mr. Shoesmith, con
  // su propio set de fotogramas (vídeo Grok) y su propia voz — elegido con un
  // selector previo (no al azar, no en Camarero Survivors). Misma regla de
  // ficción que Shoesmith: ella es la única clienta en su mesa.
  // (1) El motor de humor/animación lee de un registro por persona, no de
  //     constantes de Shoesmith a secas — así un tercer personaje no exige
  //     tocar txClientFace/txApplyMood/txAnimTick/txAnswer/txNext.
  assert(/const TX_PERSONAS=\{/.test(html), 'TX_PERSONAS registry missing');
  const reg = html.slice(html.indexOf('const TX_PERSONAS={'), html.indexOf('const TX_VOICE_MSGS='));
  assert(/critic:\{[\s\S]*?talkTier:4/.test(reg), 'critic persona must define its own talkTier (her talk frame lives at a different tier than Shoesmith\'s)');
  assert(/shoesmith:\{[\s\S]*?blinkTier:5/.test(reg), 'shoesmith persona must keep its blinkTier (regression: engine must stay backward-compatible)');
  assert(!/critic:\{[^}]*blinkTier/.test(reg), 'critic persona must NOT claim a blinkTier — her source video has no natural blink, and the engine must skip it rather than fake one');
  // (2) Selector previo: el juego pide ahora el picker, no salta directo a
  //     ninguna ficha de personaje — y cada tarjeta abre su propia ficha.
  assert(/onclick="txStart\(\)"/.test(html), 'the Games-hub card must still call bare txStart() — it now opens the persona picker');
  assert(/function txShowPersonaPicker\(/.test(html), 'txShowPersonaPicker missing');
  const picker = html.slice(html.indexOf('function txShowPersonaPicker('), html.indexOf('function txShowPersonaPicker(') + 2000);
  assert(/onclick="txShowIntro\('\$\{p\.id\}'\)"/.test(picker), 'each persona card must open its own ficha via txShowIntro(id)');
  const introFn = html.slice(html.indexOf('function txShowIntro('), html.indexOf('function txShowPersonaPicker('));
  assert(/function txShowIntro\(personaId\)/.test(introFn), 'txShowIntro must take a personaId parameter');
  assert(/onclick="txStart\(true,'\$\{p\.id\}'\)"/.test(introFn), 'the ficha CTA must seed txStart with the chosen persona');
  assert(/onclick="txShowPersonaPicker\(\)"/.test(introFn), 'the ficha back button must return to the picker, not straight to the games hub');
  // (2b) La pantalla de juego (txRender) también debe leer el nombre/mesa de la
  //     persona activa — un tag "MR. SHOESMITH" fijo mientras se juega como La
  //     Crítica fue un bug real detectado en la verificación con Playwright.
  const renderFn = html.slice(html.indexOf('function txRender('), html.indexOf('function txGameOver('));
  assert(!/MR\.\s*SHOESMITH/.test(renderFn) && !/MESA 501/.test(renderFn) && !/TABLE 501/.test(renderFn),
    'txRender must not hardcode Shoesmith\'s name/table — it must read the active persona');
  assert(/_pName/.test(renderFn) && /_pMesa/.test(renderFn), 'txRender must derive the face tag and table label from the active persona');
  // (2c) "Try again" tras Game Over debe conservar la persona con la que se
  //     jugó — sin esto, reintentar como La Crítica te devolvía a Shoesmith
  //     en silencio.
  const overFn = html.slice(html.indexOf('function txGameOver('), html.indexOf('function txGameOver(') + 2200);
  assert(/txStart\(true,'\$\{txokoState\.persona\|\|'shoesmith'\}'\)/.test(overFn),
    'Try again must replay with the SAME persona, not silently reset to Shoesmith');
  // (3) Voz propia: 5 caras + 5 fotogramas de ánimo (sin parpadeo) embebidos.
  assert(/const CRITIC_FACES=\[/.test(html), 'CRITIC_FACES missing');
  for (let k = 0; k < 5; k++) {
    assert(html.includes(`img/sprites/critic-f${k}.jpg`), `critic face ${k} path missing`);
    assert(existsSync(join(ROOT, `img/sprites/critic-f${k}.jpg`)), `img/sprites/critic-f${k}.jpg missing on disk`);
  }
  assert(html.includes("const CRITIC_INTRO='img/sprites/critic-intro.jpg'") && existsSync(join(ROOT, 'img/sprites/critic-intro.jpg')),
    'CRITIC_INTRO must point to the repo file');
  // (4) Barrido del generador real con la voz de la crítica: mismo estándar que
  //     Shoesmith — sin mesas/terceros, sin ingredientes en platos vacuos, sin
  //     eco de peso. Prueba que la voz NO es un simple alias de Shoesmith: sus
  //     frases son distintas y no dependen de "mi mujer".
  const cut = (a, b) => { const i = html.indexOf(a); assert(i !== -1, 'missing ' + a); return html.slice(i, html.indexOf(b, i) + b.length); };
  const fn = (name) => { const sig = 'function ' + name + '('; const i = html.indexOf(sig); assert(i !== -1, 'missing fn ' + name); let depth = 0, k = html.indexOf('{', i);
    while (true) { const ch = html[k]; if (ch === '{') depth++; else if (ch === '}') { depth--; if (depth === 0) return html.slice(i, k + 1); } k++; } };
  const stub = 'function _renderShiftBar(){} var localStorage={getItem:()=>null,setItem:()=>{}};'
    + 'var LANG="es"; function allergenLocal(a){return a;} function t(k){return k==="noHistory"?"✦ Storytelling próximamente":k;}'
    + 'function escapeHTML(s){return String(s);}'
    + 'function getDish(d){ if(LANG!=="en") return d; const en=DISHES_EN.find(x=>x.id===d.id); return en?Object.assign({},d,en):d; }'
    + 'var TOPICS=[{key:"allergens",label:"al"},{key:"ingredients",label:"in"},{key:"history",label:"hi"}];';
  const M = new Function(stub // eslint-disable-line no-new-func
    + cut('const DISHES = [', '\n];') + cut('const DISHES_EN = [', '\n];') + cut('const DISH_SERVICE = {', '};') + ';'
    + html.slice(html.indexOf('let _studyShift'), html.indexOf('function computeDishAllergens'))
    + cut('const WAITER_MSGS={', '  ]};') + cut('const WAITER_MSGS_REV={', '  ]};')
    + cut('const CRITIC_MSGS={', '  ]};') + cut('const CRITIC_MSGS_REV={', '  ]};')
    + 'var TX_VOICE_MSGS={critic:CRITIC_MSGS}; var TX_VOICE_MSGS_REV={critic:CRITIC_MSGS_REV};'
    + cut('const _EXAM_STOP = new Set', ']);') + ';' + cut('const _ING_GENERIC = new Set', ']);') + ';'
    + fn('_txIngredientsVacuous') + fn('_isQuizableDish') + fn('_isDishQuizableForTopic')
    + fn('_txRevBubble') + fn('_examNameTokens') + fn('_examRedact')
    + fn('_lqaShuffle') + fn('txNorm') + fn('txGetAnswer') + fn('txTruncate') + fn('_txNameWords') + fn('_txNameTwin') + fn('txBuildQuestion')
    + 'return {DISHES, CRITIC_MSGS, CRITIC_MSGS_REV, txBuildQuestion, txNorm, _txIngredientsVacuous,'
    + '  setShift:(s)=>{_studyShift=s;}, setLang:(l)=>{LANG=l;}, dishByName:(n)=>DISHES.find(d=>getDish(d).name===n)};')();
  const NOT_HER_VOICE = /\b(mesa|table)\s*\d+|hu[eé]sped|guest|compa[ñn]ero|colleague|cocina|kitchen|mi mujer|my wife|Mr\.?\s*Shoesmith|VIP/i;
  for (const lang of ['es', 'en']) {
    M.setLang(lang);
    const stems = [
      ...M.CRITIC_MSGS.allergens.map(f => f('PLATO')),
      ...M.CRITIC_MSGS_REV.ingredients.map(f => f()),
      ...M.CRITIC_MSGS_REV.history.map(f => f()),
    ];
    assert(stems.length >= 12, `Critic stem pool too small (${stems.length}) — keep variety`);
    for (const s of stems) assert(!NOT_HER_VOICE.test(s), `Critic stem out of voice (${lang}): «${s}»`);
  }
  for (const lang of ['es', 'en']) {
    M.setLang(lang);
    for (const shift of ['a', 'c']) {
      M.setShift(shift);
      let n = 0;
      for (let i = 0; i < 1200; i++) {
        const q = M.txBuildQuestion('critic'); if (!q) continue; n++;
        const stem = String(q.msg).split('<div')[0].replace(/<[^>]+>/g, ' ');
        assert(!NOT_HER_VOICE.test(stem), `stem out of Critic voice (${lang}/${shift}): «${stem}»`);
        // Ben & Jerry's se eliminó de la app (propietario, sep 2026): no puede
        // volver a aparecer ni como sujeto ni como opción.
        assert(!/jerry/i.test(q.dishName), `Ben & Jerry's reached a question as subject (${lang}/${shift})`);
        for (const o of (q.choices || [])) assert(!/jerry/i.test(o), `Ben & Jerry's leaked as an option (${lang}/${shift}): «${o}»`);
        if (q.topicKey === 'ingredients') {
          const dish = M.dishByName(q.dishName);
          assert(dish && !M._txIngredientsVacuous(dish),
            `vacuous-ingredients dish reached an ingredients question: ${q.dishName}`);
        }
      }
      assert(n > 800, `Critic voice produced too few questions (${n}) in ${lang}/${shift} — over-filtered?`);
    }
  }
});

test('La Crítica sarcástica + Ben & Jerry\'s fuera de la app + un segundo más por nivel', () => {
  // Tres ajustes del propietario tras probar el juego:
  // (1) Tono sarcástico: anclamos dos frases características para que una
  //     reescritura futura no la devuelva al tono neutro sin querer.
  assert(html.includes('Sorpréndame: ¿de verdad sabe qué alérgenos lleva?'),
    'critic voice must keep its sarcastic edge (allergens stem)');
  assert(html.includes('permítame dudarlo'), 'critic voice must keep its sarcastic edge (history stem)');
  assert(html.includes('yo solo anoto todo lo que haga mal'), 'critic intro quote must stay sarcastic');
  // (2) Ben & Jerry's ya no existe en la app (propietario, sep 2026). Antes se
  //     vetaba sólo en el juego con _txDishBanned; ahora las dos fichas (103
  //     postres y 119 almuerzo) están fuera de DISHES, de las matrices por id,
  //     de las fotos y del maridaje. Ni la marca ni el helper pueden volver.
  assert(!/jerry/i.test(html), 'Ben & Jerry\'s must not appear anywhere in the app');
  assert(!html.includes('_txDishBanned'),
    'the per-dish ban helper is gone — the dishes were removed, not filtered');
  for (const id of ['103', '119']) {
    assert(!new RegExp(`\\{id:${id},`).test(html), `dish ${id} (Ben & Jerry's) must stay deleted from DISHES`);
    for (const mapa of ['DISH_ACTIONS', 'DISH_COMPONENTS', 'DISH_SERVICE']) {
      const linea = html.slice(html.indexOf(`const ${mapa} =`), html.indexOf('\n', html.indexOf(`const ${mapa} =`)));
      assert(!new RegExp(`[{,]\\s*"?${id}"?\\s*:`).test(linea), `${mapa} still keys dish ${id}`);
    }
  }
  // (3) +1s por nivel: leer la pregunta ya consume tiempo. Valores exactos.
  const lv = html.slice(html.indexOf('const TXOKO_LEVELS=['), html.indexOf('];', html.indexOf('const TXOKO_LEVELS=[')));
  for (const t of ['time:14', 'time:11', 'time:8', 'time:6']) {
    assert(lv.includes(t), `TXOKO_LEVELS must carry the +1s budgets (missing ${t})`);
  }
});

test('study shift filter: Error Mode (Puntos Débiles) subject pool routes by shift', () => {
  // Regresión (jul 2026, barrido exhaustivo): startErrorMode elegía el plato-
  // sujeto de getFailedDishes() SIN filtrar por turno — medido: 47% del pool
  // eran platos de otro turno en modo almuerzo. Ahora filtra con fallback.
  assert(/const _failedSh=_shiftDishes\(_failedAll\);\s*\n\s*const failed=_failedSh\.length\?_failedSh:_failedAll;/.test(html),
    'startErrorMode subject pool must be shift-filtered with a safe fallback');

  // Guard empírico: ejecutar el startErrorMode real y exigir 0 sujetos de otro
  // turno en modo almuerzo/cena, con suficientes preguntas (sin sobre-filtrar).
  const cut = (a, b) => { const i = html.indexOf(a); assert(i !== -1, 'missing ' + a); return html.slice(i, html.indexOf(b, i) + b.length); };
  const fn = (name) => { const sig = 'function ' + name + '('; const i = html.indexOf(sig); assert(i !== -1, 'missing fn ' + name); let depth = 0, k = html.indexOf('{', i);
    while (true) { const ch = html[k]; if (ch === '{') depth++; else if (ch === '}') { depth--; if (depth === 0) return html.slice(i, k + 1); } k++; } };
  const dishesSrc = cut('const DISHES = [', '\n];');
  const svcSrc = cut('const DISH_SERVICE = {', '};') + ';';
  const helpers = html.slice(html.indexOf('let _studyShift'), html.indexOf('function computeDishAllergens'));
  const topicsSrc = cut('const TOPICS=[', '\n];');
  const env = `var LANG='es';var localStorage={getItem:()=>null,setItem:()=>{}};function _renderShiftBar(){}
    function allergenLocal(a){return a;} function getDish(d){return d;}
    function t(k,a){ if(k==='noHistory')return '__NOHIST__'; if(k==='noAllergens')return '__NOALLERG__'; return (k||'')+(a?(' '+a):''); }
    function showTab(){} var currentUser='u'; var _emp={examCorrect:{},sessions:[]}; function getEmp(){return _emp;}
    var examConfig={cat:'all',topic:'mixed',count:15};
    var examDishes=[],examIndex=0,examScore=0,examAnswered=false,examActive=false,examResults=null,examStartTime=0;`;
  const M = new Function(env + dishesSrc + '\n' + svcSrc + '\n' + helpers + '\n' + topicsSrc + '\n' // eslint-disable-line no-new-func
    + fn('_lqaShuffle') + fn('_pickDistractorPool') + fn('getFailedDishes') + fn('startErrorMode')
    + 'return {DISHES, DISH_SERVICE, setShift:(s)=>{_studyShift=s;}, run:()=>{examDishes=[];examActive=false;startErrorMode();return examDishes.slice();}};')();
  const svc = M.DISH_SERVICE;
  for (const shift of ['a', 'c']) {
    M.setShift(shift);
    let nQ = 0, leak = 0;
    for (let i = 0; i < 120; i++) {
      const qs = M.run(); nQ += qs.length;
      for (const q of qs) { const s = svc[q.dish.id]; if (s !== 'ambos' && s !== shift) leak++; }
    }
    assert(nQ > 500, `Error Mode produced too few questions in shift ${shift} (${nQ}) — over-filtered?`);
    assert(leak === 0, `Error Mode leaked ${leak} wrong-shift subject dishes in shift ${shift}`);
  }
});

test('login fits one phone screen; Share/Update buttons prominent', () => {
  // Petición del propietario: nada de arrastrar en el login, y Compartir/
  // Actualizar se veían "muy poco". Medido en headless a 390x844: el botón
  // Actualizar termina en y=833 (cabe). Candados de las reglas que lo logran.
  const css = read('styles.css');
  assert(/#screenLogin\{padding:1rem \.9rem \.8rem\}/.test(css), 'mobile login compaction missing');
  assert(/\.login-error:empty\{min-height:0/.test(css), 'empty error div must not reserve height');
  assert(/\.login-logo h1\{font-size:2\.35rem\}/.test(css), 'mobile logo size missing');
  assert(/max-height:720px/.test(css), 'short-screen (iPhone SE) tier missing');
  // Los botones del pie con presencia: borde y texto firmes, fondo sutil
  const shareBtn = html.slice(html.indexOf('onclick="shareApp()"'), html.indexOf('onclick="shareApp()"') + 400);
  assert(/rgba\(196,154,60,\.55\)/.test(shareBtn) && /rgba\(196,154,60,\.08\)/.test(shareBtn),
    'Share button must have the strengthened border + subtle fill');
  const updBtn = html.slice(html.indexOf('onclick="forceAppUpdate()"'), html.indexOf('onclick="forceAppUpdate()"') + 400);
  assert(/rgba\(196,154,60,\.55\)/.test(updBtn), 'Update button must have the strengthened border');
});

test('avatar system: branded SVG medallions, no emojis, self-styled picker', () => {
  // Reporte del propietario: el selector salía como texto crudo (las clases
  // avatar-picker-* nunca existieron en styles.css) y las opciones eran
  // letras/símbolos pobres. Ahora: medallones SVG de marca, sin emojis, y el
  // modal lleva TODOS sus estilos inline (no puede renderizar desnudo).
  const iA = html.indexOf('const AVATAR_ICONS = {');
  assert(iA !== -1, 'AVATAR_ICONS missing');
  const icons = html.slice(iA, html.indexOf('function _avatarSvg', iA));
  const count = (icons.match(/\{c:'#/g) || []).length;
  assert(count >= 18, `avatar icon set shrank (${count})`);
  assert(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(icons), 'emoji found in avatar icons — owner banned them');
  assert(!/const AVATAR_OPTIONS/.test(html), 'legacy letter/symbol AVATAR_OPTIONS must stay retired');
  // Ambos renderers entienden icon:
  const rsa = html.slice(html.indexOf('function renderSmallAvatar'), html.indexOf('function renderSmallAvatar') + 2400);
  assert(/indexOf\('icon:'\)/.test(rsa) && /_avatarSvg/.test(rsa), 'renderSmallAvatar must render icon: avatars');
  const rha = html.slice(html.indexOf('function _renderHeaderAvatar'), html.indexOf('function getEmpAvatar'));
  assert(/indexOf\('icon:'\)/.test(rha), 'header avatar must render icon: avatars');
  // El picker es autosuficiente: estilos inline, sin depender de clases CSS
  const pk = html.slice(html.indexOf('function openAvatarPicker'), html.indexOf('function selectAvatar'));
  assert(/overlay\.style\.cssText = 'position:fixed/.test(pk), 'picker overlay must carry inline styles');
  assert(!/class="avatar-grid"/.test(pk) && !/class="avatar-picker-modal"/.test(pk),
    'picker must not depend on the never-defined avatar-picker CSS classes');
  assert(/safe-area-inset-top/.test(pk), 'picker must respect the iOS notch');
});

test('app header respects the iOS notch (safe-area inset)', () => {
  // black-translucent + viewport-fit=cover extienden la página bajo la barra
  // de estado de iOS: con height fija la cabecera quedaba DEBAJO del reloj y
  // sus botones eran intocables (reporte del propietario, iPhone de sala).
  const css = read('styles.css');
  const hdr = css.slice(css.indexOf('.app-header{'), css.indexOf('.header-logo{'));
  assert(/height:calc\(56px \+ env\(safe-area-inset-top/.test(hdr), 'header height must grow with the notch');
  assert(/padding:env\(safe-area-inset-top/.test(hdr), 'header padding must push content below the status bar');
  assert(/viewport-fit=cover/.test(html) && /black-translucent/.test(html),
    'iOS viewport/status-bar metas changed — re-audit safe-area handling');

  // Y debe CABER en un iPhone estrecho: el reporte "los botones no responden
  // y no pueden cambiar el idioma" era la fila desbordando — EN y Salir
  // quedaban fuera de pantalla a 375-390px. Compresión responsiva medida en
  // headless a 375px: todos los controles (ES, EN, Salir) dentro del ancho.
  assert(/@media \(max-width:520px\)\{\s*\n?\s*\.app-header\{padding-left:\.7rem/.test(css.replace(/\r/g,'')),
    'narrow-screen header compression missing');
  assert(/\.header-uname\{display:none\}/.test(css), 'username must hide on narrow screens (avatar identifies)');
  // Android estrecho (Galaxy S20 = 360px CSS): "Salir" se cortaba por la
  // derecha. Tiers de compresión extra a ≤400px y ≤340px; medido en headless:
  // Salir dentro del ancho a 412/360/320px.
  assert(/@media \(max-width:400px\)/.test(css) && /@media \(max-width:340px\)/.test(css),
    'narrow-Android header compression tiers (400px/340px) missing');
});

test('force-update escape hatch + APP_VERSION synced to the SW', () => {
  // iOS PWAs se aferran a builds viejas (reporte del propietario: "en iPhone
  // sigue apareciendo la versión antigua"). El botón Actualizar del login
  // desregistra el SW, borra las cachés y recarga con cache-busting — sin
  // tocar localStorage — y muestra la versión realmente cacheada en el
  // dispositivo. APP_VERSION (cosmética, consola) debe ir SIEMPRE a la par
  // de la VERSION del service worker: llevaba clavada en 5.8.3 desde mayo.
  assert(/async function forceAppUpdate\(\)/.test(html), 'forceAppUpdate missing');
  const f = html.slice(html.indexOf('async function forceAppUpdate'), html.indexOf('async function forceAppUpdate') + 900);
  assert(/unregister\(\)/.test(f) && /caches\.delete\(k\)/.test(f) && /localStorage/.test(f) === false,
    'forceAppUpdate must unregister SW + clear caches and never touch localStorage');
  assert(/\?upd=/.test(f), 'forceAppUpdate must reload with cache-busting');
  assert(/onclick="forceAppUpdate\(\)"/.test(html), 'update button missing from login footer');
  assert(/txoko-shell-/.test(html.slice(html.indexOf('_showCachedVersion'), html.indexOf('_showCachedVersion') + 700)),
    'cached-version label must read the real SW cache name');
  const swv = read('sw.js').match(/const VERSION = 'v([\d.]+)';/)[1];
  const appv = html.match(/const APP_VERSION='([\d.]+)'/)[1];
  assert(swv === appv, `APP_VERSION (${appv}) must match sw.js VERSION (${swv}) — bump both together`);
  // La META app-version también debe ir a la par: quedó atrás en main (7.307
  // vs 7.309) sin que este guard lo viera. Tres sitios, una sola versión.
  const metav = html.match(/<meta name="app-version" content="([\d.]+)">/)[1];
  assert(metav === appv, `meta app-version (${metav}) must match APP_VERSION (${appv}) — bump all three`);

  // El botón también avisa si el servidor tiene versión más nueva que la
  // cacheada (fetch de sw.js con no-store y comparación).
  const scv = html.slice(html.indexOf('_showCachedVersion'), html.indexOf('_showCachedVersion') + 1600);
  assert(/cache: 'no-store'/.test(scv) && /!== local/.test(scv), 'update button must detect a newer published version');
});

test('ghost inactivity interceptor stays dead: no callers + kill-switch', () => {
  // El propietario eliminó el Servicio Fantasma por inactividad; se siguió
  // viendo en dispositivos con la build ANTIGUA cacheada (justo los
  // inactivos). Triple candado en la build actual: (1) cero llamadas a
  // launchServicioFantasma/_sfShouldTrigger, (2) kill-switch dentro de la
  // propia función, (3) el onboarding ya no promete la intercepción.
  const launches = (html.match(/launchServicioFantasma\(/g) || []).length;
  assert(launches === 1, `launchServicioFantasma has ${launches - 1} caller(s) — must have none (definition only)`);
  const triggers = (html.match(/_sfShouldTrigger\(/g) || []).length;
  assert(triggers === 1, `_sfShouldTrigger has ${triggers - 1} caller(s) — must have none`);
  assert(/if\(!window\.__SF_ENABLED\) return false;[\s\S]{0,120}_sfDifficulty/.test(html),
    'launchServicioFantasma kill-switch missing');
  assert(!/Servicio Fantasma te pondrá a prueba/.test(html) && !/Ghost Service will test you/.test(html),
    'onboarding still promises the removed inactivity interceptor');
});

test('offer rules: kids menu and Vegetariano never recommended to generic guests', () => {
  // Reglas del propietario (jul 2026, reporte en vivo): el Fish and chips de
  // la CENA es solo del menú infantil y los platos Vegetariano solo se
  // recomiendan a vegetarianos. El Servicio Fantasma recomendaba ambos en
  // una pregunta que además pedía ENTRANTES con un pool de cualquier
  // categoría. _simOfferable centraliza la regla; se verifica ejecutándola.
  // El plato infantil era el Fish and chips de cena. Salió de la carta en sep
  // 2026 y el propietario confirmó que el del almuerzo NO hereda la marca, así
  // que hoy la lista está vacía — pero la regla tiene que seguir existiendo,
  // porque el día que haya carta infantil se marca ahí.
  assert(/KIDS_ONLY_DISH_IDS = new Set\(\[\]\)/.test(html),
    'la lista de platos solo-infantiles debe existir aunque esté vacía');
  assert(/!KIDS_ONLY_DISH_IDS\.has\(d\.id\)/.test(html),
    '_simOfferable tiene que seguir consultándola');
  const cut = (start, endMark) => { const i = html.indexOf(start); assert(i !== -1, 'missing ' + start); return html.slice(i, html.indexOf(endMark, i)); };
  const dishesSrc = cut('const DISHES = [', '\n];') + '\n];';
  // extrae _simIsSideNamed + KIDS_ONLY + _simOfferable por marcadores fijos
  const iH = html.indexOf('function _simIsSideNamed(d){');
  const jH = html.indexOf('function _simOfferable(d){');
  const kH = html.indexOf('}', jH) + 1;
  const src = html.slice(iH, kH);
  const stubs = "const LANG='es'; function getDish(d){return d;} const DISHES_EN=[];";
  const f = new Function(stubs + dishesSrc + src + '; return {DISHES, _simOfferable};'); // eslint-disable-line no-new-func
  const { DISHES, _simOfferable } = f();
  const arroz = DISHES.find(d => d.id === 53);
  assert(arroz && !_simOfferable(arroz), 'Arroz cremoso (Vegetariano) must NOT be a generic recommendation');
  assert(DISHES.filter(d => d.cat === 'Entrantes' && _simOfferable(d)).length >= 10,
    'offerable starters pool collapsed');
  // Consumidores: SR SafeAlternative/WhichAdaptable y SF alergia (entrantes)
  const sfA = html.slice(html.indexOf("if(sc.type==='alergia')"), html.indexOf("} else if(sc.type==='maridaje')"));
  assert(/cat==='Entrantes' && _sfOfr\(d\)/.test(sfA), 'ghost-service alergia must draw offerable STARTERS (text asks for entrantes)');
  const wa2 = html.slice(html.indexOf('function _scenarioWhichAdaptable'), html.indexOf('function _srWaitMins'));
  assert(/_simOfferable\(d\)/.test(wa2), 'WhichAdaptable offers must be offerable');
});

test('smart review provenance: DISH_COMPONENTS-driven, executed, anti-obvious', () => {
  // FASE 4 en el entrenamiento: las preguntas de procedencia derivan de
  // DISH_COMPONENTS (base única validada). El guard EJECUTA los builders con
  // los datos reales: bien formadas, sin opciones duplicadas y la correcta
  // nunca delata el alérgeno por morfología (mantequilla→Lácteos prohibido
  // como correcta: la pregunta exige conocer la ficha, no saber clasificar).
  const cut = (start, endMark) => {
    const i = html.indexOf(start); assert(i !== -1, 'missing: ' + start);
    return html.slice(i, html.indexOf(endMark, i));
  };
  const dishesSrc = cut('const DISHES = [', '\n];') + '\n];';
  const compsSrc = cut('const DISH_COMPONENTS = {', '};') + '};';
  const buildersSrc = cut('const _SR_OBVIOUS = {', '// ═══ Main generator');
  assert(/DISH_COMPONENTS\[dish\.id\]/.test(buildersSrc), 'builders must read DISH_COMPONENTS');
  const gen = html.slice(html.indexOf('function _srGenerateQuiz'), html.indexOf('function _srGenerateQuiz') + 3500);
  assert(/_scenarioAllergenSource/.test(gen) && /_scenarioComponentAllergen/.test(gen),
    'provenance builders missing from the Smart Review rotation');
  const stubs = "const LANG='es';" +
    "function _djShuffle(a){const x=[...a];for(let i=x.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[x[i],x[j]]=[x[j],x[i]];}return x;}" +
    "function _simPick(a){return a[Math.floor(Math.random()*a.length)];}" +
    "function _simAllergenLabel(a,en){return a;}";
  const f = new Function(stubs + dishesSrc + compsSrc + buildersSrc + // eslint-disable-line no-new-func
    "return {DISHES, _scenarioAllergenSource, _scenarioComponentAllergen, _srNorm, _srObviousSource};");
  const { DISHES, _scenarioAllergenSource, _scenarioComponentAllergen, _srNorm, _srObviousSource } = f();
  assert(_srNorm('Lácteos') === 'lacteos', '_srNorm must strip diacritics (combining-class regex intact)');
  assert(_srObviousSource('Lácteos', 'Mantequilla') && _srObviousSource('Pescado', 'Atún')
    && !_srObviousSource('Sulfitos', 'Mirim'), 'obviousness filter broken');
  let made = 0;
  for (let round = 0; round < 4; round++) {
    for (const d of DISHES) {
      for (const fn of [_scenarioAllergenSource, _scenarioComponentAllergen]) {
        const q = fn(d, d, false);
        if (!q) continue;
        made++;
        assert(q.options.length === 4 && q.correctIdx >= 0 && q.correctIdx < 4
          && q.options.filter(o => o === q.options[q.correctIdx]).length === 1,
          `malformed provenance question for dish ${d.id}: ${q.q}`);
        assert(new Set(q.options.map(o => o.toLowerCase())).size === 4,
          `duplicate options for dish ${d.id}: ${q.options.join(' | ')}`);
        // Anti-fuga de nombre: la correcta de "¿qué componente lo aporta?"
        // no puede compartir palabra con el nombre del plato (Focaccia ↔
        // "Focaccia con vegetales" se respondía leyendo el enunciado).
        if (fn === _scenarioAllergenSource) {
          const dt = new Set(_srNorm(d.name).split(/[^a-z0-9ñ]+/).filter(w => w.length > 3));
          const leak = _srNorm(q.options[q.correctIdx]).split(/[^a-z0-9ñ]+/).some(w => w.length > 3 && dt.has(w));
          assert(!leak, `name leak: dish "${d.name}" answer "${q.options[q.correctIdx]}"`);
        }
      }
    }
  }
  assert(made >= 400, `provenance yield collapsed (${made} questions from 4 rounds)`);
  // El Simulacro de Alérgenos mezcla los MISMOS builders (~30% procedencia):
  // misma calidad medida en las dos superficies, sin generador duplicado.
  const drill = html.slice(html.indexOf('function buildAllergenQuestions'), html.indexOf('function startAllergenTest'));
  assert(/_scenarioAllergenSource/.test(drill) && /_scenarioComponentAllergen/.test(drill),
    'allergen drill must mix the provenance builders');
  const rq = html.slice(html.indexOf('function renderAllergenQuestion'), html.indexOf('function answerAllergenTest'));
  assert(/q\.prompt \|\|/.test(rq), 'drill renderer must honour per-question prompt label');
  const aq = html.slice(html.indexOf('function answerAllergenTest'), html.indexOf('function renderAllergenResults'));
  assert(/q\.explain/.test(aq), 'drill feedback must show the provenance explanation');
});

test('Reto del Día: ingredient subjects are clean tokens, no section labels', () => {
  // El tipo 'ingredient' preguntaba «¿qué plato lleva X?» donde X salía de un
  // split(/[,.]/) crudo — dejaba el prefijo de sección pegado y producía
  // sujetos absurdos: «Topping: loncha de jamón», «Masa: Leche», «Aderezo
  // césar: Huevo» (agravado por la división de las croquetas). El generador
  // debe tokenizar con _simExtractIngredients (parte por ':' y limpia
  // paréntesis) y descartar etiquetas de sección. Candado: ejecuta el
  // generador determinista sobre 1000 días × 2 idiomas y verifica que ningún
  // sujeto de ingrediente contiene ':' '/' paréntesis ni una etiqueta de
  // sección. Corre los MISMOS builders reales, no una regex sobre el fuente.
  const cut = (a, b) => { const i = html.indexOf(a); assert(i !== -1, 'missing ' + a); return html.slice(i, html.indexOf(b, i)); };
  const fnBody = (name) => { const s = html.indexOf('function ' + name + '('); let d = 0, k = html.indexOf('{', s); for (;;) { const c = html[k]; if (c === '{') d++; else if (c === '}') { d--; if (d === 0) return html.slice(s, k + 1); } k++; } };
  const dishesSrc = cut('const DISHES = [', '\n];') + '\n];';
  const svcSrc = cut('const DISH_SERVICE = {', '};') + '};';
  const block = html.slice(html.indexOf('const _SIM_PROFILES = {'), html.indexOf('function _srGenerateQuiz('));
  const stub = 'let LANG="es";const DISHES_EN=[];function getDish(d){return d;}function _djShuffle(a){return a;}'
    + 'function escapeHTML(s){return s;}function _srCap(s){return s;}function _shiftDishes(a){return a;}function catLocal(c){return c;}';
  const M = new Function(stub + '\n' + dishesSrc + '\n' + svcSrc + '\n' + block + '\n' // eslint-disable-line no-new-func
    + fnBody('_mulberry32') + '\n' + fnBody('_dqSample') + '\n' + fnBody('_normName') + '\n' + fnBody('_dqQuestion')
    + '\nreturn {_dqQuestion, setLang:(l)=>{LANG=l;}};')();
  const dayStr = (n) => { const d = new Date(2026, 0, 1); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const STRUCT = /^(masa|topping|base|relleno|guarnici|sabores|caldo|bisque|fondo)\b/i;
  // Cantidades y pesos que el troceo dejaba como si fueran ingredientes:
  // «180 grs de carne de buey», «Tomahawk de Hereford 1», «1 Pularda».
  const CANT = /\d|\b(grs?|kg|gramos?|ml|cl|litros?|uds?|unidades?|numero|n[ºo])\b/i;
  // Palabras con carga: que coincida «de» o «con» no delata nada.
  const VACIAS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'con', 'al', 'y', 'en', 'un', 'una', 'sobre', 'estilo',
                          'the', 'of', 'and', 'with', 'from']);
  const pal = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 3 && !VACIAS.has(w));
  let ing = 0;
  for (const lang of ['es', 'en']) {
    M.setLang(lang);
    for (let n = 0; n < 1000; n++) {
      const q = M._dqQuestion(dayStr(n));
      const nOpt = q.type === 'service' ? 3 : 4;
      assert(q.opts && q.opts.length === nOpt && q.correctIdx >= 0 && q.correctIdx < nOpt,
        `Reto del Día malformed (${lang}): ${JSON.stringify(q)}`);
      assert(new Set(q.opts.map((o) => String(o).toLowerCase())).size === q.opts.length,
        `Reto del Día duplicate options (${lang}): ${q.q}`);
      const m = q.q.match(/«([^»]+)»|[“]([^”]+)[”]/);
      if (m && /lleva |includes /.test(q.q)) {
        ing++;
        const tk = m[1] || m[2];
        assert(!/[:\/()]/.test(tk), `Reto del Día: ingredient subject has an artifact token (${lang}): «${tk}»`);
        assert(!STRUCT.test(tk), `Reto del Día: ingredient subject is a section label (${lang}): «${tk}»`);
        // ── La respuesta no puede estar en el enunciado ──────────────────
        // Reporte del propietario (ago 2026): «las preguntas del día son
        // absurdas». El caso que enseñó: «¿Qué plato lleva "Alitas de
        // pollo"?» → «Alitas melosas glaseadas». Medido entonces: 19 de las
        // 80 preguntas de este tipo al año (24 %) se regalaban así.
        assert(!CANT.test(tk),
          `Reto del Día: el sujeto es una cantidad, no un ingrediente (${lang}): «${tk}»`);
        const nombre = new Set(pal(q.opts[q.correctIdx]));
        const eco = pal(tk).filter((w) => nombre.has(w));
        assert(eco.length === 0,
          `Reto del Día: la respuesta está en el enunciado (${lang}): «${tk}» → «${q.opts[q.correctIdx]}» ` +
          `(comparten: ${eco.join(', ')})`);
      }
    }
  }
  assert(ing >= 100, `Reto del Día ingredient questions collapsed (${ing})`);
});

test('pairingExplanations: every entry matches a dish still on the menu', () => {
  // Los mapas indexados por nombre de plato quedan huérfanos en silencio
  // cuando un plato sale de la carta (pasó con el Rejo de pulpo): la entrada
  // nunca se ejecuta pero envejece como dato muerto. Candado: cada clave del
  // mapa de narrativas de maridaje debe corresponder a un plato actual.
  const iP = html.indexOf('const pairingExplanations = {');
  assert(iP !== -1, 'pairingExplanations map missing');
  // fin del mapa: la primera '};' a nivel de indentación 2
  const jP = html.indexOf('\n  };', iP);
  const mapSrc = html.slice(iP, jP);
  const keys = [...mapSrc.matchAll(/\n    '((?:[^'\\]|\\.)*)': \{/g)].map(m => m[1].replace(/\\'/g, "'"));
  assert(keys.length >= 10, `pairing map suspiciously small (${keys.length} keys)`);
  const norm = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const iEs = html.indexOf('const DISHES = ['), jEs = html.indexOf('\n];', iEs);
  const names = new Set([...html.slice(iEs, jEs).matchAll(/name:'((?:[^'\\]|\\.)*)'/g)]
    .map(m => norm(m[1].replace(/\\'/g, "'").replace(/ \((Almuerzo|Cena)\)$/i, ''))));
  // match laxo: todas las palabras significativas de la clave aparecen en el
  // nombre de algún plato ('pluma ibérica' ↔ 'Pluma de cerdo Ibérico').
  const STOP = new Set(['de', 'del', 'la', 'el', 'con', 'al', 'a', 'y', 'en']);
  const stem = w => w.replace(/(os|as|es)$/, '').replace(/[ao]$/, '');
  const toks = s2 => norm(s2).split(/[^a-z0-9ñ]+/).filter(w => w && !STOP.has(w)).map(stem);
  const nameToks = [...names].map(n => new Set(toks(n)));
  // Allowlist VACÍA: el propietario cerró todas las dudas (jul 2026) — los
  // 8 cortes son fichas reales y la narrativa de Ben & Jerry's se eliminó
  // junto a sus maridajes. Cualquier huérfano nuevo debe fallar aquí.
  const PENDING_OWNER = new Set([]);
  for (const k of keys) {
    if (PENDING_OWNER.has(norm(k))) continue;
    const kt = toks(k);
    assert(nameToks.some(nt => kt.every(w => nt.has(w))),
      `pairing narrative for "${k}" matches no dish on the menu (orphan — dish removed?)`);
  }
});

test('ES and EN dish twins declare identical allergens', () => {
  // The EN cards are hand-written too — a divergent twin misinforms staff
  // using the app in English (found live: EN Croquettes missing Molluscs and
  // Mustard). Locked: every twin must match through the vocabulary map.
  const MAP = { 'Lácteos':'Dairy','Huevos':'Eggs','Pescado':'Fish','Crustáceos':'Crustaceans',
    'Moluscos':'Molluscs','Sulfitos':'Sulphites','Frutos secos':'Tree nuts',
    'Granos de sésamo':'Sesame seeds','Cacahuete':'Peanut','Apio':'Celery',
    'Mostaza':'Mustard','Soja':'Soy','Gluten':'Gluten','Altramuces':'Lupin' };
  const parse = (block) => {
    const out = {};
    for (const m of block.matchAll(/\{id:(\d+)(?:,cat:'[^']*')?,name:'((?:[^'\\]|\\.)*)',allergens:\[([^\]]*)\]/g)) {
      out[m[1]] = { name: m[2], alg: [...m[3].matchAll(/'([^']+)'/g)].map(x => x[1]).sort() };
    }
    return out;
  };
  const iEn = html.indexOf('const DISHES_EN = ['), jEn = html.indexOf('\n];', iEn);
  const iEs = html.indexOf('const DISHES = ['), jEs = html.indexOf('\n];', iEs);
  const EN = parse(html.slice(iEn, jEn)), ES = parse(html.slice(iEs, jEs));
  for (const id of Object.keys(ES)) {
    assert(EN[id], `dish ${id} "${ES[id].name}" has no EN twin`);
    const expected = ES[id].alg.map(a => MAP[a] || `??${a}`).sort();
    assert(JSON.stringify(expected) === JSON.stringify(EN[id].alg),
      `dish ${id} "${ES[id].name}": EN twin allergens diverge (ES→${expected.join(',')} vs EN ${EN[id].alg.join(',')})`);
  }
});

test('búsqueda: alias de plato (aka) indexado — "Txuleta de atún" encuentra el Lomo', () => {
  // El mismo plato se oye llamar de dos formas. El plating guide 2026 lo llama
  // «Lomo de atún con tomate en texturas», así que ése es el nombre oficial y
  // el alias pasa a ser el antiguo: quien aprendió «Txuleta» sigue encontrándolo.
  assert(/\{id:21,cat:'Platos Principales',name:'Lomo de atún con tomate en texturas',aka:'Txuleta de atún',/.test(html),
    'id21 debe llamarse «Lomo de atún…» y llevar aka:"Txuleta de atún"');
  const idx = html.slice(html.indexOf('function _gsDishIndex'), html.indexOf('function _gsWineIndex'));
  assert(/d\.aka\|\|''/.test(idx), '_gsDishIndex debe incluir d.aka en el texto buscable');
});

test('no dish in the Vegetariano category self-declares as not vegetarian', () => {
  // Owner call (Jul 2026): the potato purée sat in Vegetariano while its own
  // card warned "NO es vegetariano (caldo de pollo)" — moved to Guarniciones.
  // Lock the class of contradiction, not just that dish.
  const i = html.indexOf('const DISHES = [');
  const j = html.indexOf('\n];', i);
  const dishes = html.slice(i, j);
  for (const m of dishes.matchAll(/\{id:(\d+),cat:'Vegetariano'[^\n]*/g)) {
    assert(!/NO es vegetariano/i.test(m[0]), `dish id:${m[1]} is in Vegetariano but its notes say it is not vegetarian`);
  }
});

// ─── 6c. Employee PIN server-verify wiring ──────────────────────
console.log('\nAuth hardening');
test('verificación del PIN de empleado en servidor (SHA RPCs) ACTIVADA', () => {
  const m = html.match(/const USE_SERVER_EMP_PIN_VERIFY\s*=\s*(true|false)\s*;/);
  assert(m, 'USE_SERVER_EMP_PIN_VERIFY flag missing');
  // jul 2026: ACTIVADO. Las RPCs verify_employee_pin_sha / set_employee_pin_sha
  // están desplegadas; el cliente ya no lee/escribe employees.pin.
  assert(m[1] === 'true', 'USE_SERVER_EMP_PIN_VERIFY debe estar en true (RPCs SHA desplegadas)');
  assert(/rpc\/verify_employee_pin_sha/.test(html), 'debe usar verify_employee_pin_sha');
  assert(/rpc\/set_employee_pin_sha/.test(html), 'debe usar set_employee_pin_sha');
  assert(/rpc\/employee_has_pin/.test(html), 'debe usar employee_has_pin para "entrar vs crear"');
  // el hash del pin ya NO se sube en los payloads de employees
  assert(!/\bpin:\s*pin\b/.test(html) && !/\bpin:\s*emp\.pin\b/.test(html),
    'los upserts de employees NO deben incluir el hash del pin');
  // las lecturas de employees excluyen la columna pin
  assert(/const _EMP_COLS\s*=/.test(html) && !/_EMP_COLS[^']*\bpin\b/.test(html),
    '_EMP_COLS (columnas leídas) no debe incluir pin');
  assert(/async function verifyEmployeePinServer\(/.test(html), 'verifyEmployeePinServer() missing');
  assert(/async function setEmployeePinServer\(/.test(html), 'setEmployeePinServer() missing');
});

test('supabase/employee_pin.sql defines the verify/set RPCs and locks the table', () => {
  const sql = read('supabase/employee_pin.sql');
  assert(/create or replace function public\.verify_employee_pin\(/.test(sql), 'verify_employee_pin RPC missing');
  assert(/create or replace function public\.set_employee_pin\(/.test(sql), 'set_employee_pin RPC missing');
  assert(/revoke all on public\.employee_pin_secret from anon/.test(sql), 'secret table not revoked from anon');
  assert(/gen_salt\('bf'/.test(sql), 'not using bcrypt (gen_salt bf)');
});

// ─── 6d. Quiz generator distractor-quality guards ───────────────
console.log('\nQuiz generators');
test('"Which ingredient is NOT in this dish?" rejects substring-ambiguous fakes', () => {
  // The fix added a bidirectional substring filter so we never produce
  // questions like "Which is NOT in this dish? Egg / Egg yolk / Squid / Onion"
  // where the fake ("Egg") is a substring of a real ingredient ("Egg yolk").
  const m = /fakeIng = _djShuffle\(otherIngs\.filter\(i => \{([\s\S]*?)\}\)\)/.exec(html);
  assert(m, 'fake-ingredient filter signature changed — bug-2 guard may be gone');
  const body = m[1];
  // Both directions of substring overlap must be filtered out.
  assert(/real\.includes\(il\)/.test(body),
    'filter must reject fakes that are substrings of real ingredients (real.includes(il))');
  assert(/il\.includes\(real\)/.test(body),
    'filter must reject real ingredients that are substrings of the fake (il.includes(real))');
});

test('modification quiz excludes the dish-defining ingredient from distractors', () => {
  // The fix added isDishDefining() so we no longer produce options like
  // "Comandar SIN CALAMAR" for Calamares a la Andaluza — those are obvious
  // throwaways that defeat the test.
  assert(/const isDishDefining\s*=/.test(html),
    'isDishDefining helper missing — bug-3 guard may be gone');
  assert(/_simExtractIngredients\(src\)\.filter\(i =>[\s\S]*?!isDishDefining\(i\)/.test(html),
    'distractor pool must filter out dish-defining ingredients');
});

// ─── 6e. Dashboard hierarchy — action-first, no duplication ─────
console.log('\nDashboard hierarchy');
test('hero is slim: no motivational quote, no duplicate level title', () => {
  // The motivational quote and the badge-side level title were causing
  // visual clutter and a duplicate (the XP bar already shows the title).
  // These regressions matter because the user reports the screen feels
  // overwhelming — keep the hero a single source of truth.
  assert(!/dash-hero-quote/.test(html), 'hero motivational quote is back');
  assert(!/dash-hero-lvl-title/.test(html), 'duplicate level title in hero badge is back');
  assert(!/motivations_es|motivations_en/.test(html), 'dead motivational quote arrays returned');
});

test('dashboard: una sola escalera de progreso (la barra de XP)', () => {
  // Petición del propietario (ago 2026): «esto es innecesario y sobreestimula
  // de información al usuario, tampoco tiene relación con la barra de
  // experiencia». El Inicio mostraba TRES progresos que se contradecían:
  // barra XP (Lv.7), «Próximo rango 0%» y hexágonos por tema al 95%, más una
  // statline con «0 dominados» junto a «89% media». Ahora el Inicio solo
  // lleva la barra de XP; el detalle vive en Ranking → Estadísticas.
  const dashStart = html.indexOf("document.getElementById('appContent').innerHTML=`", html.indexOf('function renderDashboard'));
  assert(dashStart !== -1, 'renderDashboard innerHTML template not found');
  const dashEnd = html.indexOf('`;', dashStart);
  const dashTpl = html.slice(dashStart, dashEnd);
  assert(dashTpl.indexOf('HOY:') !== -1, 'HOY section missing');
  assert(dashTpl.indexOf('STATS STRIP') === -1, 'the boxed stats strip must stay removed');
  assert(!/dash-statline/.test(dashTpl), 'la statline de 4 cifras debe seguir fuera del Inicio');
  assert(!/'Your progress':'Tu progreso'/.test(dashTpl), 'la sección «Tu progreso» debe seguir fuera del Inicio');
  assert(!/Next rank|Próximo rango/.test(dashTpl), 'la fila «Próximo rango» debe seguir fuera del Inicio');
  assert(/renderXPBar\(\)/.test(dashTpl), 'la barra de XP es la única medida de progreso del Inicio');
  // El detalle no se pierde: sigue existiendo en la pantalla de Estadísticas.
  const stats = html.slice(html.indexOf('function renderStats()'), html.indexOf('function renderVideos'));
  assert(/topicBars/.test(stats) && /t-stat-row/.test(stats),
    'Estadísticas debe conservar las barras de precisión por tema');
});

// ─── 6f. Latent-bug regression guards (sideways drift family) ───
console.log('\nLatent bug guards');
test('every fullscreen-ish overflow-y:auto container also clips X', () => {
  const css = read('styles.css');
  // The sideways-drift bug class: setting overflow-y:auto without taming
  // overflow-x lets touch scrollers drift diagonally, especially when a
  // child has a sticky :hover translateX. These selectors are fullscreen
  // or near-fullscreen, so they're the high-impact ones — child-level
  // pills/chips with their own intentional horizontal scrollers are fine.
  const mustClip = [
    '.sf-overlay', '.dj-body', '.ranks-body',
    '.wine-detail-overlay', '.login-employees'
  ];
  for (const sel of mustClip) {
    const ruleRe = new RegExp(`\\${sel}\\s*\\{[^}]*\\}`, 'g');
    let found = 0, clipped = 0;
    for (const m of css.matchAll(ruleRe)) {
      found++;
      if (/overflow-x\s*:\s*hidden/.test(m[0])) clipped++;
    }
    assert(found > 0, `selector ${sel} no longer defined`);
    assert(clipped === found, `${sel}: ${clipped}/${found} rules clip overflow-x — sideways drift regression`);
  }
});

test('hover translateX rules are scoped to @media(hover:hover)', () => {
  // On touch, :hover sticks after tap — if the hover shifts an element
  // horizontally and the parent doesn't clip X, you get the sideways
  // drift bug again. Every sideways hover transform must be inside a
  // hover-capable media query.
  const css = read('styles.css');
  // Find :hover rules that translateX and check the preceding 80 chars
  // include the media query.
  const re = /([\s\S]{0,80}):hover\s*\{[^}]*transform\s*:[^;}]*translateX/g;
  for (const m of css.matchAll(re)) {
    const context = m[1];
    assert(/@media\s*\(\s*hover\s*:\s*hover/.test(context),
      `unscoped :hover translateX near offset ${m.index} — touch will stick`);
  }
});

test('async render functions guard against tab-change races', () => {
  // When the user navigates away while a multi-fetch render is awaiting
  // Supabase, the final innerHTML overwrites the new tab. Every async
  // renderTab function must capture currentTab and bail before writing.
  for (const fn of ['renderVinos', 'renderDuel']) {
    const startIdx = html.search(new RegExp(`async function ${fn}\\(`));
    assert(startIdx !== -1, `${fn} no longer async — guard expectations stale`);
    // The body of the function is bounded by the next top-level function
    // declaration; grab a generous slice and check for the pattern.
    const slice = html.slice(startIdx, startIdx + 8000);
    assert(/const _startTab\s*=\s*currentTab/.test(slice) ||
           /var _startTab\s*=\s*currentTab/.test(slice),
      `${fn} missing _startTab capture — tab-change race regression`);
    assert(/currentTab\s*!==\s*_startTab/.test(slice),
      `${fn} missing currentTab !== _startTab guard`);
  }
});

test('quiz distractor pools prefer same-category dishes', () => {
  // The pedagogical bug: a "Tarta de queso: Queso San Millán, ..." option
  // appearing as distractor in an Entrantes ingredient quiz reveals itself
  // by name prefix — the trainee crosses it off without knowing the recipe.
  // _pickDistractorPool(d) filters to same-category dishes when possible
  // so distractors stay pedagogically valid.
  const helper = html.match(/function _pickDistractorPool\(d\)\s*\{[\s\S]{0,400}?\}/);
  assert(helper, '_pickDistractorPool helper missing — distractors will leak across categories');
  assert(/x\.cat\s*===\s*d\.cat/.test(helper[0]),
    '_pickDistractorPool no longer filters by category');
  assert(/sameCat\.length\s*>=?\s*6/.test(helper[0]),
    '_pickDistractorPool fallback threshold removed — small categories like Sugerencias will starve');
  // 1 definition + 4 callsites (startExam, smart review, error mode ×2 —
  // el del quiz en vivo se fue con el quiz en vivo, jul 2026)
  const usages = (html.match(/_pickDistractorPool\(/g) || []).length;
  assert(usages >= 5, `_pickDistractorPool used ${usages-1} times; expected 4 callsites`);
  // No raw `DISHES.filter(x=>x.id!==d.id)` should remain — those bypassed the category filter
  const orphans = (html.match(/DISHES\.filter\(x=>x\.id!==d\.id\)/g) || []).length;
  assert(orphans === 0, `${orphans} unfiltered DISHES distractor pools remain — re-introduces cross-category leaks`);
});

test('todayStr() uses Intl Atlantic/Canary, not manual UTC math', () => {
  // Before the fix, todayStr() returned the UTC date computed from
  // raw UTC hours. In CEST (UTC+1), between 00:00 and 01:00 Canary
  // local, the UTC date was still "yesterday" — streaks double-counted
  // and a single overnight session split across two day buckets. Intl
  // with the IANA zone is the only DST-safe way to compute this.
  const fn = html.match(/function todayStr\(\)\s*\{[\s\S]{0,600}?^\}/m);
  assert(fn, 'todayStr() function missing');
  assert(/Atlantic\/Canary/.test(fn[0]),
    'todayStr() no longer references Atlantic/Canary — manual DST math will silently break overnight');
  assert(/Intl\.DateTimeFormat/.test(fn[0]),
    'todayStr() no longer uses Intl — regressed to manual UTC math');
  // Verify the invariant the fix protects: 00:30 CEST should return the
  // Canary date, not the UTC date.
  const probe = new Intl.DateTimeFormat('en-CA', { timeZone: 'Atlantic/Canary' })
    .format(new Date(Date.UTC(2025, 5, 10, 23, 30)));
  assert(probe === '2025-06-11',
    `Intl Atlantic/Canary returned ${probe} instead of 2025-06-11 — runtime broken`);
});

test('modal a11y coverage ratchet', () => {
  // Number of createElement-based overlays wired into the central
  // setupModalA11y helper (ESC-to-close, focus trap, focus restoration,
  // role/aria-modal). This floor ratchets up as we migrate each modal;
  // dropping below it means a modal lost its keyboard accessibility.
  //
  // Migrated so far: delOverlay, notifOverlay, pinOverlay,
  // cloudPinOverlay, avatarPickerOverlay.
  // Remaining candidates: djOverlay (has custom keydown — needs care),
  // onboardingOverlay, wineDetailOverlay, smartOverlay (x2), sfOverlay,
  // ~10 total.
  // Count only real call sites: lines that invoke the helper with the
  // remove-callback pattern. Excludes the function definition, the
  // doc-comment example, and the window assignment.
  const calls = (html.match(/^\s+setupModalA11y\(overlay,\s*\(\)/gm) || []).length;
  assert(calls >= 5,
    `setupModalA11y wired to only ${calls} overlays; expected >= 5 after avatarPickerOverlay migration`);
});

test('mobile input font-size avoids iOS Safari auto-zoom trap', () => {
  // iOS Safari (mobile WebKit) auto-zooms <input> elements whose
  // computed font-size is below 16px when they receive focus. The zoom
  // shifts the layout and can hide the on-screen keypad behind the
  // input. Hot-path search inputs that the camarero uses during service
  // must sit at the 16px floor in the mobile media block.
  //
  // Currently audited: .gs-input (el buscador global, que es el que usa el
  // camarero en sala). Antes se auditaba .svc-search, del Modo Servicio, que
  // ya no existe. Add more selectors to this list as future passes migrate
  // other inputs.
  const css = read('styles.css');
  // Each selector in the list must have at least one mobile-context rule
  // where font-size is >= 16px. Walk every `.selector{...}` block,
  // measure font-size if present, and require at least one safe variant.
  for (const sel of ['.gs-input']) {
    const ruleRe = new RegExp(`\\${sel}\\s*\\{([^}]+)\\}`, 'g');
    const sizes = [];
    let m;
    while ((m = ruleRe.exec(css)) !== null) {
      const sizeMatch = m[1].match(/font-size:\s*([\d.]+)(rem|px|em)/);
      if (sizeMatch) {
        const px = sizeMatch[2] === 'px'
          ? parseFloat(sizeMatch[1])
          : parseFloat(sizeMatch[1]) * 16;
        sizes.push(px);
      }
    }
    assert(sizes.length > 0, `${sel} no font-size declared anywhere`);
    // The smallest declared font-size for this selector must clear 16px.
    // CSS cascade may make a larger value win at runtime, but the
    // mobile-context one (which is usually the smallest) is the trap.
    const min = Math.min(...sizes);
    assert(min >= 16,
      `${sel} declares font-size ${min}px somewhere — iOS Safari auto-zooms <16px inputs on focus`);
  }

  // Some inputs are styled inline (no CSS class) instead of via
  // styles.css. Audit those by id directly against the inline style
  // attribute on the <input id="..."> tag.
  // Currently audited: maridajeSearch (sommelier pairing search).
  const html = read('index.html');
  for (const id of ['maridajeSearch']) {
    const tagRe = new RegExp(`id="${id}"[^>]*style="([^"]+)"`);
    const tagMatch = html.match(tagRe);
    assert(tagMatch, `<input id="${id}"> not found with inline style`);
    const sizeMatch = tagMatch[1].match(/font-size:\s*([\d.]+)(rem|px|em)/);
    assert(sizeMatch, `#${id} no inline font-size declared`);
    const px = sizeMatch[2] === 'px'
      ? parseFloat(sizeMatch[1])
      : parseFloat(sizeMatch[1]) * 16;
    assert(px >= 16,
      `#${id} inline font-size is ${px}px — iOS Safari auto-zooms <16px inputs on focus`);
  }
});

test('pinSubmit guards against re-entrant double-submit', () => {
  // pinSubmit is scheduled via setTimeout from pinKey/pinHiddenInputHandler
  // once the 4th digit lands, then awaits verifyEmployeePinServer (a fetch).
  // On slow restaurant Wi-Fi that round trip can take seconds; if the camarero
  // deletes and re-enters a digit while it's in flight, a second pinSubmit
  // gets scheduled and runs concurrently, double-counting recordPinFail (or
  // recordPinSuccess/closePinAndEnter) for a single PIN entry. A module-level
  // in-flight flag, checked before the first await and cleared in a finally,
  // must prevent the re-entrant call.
  const startIdx = html.search(/async function pinSubmit\(\)\{/);
  assert(startIdx !== -1, 'pinSubmit not found');
  const slice = html.slice(startIdx, startIdx + 3800);
  const endIdx = slice.search(/\n\}\n/);
  assert(endIdx !== -1, 'could not find end of pinSubmit');
  const body = slice.slice(0, endIdx);
  const firstAwaitIdx = body.search(/\bawait\b/);
  assert(firstAwaitIdx !== -1, 'pinSubmit has no await — guard expectations stale');
  const beforeAwait = body.slice(0, firstAwaitIdx);
  assert(/_pinSubmitInFlight\)\s*return/.test(beforeAwait),
    'pinSubmit must bail out early on re-entry (in-flight flag already set) before the first await');
  assert(/_pinSubmitInFlight\s*=\s*true/.test(beforeAwait),
    'pinSubmit must set the in-flight flag before the first await');
  assert(/finally\s*\{\s*_pinSubmitInFlight\s*=\s*false;/.test(body),
    'pinSubmit must clear the in-flight flag in a finally block so the next PIN entry is not permanently blocked');
});

test('la consola del Repaso Inteligente viste pergamino, no terminal', () => {
  // Rediseño jul 2026: la consola era un terminal Pip-Boy (fósforo verde
  // sobre negro) que rompía la estética Michelin de la app. Ahora es una
  // tarjeta de pergamino como el resto — y que no vuelva el fósforo.
  const css = read('styles.css');
  const con = (css.match(/\.ri-console\{([^}]*)\}/) || [])[1] || '';
  assert(/#faf6ee/.test(con), '.ri-console debe ser tarjeta de pergamino (como .card)');
  // Y con el MISMO marco que las tarjetas del resto de la app: llevaba 2 px de
  // tinta y radio 20, un tratamiento que no existe en ninguna otra pantalla
  // («no hay congruencia con el diseño», sept 2026).
  // Anclado a principio de línea: hay reglas posteriores como
  // «.tx-rh-hub .game-card» que redefinen el marco y no son la base.
  const gc = (css.match(/^\.game-card\{([^}]*)\}/m) || [])[1] || '';
  const marco = (b) => ((b.match(/border:\s*([^;]+)/) || [])[1] || '').trim();
  const radio = (b) => ((b.match(/border-radius:\s*([^;]+)/) || [])[1] || '').trim();
  assert(marco(con) === marco(gc),
    `.ri-console usa «${marco(con)}» y las tarjetas de la app «${marco(gc)}»`);
  assert(radio(con) === radio(gc),
    `.ri-console usa radio ${radio(con)} y las tarjetas de la app ${radio(gc)}`);
  assert(!/3dffa0|22ff88|9fffc8|7fffb8|03160c|02110a/.test(css),
    'paleta de fósforo Pip-Boy detectada en styles.css — el terminal no debe volver');
  assert(!/smart-terminal\s*\{/.test(css),
    'el bloque .smart-terminal (CRT de la sesión) debe quedar retirado');
  assert(!/TXOKO·OS/.test(html) && !/ri-cta-bracket/.test(html),
    'restos del terminal (topbar TXOKO·OS / brackets NieR) en el markup');
  const cta = (css.match(/\.ri-cta\{([^}]*)\}/) || [])[1] || '';
  assert(/var\(--gold\)/.test(cta),
    'el CTA «Empezar sesión» debe ser el oro de la casa');
});

test('la cabecera del Repaso usa piezas de la casa, no inventadas', () => {
  // Reporte del propietario (sept 2026): «no hay congruencia con el diseño,
  // no se entiende a primera vista». Medido: la cabecera llevaba un anillo
  // SVG de 72 px con trazo en degradado y el porcentaje en Cinzel recortado
  // a degradado — una pieza única en toda la app — que dejaba al titular
  // 222 px de los 300 útiles de un móvil de 375 y lo partía en dos líneas.
  const css = read('styles.css');
  const hero = html.slice(html.indexOf('<div class="ri-hero">'),
                          html.indexOf('<div class="ri-pad">'));
  assert(hero, 'no encuentro la cabecera del Repaso');
  // 1 · El titular va SOLO en su línea: nada flota a su lado empujándolo.
  assert(!/riRingGrad|ri-ring/.test(hero),
    'el anillo de 72 px vuelve a competir con el titular en la cabecera');
  const heroCss = (css.match(/^\.ri-hero\{([^}]*)\}/m) || [])[1] || '';
  assert(!/display:\s*flex/.test(heroCss),
    '.ri-hero en fila vuelve a estrechar el titular: debe apilar');
  // 2 · Cejilla, chip y barra son las mismas piezas que ya usa la app.
  const eq = (sel, prop) => {
    const b = (css.match(new RegExp('^\\' + sel + '\\{([^}]*)\\}', 'm')) || [])[1] || '';
    return ((b.match(new RegExp(prop + ':\\s*([^;]+)')) || [])[1] || '').trim();
  };
  assert(eq('.ri-eyebrow', 'letter-spacing') === eq('.dash-hero-label', 'letter-spacing'),
    'la cejilla del Repaso no lleva el espaciado de la cejilla de INICIO');
  assert(eq('.ri-rank', 'clip-path') === eq('.xp-bar-lvl', 'clip-path'),
    'el rango debe ser el chip hexagonal de la casa, no una píldora propia');
  assert(eq('.ri-mast-track', 'clip-path') === eq('.xp-bar-track', 'clip-path') &&
         eq('.ri-mast-track', 'height') === eq('.xp-bar-track', 'height'),
    'la barra de dominio debe ser la barra de progreso de la casa');
  // 3 · Y el dominio deja de ser el titular: el porcentaje no puede volver a
  //     salir a tamaño de titular en Cinzel.
  assert(!/-webkit-text-fill-color:transparent/.test((css.match(/^\.ri-mast-sub\{([^}]*)\}/m)||[])[1]||''),
    'el dominio vuelve a ir en degradado recortado: es una línea de apoyo');
  // 4 · Ningún texto de la pantalla por debajo de 12 px. La etiqueta de las
  //     cifras iba a .52rem (9,4 px) — el texto más pequeño de la app, y era
  //     justo la palabra que explica el número.
  const rem = (v) => v.endsWith('rem') ? parseFloat(v) * 18 : parseFloat(v);
  for (const sel of ['.ri-stat-l', '.ri-mast-sub', '.ri-fam', '.ri-drill-sub']) {
    const px = rem(eq(sel, 'font-size'));
    assert(px >= 12, `${sel} va a ${px.toFixed(1)} px: no se lee de pie y cansado`);
  }
  // Y las cifras en tinta plana: el degradado recortado dejaba media cifra
  // del color del dato (oro claro en «mejor combo»).
  assert(!/-webkit-text-fill-color:transparent/.test((css.match(/^\.ri-stat-v\{([^}]*)\}/m)||[])[1]||''),
    'las cifras del Repaso vuelven al degradado recortado: se leen a medias');
});

test('el Repaso no arrastra CSS muerto de rediseños anteriores', () => {
  // El propietario retiró hace tiempo el caso de la noche, el selector manual
  // de dificultad, las zonas a reforzar y la rejilla de alérgenos, y sus
  // constructores se fueron con el rediseño a pergamino — pero 200 líneas de
  // CSS se quedaron, con seis animaciones que ningún elemento podía disparar.
  // Cada pasada de diseño obligaba a leerlas para saber si estaban vivas.
  const css = read('styles.css');
  const clases = new Set();
  for (const m of css.matchAll(/^\.(ri-[a-z0-9-]+)/gm)) clases.add(m[1]);
  const muertas = [...clases].filter(c => !html.includes(c));
  assert(muertas.length === 0,
    `reglas .ri- que ningún elemento usa: ${muertas.join(', ')}`);
  // Y ninguna animación de la pantalla sin quien la dispare.
  for (const m of css.matchAll(/^@keyframes (ri-[a-z0-9-]+)/gm)) {
    const usada = new RegExp(`animation(-name)?:\\s*(?:[^;]*\\s)?${m[1]}\\b`).test(css);
    assert(usada, `@keyframes ${m[1]} no la dispara nadie`);
  }
});

test('smart review screen is stripped to the simulation lead', () => {
  // Owner removed the focus-areas, difficulty-picker and allergen blocks;
  // the jul 2026 redesign deleted even their dead builders. Guard they stay out.
  const start = html.indexOf('function renderSmartReview()');
  const fn = html.slice(start, start + 12000);
  assert(!/focusHTML/.test(fn) && !/diffHTML/.test(fn) && !/allergenHTML/.test(fn),
    'a removed block (focus/difficulty/allergens) is back in the smart-review render');
  assert(/const pickedDiff = autoDiff;/.test(html),
    'difficulty must be auto (pickedDiff = autoDiff) now the picker is gone');
});

test('la sesión de repaso usa el acabado cálido estándar, sin piel CRT', () => {
  // Rediseño jul 2026: la sesión ya no se abre con la clase .smart-terminal
  // (piel CRT verde); hereda el dj-overlay cálido que comparte con Dish Journey.
  assert(!/smart-terminal/.test(html),
    'la clase smart-terminal no debe aplicarse en ninguna pantalla');
  assert(/overlay\.className = 'dj-overlay';/.test(html),
    'el overlay de la sesión debe ser dj-overlay a secas');
});

test('main nav is a dropdown, not a horizontal scroller', () => {
  // The 8-section top nav scrolled horizontally, hiding half the sections.
  // It's now a Tenet-style dropdown: a trigger + the .nav-btn list.
  assert(/id="mainNavDD"/.test(html) && /class="nav-dd-trigger"/.test(html),
    'main nav dropdown trigger missing');
  assert(/class="app-nav nav-dd-list"/.test(html),
    'the nav list must carry the .nav-dd-list class');
  // showTab must reflect the active section into the trigger + close it
  assert(/_navCur\.innerHTML = _activeNav\.innerHTML/.test(html),
    'showTab must update the nav trigger to the active section');
  assert(/function showTab\(tab, instant\)\{[^]{0,4000}_navDDClose\(\)/.test(html),
    'showTab must close the nav dropdown after navigating');
  const css = read('styles.css');
  assert(/\.nav-dd-list \.nav-btn\.active\{[^}]*border-left-color:var\(--gold\)/.test(css),
    'active nav item must show the gold accent bar');
});

test('el Repaso Inteligente vive dentro de La Carta, sin chip propio', () => {
  // Fusión jul 2026: fuera el chip «Simulación» de la barra de Aprender
  // (novia del propietario: «no aporta»; propietario: rompe la estética).
  // La sesión entra por una tarjeta al frente de La Carta y sigue enlazada
  // desde la fila «Repaso» del inicio.
  assert(!/\['smart',_en\?'Simulation':'Simulación'/.test(html),
    'el chip Simulación ha vuelto a la barra de Aprender');
  assert(/smart:renderSmartReview/.test(html),
    'la ruta smart debe seguir existiendo (el plan del día del inicio la usa)');
  const rc = html.slice(html.indexOf('function renderRepasoCats()'), html.indexOf('function renderRepasoTopic()'));
  assert(/Repaso inteligente/.test(rc) && /_subTab\.aprender='smart'/.test(rc),
    'falta la tarjeta de entrada a la sesión al frente de La Carta');
  // Refuerzo jul 2026 («no se ve, no se sabe de qué trata»): la entrada es
  // una tarjeta ri-cta destacada con subtítulo explicativo, y su cuenta usa
  // el MISMO criterio que la línea de resumen (solo repasos vencidos).
  assert(/class="ri-cta"[^>]*onclick="_subTab\.aprender='smart'/.test(rc),
    'la entrada debe ser la tarjeta destacada ri-cta');
  assert(/la app elige los platos que más te conviene repasar/.test(rc),
    'el subtítulo debe explicar qué es la sesión');
  assert(/s\.reps > 0 && Date\.now\(\) >= s\.nextReview/.test(rc),
    'la cuenta de pendientes debe contar solo repasos vencidos, como el resumen');
  assert(/REPASO INTELIGENTE/.test(html) && !/'SIMULACIÓN'/.test(html),
    'la pantalla debe presentarse como Repaso Inteligente, no Simulación');
});

test('nav opens as a thumb-zone bottom sheet with a dim scrim', () => {
  // The option list rises from the bottom (reachable one-handed) instead of
  // dropping from the top edge, and a scrim dims the page behind it.
  const css = read('styles.css');
  assert(/\.nav-scrim\{[^}]*position:fixed[^}]*z-index:999\d/.test(css),
    'nav scrim must be a fixed full-screen layer above the header');
  assert(/\.nav-dd \.nav-dd-list\{[^}]*position:fixed[^}]*bottom:0[^}]*transform:translateY\(105%\)/.test(css),
    'the nav list must be a bottom sheet that slides up (translateY)');
  assert(/\.nav-dd\.open \.nav-dd-list\{transform:translateY\(0\)/.test(css),
    'opening the nav must slide the sheet into view');
  // markup: scrim element that closes the sheet on tap
  assert(/class="nav-scrim"[^>]*onclick="_navDDClose\(\)"/.test(html) && /function _navDDClose\(\)/.test(html),
    'a tappable scrim element that closes the nav must exist');
});

test('screen wrapper never animates transform (breaks fixed nav sheet)', () => {
  // The bottom-sheet nav + search overlay are position:fixed inside #screenApp.
  // If .screen.active animates transform, #screenApp becomes a containing block
  // and the sheet renders at the bottom of the (tall) page instead of the
  // viewport — i.e. off-screen. It must use an opacity-only enter animation.
  const css = read('styles.css');
  const m = css.match(/\.screen\.active\{[^}]*animation:\s*([a-zA-Z0-9_-]+)/);
  assert(m, '.screen.active must declare an enter animation');
  const anim = m[1];
  assert(anim === 'screenEnter', `.screen.active must use the opacity-only screenEnter (got ${anim})`);
  const kf = css.match(/@keyframes\s+screenEnter\{([^]*?)\}\s*(?:@|\/\*|\.[a-z])/i);
  assert(kf && !/transform/.test(kf[1]),
    'screenEnter keyframes must not animate transform');
});

test('dropdown triggers use a clear chevron-chip (not a subtle glyph)', () => {
  const css = read('styles.css');
  assert(/\.nav-dd-chev\{[^}]*border:1px solid[^}]*\}/.test(css) && /\.nav-dd-chev svg\{/.test(css),
    'nav chevron must be a bordered chip containing an SVG');
  // Regresión (jul 2026): con solo el chevron nadie sabía que la barra era un
  // menú desplegable. La píldora debe llevar la PALABRA «Menú» + hamburguesa
  // + caret, y el disparador debe anunciar su estado (aria-expanded).
  assert(/id="navDDMenuLbl"/.test(html) && /class="nav-dd-burger"/.test(html) && /class="nav-dd-caret"/.test(html),
    'nav trigger pill must say «Menú» with burger + caret icons');
  assert(/class="nav-dd-trigger" aria-haspopup="true" aria-expanded="false"/.test(html),
    'nav trigger must expose aria-expanded');
  assert(/_ddMenu\.textContent = LANG==='en' \? 'Menu' : 'Menú'/.test(html),
    'menu pill label must be bilingual');
  assert(/\.nav-dd-menu-lbl\{[^}]*text-transform:uppercase/.test(css),
    'menu pill label style missing');
  // (la sub-navegación pasó a chips visibles — solo el nav principal es desplegable)
});

test('achievement toasts stack and stay readable', () => {
  // Several achievements unlocking together used to render at the same fixed
  // position (text painted over text) with a dark-on-dark description.
  assert(/achToastStack/.test(html), 'toasts must render into the shared stack');
  assert(/flex-direction:column[^']*pointer-events:none/.test(html),
    'toast stack must be a column that lets taps through');
  assert(!/Logro Desbloqueado'\}[^]*?color:var\(--parch3\)/.test(
    html.slice(html.indexOf('function showAchievementToast'), html.indexOf('function showAchievementToast') + 2200)),
    'toast description must not use the dark parch3 color on the dark toast');
});

test('ranking rows drop the placeholder styling before injecting', () => {
  // #rankingContent ships with text-align:center + 2rem padding for the "—"
  // placeholder; leaked into the results it centered and squeezed the rows.
  assert(/_rc\.removeAttribute\('style'\)/.test(html),
    'renderRanking must clear the placeholder style before rows');
});

test('vinos filter pills wrap instead of side-scrolling', () => {
  // Side-scrolling pill rows hid options past the viewport edge — the exact
  // pattern the owner banned from the navigation.
  const pillRows = [...html.matchAll(/<div style="([^"]*)">\s*\$\{(?:types|levels|\(_en\?\[\['all')/g)].map(m => m[1]);
  assert(pillRows.length >= 3, `expected 3 pill containers, found ${pillRows.length}`);
  for (const style of pillRows) {
    assert(/flex-wrap:wrap/.test(style) && !/overflow-x:auto/.test(style),
      `pill container must wrap, not scroll: ${style.slice(0,60)}`);
  }
});

test('section labels share the tunic-divider recipe (no rogue styles)', () => {
  // One section-label style across screens: the gold Cinzel divider. Ranking
  // used orange Quicksand (also ~2.4:1 on cream, WCAG fail), exam had a
  // literal ◆…◆ variant, games a one-off mono hint.
  assert(/tunic-divider"><span>\$\{LANG==='en'\?'By total XP':'Por XP total'\}/.test(html),
    'ranking label must use the tunic-divider');
  // (exam mastery moved into the dark dom-panel under a gilded-divider label
  //  in the simplified Examen redesign — asserted by its own test below)
  assert(/tunic-divider"[^>]*><span>\$\{_en\?'More ways to train':'Más formas de entrenar'\}/.test(html),
    'games section label must use the tunic-divider');
  // Ranking XP value must be brand gold (WCAG 5.66:1), not candy-orange.
  assert(!/color:var\(--candy-orange\)"?>\$\{\(emp\.xp/.test(html),
    'ranking XP value must not be candy-orange');
  // The replaced one-off recipes must not linger unused in the stylesheet.
  const css = read('styles.css');
  assert(!/exam-topics-mastery-title|games-secondary-hint/.test(css + html),
    'orphaned section-label classes must be removed');
});

test('vinos carta premium port: fonts, search, pills, card, light sub-trigger', () => {
  const css = read('styles.css');
  // Cormorant Garamond powers the sommelier voice — it must actually load.
  // Desde v7.345 se sirve del propio dominio, no de Google.
  assert(/@font-face\{?[^}]*font-family:\s*'Cormorant Garamond'[^}]*fonts\/CormorantGaramond-[^}]*\.woff2/s.test(css),
    'Cormorant Garamond debe tener @font-face propio en styles.css');
  assert(/\.wine-storybook-text\{[^}]*Cormorant Garamond/.test(css)
    && /\.wc-story\{[^}]*Cormorant Garamond/.test(css),
    'hero quote and card story must use Cormorant');
  // Jewel search: full pill and 16px (iOS zoom trap — was .82rem).
  assert(/\.wine-search\{[^}]*font-size:16px/.test(css) && /\.wine-search\{[^}]*border-radius:999px/.test(css),
    'wine search must be a 16px full pill');
  // Pills: fine mono count, no spreadsheet parens in the type row.
  assert(/class="wfp-count"/.test(html) && /\.wfp-count\{/.test(css),
    'pill counts must use the fine mono style');
  assert(!/wine-filter-pill[^>]*>\$\{icon\} \$\{label\} <span[^>]*>\(/.test(html),
    'type pills must not render parenthesised counts');
  // Active pill keeps dark ink on gold (white-on-gold is 2.2:1, WCAG fail).
  assert(/\.wine-filter-pill\.active\{[^}]*color:#1a0f05/.test(css),
    'active pill text must stay dark ink for contrast');
  // Card hierarchy classes exist and are used.
  for (const cls of ['wc-name','wc-price','wc-story','wc-type-dot','wc-rec']) {
    assert(css.includes(`.${cls}`) && html.includes(`class="${cls}`),
      `card class .${cls} missing from CSS or markup`);
  }
  // Índice editorial (rediseño jul 2026): pestañas transparentes en serif
  // sobre línea de libro mayor — nada de píldoras rellenas ni emojis.
  assert(/\.subtab-chip\{[^}]*background:transparent/.test(css) && /\.subtab-chip\{[^}]*Cinzel/.test(css),
    'sub-tab chips must be the editorial serif tabs');
  assert(!/subtab-chip-ico/.test(html),
    'los emojis no deben volver a la barra de subsecciones');
  assert(!/subtab-chip--green/.test(css),
    'la variante verde Pip-Boy del chip murió con el rediseño — no debe volver');
});

test('wine detail speaks the premium carta language', () => {
  // The detail view must match the redesigned carta: dot+mono type, deep-gold
  // prices, Cormorant story, and the "G " label typo fixed to the ◇ ornament.
  const detail = html.slice(html.indexOf('function _showWineDetail'), html.indexOf('function _showWineDetail') + 9000);
  assert(/class="wc-type"/.test(detail), 'detail type must use the dot+mono style');
  // Carta 11.08: los vinos solo-por-copa muestran «—» en la casilla de botella.
  assert(/color:var\(--gold-deep\);font-weight:600">\$\{w\.price\?w\.price\+' €':'—'\}/.test(detail),
    'detail bottle price must be deep gold with a spaced euro (— sin precio de botella)');
  assert(/Cormorant Garamond[^"]*"[^>]*>"\$\{escapeHTML\(_en && w\.story_en/.test(detail),
    'detail story must use Cormorant italic');
  assert(!/wine-info-label"[^>]*>G \$\{/.test(html),
    'the broken "G " info label must be the ◇ ornament');
});

test('editorial sweep: quiz + dish headers join the shared recipe', () => {
  assert(/wine-section-title">\$\{LANG==='en'\?'Wine Quiz':'Quiz de Vinos'\}/.test(html),
    'wine quiz header must use the shared editorial classes');
  assert(/text-align:left;margin-bottom:1\.2rem;padding-bottom:\.65rem;border-bottom:1px solid rgba\(28,42,34,\.12\)/.test(html),
    'explorar dish header must be the left editorial block');
});

test('editorial TUNIC DNA: left headers, pull-quotes, crisp radii, slim bars', () => {
  // Owner verdict: the centered temple-hero pattern on every screen read as
  // AI-made. Sub-screen headers are now left-aligned editorial blocks with a
  // hairline; quotes are left pull-quotes with a gold edge; global radii are
  // crisper; the two nav bars are slimmer.
  const css = read('styles.css');
  assert(/--r:12px; --r2:10px; --r3:7px;/.test(css), 'crisp radius tokens missing');
  assert(/\.wine-section-header\{\n  text-align:left/.test(css), 'section header must be left-aligned');
  assert(/\.wine-section-header::before\{content:none\}/.test(css), 'centered glow orb must be retired');
  assert(/\.wine-storybook-intro\{[^}]*border-left:2px solid rgba\(196,154,60,\.45\)/.test(css),
    'storybook quote must be the left pull-quote');
  assert(/\.wine-hub-title\{\n  font-family:'Cinzel',serif;font-size:1\.18rem[^}]*text-align:left/.test(css),
    'sommelier hub title must be editorial');
  assert(/\.wine-hex-medallion\{display:none;/.test(css) && !/\.wine-hex-medallion\{display:none;[^}]*display:flex/.test(css),
    'hub medallion must be retired without a later display override');
  assert(/\.nav-dd-trigger\{[^}]*min-height:44px/.test(css) && /\.subtab-chip\{[^}]*min-height:44px/.test(css),
    'nav stays slim 44px and sub-nav chips stay tappable (44px)');
});

test('vinos sweep 3: sommelier index, maridaje rows, frases rows', () => {
  // Visible de-boxing for the remaining sub-screens (owner follow-up).
  assert(/dash-index-entry" onclick="_vinoSubTab='carta';renderVinos\(\)/.test(html),
    'sommelier quick access must be the manual index');
  assert(!/wine-quiz-option" style="flex-direction:column/.test(html),
    'boxed quick-access tiles must be gone');
  assert(/maridaje-item[^>]*style="padding:\.6rem \.15rem;border-bottom:1px solid rgba\(28,42,34,\.1\)/.test(html),
    'pairing guide entries must be hairline rows');
  assert(/wine-service-card wc-row/.test(html), 'selling scripts must use the row modifier');
  const css = read('styles.css');
  assert(/\.wine-service-card\.wc-row,/.test(css), 'wc-row must cover service cards');
});

test('vinos sweep 2: quiz rows, concept rows, no paren counts on map pills', () => {
  // Re-audit with the TUNIC bar: quiz category tiles and concept accordion
  // cards become hairline rows; map origin pills drop spreadsheet parens.
  assert(/dash-row" onclick="_startWineQuiz\('all',15\)/.test(html),
    'wine quiz must lead with the all-questions ledger row');
  assert(!/wq-cat-grid/.test(html), 'boxed quiz category grid must be gone');
  assert(/wine-concept-card wc-row/.test(html), 'concept accordions must use the row modifier');
  const css = read('styles.css');
  assert(/\.wine-concept-card\.wc-row\{[^}]*border-bottom:1px solid rgba\(28,42,34,\.1\)/.test(css),
    'wc-row must be a hairline row');
  assert(/wfp-count\" > \' \+ r\.wines\.length|wfp-count\">' \+ r\.wines\.length/.test(html),
    'map origin pills must use the fine mono count');
  assert(!/\(' \+ r\.wines\.length \+ '\)/.test(html), 'paren counts must be gone from map pills');
});

test('vinos sub-screens finished in the premium language', () => {
  // No wine section title may carry flanking ✦/◇ glyphs — the ornament is the
  // fine rule under the title (the carta pattern).
  assert(!/wine-section-title">[✦◇]|wine-section-title">\$\{[^}]*\?'[✦◇]/.test(html),
    'wine section titles must not open with a flanking glyph');
  assert(!/[✦◇] \$\{_en\?'Learn about Wine|[✦◇] \$\{_en\?'Wine Parchments/.test(html),
    'aprende/pergaminos titles must be clean');
  // Sommelier hub: unified deep-gold stat trio (was gold/sage/azure), and the
  // hub verse speaks Cormorant.
  const hub = html.slice(html.indexOf('wine-hub-stats'), html.indexOf('wine-hub-stats') + 1800);
  assert(!/var\(--sage\)|var\(--azure\)/.test(hub),
    'sommelier stat trio must not mix sage/azure — deep gold only');
  const css = read('styles.css');
  assert(/\.wine-hub-verse\{[^}]*Cormorant Garamond/.test(css),
    'sommelier verse must use Cormorant');
  // Discover-today featured card uses the carta language (dot, spaced price, wc-story).
  const disc = html.slice(html.indexOf('Descubre Hoy'), html.indexOf('Descubre Hoy') + 2600);
  assert(/wc-type-dot/.test(disc) && /wc-price/.test(disc) && /wc-story/.test(disc),
    'featured wine card must use the carta card classes');
});

test('vinos hero is compact and venue-aware', () => {
  const css = read('styles.css');
  // Hero spacing: header + intro tightened so the first wine lands sooner.
  assert(/\.wine-section-header\{[^}]*margin-bottom:1rem/.test(css),
    'wine section header must keep the tightened 1rem gap');
  assert(/\.wine-storybook-intro\{[^}]*border-left:2px solid rgba\(196,154,60,\.45\)/.test(css),
    'storybook intro must be the left pull-quote');
  // The hero byline must come from the active venue (multi-restaurant), with
  // the exact Txoko copy preserved as the default.
  assert(/ACTIVE_VENUE\.id!=='txoko'\) \? escapeHTML\(ACTIVE_VENUE\.name/.test(html)
    && /: 'TXOKO by Martín Berasategui'\}/.test(html),
    'vinos hero byline must be venue-aware with the Txoko copy as default');
});

test('dashboard polish: capitalized alert, collapsed achievements', () => {
  // Los hexágonos de progreso por tema se retiraron del Inicio (ago 2026):
  // sobrecargaban la pantalla y contradecían a la barra de XP. Su guard de
  // legibilidad ya no aplica — aquí solo se comprueba que no vuelvan.
  assert(!/TOPIC_RING_COLORS|topicRings/.test(html),
    'los hexágonos de progreso por tema deben seguir retirados');
  // The SRS alert title is capitalized like its sibling alerts.
  assert(/'Plato para repasar':'Platos para repasar'/.test(html),
    'SRS alert title must be capitalized');
  // Achievements collapse to a showcase with a view-all toggle; the toggle is
  // presentational only (unlock logic untouched).
  assert(/function _toggleAchievements\(/.test(html) && /id="achSection"/.test(html),
    'achievements section must collapse with a toggle');
  assert(/_achShowAll \? ACHIEVEMENTS/.test(html),
    'expanded view must still show the full canonical grid');
});

test('section heroes share one ornament language (no flanking glyphs)', () => {
  // Exam's ◆ EVALUACIÓN ◆ and Juegos' ◇ Juegos ◇ came from CSS pseudo-elements;
  // the app-wide hero ornament is the thin gradient line (sup-hero-sub style).
  const css = read('styles.css');
  assert(!/games-header-title::(before|after)\{content:'◇'/.test(css),
    'games hero title must not flank with ◇ glyphs');
  assert(!/exam-setup-crown-orn::(before|after)[^}]*content:'◆'/.test(css),
    'exam crown must not flank with ◆ glyphs');
  // The shared thin-line ornament stays.
  assert(/\.sup-hero-sub::before/.test(css) && /\.games-header-sub::before/.test(css),
    'hero subtitles must keep their gradient-line ornament');
});

test('exam setup: one-tap start, folded customize, drill role, dark mastery panel', () => {
  // Owner feedback: the exam screen was overwhelming (20+ elements, 4 decisions
  // before starting) and "Modo Examen" duplicated the tab name.
  assert(/examSetupTitle: 'Examen',/.test(html) && /examSetupTitle: 'Exam',/.test(html),
    'title must be Examen/Exam, not Modo Examen');
  assert(/examConfig=\{topic:'mixed',cat:'all',count:10\};startExam\(\)/.test(html),
    'quick-start button must launch a mixed 10-question exam in one tap');
  assert(/id="examCustom" style="display:none"/.test(html) && /function _examToggleCustom\(/.test(html),
    'topic/category/count pickers must fold behind Personalizar');
  // El nombre y el papel siguen ahí; el texto se acortó (sept 2026, «mucha
  // información agobia»): «Solo alérgenos, con trampas — seguridad, no memoria».
  assert(/Simulacro de Alérgenos/.test(html) && /trampas — seguridad, no memoria/.test(html),
    'the allergen drill must be renamed and explain its role');
  const css = read('styles.css');
  assert(/\.exam-dom-panel\{/.test(css) && /class="exam-dom-panel"/.test(html),
    'mastery must live in the dark dom-panel');
  assert(/\.exam-dom-panel \.exam-stat-lbl\{color:rgba\(244,237,226/.test(css),
    'dom-panel stats must use light ink on the dark card');
  assert(/\.exam-orient\{/.test(css) && /class="exam-orient"/.test(html),
    'the review-vs-exam orientation line must exist');
  // Regresión (jul 2026): en mitad de un examen no había botón para volver
  // atrás. La pregunta debe llevar un «←» que confirma antes de abandonar.
  assert(/class="exam-exit" onclick="abortExam\(\)"/.test(html),
    'exam question topbar must carry the exit button');
  const ab = html.slice(html.indexOf('function abortExam()'), html.indexOf('function abortExam()') + 500);
  assert(/confirm\(/.test(ab) && /examActive=false/.test(ab) && /renderExam\(\)/.test(ab),
    'abortExam must confirm, deactivate the exam and return to setup');
  assert(/\.exam-exit\{[^}]*min-height:34px/.test(css), 'exam exit button style missing');
});

test('auditoría de botones: toda sesión interactiva tiene salida y no repinta tras abandonar', () => {
  // Auditoría jul 2026 tras el «←» del examen: el Simulacro de Alérgenos,
  // los duelos remotos (reto y defensa) y el duelo local eran callejones sin
  // salida — y sus setTimeout/temporizadores recuperaban la pantalla aunque
  // el usuario hubiera navegado a otra pestaña.
  assert(/function abortAllergenTest\(\)/.test(html) && /onclick="abortAllergenTest\(\)"/.test(html),
    'el simulacro de alérgenos debe tener botón de salida');
  const raq = html.slice(html.indexOf('function renderAllergenQuestion()'), html.indexOf('function renderAllergenQuestion()') + 700);
  // Tab-aware desde jul 2026: el drill vive en Aprender, así que la guarda
  // compara contra la pestaña de lanzamiento registrada (no 'exam' fijo).
  assert(/if\(!allergenTestState \|\| currentTab!==\(allergenTestState\.tab\|\|'exam'\)\) return;/.test(raq),
    'renderAllergenQuestion debe cortar el repintado tras abandono o navegación');
  assert(/function abortRemoteDuel\(\)/.test(html) && /onclick="abortRemoteDuel\(\)"/.test(html),
    'los duelos remotos deben tener botón de abandono');
  for(const fn of ['renderRemoteDuelQuestion', 'renderRemoteDefenseQuestion']){
    const body = html.slice(html.indexOf(`function ${fn}()`), html.indexOf(`function ${fn}()`) + 700);
    assert(/if\(!remoteDuelState \|\| currentTab!=='txoko'\)\{ duelClearTimer\(\); return; \}/.test(body),
      `${fn} debe parar el temporizador y no repintar fuera de Juegos`);
  }
  const ard = html.slice(html.indexOf('function abortRemoteDuel()'), html.indexOf('function abortRemoteDuel()') + 700);
  assert(/confirm\(/.test(ard) && /duelClearTimer\(\)/.test(ard) && /renderDuel\(\)/.test(ard),
    'abortRemoteDuel debe confirmar, parar el temporizador y volver al lobby');
  assert(/function abortLocalDuel\(\)/.test(html) && /onclick="abortLocalDuel\(\)"/.test(html),
    'el duelo local debe tener botón de fin anticipado');
  assert(/setTimeout\(\(\)=>\{ if\(!duelState\) return; if\(duelState\.round<=duelState\.totalRounds\)/.test(html),
    'el paso de ronda del duelo local debe tolerar el abandono');
});

test('allergen drill: three action-frames per question, no fixed traps', () => {
  // The old drill used three FIXED trap texts and a correct answer whose
  // yes/no polarity was unique — solvable by option style after one round.
  // Every question now carries the same three real courses of action whose
  // truth depends on the dish, plus one rotating trap from a bank.
  const fn = html.slice(html.indexOf('function buildAllergenQuestions'), html.indexOf('function buildAllergenQuestions') + 12000);
  assert(/_trapBank/.test(fn) && /_comandaBank/.test(fn), 'rotating trap/comanda banks missing');
  assert(/optServe/.test(fn) && /optAdapt/.test(fn) && /optBlock/.test(fn),
    'the three action-frames must exist');
  assert(/state === 'absent' \? optServe : state === 'adapt' \? optAdapt : optBlock/.test(fn),
    'the correct answer must be the frame matching the dish truth');
  assert(!/es mínimo y no supone riesgo/.test(html),
    'the old fixed trap texts must be gone');
  assert(!/firme una exención/.test(html), 'old waiver trap must be gone');
  assert(/_lqaShuffle\(questions\)\.slice\(0, 10\)/.test(fn),
    'question shuffle must be unbiased (_lqaShuffle)');
});

test('los tartares NO pueden ofrecerse sin gluten: la Perrins lleva vinagre de malta', () => {
  // Corrección del propietario, tras consultar a cocina (sept 2026): «la
  // Perrins lleva vinagre de malta». Esto ANULA una corrección suya anterior,
  // que decía que el gluten de los tartares de tomate y de solomillo venía
  // SOLO del pan carasau y que retirándolo el plato quedaba sin gluten. Con
  // el vinagre de malta —cebada— eso era falso: la app le estaba diciendo al
  // camarero que podía servirle esos tartares a un celíaco.
  // Este guard fija lo contrario, que es lo que ahora es cierto.
  assert(!/queda SIN GLUTEN|is then GLUTEN-FREE/.test(html),
    'vuelve la promesa de que retirando el pan el tartar queda sin gluten: la Perrins lleva vinagre de malta');
  // El aviso dice que no se puede GARANTIZAR sin gluten y remite a cocina, no
  // «no se lo des a un celíaco»: decidir si un huésped puede comer algo no es
  // trabajo de la app, y el bote concreto de Perrins puede estar certificado.
  const need = [
    'el plato NO se puede garantizar sin gluten: si el huésped es celíaco, consultar con cocina.',
    'the dish CANNOT be guaranteed gluten-free: if the guest is coeliac, check with the kitchen.'
  ];
  for (const s of need) assert(html.includes(s), `falta el aviso de que el tartar no puede ir sin gluten: "${s.slice(0, 60)}…"`);
  // El gluten de estos tartares viene de DOS sitios: el pan carasau y el
  // vinagre de malta de la Perrins. El propietario confirmó después que la
  // Perrins SÍ se puede dejar fuera, así que el gluten pasa a retirable — pero
  // SOLO con las dos comandas. Lo que este guard prohíbe es lo peligroso:
  // que la comanda del gluten mencione el pan y NO la Worcestershire, porque
  // entonces se estaría prometiendo un plato sin gluten que sigue teniéndolo.
  const iM = html.indexOf('const DISH_ACTIONS = ');
  const M = JSON.parse(html.slice(iM + 'const DISH_ACTIONS = '.length, html.indexOf('};', iM) + 1));
  for (const id of ['15', '16']) {
    const gl = M[id] && M[id].Gluten;
    assert(gl, `el plato ${id} no declara qué hacer con el gluten`);
    if (gl.r !== 1) continue;                       // estructural: nada que prometer
    for (const cmd of [gl.c, gl.c_en].filter(Boolean))
      assert(/worcestershire|perrins/i.test(cmd),
        `la comanda de gluten del plato ${id} («${cmd}») no retira la Worcestershire: el plato seguiría llevando gluten`);
  }
  // The generator must extract EN comanda instructions too ("Order WITHOUT …"),
  // otherwise the correct adapt answer shows a fake generic instruction in EN.
  assert(html.includes('(?:Comandar|Order) ([^.]+)\\.'),
    'comanda-instruction regex must accept both Comandar (ES) and Order (EN)');
});

test('smart review v2: unified frames, no set-fingerprint, smarter scenarios', () => {
  // Measured before the rebuild: DeclaredAllergy and Vegetarian revealed the
  // answer through their option SET in 100% of questions (each truth state
  // had its own texts), and CrossContamination / MultipleAllergies had the
  // same correct answer 100% of the time. The v2 frames must stay unified.
  assert(!html.includes("'Sí, tal como se emplata'"), 'old per-state DeclaredAllergy option set is back');
  assert(!html.includes("'Sí, es totalmente seguro'"), 'old per-state DeclaredAllergy option set is back (safe)');
  assert(!html.includes('(ej. Boletus)'), 'Vegetarian correct option leaks the flavour again');
  assert(!html.includes("'Solo sin la guarnición'"), 'old per-state Vegetarian option set is back');
  const da = html.slice(html.indexOf('function _scenarioDeclaredAllergy'), html.indexOf('function _scenarioDeclaredAllergy') + 4500);
  assert(/const optYes\b/.test(da) && /const optMod\b/.test(da) && /const optNo\b/.test(da) && /trapBank/.test(da),
    'DeclaredAllergy must use unified frames + rotating trap bank');
  assert(/dishProfileKeys/.test(da), 'DeclaredAllergy must bias the allergen toward the dish (polarity balance)');
  const cc = html.slice(html.indexOf('function _scenarioCrossContamination'), html.indexOf('function _scenarioCrossContamination') + 3500);
  assert(/optRisk\b/.test(cc) && /optClean\b/.test(cc), 'CrossContamination must have both truth polarities');
  const ma = html.slice(html.indexOf('function _scenarioMultipleAllergies'), html.indexOf('function _scenarioMultipleAllergies') + 4000);
  assert(/bothClear/.test(ma), 'MultipleAllergies must include the shareable (yes) polarity');
  // Modification echo guard: allergen named in the question must not appear
  // inside the comanda answer (measured 16% echo before).
  assert(/_hintToks/.test(html) && /hintEchoes|!_hintToks\.some/.test(html.slice(html.indexOf('function _scenarioModification'))),
    'Modification allergen-echo guard missing');
  // New smarter scenario types exist and are wired into the generator.
  for (const fn of ['_scenarioWhichAdaptable', '_scenarioWaitTime', '_scenarioIngredientWhere']) {
    assert(html.includes(`function ${fn}(`), `${fn} missing`);
    assert(html.includes(`${fn}(dish, dd, _en)`), `${fn} not wired into _srGenerateQuiz`);
  }
  // Correct-first dedupe: a same-named wrong option must never evict the
  // correct dish (produced correctIdx = -1 → unanswerable question).
  assert(!/_simDedupeOptions\(_djShuffle\(\[correct,/.test(html) && !/_simDedupeOptions\(_djShuffle\(\[dish,/.test(html),
    'dedupe must receive the correct option FIRST (shuffle after), or correctIdx can be -1');
});

test('el aterrizaje del Repaso Inteligente es pergamino puro (sin tubo CRT)', () => {
  // Rediseño jul 2026: el «tubo Pip-Boy» completo (topbar, scanlines, cursor,
  // barrido CRT) se retiró. Guardia inversa de la que había antes.
  const smart = html.slice(html.indexOf('function renderSmartReview'), html.indexOf('function _startSmartSession'));
  assert(!/ri-topbar|ri-grid-bg|ri-particles/.test(smart),
    'mobiliario del terminal (topbar/grid/partículas) de vuelta en la pantalla');
  const css = read('styles.css');
  assert(!/ri-crt-sweep|ri-cursor|ri-scanlines/.test(css),
    'restos de CSS del tubo CRT (sweep/cursor/scanlines) en styles.css');
  // Los acentos de color de la casa vuelven a las stats (ya no monocromo)
  assert(/#b0563c/.test(smart) && /#4a8f6f/.test(smart),
    'las stats deben usar los acentos cálidos de la casa');
});

test('smart review owner-reported fixes: header leak, agua), Txipiron≠ron', () => {
  // 1. The Smart Review card header names the current dish, so cross-carta
  //    questions must never use it as the hidden answer.
  const iw = html.slice(html.indexOf('function _scenarioIngredientWhere'), html.indexOf('function _scenarioIngredientWhere') + 4200);
  assert(/for\(const target of _djShuffle\(sibs\)\)/.test(iw), 'IngredientWhere must target a SIBLING, not the header dish');
  const wa = html.slice(html.indexOf('function _scenarioWhichAdaptable'), html.indexOf('function _scenarioWhichAdaptable') + 3200);
  assert(/d\.id!==dish\.id && _simDishName\(d\)\.toLowerCase\(\)!==_curName/.test(wa),
    'WhichAdaptable must exclude the header dish (by id AND display name)');
  const wt = html.slice(html.indexOf('function _scenarioWaitTime'), html.indexOf('function _scenarioWaitTime') + 3600);
  assert(!/opts\.map\(d=>_simDishName\(d\)\)/.test(wt), 'WaitTime must use duration-shaped options, not dish names');
  // Owner-stated house rule: a main ordered WITHOUT starters carries ~40 min.
  // The old "Ninguna — su ficha no indica espera especial" answer taught
  // something false and must stay removed.
  assert(/label\(40\)/.test(wt) && /SIN entrantes/.test(wt), 'WaitTime 40-min house rule (main without starters) missing');
  assert(/Norma de Txoko/.test(wt) && /Forbes\/LQA/.test(wt), 'WaitTime explanation must cite the house norm and Forbes pacing');
  assert(!/no indica espera especial/.test(wt), 'false "no special wait" answer is back in WaitTime');
  // 2. Ingredient extraction must strip parentheses ("¿lleva agua)?" bug).
  assert(/replace\(\/\[\(\)\]\/g/.test(html.slice(html.indexOf('function _simExtractIngredients'), html.indexOf('function _simExtractIngredients') + 900)),
    'ingredient extractor must strip parentheses before filtering');
  // 3. Liquor detection must be word-bounded: /ron/ matched inside Txipiron.
  assert(!/\(flamb\|brandy\|coñac\|ron\|whisky/.test(html), 'unbounded liquor regex is back (ron ⊂ Txipiron)');
  assert(/\\bflamb\\w\*\|\\b\(brandy\|coñac\|ron\|whisky\|vodka\|porto\|oporto\|sake\)\\b/.test(html),
    'word-bounded liquor regex missing');
  // 4. Beer/wine in fried or baked preparations loses its alcohol
  //    (owner-confirmed: Calamares tempura) — pregnancy must exempt it.
  assert(/tempura\|rebozado\|masa\|frit/.test(html), 'cooked beer/wine exemption missing in pregnancy scenario');

  // Huevo a baja temperatura = poco cocinado → embarazada NO (owner, jul 2026)
  const preg = html.slice(html.indexOf('function _scenarioPregnancy'), html.indexOf('function _scenarioChildFriendly'));
  assert(/baja temperatura/.test(preg), 'pregnancy scenario must treat low-temperature egg as undercooked');
});

test('exam surfaces shuffle options: LQA exam/situations + wine quiz shape guard', () => {
  // LQA exam & situations rendered the AUTHORED option order: measured on the
  // real data, 44% of situation answers sat on option 2, so position alone
  // scored. Both must build session copies with options shuffled in lockstep.
  assert(/function _lqaShuffledExamQ\(/.test(html), '_lqaShuffledExamQ missing');
  assert(/_lqaShuffle\(LQA_EXAM_QUESTIONS\)\.slice\(0,10\)\.map\(_lqaShuffledExamQ\)/.test(html),
    'LQA exam questions must be session-shuffled');
  assert(/function _lqaShuffledSituation\(/.test(html), '_lqaShuffledSituation missing');
  assert(/_lqaPickFresh\(LQA_SITUATIONS, recent, 10\)\.map\(_lqaShuffledSituation\)/.test(html),
    'LQA situations must be session-shuffled');
  // Philosophy tags are keyed by AUTHORED option index — the answer handler
  // must translate the displayed index back through _map.
  assert(/_lqaTagFor\(sc\.id, sc\._map \? sc\._map\[idx\] : idx\)/.test(html),
    'situation answer must map displayed index back to authored index for tags');
  // Wine quiz shape guard: a sentence correct among bare-term wrongs (36% of
  // EN questions) revealed the answer by shape; and the correct was the
  // longest option ~50% of the time.
  const wq = html.slice(html.indexOf('function _generateWineChoices'), html.indexOf('function _generateWineChoices') + 10000);
  assert(/isSentence/.test(wq) && /mergedPool/.test(wq), 'wine quiz shape guard missing');
  assert(/_inWindow/.test(wq) && /strictLen/.test(wq), 'wine quiz length-window two-pass pick missing');
  // El generador debe CONSUMIR los distractores autorados por flashcard.
  assert(/q\.distractors_en \|\| q\.distractors/.test(wq) && /\.\.\.authored/.test(wq),
    'wine quiz must seed authored distractors (q.distractors/_en) at top priority');
});

test('wine quiz length tell: correct is never reliably the longest option', () => {
  // Medido sobre los generadores REALES (auditoría jul 2026): en 6 flashcards
  // ES + 7 EN la respuesta correcta era la opción más larga >60% de las veces
  // (3 tarjetas lo daban al 100 %), así que "elegir la más larga" acertaba sin
  // saber de vino. Las flashcards infractoras traen ahora distractores
  // autorados —erróneos pero plausibles y de longitud ≥ la correcta— que el
  // generador prioriza. Candado: ejecuta el generador real sobre cada flashcard
  // en los dos idiomas y verifica que ninguna deja la correcta como opción
  // estrictamente más larga en >75 % de las tiradas.
  const fnBody = (name) => { const s = html.indexOf('function ' + name + '('); let d = 0, k = html.indexOf('{', s); for (;;) { const c = html[k]; if (c === '{') d++; else if (c === '}') { d--; if (d === 0) return html.slice(s, k + 1); } k++; } };
  const wines = JSON.parse(read('data/wines.json'));
  const FC = JSON.parse(read('data/vinos-content.json')).WINE_FLASHCARDS;
  const M = new Function('let LANG="es";const WINES=arguments[0];const WINE_FLASHCARDS=arguments[1];' // eslint-disable-line no-new-func
    + '\n' + fnBody('_generateWineChoices') + '\nreturn {gen:_generateWineChoices, setLang:(l)=>{LANG=l;}};')(wines, FC);
  const N = 400, offenders = [];
  let malformed = 0;
  for (const lang of ['es', 'en']) {
    M.setLang(lang);
    FC.forEach((q, idx) => {
      let longest = 0;
      for (let r = 0; r < N; r++) {
        const ch = M.gen(q);
        const ci = ch.findIndex((c) => c.correct);
        if (ch.length !== 4 || ci < 0 || new Set(ch.map((c) => c.text.toLowerCase())).size !== 4) { malformed++; continue; }
        const cl = ch[ci].text.length;
        const mo = Math.max(...ch.filter((_, i) => i !== ci).map((c) => c.text.length));
        if (cl > mo) longest++;
      }
      if (longest / N > 0.75) offenders.push(`${lang} idx${idx} [${q.cat}] rate=${(longest / N).toFixed(2)}`);
    });
  }
  assert(malformed === 0, `wine quiz produced ${malformed} malformed question(s)`);
  assert(offenders.length === 0, `wine quiz length tell (correct = longest >75%): ${offenders.join(' · ')}`);
});

test('ghost inspection shuffles scene options per session', () => {
  // Measured on data/ghost-scenarios.json: the all-standards-met option sat on
  // position B in 95/96 scenes, and the renderer painted the AUTHORED order —
  // always pressing B scored a near-perfect inspection. startGhostInspection
  // must build a session copy with each scene's options shuffled at runtime
  // (never by reordering the JSON: the bias would return with the next authored
  // scenario), and the scene renderer must read only that copy.
  const start = html.slice(html.indexOf('async function startGhostInspection'), html.indexOf('function renderGhostIntro'));
  assert(/options: _lqaShuffle\(sc\.options\)/.test(start),
    'startGhostInspection must shuffle each scene\'s options via _lqaShuffle');
  assert(/_gBase\.scenes\.map/.test(start), 'ghost session copy must be built at inspection start');
  const render = html.slice(html.indexOf('function renderGhostScene'), html.indexOf('function ghostChoose'));
  assert(!/GHOST_SCENARIOS/.test(render), 'renderGhostScene must read the shuffled session copy, never the authored array');
  // Anti-repetición (jul 2026: "se repiten mucho las mismas situaciones"): la
  // elección recuerda los últimos vistos y evita repetir; hay botón "Otra".
  assert(/function _ghostPick\(exclude\)/.test(html) && /txk_ghost_recent/.test(html),
    'debe existir _ghostPick con memoria de escenarios recientes');
  assert(/const _gBase = _ghostPick\(/.test(start),
    'startGhostInspection debe elegir vía _ghostPick (sin repetición)');
  const intro = html.slice(html.indexOf('function renderGhostIntro'), html.indexOf('function renderGhostScene'));
  assert(/startGhostInspection\(true\)/.test(intro) && /(Otra situación|Another situation)/.test(intro),
    'el intro debe ofrecer «Otra situación» (reroll)');
  // Shuffle-safety shape guard: options must be self-contained (label+effects+
  // feedback travel together, both languages) so reordering needs no index remap.
  const ghost = JSON.parse(read('data/ghost-scenarios.json'));
  for (const g of ghost) for (const sc of g.scenes) {
    assert(Array.isArray(sc.options) && sc.options.length >= 3, `ghost ${g.id}/${sc.title}: expected >=3 options`);
    for (const o of sc.options) {
      assert(o.label && o.label_en && o.feedback && o.feedback_en, `ghost ${g.id}/${sc.title}: option missing bilingual label/feedback`);
      assert(Array.isArray(o.effects) && o.effects.length && o.effects.every(e => typeof e.std === 'number' && typeof e.met === 'boolean'),
        `ghost ${g.id}/${sc.title}: option missing well-formed effects`);
    }
  }
});

test('exam anti-echo: ingredients/history questions are reversed and redacted', () => {
  // Measured on the real menu: the correct option leaked dish-name words in
  // 74% (ingredients) / 83% (history) of questions. Those topics now ask in
  // reverse with the passage masked of all candidates' name tokens.
  assert(/function _examRedact\(/.test(html) && /function _examNameTokens\(/.test(html),
    'redaction helpers missing');
  assert(/topic\.key==='ingredients' \|\| topic\.key==='history'/.test(html),
    'ingredients/history must branch into the reversed builder');
  assert(/rev:true,passage/.test(html), 'reversed questions must carry the redacted passage');
  assert(/qIngredientsRev/.test(html) && /qHistoryRev/.test(html),
    'reversed question labels missing (ES/EN)');
  // The renderer must show the passage, not the dish name, for reversed questions.
  assert(/q\.rev\s*\n?\s*\?/.test(html) && /escapeHtml\(q\.passage\)/.test(html),
    'renderer must show the redacted passage for reversed questions');
});

test('floating FABs hide behind the open nav sheet / search', () => {
  // The sound toggle + sync pill float above #screenApp and otherwise overlap
  // the bottom-sheet options; they must hide while the nav or search is open.
  const css = read('styles.css');
  assert(/body:has\(#mainNavDD\.open\)\s+\.sound-toggle/.test(css),
    'sound toggle must hide when the nav sheet is open');
  assert(/body:has\(#gsOverlay\.open\)\s+\.sound-toggle/.test(css),
    'sound toggle must hide when global search is open');
});

test('global search phase 2: LQA situations searchable + read-only card', () => {
  // The search must index LQA situations (both languages + category) and open
  // a read-only reference card — never the quiz, never awarding XP.
  assert(/function _gsLqaIndex\(/.test(html), 'LQA search index missing');
  assert(/s\.scn, s\.scn_en, s\.q, s\.q_en, s\.expl, s\.expl_en/.test(html),
    'LQA index must cover ES+EN scenario, question and explanation');
  assert(/data\/lqa-situations\.json'[^)]*\{ silent:true \}/.test(html),
    'openGlobalSearch must silently lazy-load the LQA data');
  assert(/Situaciones LQA/.test(html), 'results must group LQA situations');
  assert(/function _gsShowLqaSituation\(/.test(html) && /id = 'gsLqaOverlay'/.test(html),
    'LQA result must open the reference overlay');
  // Read-only: the card body must not touch quiz state or award XP.
  const card = html.slice(html.indexOf('function _gsShowLqaSituation'), html.indexOf('function _gsShowLqaSituation') + 5200);
  assert(!/awardXP|lqaSitState|lqaExamState/.test(card),
    'the reference card must not award XP or touch quiz state');
  assert(/showTab\('protocolo'\)/.test(card), 'card must link to practice in LQA');
});

test('global search: entry, overlay and deep-link wiring', () => {
  const css = read('styles.css');
  // one-tap entry lives at the top of the nav sheet
  assert(/id="navSearchEntry"[^>]*onclick="openGlobalSearch\(\)"/.test(html),
    'the search entry button must call openGlobalSearch()');
  // overlay + input exist and the input is >=16px (no iOS zoom) via .gs-input
  assert(/id="gsOverlay"/.test(html) && /id="gsInput"/.test(html),
    'search overlay + input must exist');
  // The overlay MUST be hidden by an inline style so a stale styles.css in the
  // PWA cache can never render it as a full-screen unstyled block over the app.
  assert(/id="gsOverlay"[^>]*style="display:none"/.test(html),
    'search overlay must be inline-hidden (stale-CSS safety)');
  assert(/ov\.style\.display='flex'/.test(html) && /ov\.style\.display='none'/.test(html),
    'openGlobalSearch/closeGlobalSearch must toggle the inline display');
  assert(/\.gs-input\{[^}]*font-size:16px/.test(css),
    'search input must be >=16px so iOS does not zoom on focus');
  // engine + deep-links into the real detail views
  assert(/function openGlobalSearch\(/.test(html) && /function _gsRender\(/.test(html),
    'search engine functions missing');
  // Los resultados de plato abren la FICHA RÁPIDA (foto + info), no el viaje;
  // el recorrido guiado queda como botón opcional dentro de la ficha.
  assert(/if\(type==='dish'\)\{ if\(typeof _emplOpen==='function'\) _emplOpen\(id\)/.test(html),
    'dish results must open the quick sheet (_emplOpen), not force the journey');
  assert(/class="empl-ov-journey" onclick="[^"]*launchDishJourney\(\$\{d\.id\}\)"/.test(html),
    'the quick sheet must offer the guided journey as an optional button');
  assert(/_showWineDetail\(id,/.test(html),
    'wine results must deep-link into _showWineDetail');
  // accent-insensitive index so "lacteos" matches "Lácteos", "gluten" the allergen
  assert(/normalize\('NFD'\)\.replace\(\/\[\\u0300-\\u036f\]\/g,''\)/.test(html),
    'search must fold accents for allergen/name matching');
});

test('sub-tab navigation is VISIBLE chips (owner: the dropdown hid the subsections)', () => {
  // Jul 2026: el desplegable cerrado parecía un título y nadie descubría
  // Emplatado/Flashcards/Videos. _subTabBar renderiza ahora chips visibles
  // con scroll horizontal. Vinos conserva su desplegable propio.
  assert(/class="subtab-chips" role="tablist"/.test(html),
    '_subTabBar must render the visible chips row');
  assert(!/return _subTabDropdown\(tabs, activeTab,/.test(html),
    '_subTabBar must NOT delegate to the closed dropdown anymore');
  assert(/_chipsBar\(tabs, sub, id=>`_vinoSubTab/.test(html),
    'the Vinos bar must use the SAME chips language (uniform design, owner request)');
  assert(!/_subTabDropdown\(/.test(html), 'the dead dropdown component must be fully removed');
  const css = read('styles.css');
  assert(/\.subtab-chips\{[^}]*overflow-x:auto/.test(css), 'chips row must scroll horizontally');
  assert(/\.subtab-chip\.on\{[^}]*var\(--gold\)/.test(css), 'active chip must be gold-filled');
  // (la variante verde del chip era exclusiva de la antigua «Simulación»;
  // desde el rediseño jul 2026 ningún chip la usa)
  assert(!/\? 'smart' : null/.test(html),
    'la barra no debe cablear el chip verde de la antigua Simulación');
});

test('Aprender → Técnicas: glosario de técnicas de cocina cableado y derivado de la carta', () => {
  // Pedido por el chef (jul 2026): que el equipo aprenda qué es cada técnica.
  // Datos + renderer + subpestaña, con enlaces a platos calculados en runtime.
  assert(/const TECNICAS\s*=\s*\[/.test(html) && /const TECNICA_FAMS\s*=\s*\[/.test(html),
    'faltan los datos de técnicas (TECNICAS / TECNICA_FAMS)');
  // repertorio de alta cocina: el aire y las familias de vanguardia/húmeda/pastelería
  assert(/es:'Aire \(aire de lecitina\)'/.test(html) && /es:'Esferificación'/.test(html),
    'faltan técnicas de vanguardia (aire, esferificación)');
  assert(/k:'vanguardia'/.test(html) && /k:'humeda'/.test(html) && /k:'pasteleria'/.test(html),
    'faltan las familias de alta cocina (vanguardia, húmeda, pastelería)');
  // técnicas de escuela de hostelería (sugeridas por el chef): prep + clásicas
  assert(/k:'prep'/.test(html) && /es:'Bridar \(embridar\)'/.test(html) && /es:'Saltear'/.test(html) &&
         /es:'Gratinar'/.test(html) && /es:'Desglasar'/.test(html) && /es:'Clarificar'/.test(html),
    'faltan las técnicas clásicas de escuela (bridar, saltear, gratinar, desglasar, clarificar)');
  // la nota "En el Txoko" es opcional (técnicas aspiracionales sin plato en carta)
  assert(/\$\{t\.txoko\?`<div class="tec-txoko"/.test(html),
    'la nota En el Txoko debe ser opcional (solo cuando hay plato real)');
  assert(/function renderTecnicas\(\)/.test(html), 'falta el renderer renderTecnicas');
  // subpestaña cableada en los 5 puntos del enrutado de Aprender
  assert(/\['tecnicas',_en\?'Techniques':'Técnicas'/.test(html), 'la subpestaña Técnicas no está en la barra de chips');
  assert(/const APR = \['aprender','repaso','tecnicas'/.test(html), 'tecnicas no está en la lista APR');
  assert(/tecnicas:'aprender'/.test(html), 'tecnicas no está en parentMap');
  assert(/tecnicas:renderAprender/.test(html), 'tecnicas no está en renderMap');
  assert(/tecnicas:renderTecnicas/.test(html), 'renderAprender no despacha a renderTecnicas');
  // los platos NO se escriben a mano: se buscan por palabra clave en las fichas
  assert(/function _tecDishes\(kw,kwx\)/.test(html) && /kw\.some\(k=>hay\.includes\(k\)\)/.test(html),
    'los enlaces a platos deben derivarse de DISHES en runtime, no hardcodearse');
  // kwx: exclusión de falsos positivos (p.ej. "horno de carbón"/josper NO es
  // "asado al horno"; "grasa infiltrada...a baja temperatura" del entrecot de
  // wagyu describe la grasa, no una cocción a baja temperatura)
  assert(/kwx && kwx\.some\(k=>hay\.includes\(k\)\)/.test(html),
    'falta la exclusión kwx en _tecDishes');
  assert(/kwx:\['horno de carbón'\]/.test(html), 'Asado al horno debe excluir "horno de carbón" (josper=brasa)');
  assert(/kwx:\['grasa infiltrada'\]/.test(html), 'Baja temperatura debe excluir "grasa infiltrada" (entrecot wagyu)');
  assert(/kw:\['brasa','parrilla','horno de carbón'\]/.test(html),
    'las carnes de horno de carbón (josper) deben enlazarse en Brasa y parrilla');
  // el emparejamiento cubre nombre+ingredientes+historia+NOTAS (p.ej. gratinado
  // del parmentier o filetones al horno solo aparecen en las notas)
  assert(/const hay=\(\(d\.name\|\|''\)\+' '\+\(d\.ingredients\|\|''\)\+' '\+\(d\.history\|\|''\)\+' '\+\(d\.notes\|\|''\)\)/.test(html),
    'el emparejamiento de técnicas debe incluir las notas de la ficha');
  // los fondos (fumet, bisque, caldos) están como técnica
  assert(/es:'Fondos y caldos'/.test(html), 'falta la técnica de fondos y caldos');
  // profundidad "Tipos · saber más": render desplegable + tipos de fondo
  assert(/<details class="tec-mas"><summary>/.test(html) && /t\.mas\.map\(m=>/.test(html),
    'falta el desplegable de tipos (tec-mas) en las técnicas');
  assert(/masT:\{es:'Tipos de fondo'/.test(html) && /t:'Fondo blanco'/.test(html) &&
         /t:'Fondo oscuro'/.test(html) && /t:'Fumet'/.test(html) && /t:'Court-bouillon/.test(html),
    'faltan los tipos de fondo (blanco, oscuro, fumet, court-bouillon)');
  // toca un plato → abre su ficha en La Carta
  assert(/onclick="_aprenderOpenDish\(\$\{d\.id\}\)"/.test(html), 'los chips de plato deben abrir la ficha');
  // color de texto correcto para tarjetas claras (usar --parchment, no --ink)
  const css = read('styles.css');
  assert(/\.tec-card-h\{[^}]*color:var\(--parchment\)/.test(css) && /\.tec-def\{[^}]*color:var\(--parch2\)/.test(css),
    'el texto de las técnicas debe usar el color oscuro (--parchment/--parch2) sobre parchment');
});

test('Aprender lands on Emplatado and lists it first (owner request, jul 2026)', () => {
  // La guía visual es lo más consultado en servicio: primera opción y
  // subtab por defecto.
  const bar = html.match(/_subTabBar\(\[\s*([\s\S]*?)\]\s*,\s*_subTab\.aprender \|\| 'emplatado'\s*,\s*'aprender'\)/);
  assert(bar, 'aprender _subTabBar call not found');
  const empIdx = bar[1].indexOf("'emplatado'");
  assert(empIdx !== -1, 'emplatado tab missing');
  assert(bar[1].indexOf("'smart'") === -1,
    'el chip Simulación/smart no debe volver a la barra (vive en La Carta)');
  assert(bar[1].trim().startsWith("['emplatado'"), 'Emplatado must be the FIRST Aprender sub-tab');
  assert(/_subTab\.aprender\s*\|\|\s*'emplatado'/.test(html),
    "Aprender default sub-tab must be 'emplatado'");
  // el inicializador manda: '|| emplatado' nunca dispara porque _subTab.aprender
  // siempre es truthy una vez inicializado
  assert(/let _subTab = \{ aprender:'emplatado'/.test(html),
    "_subTab must initialise aprender to 'emplatado', else the old default wins");
});

test('smart review leads with the simulation CTA, no live-case block', () => {
  // Owner request: the "ENTRAR EN SIMULACIÓN" CTA moves to the top of the
  // smart-review body, and the "EN VIVO · MESA AHORA" single-case block is
  // removed (redundant with the simulation).
  const start = html.indexOf('function renderSmartReview()');
  assert(start !== -1, 'renderSmartReview not found');
  const fn = html.slice(start, start + 12000);
  assert(!/class="ri-case-quote"/.test(fn) && !/id="riCaseQuote"/.test(fn),
    'the EN VIVO / MESA AHORA case block markup is back');
  const ctaIdx = fn.indexOf('class="ri-cta-wrap"');
  const statsIdx = fn.indexOf('class="ri-stats-row"');
  assert(ctaIdx !== -1 && statsIdx !== -1, 'cta or stats row missing');
  assert(ctaIdx < statsIdx,
    'simulation CTA must render above the stats row (lead action)');
});

test('video accordion tabs are tappable with legible labels', () => {
  // renderVideoAccordion built tab buttons with a ~32px tap target,
  // .58rem labels, and label colours that failed contrast (gold/red/
  // orange 2.4-3.3:1). Now 44px tap, .64rem labels, dark colours.
  const fn = html.match(/function renderVideoAccordion\([\s\S]*?\n\}/);
  assert(fn, 'renderVideoAccordion not found');
  const body = fn[0];
  assert(/min-height:44px/.test(body),
    'video accordion tab buttons must have a 44px tap target');
  assert(/font-size:\.64rem/.test(body),
    'video accordion labels must be .64rem (were .58rem ~9px)');
  assert(/#a04848/.test(body) && /#7d5c2f/.test(body),
    'video accordion label colours must use the dark WCAG palette');
});

test('profile stat numbers clear large-text contrast', () => {
  // The gold/orange/blue stat numbers were 2.42 / 2.39 / 2.89:1 on the
  // cream tiles — below even the 3:1 large-text floor. Darkened to >=4:1
  // while keeping the hue (tile border-left stays the vivid token).
  const css = read('styles.css');
  const base = (css.match(/\.stat-num\s*\{([^}]*)\}/) || [])[1] || '';
  assert(/color:\s*#9a7340/.test(base),
    '.stat-num base must be darkened gold #9a7340 (var(--gold) was 2.42:1)');
  assert(/\.stat-tile:nth-child\(2\) \.stat-num\{color:#b06828\}/.test(css),
    'tile 2 number must be darkened orange #b06828');
  assert(/\.stat-tile:nth-child\(4\) \.stat-num\{color:#3d7a96\}/.test(css),
    'tile 4 number must be darkened blue #3d7a96');
});

test('sommelier search input is >=16px (no iOS zoom)', () => {
  // Otro input con la trampa del auto-zoom de iOS, como maridajeSearch,
  // login y el buscador global. El camarero lo usa en la mesa.
  const css = read('styles.css');
  const rule = (css.match(/\.sommelier-input\s*\{([^}]*)\}/) || [])[1] || '';
  const m = rule.match(/font-size:\s*([\d.]+)(px|rem)/);
  assert(m, '.sommelier-input has no font-size');
  const px = m[2] === 'px' ? parseFloat(m[1]) : parseFloat(m[1]) * 16;
  assert(px >= 16, `.sommelier-input font-size is ${px}px (<16) — iOS will zoom on focus`);
});

test('leaderboard scores are WCAG-legible and names truncate', () => {
  // Score colours were gold/sage/rose on cream — 2.4 / 4.1 / 3.3:1, all
  // failing. Now dark green/gold/red. And long names must ellipsis, not
  // wrap and blow up the row.
  const css = read('styles.css');
  assert(/\.lb-score\.mid\s*\{[^}]*color:\s*(?:#7d5c2f|var\(--gold-deep\))/.test(css),
    '.lb-score.mid must be dark gold #7d5c2f / var(--gold-deep) (var(--gold) was 2.4:1 on cream)');
  assert(/\.lb-score\.lo\s*\{[^}]*color:\s*#a04848/.test(css),
    '.lb-score.lo must be dark red #a04848 (rose was 3.3:1)');
  const name = (css.match(/\.lb-name\s*\{([^}]*)\}/) || [])[1] || '';
  assert(/text-overflow:\s*ellipsis/.test(name) && /min-width:\s*0/.test(name),
    '.lb-name must truncate long names (ellipsis + min-width:0)');
});

test('login inputs are >=16px so iOS does not zoom on focus', () => {
  // .login-input (name / PIN / password) was .9rem (14.4px) — iOS Safari
  // auto-zooms inputs under 16px on focus, shifting the whole login. Must
  // stay at the 16px floor, like maridajeSearch / el buscador global.
  const css = read('styles.css');
  const rule = (css.match(/\.login-input\s*\{([^}]*)\}/) || [])[1] || '';
  const m = rule.match(/font-size:\s*([\d.]+)(px|rem)/);
  assert(m, '.login-input has no font-size');
  const px = m[2] === 'px' ? parseFloat(m[1]) : parseFloat(m[1]) * 16;
  assert(px >= 16, `.login-input font-size is ${px}px (<16) — iOS will zoom on focus`);
});

test('exam results ring is a real progress ring with result colour', () => {
  // The results ring was a decorative gold border with a gold % at
  // 2.25:1 on cream. Now it's a conic-gradient that fills to the score
  // and the % takes the result colour (green/gold/red, all WCAG-legible).
  const css = read('styles.css');
  const ring = (css.match(/\.results-ring\s*\{([^}]*)\}/) || [])[1] || '';
  assert(/conic-gradient/.test(ring),
    '.results-ring lost its conic-gradient progress fill — back to a decorative circle');
  const pct = (css.match(/\.results-pct\s*\{([^}]*)\}/) || [])[1] || '';
  assert(/color:\s*var\(--sc/.test(pct),
    '.results-pct must take the result colour var(--sc), not flat gold (gold was 2.25:1 on cream)');
  // markup must pass the score colour + percent into the ring
  assert(/--sc:\$\{scoreCol\}/.test(html) && /--p:\$\{pct\}/.test(html),
    'results markup must feed --sc and --p into the ring');
});

test('exam progress bar is visible and feedback colours clear WCAG', () => {
  // On the cream exam bg the gold "Correcto" feedback was 2.25:1 and the
  // 2px progress bar was near-invisible. Fixed: 6px bar, and success/error
  // feedback in dark green/red that clear 4.5:1.
  const css = read('styles.css');
  const track = (css.match(/\.exam-track\s*\{([^}]*)\}/) || [])[1] || '';
  const h = (track.match(/height:\s*(\d+)px/) || [])[1];
  assert(h && parseInt(h) >= 4, `.exam-track height ${h}px is too thin to see on a phone`);
  assert(/\.exam-feedback\.ok\s*\{[^}]*color:\s*(?:#2d6a3e|var\(--green-deep\))/.test(css),
    '.exam-feedback.ok must be dark green #2d6a3e / var(--green-deep) (gold was 2.25:1 on cream, failed WCAG)');
  assert(/\.exam-feedback\.ko\s*\{[^}]*color:\s*#a04848/.test(css),
    '.exam-feedback.ko must be dark red #a04848 (light red failed WCAG on cream)');
});

test('sub-tabs are tappable and use the flat (Sobria) active style', () => {
  // .tunic-stab tap target was ~34px; the "Sobria" redesign sets a 44px
  // min-height and a legible label, and drops the heavy pulsing aura on
  // the active tab (no tunic-stab-aura animation).
  const css = read('styles.css');
  const base = (css.match(/\.tunic-stab\s*\{([^}]*)\}/) || [])[1] || '';
  assert(/min-height:\s*44px/.test(base),
    '.tunic-stab lost its 44px min tap target');
  const lblSize = (base.match(/font-size:\s*([\d.]+)rem/) || [])[1];
  assert(lblSize && parseFloat(lblSize) >= 0.64,
    `.tunic-stab font-size ${lblSize}rem fell below the legible floor (.64rem)`);
  const active = (css.match(/\.tunic-stab\.active\s*\{([^}]*)\}/) || [])[1] || '';
  assert(!/tunic-stab-aura/.test(active),
    'the pulsing aura animation came back to the active sub-tab — Sobria removed it');
});

test('flashcard hint + rating buttons stay legible and accessible', () => {
  // Flip hint was .52rem (~8px) with no flip affordance; rating buttons
  // packed a decorative keyboard glyph and the "Repasar" red failed WCAG
  // (4.33:1). Guard the legibility bump, the flip icon, the removed glyph,
  // and the darker red.
  const css = read('styles.css');
  const hint = (css.match(/\.fc-flip-hint\s*\{([^}]*)\}/) || [])[1] || '';
  const hintSize = (hint.match(/font-size:\s*([\d.]+)rem/) || [])[1];
  assert(hintSize && parseFloat(hintSize) >= 0.6,
    `.fc-flip-hint font-size ${hintSize}rem fell below the legible floor (.6rem)`);
  assert(/\.fc-flip-hint svg\s*\{/.test(css),
    'flip-hint lost its ↻ icon — the turn gesture is no longer signalled');
  assert((html.match(/fc-rate-kbd"/g) || []).length === 0,
    'the decorative keyboard glyph came back to the rating buttons');
  assert(/\.fc-rate-again\s*\{[^}]*color:\s*#a04848/.test(css),
    '.fc-rate-again red must stay #a04848 (the old #b55858 was 4.33:1, below WCAG)');
});

test('dashboard stat label stays legible (Limpia redesign)', () => {
  // The stat label was .5rem (~8px) — too small. The "Limpia" redesign
  // bumped it and dropped the em-dash ::before/::after and the corner
  // marks. Guard the legible floor and that the decorations stay gone.
  const css = read('styles.css');
  const lbl = (css.match(/\.dash-stat-lbl\s*\{([^}]*)\}/) || [])[1] || '';
  const size = (lbl.match(/font-size:\s*([\d.]+)rem/) || [])[1];
  assert(size && parseFloat(size) >= 0.58,
    `.dash-stat-lbl font-size ${size}rem dropped below the legible floor (.58rem)`);
  assert(!/\.dash-stat-lbl::(before|after)\s*\{/.test(css),
    'the em-dash ::before/::after on the stat label came back — Limpia removed them');
  assert((html.match(/dash-stat-corner/g) || []).length === 0,
    'dash-stat-corner spans are back in the markup — Limpia removed them');
});

test('.btn-secondary has a real style rule (not a bare grey button)', () => {
  // .btn-secondary is used on "Volver" buttons but for a long time had no
  // CSS rule, so those rendered as unstyled grey system buttons. The rule
  // must exist with the brand cream/gold treatment and the dark-gold text
  // that clears WCAG (#9a7340 was 3.98:1 and failed; #7d5c2f is 5.66:1).
  const css = read('styles.css');
  const rule = css.match(/\.btn-secondary\s*\{([^}]*)\}/);
  assert(rule, '.btn-secondary has no CSS rule — Volver buttons render as bare grey');
  assert(/border:[^;]*var\(--gold\)/.test(rule[1]) || /border:[^;]*#c49a3c/.test(rule[1]),
    '.btn-secondary lost its gold border');
  assert(/color:\s*(?:#7d5c2f|var\(--gold-deep\))/.test(rule[1]),
    '.btn-secondary text must be dark gold #7d5c2f / var(--gold-deep) (lighter gold fails WCAG on cream)');
  // Still used in the markup — guard against the class being renamed away.
  assert((html.match(/class="btn-secondary/g) || []).length >= 1,
    'no .btn-secondary usages found — was the class renamed?');
});

test('Explorar is a TUNIC manual page (statline + ledger categories)', () => {
  // Same de-boxing as dashboard/LQA: the boxed stats banner and the seven
  // ~200px category tiles became a mono stat line and hairline ledger rows.
  const rep = html.slice(html.indexOf('const cards=activeCats.map'), html.indexOf('function searchRepaso'));
  assert(/dash-row" aria-label[^>]*onclick="openRepasoCat/.test(rep),
    'categories must render as ledger rows');
  assert(/repaso-statline/.test(rep), 'overview must be the mono stat line');
  assert(!/repaso-cat-tile|repaso-orient-stat/.test(rep), 'old boxed tiles/banner must be gone');
  const css = read('styles.css');
  assert(/\.repaso-statline\{/.test(css), 'repaso statline style missing');
});

test('LQA hub is a TUNIC manual page (banner + index + ledger categories)', () => {
  // Same de-boxing language as the dashboard: the 9 colored cards became one
  // flagship Ghost banner, a 2-col mode index and hairline category rows.
  const lqa = html.slice(html.indexOf('LQA hub — TUNIC manual page'), html.indexOf('function renderLqaCategory'));
  assert(lqa.length > 100, 'LQA hub block missing');
  assert(/hub-banner[^>]*startGhostInspection/.test(lqa), 'Ghost banner must stay the flagship');
  assert(/dash-index-entry" onclick="lqaView='info'/.test(lqa)
    && /dash-index-entry" onclick="startLqaExam\(\)/.test(lqa)
    && /dash-index-entry" onclick="startLqaSituations\(\)/.test(lqa)
    && /dash-index-entry" onclick="startLqaAuditor\(\)/.test(lqa),
    'the four LQA modes must live in the manual index');
  assert(/dash-row" onclick="renderLqaCategory/.test(lqa),
    'categories must render as ledger rows');
  assert(!/hub-qa"|lqa-cat-card/.test(lqa), 'old boxed hub cards must be gone');
});

test('dashboard alerts are hairline ledger rows (TUNIC de-boxing)', () => {
  // The colored .dash-alert cards + .dash-num badges became .dash-row ledger
  // rows: ink numeral, hairline separator, semantic color only on numerals.
  const css = read('styles.css');
  assert(/\.dash-row\{[^}]*border-bottom:1px solid rgba\(28,42,34,\.1\)/.test(css),
    '.dash-row must separate with a hairline, not a card box');
  assert(/\.dash-row-num\{[^}]*Cinzel/.test(css), 'ledger numeral style missing');
  const rows = (html.match(/class="dash-row[" ]/g) || []).length;
  assert(rows >= 5, `expected >=5 dashboard ledger rows, found ${rows}`);
  // Study section must be the 2-column index, not the boxed hub grid.
  assert(/dash-index-entry/.test(html) && !/dash-hub-grid/.test(html),
    'study must render as the manual index, not boxed hub cards');
});

test('exam .choice has high-contrast state badge + check/cross mark', () => {
  // Ported "Claridad" redesign: on answer the letter badge must go to the
  // DARK green/red (white letter legible) and a ✓/✕ mark must appear so the
  // result isn't communicated by colour alone. The mark is CSS-injected via
  // ::after keyed on the state class, so the markup just needs the span.
  const css = read('styles.css');
  assert(/\.choice\.correct\s+\.choice-ltr\s*\{[^}]*background:\s*(?:#2d6a3e|var\(--green-deep\))/.test(css),
    '.choice.correct badge must use dark green #2d6a3e / var(--green-deep) (light sage fails WCAG on white text)');
  assert(/\.choice\.wrong\s+\.choice-ltr\s*\{[^}]*background:\s*#a85848/.test(css),
    '.choice.wrong badge must use dark red #a85848 (light rose fails WCAG on white text)');
  assert(/\.choice\.correct\s+\.choice-mark::after\s*\{\s*content:\s*'✓'/.test(css),
    '.choice.correct must inject a ✓ mark (colour-blind-safe state signal)');
  assert(/\.choice\.wrong\s+\.choice-mark::after\s*\{\s*content:\s*'✕'/.test(css),
    '.choice.wrong must inject a ✕ mark');
  assert(/min-width:\s*0/.test((css.match(/\.choice-txt\s*\{([^}]*)\}/)||[])[1]||''),
    '.choice-txt needs min-width:0 so long ingredient text does not push the badge/mark off a narrow phone');
  // Markup must carry the two spans the CSS targets.
  assert(/class="choice-txt"/.test(html) && /class="choice-mark"/.test(html),
    'exam choice markup must include .choice-txt and .choice-mark spans');
});

test('viewport is clipped horizontally on <html>, not just <body>', () => {
  // Sideways-drift on app open: body had overflow-x:hidden but <html>
  // did not. On iOS/Android the document scroll lives on <html>, so the
  // viewport still drags sideways (e.g. the 140vw login godrays). <html>
  // must clip overflow-x; clip is preferred (no scroll container, keeps
  // sticky working) with hidden as the old-WebKit fallback.
  const css = read('styles.css');
  // The base html/body rules each start at the beginning of a line.
  const htmlRule = css.match(/\nhtml\s*\{([^}]*)\}/);
  assert(htmlRule, 'html rule not found');
  assert(/overflow-x\s*:\s*(clip|hidden)/.test(htmlRule[1]),
    'html must set overflow-x:clip/hidden or the viewport drags sideways on touch');
  // body should also disable horizontal overscroll so there's no
  // rubber-band / swipe-to-navigate drift.
  const bodyRule = css.match(/\nbody\s*\{([^}]*)\}/);
  assert(bodyRule && /overscroll-behavior-x\s*:\s*none/.test(bodyRule[1]),
    'body must set overscroll-behavior-x:none to stop horizontal rubber-band drift');
});

test('PWA theme-color is unified across manifest and meta tag', () => {
  // The launch splash on installed Android PWAs is drawn by the OS from
  // the manifest. Keeping theme_color == background_color (the brand dark
  // green #1c2a22) makes the status bar and splash one cohesive surface
  // instead of a black flash. The <meta name="theme-color"> must match the
  // manifest so the in-app status bar doesn't drift back to black.
  const manifest = JSON.parse(read('manifest.json'));
  assert(manifest.theme_color === manifest.background_color,
    `manifest theme_color (${manifest.theme_color}) != background_color (${manifest.background_color}) — splash/status-bar mismatch returns`);
  const meta = html.match(/<meta\s+name="theme-color"\s+content="([^"]+)"/i);
  assert(meta, 'meta theme-color tag missing');
  assert(meta[1].toLowerCase() === manifest.theme_color.toLowerCase(),
    `<meta theme-color> (${meta[1]}) != manifest theme_color (${manifest.theme_color}) — they must stay in sync`);
});

test('Service Mode stays removed (no FAB, no show call)', () => {
  // Owner removed Service Mode. The FAB (its only entry point) must not be
  // rendered and _svcShowFab() must not be called; the _svc* code is kept
  // but unreferenced, like the Servicio Fantasma removal.
  assert(!/id="svcFab"/.test(html),
    'the Service Mode FAB button is back in the markup');
  assert(!/[^n] _svcShowFab\(\)/.test(html.replace(/function _svcShowFab\(\)/g, 'function DEFN')),
    '_svcShowFab() is being called again — Service Mode FAB would reappear');
});

test('Servicio Fantasma inactivity trigger stays disabled', () => {
  // The Servicio Fantasma drill used to intercept returning users on login
  // when inactive >= 7 days. The owner asked to remove that interception.
  // launchServicioFantasma must therefore appear ONLY as its own definition,
  // never as a call site — any re-introduced invocation brings the drill back.
  const defs = (html.match(/function\s+launchServicioFantasma\s*\(/g) || []).length;
  const allRefs = (html.match(/launchServicioFantasma\s*\(/g) || []).length;
  assert(defs === 1, `expected exactly 1 launchServicioFantasma definition, found ${defs}`);
  assert(allRefs === defs,
    `launchServicioFantasma is invoked ${allRefs - defs} time(s) — the inactivity drill trigger is back; the owner disabled it`);
});

// ─── 6y. EL TURNO — survivors mini-game overlay guards ──────────
// New full-screen game overlay (canvas + joystick + WebAudio). Guards its
// three risk areas: (1) it exists and is entry-pointed from the games hub,
// (2) it never leaks — every listener/rAF/AudioContext it opens must be
// torn down on exit, (3) it stays scoped — no unprefixed id/class collides
// with pre-existing app selectors (.screen, .card, .pill, .row, #stage...).
console.log('\nEL TURNO mini-game guards');

test('launchElTurno() is defined exactly once', () => {
  const defs = (html.match(/function\s+launchElTurno\s*\(\)/g) || []).length;
  assert(defs === 1, `expected exactly 1 launchElTurno definition, found ${defs}`);
});

test('games hub (renderTxoko) has a card launching Camarero Survivors', () => {
  const hubStart = html.indexOf('function renderTxoko(');
  const hubEnd = html.indexOf('function renderTxTop10(');
  assert(hubStart !== -1 && hubEnd > hubStart, 'could not locate renderTxoko body');
  const hub = html.slice(hubStart, hubEnd);
  assert(hub.includes('launchElTurno()'), 'no game-card in renderTxoko() calls launchElTurno()');
  assert(hub.includes('Camarero Survivors'), 'Camarero Survivors card title missing from games hub');
});

test('Camarero Survivors: 14 alérgenos de la UE + objetivo visible (jul 2026)', () => {
  const s = html.indexOf('const ALLERGENS=[');
  assert(s !== -1, 'no se encontró el array ALLERGENS');
  const arr = html.slice(s, html.indexOf('];', s));
  const nuevos = ['cacahuete','apio','mostaza','sesamo','molusco','altramuz'];
  for (const k of nuevos) assert(arr.includes("key:'"+k+"'"), 'falta el alérgeno '+k+' en ALLERGENS');
  // los 8 originales siguen presentes → total 14 (los oficiales de la UE)
  const claves = (arr.match(/key:'[a-z]+'/g)||[]);
  assert(claves.length === 14, 'deberían ser 14 alérgenos (UE), hay '+claves.length);
  // mapas de sprites preparados para el arte de Grok (foe/boss por clave)
  for (const k of nuevos) {
    assert(html.includes('boss-'+k+'.webp'), 'falta el sprite boss de '+k);
    assert(html.includes('foe-'+k+'.webp'), 'falta el sprite foe de '+k);
  }
  // cada jefe nuevo tiene habilidad definida (no cae en el volley por defecto)
  const ab = html.slice(html.indexOf('const BOSS_ABIL='), html.indexOf('const BOSS_ABIL=')+420);
  for (const k of nuevos) assert(ab.includes(k+':'), 'BOSS_ABIL sin entrada para '+k);
  // OBJETIVO visible: barra de progreso al cierre + contador de chefs + misión
  assert(/id="etObjfill"/.test(html) && /id="etChefTxt"/.test(html),
    'falta la barra de objetivo o el contador de chefs en el HUD');
  assert(/chefsKilled/.test(html), 'no se cuentan los chefs despachados (objetivo)');
  assert(/TU MISIÓN/.test(html), 'la pantalla de inicio no comunica la misión');
  const css = read('styles.css');
  assert(/\.et-obj\{/.test(css) && /\.et-objfill\{/.test(css), 'falta el CSS de la barra de objetivo');
});

test('Camarero Survivors: LA MÁNAGER aliada suelta una botella que explota (jul 2026)', () => {
  const i = html.indexOf('function launchElTurno(');
  const body = html.slice(i, i + 130000);
  // estado + temporizador de aparición
  assert(/manager:null, nextMgr:/.test(body), 'falta el estado de la mánager (manager/nextMgr)');
  assert(/mgrBottles:\[\]/.test(body), 'falta el array de botellas de la mánager');
  // cruza volando y suelta una botella hacia un enemigo
  assert(/G\.manager=\{/.test(body) && /dropped:false/.test(body), 'la mánager no aparece/cruza');
  assert(/G\.mgrBottles\.push\(/.test(body), 'la mánager no suelta la botella');
  // la botella EXPLOTA dañando enemigos (reusa hurtEnemy + explosión) y NO toca al héroe
  assert(/for\(let i=G\.mgrBottles\.length-1[\s\S]{0,400}hurtEnemy\(e,/.test(body),
    'la botella de la mánager no daña a los enemigos al explotar');
  assert(/G\.mgrBottles\.length-1[\s\S]{0,700}G\.explosions\.push/.test(body),
    'la botella de la mánager no genera la onda de explosión');
  // se reprograma para volver a pasar
  assert(/G\.nextMgr=G\.time\+/.test(body), 'la mánager no se reprograma tras salir');
  // sprite con respaldo dibujado
  assert(/const ET_HELPER_SPRITE=/.test(html) && /MGR_IMG/.test(body),
    'falta el sprite de la mánager o su respaldo');
});

test('Camarero Survivors: armas nuevas — tenedor asta + pimentero pesado (jul 2026)', () => {
  const i = html.indexOf('function launchElTurno(');
  const body = html.slice(i, i + 150000);
  // cartas de mejora y evoluciones
  assert(/t:'Tenedor gigante'/.test(body) && /t:'Pimentero'/.test(body), 'faltan las cartas de tenedor/pimentero');
  assert(/'Trinche real'/.test(body) && /'Pimienta negra'/.test(body), 'faltan las evoluciones de las armas nuevas');
  // estado
  assert(/fork:0, forkT:0/.test(body) && /pepper:0, pepperT:0/.test(body), 'falta el estado de las armas nuevas');
  assert(/pClouds:\[\]/.test(body), 'falta el array de nubes de pimienta');
  assert(/pepShots:\[\]/.test(body), 'falta el array de molinillos en vuelo');
  // TENEDOR: estocada al más cercano que atraviesa la línea y empuja
  assert(/WEAPON — TENEDOR/.test(body) && /G\.forkFx=1/.test(body), 'falta la lógica del tenedor (estocada)');
  // PIMENTERO: el molinillo SALE VOLANDO y explota al impactar (área + nube DoT)
  assert(/WEAPON — PIMENTERO/.test(body) && /G\.pepShots\.push/.test(body), 'el molinillo no sale volando');
  assert(/G\.pClouds\.push\(\{x:m\.x,y:m\.y/.test(body) && /G\.explosions\.push\(\{x:m\.x,y:m\.y/.test(body),
    'el molinillo no explota en el punto de impacto');
  assert(/for\(const e of G\.enemies\)\{ if\(Math\.hypot\(e\.x-c\.x,e\.y-c\.y\)<c\.r\) hurtEnemy/.test(body),
    'la nube de pimienta no hace daño por segundo');
  // pimentero MARRÓN (no salero blanco): icono SVG marrón de respaldo, nunca 🧂
  assert(/const PEPPER_IC='<svg/.test(body) && /fill="#7a4a1e"/.test(body) && !/🧂/.test(body),
    'el pimentero debe ser un SVG marrón, no el salero blanco 🧂');
  // sprites ilustrados (tenedor plateado + molinillo de madera) con loader _ok y
  // respaldo vectorial; existen en disco y se cachean en la runtime estable
  assert(/const ET_FORK_SPRITE='img\/sprites\/fork-weapon\.webp'/.test(html) &&
         /const ET_PEPPER_SPRITE='img\/sprites\/pepper-mill\.webp'/.test(html),
    'faltan las constantes de sprite de tenedor/molinillo');
  assert(existsSync(join(ROOT, 'img/sprites/fork-weapon.webp')), 'img/sprites/fork-weapon.webp missing on disk');
  assert(existsSync(join(ROOT, 'img/sprites/pepper-mill.webp')), 'img/sprites/pepper-mill.webp missing on disk');
  assert(/const FORK_IMG=new Image\(\); FORK_IMG\.onload=\(\)=>\{ FORK_IMG\._ok=true; \}/.test(body) &&
         /const PEPPER_IMG=new Image\(\); PEPPER_IMG\.onload=\(\)=>\{ PEPPER_IMG\._ok=true; \}/.test(body),
    'faltan los loaders de sprite de las armas nuevas');
  // el tenedor se dibuja con el sprite rotado (con respaldo vectorial)
  assert(/if\(FORK_IMG && FORK_IMG\._ok\)\{[\s\S]{0,200}ctx\.rotate\(G\.forkAng\)/.test(body),
    'el tenedor no dibuja el sprite rotado hacia el enemigo');
  // el molinillo se muestra al golpear (pepperFx) con su sprite
  assert(/G\.pepperFx=1;/.test(body) && /PEPPER_IMG && PEPPER_IMG\._ok/.test(body),
    'el molinillo no se muestra en el golpe pesado');
  // la carta usa el molinillo ilustrado, con respaldo (onerror) al SVG marrón
  assert(body.includes('const PEPPER_CARD_IC=\'<img \'+SRC+\'="') && body.includes("ic:PEPPER_CARD_IC,t:'Pimentero'") &&
         body.includes('this.outerHTML=this.dataset.fb'),
    'la carta del pimentero debe usar el sprite del molinillo con respaldo SVG');
});

test('launchElTurno() is idempotent (guards against a second overlay)', () => {
  const i = html.indexOf('function launchElTurno(');
  assert(i !== -1, 'launchElTurno not found');
  const body = html.slice(i, html.indexOf('\nfunction ', i + 10));
  assert(/if\(document\.getElementById\('etOverlay'\)\)\s*return;/.test(body),
    'launchElTurno lacks an early-return guard when #etOverlay already exists — re-invoking it (e.g. a double tap on the card) would mount a second game on top of the first');
});

test('EL TURNO teardown fully unmounts: cancels rAF, removes all its listeners, closes AudioContext, removes overlay', () => {
  const i = html.indexOf('function launchElTurno(');
  assert(i !== -1, 'launchElTurno not found');
  const end = html.indexOf('\n// ── Game flow', i);
  const body = html.slice(i, end > i ? end : i + 40000);
  const teardownMatch = body.match(/function teardown\(\)\{[\s\S]*?\n  \}/);
  assert(teardownMatch, 'no teardown() function found inside launchElTurno');
  const td = teardownMatch[0];
  assert(/cancelAnimationFrame\(rafId\)/.test(td), 'teardown does not cancel the game rAF loop — it would keep running after exit');
  assert(/window\.removeEventListener\('resize'/.test(td), 'teardown does not remove the window resize listener');
  assert(/window\.removeEventListener\('keydown'/.test(td), 'teardown does not remove the window keydown listener');
  assert(/window\.removeEventListener\('keyup'/.test(td), 'teardown does not remove the window keyup listener');
  assert(/stage\.removeEventListener\('touchstart'/.test(td), 'teardown does not remove the stage touchstart listener');
  assert(/stage\.removeEventListener\('touchmove'/.test(td), 'teardown does not remove the stage touchmove listener');
  assert(/stage\.removeEventListener\('touchend'/.test(td), 'teardown does not remove the stage touchend listener');
  assert(/AC\.close\(\)/.test(td), 'teardown does not close the AudioContext — it would leak an open audio node per play session');
  assert(/overlay\.remove\(\)/.test(td), 'teardown does not remove the overlay element from the DOM');
});

test('every game has a uniform, working "back to games" control', () => {
  // Petición del propietario: los juegos no tenían botón de volver uniforme (o
  // no funcionaba). Ahora todos usan la misma píldora .game-back → showTab('txoko').
  // (1) shared style exists
  assert(/\.game-back\{/.test(read('styles.css')), 'the shared .game-back button style must exist');
  // (2) Duelo y Mr. Shoesmith (intro + pregunta) llevan .game-back
  for (const fn of ['renderDuel(', 'txShowIntro(', 'txRender(']) {
    const i = html.indexOf('function ' + fn);
    assert(i !== -1, `${fn} not found`);
    const body = html.slice(i, html.indexOf('\nfunction ', i + 10));
    assert(/class="game-back"/.test(body), `${fn} must render the unified .game-back control`);
  }
  // (3) Mr. Shoesmith mid-run exit stops the patience timer, then navigates
  const q = html.indexOf('function txQuit(');
  assert(q !== -1, 'txQuit() must exist');
  const qbody = html.slice(q, q + 180);
  assert(/clearInterval\(txokoTimer\)/.test(qbody) && /showTab\('txoko'\)/.test(qbody),
    'txQuit() must stop the patience timer and return to the games hub');
  // (4) Camarero Survivors (overlay) keeps its own exit button
  const e = html.indexOf('function launchElTurno(');
  assert(/id="etExitBtn"/.test(html.slice(e, e + 60000)), 'Camarero Survivors must keep its in-game exit button');
  // (5) El botón Salir debe quedar POR ENCIMA de .et-screen: las pantallas
  // (inicio/pausa/etc.) cubren toda la superficie con fondo translúcido, así
  // que si el botón está por debajo la pantalla se traga el clic y "Salir" no
  // funciona (bug reportado por el propietario, jul 2026).
  const gcss = read('styles.css');
  const exitZ = (gcss.match(/#etExitBtn\{[^}]*z-index:(\d+)/) || [])[1];
  const screenZ = (gcss.match(/\.et-screen\{[^}]*z-index:(\d+)/) || [])[1];
  assert(exitZ && screenZ, 'no se pudo leer el z-index de #etExitBtn o .et-screen');
  assert(Number(exitZ) > Number(screenZ),
    `#etExitBtn (z-index ${exitZ}) debe estar por encima de .et-screen (z-index ${screenZ}) o el clic de Salir no llega`);
});

test('character sprite: dashboard mascot removed, no stray SVG mascot leftovers', () => {
  // La mascota DECORATIVA del dashboard se retiró (petición del propietario:
  // no capturaba la esencia Funko). El sprite vectorial TXOKO_MASCOT_SVG que
  // usaba EL TURNO fue reemplazado por fotogramas reales (ver test del ciclo
  // de carrera) y se eliminó por completo — dead code, no relicto sin usar.
  assert(!/TXOKO_MASCOT_SVG/.test(html), 'TXOKO_MASCOT_SVG must be fully removed (replaced by the real run-cycle sprite)');
  assert(!/class="dash-mascot"/.test(html),
    'the decorative dashboard mascot must be removed from the hero');
  assert(!/\.dash-mascot\{/.test(read('styles.css')),
    'the .dash-mascot CSS rule must be removed');
});

test('Camarero Survivors: héroe con ciclo de carrera de fotogramas reales (jul 2026)', () => {
  // Segunda mejora gráfica pedida por el propietario (tras La Crítica): el
  // protagonista era una mascota vectorial estática; ahora corre con 2
  // fotogramas reales (vídeo Grok, cámara fija) sincronizados con el rebote
  // vertical ya existente — sin tocar la mecánica de dash (reutiliza el mismo
  // fotograma vía _etHeroFrame, con estela fantasma coherente).
  assert(/const ET_HERO_RUN=\[/.test(html), 'ET_HERO_RUN frame array missing');
  // Transparencia obligatoria (el JPEG dejaba caja de fondo — bug real);
  // desde jul 2026 son ARCHIVOS webp con alfa, no base64 inline.
  assert(html.includes("const ET_HERO_RUN=['img/sprites/hero-a.webp','img/sprites/hero-b.webp']"),
    'ET_HERO_RUN must wire the 2 run-cycle files');
  for (const f of ['hero-a', 'hero-b']) assert(existsSync(join(ROOT, `img/sprites/${f}.webp`)), `img/sprites/${f}.webp missing on disk`);
  const e = html.indexOf('function launchElTurno(');
  const loaderSrc = html.slice(e, e + 150000);
  assert(/const HERO=ET_HERO_RUN\.map\(/.test(loaderSrc), 'HERO must be built from the ET_HERO_RUN frames, not a single SVG image');
  assert(/function _etHeroFrame\(G\)\{ return G\.moving\?\(Math\.sin\(G\.time\*13\)>=0\?0:1\):0; \}/.test(loaderSrc),
    'the frame picker must sync leg-swap to the existing vertical bob phase, and hold frame 0 when idle');
  // Ambos puntos de dibujo (jugador + estela del dash) deben indexar el array,
  // no dibujar un HERO a secas — y la estela debe fijar el fotograma al empujar
  // el punto (para no desincronizarse mientras la estela se desvanece).
  assert(/ctx\.drawImage\(HERO\[_etHeroFrame\(G\)\]/.test(loaderSrc), 'the main player draw must pick the active run-cycle frame');
  assert(/G\.trail\.push\(\{x:G\.px,y:G\.py,life:1,face:G\.face,frame:_etHeroFrame\(G\)\}\)/.test(loaderSrc),
    'dash trail points must capture the frame active at push time');
  assert(/ctx\.drawImage\(HERO\[t\.frame\|\|0\]/.test(loaderSrc), 'the ghost trail must draw the frame captured for that point');
});

test('Mr. Shoesmith: reactive face sprites wired, intro framed (no hex crop)', () => {
  // El juego Txoko usa el personaje Mr. Shoesmith (asset del propietario) con 5
  // caras reactivas por vidas + un plano para el intro, incrustados como imagen.
  assert(/const SHOESMITH_FACES\s*=\s*\[/.test(html), 'SHOESMITH_FACES array missing');
  // Archivos desde jul 2026 (antes base64 inline; el HTML adelgazó ~713KB).
  for (let k = 0; k < 5; k++) {
    assert(html.includes(`img/sprites/shoe-f${k}.jpg`), `shoe face ${k} path missing`);
    assert(existsSync(join(ROOT, `img/sprites/shoe-f${k}.jpg`)), `img/sprites/shoe-f${k}.jpg missing on disk`);
  }
  // txClientFace must return the sprite image (not the old inline SVG faces).
  // Generalizado por persona (jul 2026, segundo personaje La Crítica): lee
  // p.faces[mood] desde el registro TX_PERSONAS en vez del array a secas —
  // el guard fija que la persona Shoesmith siga apuntando al array real.
  const i = html.indexOf('function txClientFace(lives, pct)');
  assert(i !== -1, 'txClientFace not found');
  const body = html.slice(i, html.indexOf('\n}', i) + 2);
  assert(/p\.faces\[mood\]/.test(body) && /tx-shoe-face/.test(body) && /const p=txPersona\(\)/.test(body),
    'txClientFace must return an <img class="tx-shoe-face"> from the active persona\'s faces');
  assert(!/return \[f0,f1,f2,f3,f4\]/.test(body), 'old inline-SVG faces must be gone');
  assert(/shoesmith:\{[\s\S]*?faces:SHOESMITH_FACES/.test(html), 'the shoesmith persona must still wire SHOESMITH_FACES');
  assert(/critic:\{[\s\S]*?faces:CRITIC_FACES/.test(html), 'the critic persona must wire CRITIC_FACES');
  // Intro portrait uses the framed photo, not the hexagon clip-path crop.
  const intro = html.slice(html.indexOf('function txShowIntro'), html.indexOf('function txShowIntro') + 3000);
  assert(/p\.intro/.test(intro), 'intro must render the active persona\'s intro portrait');
  assert(/shoesmith:\{[\s\S]*?intro:SHOESMITH_INTRO/.test(html), 'the shoesmith persona must still wire SHOESMITH_INTRO');
  assert(html.includes("const SHOESMITH_INTRO='img/sprites/shoe-intro.jpg'") && existsSync(join(ROOT, 'img/sprites/shoe-intro.jpg')),
    'SHOESMITH_INTRO must point to the repo file');
  assert(!/clip-path:polygon\(50% 0%,100% 25%/.test(intro), 'intro portrait must not use the hexagon crop');
  const css = read('styles.css').replace(/\s+/g,' ');
  assert(/\.tx-shoe-face\{[^}]*object-fit:cover/.test(css), '.tx-shoe-face needs object-fit:cover framing');
});

test('Txoko question screen (txRender) shows Mr. Shoesmith BIG, not the old generic waiter icon', () => {
  // Owner redesign: rubber-hose/Cuphead-vintage skin. The reactive face must
  // be large and framed next to the question bubble — the small HUD icon and
  // the generic <svg> waiter avatar are gone.
  const i = html.indexOf('function txRender(');
  assert(i !== -1, 'txRender not found');
  const body = html.slice(i, html.indexOf('\nfunction txGameOver', i));
  assert(/class="tx-rh-face-frame[ "]/.test(body), 'txRender must wrap the big face in .tx-rh-face-frame');
  assert(/id="txokoClientFace"[^>]*>\$\{txClientFace\(lives,\s*pct\)\}/.test(body),
    'txRender must render the reactive face via txClientFace(lives, pct) into #txokoClientFace');
  assert(!/txoko-waiter-avatar/.test(body), 'the old generic <svg> waiter avatar must be removed — the real face replaces it');
  assert(/class="txoko-game tx-rh-stage"/.test(body), 'txRender root must carry the tx-rh-stage rubber-hose scope');
  // Structural ids the game loop depends on (txTick/txAnswer) must survive the reskin.
  for (const id of ['txokoPatienceFill', 'txokoTimeLeft', 'txokoStreak', 'txokoChoices', 'txokoFeedback']) {
    assert(body.includes(`id="${id}"`), `txRender must keep id="${id}" — the game loop reads/writes it directly`);
  }
});

test('Games hub: Mr. Shoesmith card shows the real character photo, not the old placeholder SVG face', () => {
  const hubStart = html.indexOf('function renderTxoko(');
  const hubEnd = html.indexOf('function renderTxTop10(');
  assert(hubStart !== -1 && hubEnd > hubStart, 'could not locate renderTxoko body');
  const hub = html.slice(hubStart, hubEnd);
  // El atributo se escribe con ${SRC} para que el escáner de precarga no lo
  // confunda con una ruta real (ver la constante SRC en index.html).
  assert(/class="tx-rh-hero-frame"><img \$\{SRC\}="\$\{SHOESMITH_FACES\[0\]\}"/.test(hub),
    'the Mr. Shoesmith game-card must render SHOESMITH_FACES[0] inside .tx-rh-hero-frame');
  assert(!/Mini Mr\. Shoesmith face/.test(hub), 'the old placeholder SVG face (ellipse/path sketch) must be gone');
  assert(hub.includes('class="txoko-wrap tx-rh-hub"'), 'the hub wrapper must carry the tx-rh-hub rubber-hose scope');
  // structure/behaviour untouched — every card must still be present and wired
  // Puntos Débiles (startErrorMode) fue retirado del hub a petición del
  // propietario: los exámenes ya cubren el repaso de fallos. La Ruleta Txoko
  // se retiró entera (sept 2026): «no tiene ninguna utilidad» — era el único
  // juego que no entrenaba nada de la carta.
  for (const onclick of ['txStart()', 'renderDuel()', 'launchElTurno()']) {
    assert(hub.includes(onclick), `hub must still wire up ${onclick} — reskin must not drop a game card`);
  }
  assert(!hub.includes('startErrorMode()'), 'Puntos Débiles card must be removed from the games hub');
  assert(!/ruleta|Ruleta|Roulette/.test(html) && !/ruleta/i.test(read('styles.css')),
    'la Ruleta Txoko se retiró: no puede quedar ni marcado, ni estilos, ni la tarjeta del hub');
});

test('tx-rh rubber-hose CSS exists, is scoped, and covers every class the markup uses', () => {
  const css = read('styles.css');
  // Every tx-rh-* class name referenced by the JS templates must have a rule.
  const usedClasses = new Set();
  for (const m of html.matchAll(/class="([^"]*tx-rh-[^"]*)"/g)) {
    for (const c of m[1].split(/\s+/)) if (c.startsWith('tx-rh-')) usedClasses.add(c);
  }
  assert(usedClasses.size >= 15, `expected many tx-rh- classes in the markup, found ${usedClasses.size}`);
  const missing = [...usedClasses].filter(c => !css.includes('.' + c));
  assert(missing.length === 0, `tx-rh- classes used in markup but never styled: ${missing.join(', ')}`);
  // Scoping: every rule the TX-RH section adds for a shared/legacy class name
  // (txoko-choice, txoko-streak, txoko-dish-badge, txoko-feedback, game-card,
  // games-header) must be nested under .tx-rh-stage or .tx-rh-hub, so none of
  // it can leak into any other screen. Only look at CSS added after the
  // section marker — the original base rules for these classes predate this
  // redesign and are intentionally left as-is.
  const markerIdx = css.indexOf('TX-RH —');
  const endIdx = css.indexOf('/TX-RH', markerIdx);
  assert(markerIdx !== -1, 'TX-RH rubber-hose CSS section marker not found in styles.css');
  assert(endIdx !== -1 && endIdx > markerIdx, 'TX-RH rubber-hose CSS section end marker (/TX-RH) not found');
  const rhLines = css.slice(markerIdx, endIdx).split('\n').filter(l => l.includes('{'));
  for (const legacy of ['txoko-choice', 'txoko-streak', 'txoko-dish-badge', 'txoko-feedback', 'game-card', 'games-header']) {
    const wordBoundary = new RegExp(`\\.${legacy}\\b(?!-)`);
    const hits = rhLines.filter(l => wordBoundary.test(l));
    assert(hits.length > 0, `expected the TX-RH section to restyle .${legacy}`);
    const unscoped = hits.filter(l => !l.trim().startsWith('.tx-rh-stage') && !l.trim().startsWith('.tx-rh-hub'));
    assert(unscoped.length === 0, `.${legacy} rubber-hose override must be scoped under .tx-rh-stage/.tx-rh-hub, found unscoped: ${unscoped.join(' | ')}`);
  }
  // Tap targets: option buttons must clear the 44px touch minimum.
  const rhBlock = css.slice(markerIdx, endIdx);
  assert(/\.tx-rh-stage\s+\.txoko-choice\{[^}]*min-height:44px/.test(rhBlock),
    'rubber-hose option buttons must keep a 44px minimum tap target');
});

test('EL TURNO scene: escenarios rubber hose que rotan por nivel, con fundido (jul 2026)', () => {
  // Evolución del fondo: sepia oscuro → retícula procedural → lámina única →
  // TRES escenarios ilustrados ("qué tal cambiar de escenario después de X
  // niveles"): comedor → cocina (nv 5) → bodega (nv 10), rotando en niveles
  // altos, con fundido de ~1s y banner al cambiar. El ajedrezado queda SOLO
  // como respaldo mientras carga la lámina activa.
  const i = html.indexOf('function launchElTurno(');
  const body = html.slice(i, i + 130000);
  for (const f of ['et-comedor', 'et-cocina', 'et-bodega']) {
    assert(body.includes(`img/${f}.webp`), `scene artwork img/${f}.webp must be wired`);
    assert(existsSync(join(ROOT, `img/${f}.webp`)), `img/${f}.webp must exist on disk`);
  }
  assert(/const ET_BGS=\[/.test(body) && /b\.img\.src=b\.src/.test(body), 'scene loader array missing');
  // Selección por nivel + fundido + banner.
  assert(/Math\.floor\(G\.level\/5\)%ET_BGS\.length/.test(body), 'active scene must derive from level bands of 5, cycling');
  assert(/G\.bgPrev=G\.bgIdx; G\.bgIdx=_si; G\.bgFade=1; flash\(ET_BGS\[_si\]\.banner/.test(body),
    'scene switch must start the crossfade and announce the new room');
  assert(/¡A LA COCINA!/.test(body) && /¡A LA BODEGA!/.test(body) && /¡DE VUELTA AL COMEDOR!/.test(body),
    'each scene needs its banner');
  assert(/G\.bgFade-=dt\*0\.02/.test(body), 'the crossfade must decay over ~1s');
  // Render: lámina activa con paralaje; la anterior encima desvaneciéndose.
  assert(/\*1\.07/.test(body) && /\(G\.px-W\/2\)\*0\.05/.test(body),
    'the artwork must render with the 7% cover margin and the soft parallax offset');
  assert(/ctx\.globalAlpha=Math\.min\(1,G\.bgFade\); _bgDraw\(_bgOld\.img\)/.test(body),
    'the previous scene must fade out on top of the new one');
  assert(/\} else \{[\s\S]{0,120}const TS=54/.test(body),
    'the warm checkerboard must remain ONLY as the not-yet-loaded fallback');
  assert(!/furnished dining room: orderly grid/.test(body) && !/const CELL=178/.test(body),
    'the old procedural furniture grid must be gone (the artwork brings its own tables)');
  const css = read('styles.css');
  const stage = css.slice(css.indexOf('#etStage{'), css.indexOf('#etStage{') + 500);
  assert(/rgba\(255,236,180/.test(stage) && !/#3a2616 0%,#241609/.test(stage),
    '#etStage must keep the bright warm gradient, not the old dark sepia');
});

test('Camarero Survivors: monstruos-alérgeno ilustrados con respaldo (hoja del propietario, jul 2026)', () => {
  // Tercera mejora gráfica: los 8 enemigos dejan el círculo+emoji por sprites
  // reales recortados de UNA hoja Grok (estilo anclado con el sprite del héroe).
  // El dibujo por código queda como respaldo hasta que carga cada imagen.
  assert(/const ET_FOE_SPRITES=\{/.test(html), 'ET_FOE_SPRITES map missing');
  const mapSrc = html.slice(html.indexOf('const ET_FOE_SPRITES={'), html.indexOf('};', html.indexOf('const ET_FOE_SPRITES={')));
  const spriteKeys = [...mapSrc.matchAll(/([a-z]+):'img\/sprites\/foe-([a-z]+)\.webp'/g)].map(m => m[1]);
  // Arte en disco para los 14 alérgenos de la UE (los 6 nuevos recortados de la
  // hoja Grok del propietario, jul 2026). Si algún día se añade un alérgeno sin
  // sprite, el motor ya lo dibuja con el respaldo disco+emoji.
  for (const k of spriteKeys) assert(existsSync(join(ROOT, `img/sprites/foe-${k}.webp`)), `img/sprites/foe-${k}.webp missing on disk`);
  const i = html.indexOf('function launchElTurno(');
  const body = html.slice(i, i + 90000);
  // Las claves del mapa deben cubrir EXACTAMENTE el roster de ALLERGENS del juego.
  // roster = SOLO el array ALLERGENS (EL CHEF también define {key:'chef',...}
  // como pseudo-alérgeno y no debe contarse aquí)
  const rosterSrc = body.slice(body.indexOf('const ALLERGENS=['), body.indexOf('];', body.indexOf('const ALLERGENS=[')));
  const roster = [...rosterSrc.matchAll(/\{key:'([a-z]+)',\s*name:/g)].map(m => m[1]);
  assert(roster.length === 14, `expected 14 allergen foes (UE) in the roster, found ${roster.length}`);
  for (const k of roster) assert(spriteKeys.includes(k), `foe sprite missing for allergen '${k}'`);
  assert(spriteKeys.length === roster.length, 'ET_FOE_SPRITES must not carry unused sprites');
  // Cableado: loader por clave, dibujo del sprite con squash heredado y respaldo íntegro.
  assert(/FOES\[a\.key\]=img/.test(body), 'per-key foe image loader missing');
  assert(/\(_bsp&&_bsp\._ok\)\?_bsp:FOES\[e\.a\.key\]/.test(body) && /ctx\.drawImage\(_sp,-_sw\/2,-_sh\/2,_sw,_sh\)/.test(body),
    'enemy draw must render the sprite scaled to the body radius');
  // +10% visual solo en enemigos normales (jul 2026, "un poco pequeños"):
  // el radio de colisión no cambia y jefes/CHEF conservan su escala.
  assert(/const _sh=e\.r\*\(e\.boss\?2\.55:2\.8\)/.test(body),
    'normal foes must draw 10% larger while bosses keep their approved scale');
  assert(/\} else \{[\s\S]{0,80}ctx\.beginPath\(\); ctx\.fillStyle=e\.a\.col/.test(body),
    'the code-drawn circle body must remain as the not-yet-loaded fallback');
  assert(/if\(!\(_sp&&_sp\._ok\)\)\{ ctx\.font=/.test(body),
    'the emoji emblem must draw ONLY in the fallback (the sprite already carries the identity)');
  // La leyenda de inicio enseña el sprite real, no el emoji.
  assert(/et-lg"><img \$\{SRC\}="\$\{ET_FOE_SPRITES\[a\.key\]\}"/.test(body),
    'the start-screen legend must show the real sprites');
  // El lenguaje visual heredado sigue: sombra, aro de élite, corona del jefe, flash.
  for (const token of ['e.elite', 'corona del jefe', 'e.flash>0']) {
    assert(body.includes(token), `inherited visual language missing: ${token}`);
  }
});

test('Camarero Survivors: JEFES alérgeno con arte propio y más grandes (jul 2026)', () => {
  // Cuarta mejora gráfica: cada jefe es la versión monstruosa (estilo jefes de
  // Cuphead) de su alérgeno — no un utensilio genérico (descartado por el
  // propietario) — y sale más grande (r 46→54, "un poco más grandes").
  assert(/const ET_BOSS_SPRITES=\{/.test(html), 'ET_BOSS_SPRITES map missing');
  const mapSrc = html.slice(html.indexOf('const ET_BOSS_SPRITES={'), html.indexOf('};', html.indexOf('const ET_BOSS_SPRITES={')));
  const bossKeys = [...mapSrc.matchAll(/([a-z]+):'img\/sprites\/boss-([a-z]+)\.webp'/g)].map(m => m[1]);
  // Arte de jefe en disco para los 14 alérgenos de la UE (los 6 nuevos de la hoja
  // Grok del propietario, jul 2026), con respaldo del motor para cualquier futuro.
  for (const k of bossKeys) assert(existsSync(join(ROOT, `img/sprites/boss-${k}.webp`)), `img/sprites/boss-${k}.webp missing on disk`);
  const i = html.indexOf('function launchElTurno(');
  const body = html.slice(i, i + 90000);
  // roster = SOLO el array ALLERGENS (EL CHEF también define {key:'chef',...}
  // como pseudo-alérgeno y no debe contarse aquí)
  const rosterSrc = body.slice(body.indexOf('const ALLERGENS=['), body.indexOf('];', body.indexOf('const ALLERGENS=[')));
  const roster = [...rosterSrc.matchAll(/\{key:'([a-z]+)',\s*name:/g)].map(m => m[1]);
  assert(roster.length === 14 && bossKeys.length === 14, 'boss sprite map must cover the 14-allergen roster exactly');
  for (const k of roster) assert(bossKeys.includes(k), `boss sprite missing for allergen '${k}'`);
  // Cableado: loader propio + el dibujo del jefe PREFIERE su sprite de jefe.
  assert(/BOSSES\[a\.key\]=img/.test(body), 'per-key boss image loader missing');
  assert(/const _bsp=e\.boss&&!e\.chef\?BOSSES\[e\.a\.key\]:null;/.test(body) && /\(_bsp&&_bsp\._ok\)\?_bsp:FOES\[e\.a\.key\]/.test(body),
    'boss draw must prefer the boss sprite, falling back to the regular foe sprite');
  // Tamaño: el jefe nace con r=54.
  assert(/kind:'boss',flash:0,boss:true/.test(body) && /r:54,spd:0\.5,kind:'boss'/.test(body),
    'boss must spawn at r=54 (owner: "un poco más grandes")');
});

test('Camarero Survivors: EL CHEF, jefe final desde la foto del propietario (jul 2026)', () => {
  // Jefe final único: la persona de la foto del propietario convertida a
  // rubber hose (parecido iterado en Grok: complexión real, botones a punto
  // de explotar, barriga a la vista). Entra en el minuto 3 y cada 3 minutos.
  assert(/const ET_CHEF_SPRITES=\{/.test(html), 'ET_CHEF_SPRITES missing');
  const mapSrc = html.slice(html.indexOf('const ET_CHEF_SPRITES={'), html.indexOf('};', html.indexOf('const ET_CHEF_SPRITES={')));
  assert(/calm:'img\/sprites\/chef-calm\.webp'/.test(mapSrc) && /attack:'img\/sprites\/chef-attack\.webp'/.test(mapSrc),
    'the chef needs his two pose files wired');
  for (const f of ['chef-calm', 'chef-attack']) assert(existsSync(join(ROOT, `img/sprites/${f}.webp`)), `img/sprites/${f}.webp missing on disk`);
  const i = html.indexOf('function launchElTurno(');
  const body = html.slice(i, i + 120000);
  assert(/CHEF_SPR\[k\]=img/.test(body), 'chef sprite loader missing');
  // Aparición: minuto 3, y cada 180s después. Más grande y más duro que un jefe.
  assert(/nextChef:180/.test(body), 'chef timer must start at 180s (minute 3)');
  assert(/if\(G\.time>=G\.nextChef\)\{ G\.nextChef\+=180; spawnChef\(\); \}/.test(body), 'chef must respawn every 180s');
  assert(/function spawnChef\(/.test(body) && /r:64/.test(body) && /\*1\.9\)/.test(body) && /chef:true/.test(body),
    'spawnChef must create the bigger (r=64), tougher (×1.9 hp) final boss');
  assert(/¡EL CHEF!/.test(body), 'the chef needs his own announcement banner');
  // Poses: furioso con el cucharón al telegrafiar/embestir; imponente si no.
  assert(/const _csp=e\.chef\?CHEF_SPR\[\(e\.tele>0\|\|e\.dashing>0\)\?'attack':'calm'\]:null;/.test(body),
    'chef must swap to the attack pose while telegraphing/lunging');
  // Sin corona (se le reconoce) y con rótulo propio en la barra de jefe.
  assert(/if\(e\.boss&&!e\.chef&&!e\.inspec\)\{ \/\/ corona/.test(body), 'the crown must be skipped for the chef (and the inspector)');
  assert(/boss\.chef\?'★ EL CHEF ★'/.test(body), 'the boss bar must carry the chef\'s own label');
});

test('Camarero Survivors: propinas como monedas y bandejas de plata con estela (jul 2026)', () => {
  // Quinta pieza gráfica: los pickups de XP dejan el rombo abstracto y pasan a
  // MONEDAS que giran (oro = objetivo del chef/élite/jefe, plata = normal — el
  // color seguía significando algo y la metáfora ahora es de camarero), y los
  // proyectiles son bandejas de plata con reflejo giratorio y estela.
  const i = html.indexOf('function launchElTurno(');
  const body = html.slice(i, i + 95000);
  assert(/const gold=g\.col==='#e0a02c'/.test(body),
    'coin tint must derive from the existing gem color signal (gold = bonus XP)');
  assert(/const R=4\.5\+\(g\.val\|\|1\)\*0\.9/.test(body), 'coin size must grow with gem value');
  assert(/ctx\.ellipse\(0,0,R\*sqz,R,0,0,6\.29\)/.test(body), 'coins must spin via the squashed-ellipse phase');
  assert(!/ctx\.moveTo\(g\.x,g\.y-5\)/.test(body), 'the old abstract diamond gem must be gone');
  // (jul 2026: la bandeja se rediseñó como óvalo fijo — ver el test del
  // rediseño más abajo — pero la estela y el reflejo giratorio se conservan)
  assert(/estela: dos ecos desvanecidos/.test(body) && /ctx\.ellipse\(-k\*8,0,10\.5,6\.5,0,0,6\.29\)/.test(body),
    'trays must leave a two-ghost motion trail');
  assert(/ctx\.ellipse\(0,0,9\.6,5\.8,0,b\.rot\*1\.7,b\.rot\*1\.7\+0\.8\)/.test(body),
    'trays must carry the rotating glint arc');
  assert(/b\.pierce>0/.test(body) && /#ffe9b0/.test(body), 'piercing trays must stay golden (evolution signal)');
  // Segunda vuelta a las propinas (propietario, jul 2026): juice de arcade.
  assert(/halo pulsante SOLO en las de oro/.test(body) && /ctx\.arc\(0,0,R\*1\.9,0,6\.29\)/.test(body),
    'gold coins must carry the pulsing halo (they are the valuable ones)');
  assert(/if\(sqz>0\.78\)\{/.test(body), 'the TXOKO diamond engraving must show only when the coin faces the player');
  assert(/const tw=Math\.sin\(G\.time\*7\+g\.x\*1\.7\+g\.y\*0\.9\)/.test(body) && /tw>0\.9/.test(body),
    'coins must twinkle intermittently (arcade sparkle)');
  assert(/G\.dmgs\.push\(\{x:g\.x,y:g\.y-9,val:'\+'\+g\.val,life:1,col:/.test(body),
    'collecting a coin must float a metal-tinted "+N"');
  assert(/ctx\.fillStyle=n\.col\|\|'#fff'/.test(body), 'damage-number renderer must honor the per-float color');
});

test('Camarero Survivors: ranking rubber-hose de mejores turnos (jul 2026)', () => {
  // "Vamos a añadir un ranking con diseño rubber-hose": tablón de papel torcido
  // con medallas-moneda en la pantalla de inicio. Reutiliza la tabla genérica
  // 'scores' de Supabase con topic='elturno' (cero migraciones) y el esquema
  // local-primero + refresco remoto del Top 10 de Mr. Shoesmith.
  assert(/async function supaInsertEtRecord\(/.test(html) && /topic: 'elturno'/.test(html),
    'record insert must reuse the generic scores table with topic=elturno');
  assert(/async function supaFetchEtTop\(/.test(html) && /topic=eq\.elturno/.test(html),
    'top fetch must filter the scores table by topic=elturno');
  const i = html.indexOf('function launchElTurno(');
  const body = html.slice(i, i + 110000);
  // Guardado por empleado al morir: local (etRecord) + Supabase + refresco del tablón.
  assert(/_emp\.etRecord=\{secs:Math\.floor\(G\.time\),orders:G\.score\}/.test(body) && /saveDB\(\)/.test(body),
    'gameOver must persist the per-employee record locally');
  assert(/supaInsertEtRecord\(currentUser,Math\.floor\(G\.time\),G\.score\)/.test(body),
    'gameOver must push the new record to Supabase');
  // Tablón: markup en la pantalla de inicio + render local-primero + fusión remota.
  assert(/<div id="etRank"><\/div>/.test(body), 'start screen must carry the ranking board slot');
  assert(/function _etRankHtml\(/.test(body) && /function _etRenderRank\(/.test(body), 'ranking renderers missing');
  assert(/el\.innerHTML=_etRankHtml\(local\)/.test(body) && /supaFetchEtTop\(\)\.then\(/.test(body),
    'board must render local data instantly and merge the remote top afterwards');
  assert(/b\.secs-a\.secs/.test(body) && /slice\(0,5\)/.test(body), 'ranking must sort by seconds survived, top 5');
  assert(/Nadie ha sobrevivido aún/.test(body), 'empty state must invite the first run');
  // CSS rubber-hose: papel torcido, contorno grueso, medallas oro/plata/bronce.
  const css = read('styles.css');
  assert(/\.et-rank\{[^}]*border:3px solid var\(--et-ink\)/.test(css) && /\.et-rank\{[^}]*rotate\(-\.7deg\)/.test(css),
    '.et-rank must be the thick-outlined, slightly tilted paper board');
  assert(/\.et-rank-pos\.g\{background:#e8b83a\}/.test(css) && /\.et-rank-pos\.s\{background:#ccd4dc\}/.test(css) && /\.et-rank-pos\.b\{background:#cd7c32/.test(css),
    'medal coins must come in gold/silver/bronze');
});

test('Camarero Survivors: la botella de cava SE VE (diana, volteo, burbujas, onda larga) (jul 2026)', () => {
  // Reporte del propietario: "la botella de cava no hace nada". Verificado
  // empíricamente que SÍ dispara y daña (26 dibujos por vuelo, instrumentando
  // fillText) — el fallo era de percepción: emoji de 20px volando 0,4s y onda
  // de 0,28s, invisibles sobre la lámina. Arreglo de presencia visual:
  const i = html.indexOf('function launchElTurno(');
  const body = html.slice(i, i + 130000);
  assert(/ctx\.arc\(b\.tx,b\.ty,26-10\*k,0,6\.29\)/.test(body), 'each bomb must show its dashed landing target');
  assert(/ctx\.rotate\(k\*7\)/.test(body) && /ctx\.font='26px Georgia'; ctx\.fillText\('🍾'/.test(body),
    'the bottle must tumble mid-air at 26px');
  assert(/vy:-0\.5-Math\.random\(\),life:0\.6,col:'#ffe9b0'/.test(body), 'the bottle must trail golden bubbles');
  assert(/x\.life-=dt\*0\.03/.test(body), 'the blast ring must last ~0.55s (was 0.28s, gone before the eye caught it)');
  assert(/ctx\.arc\(x\.x,x\.y,x\.r\*0\.7,0,6\.29\)/.test(body), 'the blast must carry the inner white ring');
  // La mecánica en sí no se toca: cadencia, daño en área y evolución intactos.
  assert(/G\.cavaT=Math\.max\(70,150-G\.cava\*12\)/.test(body) && /const R=55\+G\.cava\*9, D=22\+G\.cava\*10/.test(body),
    'cava cadence and AoE damage formulas must stay untouched');
});

test('Dieta del HTML: ningún sprite en base64 inline — siempre archivos del repo (jul 2026)', () => {
  // Adelgazamiento aprobado por el propietario ("4 y 5"): los sprites en
  // base64 engordaron el index.html ~713KB que TODO el equipo pagaba en la
  // primera carga 4G. Ahora son archivos en img/sprites/ (el SW los cachea al
  // vuelo y los juegos precargan los suyos). Este guard impide la vuelta
  // atrás: ni un solo data:image base64 en el HTML.
  assert(!/data:image\/(jpeg|png|webp);base64,/.test(html),
    'inline base64 images are banned — ship sprites as repo files under img/sprites/');
  // La precarga de personas existe (los swaps de animación no esperan a la red).
  assert(/window\._txSpritesWarm/.test(html) && /Object\.values\(TX_PERSONAS\)\.forEach/.test(html),
    'the persona-sprite warm-up preloader must run when the picker opens');
});

test('Camarero Survivors: la campana de salud SE RECOGE al contacto y parece una campana (jul 2026)', () => {
  // Reporte del propietario: "cuando pasas por los objetos que dan salud, el
  // personaje no los recoge" — solo se recogían estando herido. Ahora el
  // contacto recoge SIEMPRE: cura si falta vida; a tope de vida da +2 XP con
  // su flotante verde (nunca se siente muerto). Y el rediseño aprovechado:
  // campana de plata con halo, vapor, plato base, pomo y corazón.
  const i = html.indexOf('function launchElTurno(');
  const body = html.slice(i, i + 130000);
  assert(/if\(d<G\.pr\+14\)\{/.test(body), 'contact radius must collect regardless of health');
  assert(/G\.xp\+=2; G\.dmgs\.push\(\{x:p\.x,y:p\.y-9,val:'\+2',life:1,col:'#6ad46a'\}\)/.test(body),
    'full-health pickup must convert to a small XP bonus with its green float');
  assert(/G\.hp=Math\.min\(G\.maxhp,G\.hp\+p\.heal\)/.test(body), 'healing when hurt must stay untouched');
  assert(/d<G\.pickR && G\.hp<G\.maxhp/.test(body), 'the magnet must still pull only when hurt');
  // Rediseño: halo, vapor, plato base, cúpula, pomo, corazón.
  assert(/ctx\.arc\(p\.x,p\.y\+bob-2,15,0,6\.29\)/.test(body), 'pickup needs its pulsing green halo');
  assert(/quadraticCurveTo\(p\.x\+sx\+Math\.sin\(ph\)\*3/.test(body), 'pickup needs its wavy steam wisps');
  assert(/ctx\.ellipse\(p\.x,p\.y\+bob\+1,13,3\.6,0,0,6\.29\)/.test(body), 'pickup needs its base plate');
  assert(/ctx\.arc\(p\.x,p\.y\+bob-11,2\.4,0,6\.29\)/.test(body), 'pickup needs its brass knob');
});

test('Camarero Survivors: cuchillos orbitales de chef con estela de giro (jul 2026)', () => {
  // "Mejora las gráficas de los objetos que giran alrededor del héroe": los
  // triángulos de 9px son ahora cuchillos de chef (hoja curva con línea de
  // filo, mango con remache) con estela de giro; la evolución dorada y +25%.
  const i = html.indexOf('function launchElTurno(');
  const body = html.slice(i, i + 130000);
  assert(/ctx\.arc\(G\.px,G\.py,kR,ang-0\.55,ang-0\.10\)/.test(body), 'each knife must trail a spin arc on its orbit');
  assert(/ctx\.quadraticCurveTo\(4\.2,-4,3\.4,3\.6\)/.test(body), 'the blade must be the curved chef-knife shape');
  assert(/ctx\.fillRect\(-2\.2,4,4\.4,7\)/.test(body) && /ctx\.arc\(0,7\.5,0\.9,0,6\.29\)/.test(body),
    'the knife needs its wooden handle and brass rivet');
  assert(/ctx\.moveTo\(1\.6,-7\.5\); ctx\.lineTo\(2\.6,1\.5\)/.test(body), 'the blade needs its bright edge line');
  assert(/if\(kevo\) ctx\.scale\(1\.25,1\.25\)/.test(body) && /kevo\?'#ffe9b0':'#e4e9ee'/.test(body),
    'the evolved knives must be golden and 25% larger');
  assert(!/ctx\.moveTo\(0,-9\); ctx\.lineTo\(3\.5,5\)/.test(body), 'the old 9px triangle must be gone');
  // La mecánica no cambia: radio de órbita y daño intactos.
  assert(/const kR=G\.evoKnives\?66:48/.test(body), 'orbit radii must stay untouched');
});

test('Duelos/Retos: ningún enunciado de alérgenos en formato sí/no (las opciones son listas) (jul 2026)', () => {
  // Anotado por el auditor y aprobado por el propietario ("4 y 5"): tres tallos
  // de WAITER_MSGS preguntaban sí/no («¿Los tiene X?», «…si contiene
  // crustáceos», «¿tiene alérgenos X?») pero las opciones son SIEMPRE listas
  // completas de alérgenos — desajuste pregunta/respuesta. Reformulados
  // conservando la escena; este guard veta el patrón sí/no en todo el pool.
  const wm = html.slice(html.indexOf('const WAITER_MSGS={'), html.indexOf('const SHOESMITH_MSGS={'));
  assert(wm.length > 100, 'WAITER_MSGS block not found');
  for (const bad of ['¿Los tiene', 'pregunta si', '¿tiene alérgenos', 'Does <strong>${d}</strong> contain', 'asks if', 'does <strong>${d}</strong> have allergens']) {
    assert(!wm.includes(bad), `yes/no-style stem must not return to WAITER_MSGS: «${bad}»`);
  }
  assert(wm.includes('Repasa la ficha: ¿qué alérgenos lleva') && wm.includes('recita los alérgenos de'),
    'the reworded stems must keep the scene while asking for the full list');
});

test('Camarero Survivors gameplay: health pickups, damage curve, knockback, spawn grace, low-HP warning', () => {
  // Cinco mejoras de la auditoría de daño (petición del propietario: "cómo lo
  // podemos mejorar" → "aplica todo"). Guardan que cada mecánica sigue cableada.
  const i = html.indexOf('function launchElTurno(');
  const body = html.slice(i, i + 130000);
  // (1) health pickups: dropped on kill, collected to heal, drawn, and in game state
  assert(/pickups:\[\]/.test(body), 'game state must include a pickups[] array (health drops)');
  assert(/G\.pickups\.push\(\{x:e\.x,y:e\.y,heal:/.test(body), 'enemies must be able to drop a health pickup on death');
  assert(/G\.hp=Math\.min\(G\.maxhp,G\.hp\+p\.heal\)/.test(body), 'collecting a pickup must heal (capped at maxhp)');
  // (2) spawn grace: fresh spawns can't damage for a beat
  assert(/grace:18/.test(body) && /grace:24/.test(body), 'enemies and boss must spawn with an invulnerability-grace window');
  assert(/e\.grace<=0/.test(body), 'contact damage must be gated behind the spawn-grace check');
  // (3) knockback on hit
  assert(/knockback/.test(body) && /o\.x\+=\(o\.x-G\.px\)\/od\*push/.test(body), 'taking a hit must knock nearby enemies back so the player can escape');
  // (4) damage curve (not a flat 8/18 anymore)
  assert(/damage curve/.test(body) && /Math\.min\(e\.boss\?9:6, G\.time\*0\.05\)/.test(body), 'contact damage must ramp with time (fair curve), not a flat constant');
  // (5) low-HP warning element toggled + CSS pulse
  assert(/lowEl\.classList\.toggle\('on'/.test(body) && /G\.hp<25/.test(body), 'the low-HP danger overlay must toggle under 25 HP');
  const css = read('styles.css');
  assert(/#etLow\.on\{[^}]*etLowPulse/.test(css) && /@keyframes etLowPulse/.test(css), 'styles.css must define the pulsing low-HP danger vignette');
});

test('Camarero Survivors AAA: dash, racha, élites, oleadas, jefe con embestida, evoluciones, música y pausa', () => {
  // Pasada "estudio AAA" (petición del propietario): fija cada sistema nuevo
  // para que ninguna refactorización futura los deje caer en silencio.
  const i = html.indexOf('function launchElTurno(');
  const body = html.slice(i, i + 140000);
  // (1) esquiva: helper con cooldown + botón táctil + tecla espacio
  assert(/function tryDash\(\)/.test(body) && /G\.dashCd>0\) return/.test(body), 'dash: tryDash() with cooldown gate must exist');
  assert(/id="etDashBtn"/.test(body), 'dash: the touch button must be in the overlay markup');
  assert(/e\.key===' '.*tryDash\(\)/.test(body), 'dash: Space must trigger the dash on keyboard');
  // (2) racha de comandas: contador, ventana de decaimiento y gemas extra
  assert(/G\.combo\+\+; G\.comboT=150/.test(body), 'combo: kills must extend the chain window');
  assert(/if\(G\.comboT<=0\) G\.combo=0/.test(body), 'combo: the chain must reset when the window dries up');
  // (3) élites y oleadas del director de ritmo
  assert(/function spawnEnemy\(kind,elite,pos\)/.test(body) && /elite:!!elite/.test(body), 'elites: spawnEnemy must support the elite variant');
  assert(/function surge\(\)/.test(body) && /G\.nextSurge\+=55/.test(body), 'surges: the telegraphed ring wave must exist');
  assert(/const lull=/.test(body), 'pacing: the breather window (lull) must modulate spawn pressure');
  // (4) jefe con embestida telegrafiada
  assert(/e\.tele-=dt/.test(body) && /e\.dashing=32/.test(body), 'boss: the telegraphed lunge state machine must exist');
  // (5) evoluciones de arma (cartas doradas condicionales)
  assert(/const EVOS=\[/.test(body) && /evoPierce/.test(body) && /evoKnives/.test(body) && /evoCava/.test(body), 'evolutions: the EVOS pool and its three flags must exist');
  assert(/et-evo/.test(body), 'evolutions: the gold card class must be applied in the level-up render');
  // (6) música + silencio + limpieza en teardown
  assert(/function musicTick\(\)/.test(body) && /musicIv=setInterval\(musicTick,138\)/.test(body), 'music: the WebAudio sequencer must start with the run');
  assert(/clearInterval\(musicIv\)/.test(body), 'music: teardown must stop the sequencer');
  assert(/if\(muted\) return;/.test(body), 'audio: the mute flag must gate sfx');
  // (7) pausa (botón + auto-pausa al ir a segundo plano, listener limpiado)
  assert(/id="etPause"/.test(body) && /function setPaused\(/.test(body), 'pause: the pause screen and helper must exist');
  assert(/document\.addEventListener\('visibilitychange',onVis\)/.test(body) && /document\.removeEventListener\('visibilitychange',onVis\)/.test(body),
    'pause: the visibilitychange listener must be added and removed in teardown');
  // (8) hit-stop + haptics + HUD de jefe
  assert(/G\.hitStop/.test(body) && /function vibe\(/.test(body), 'juice: hit-stop and haptics helpers must exist');
  assert(/id="etBossbar"/.test(body), 'HUD: the boss health bar must be in the overlay markup');
  // (9) fin de servicio con estadísticas + mejor turno persistente
  assert(/etBestTime/.test(body) && /Chefs/.test(body), 'game over: run stats + persistent best time must render');
  // CSS de los sistemas nuevos
  const css = read('styles.css');
  for (const sel of ['#etDashBtn', '#etCombo', '#etBossbar', '.et-pick.et-evo', '.et-statgrid']) {
    assert(css.includes(sel), `styles.css must style ${sel}`);
  }
});

test('Camarero Survivors: primer jefe abatible — vida por jefes caídos, sin apilar jefes y con respiro (jul 2026)', () => {
  // Ajuste de dificultad (propietario: "los usuarios no pasan del primer
  // jefe"): (1) la vida del jefe ya no crece solo con el reloj (548 HP en el
  // 0:38) sino con los jefes ya abatidos — el primero ronda 200; (2) nunca
  // hay dos jefes de sala a la vez; (3) el director suelta menos morralla
  // durante la pelea para que las bandejas (apuntan al más cercano) lleguen
  // al jefe; (4) la embestida avisa ~0,7s y carga más lento; (5) el golpe de
  // contacto del jefe baja de 15 a 12 de base.
  const i = html.indexOf('function launchElTurno(');
  const body = html.slice(i, i + 120000);
  assert(/const hp=Math\.round\(\(65\+G\.time\*3\.5\)\*\(1\+G\.bosses\*0\.4\)\)/.test(body),
    'boss hp must scale with bosses already defeated, not just the clock (gentle first boss)');
  assert(/if\(bossUp\) G\.nextBoss=G\.time\+8; else \{ G\.nextBoss=G\.time\+40; spawnBoss\(\); \}/.test(body),
    'a new room boss must wait while another boss is still alive (no boss stacking)');
  assert(/const bossUp=G\.enemies\.some\(e=>e\.boss\);/.test(body) && /\(bossUp\?1\.8:1\)/.test(body),
    'the spawn director must ease off the trash-mob pressure while a boss is alive');
  assert(/if\(!bossUp&&G\.time>25/.test(body),
    'the bonus double-spawn must pause during a boss fight');
  assert(/e\.tele=42/.test(body) && /spdMul=3\.8/.test(body),
    'the boss lunge must telegraph ~0.7s and charge at 3.8 (was 28 frames / 4.4)');
  assert(/e\.boss\?12:5/.test(body),
    'boss contact damage must start at 12 base, not 15');
});

test('Camarero Survivors: la bandeja PARECE bandeja y cada jefe tiene habilidad especial (jul 2026)', () => {
  // (1) Reporte de usuarios: "las bandejas parecen platos pequeños o
  // monedas". El culpable era el giro de canto (el mismo squash de elipse
  // que usan las propinas-moneda). Ahora la bandeja es un óvalo ancho
  // SIEMPRE, con pocillo interior, servilleta y tres canapés a bordo.
  // (2) Habilidades de jefe por familia de alérgeno (propietario): abanico
  // de proyectiles (gluten/huevo/pescado), refuerzos mini (frutos/crust) o
  // charco que frena y quema (lácteos/soja/sulfitos); EL CHEF barre en
  // radial. Todas avisan con un aro dorado de carga y se esquivan.
  const i = html.indexOf('function launchElTurno(');
  const body = html.slice(i, i + 130000);
  // — bandeja: óvalo fijo con comida a bordo; el squash de moneda se fue —
  assert(/ctx\.ellipse\(0,0,11,7,0,0,6\.29\)/.test(body),
    'tray must be a wide oval platter (never edge-on like a coin)');
  assert(/servilleta \+ tres canapés a bordo/.test(body),
    'tray must carry the napkin + canapés that make it read as a tray');
  assert(!/ctx\.ellipse\(0,0,6\.5,6\.5\*sq/.test(body),
    'the old coin-spin tray (edge-on squash) must be gone');
  // — sprite de bandeja (vídeo Grok del propietario, jul 2026 → fotograma
  //   recortado): preferido en el dibujo, con el respaldo por código detrás —
  assert(existsSync(join(ROOT, 'img/sprites/tray.webp')), 'img/sprites/tray.webp missing on disk');
  assert(/const TRAY=new Image\(\); TRAY\.onload=\(\)=>\{ TRAY\._ok=true; \}; TRAY\.src='img\/sprites\/tray\.webp'/.test(body),
    'the illustrated tray loader must be wired (sprite-preferred)');
  assert(/if\(TRAY\._ok\)\{/.test(body),
    'tray draw must prefer the sprite and keep the code-drawn platter as fallback');
  // — habilidades de jefe: mapa por alérgeno + las tres familias cableadas —
  assert(/const BOSS_ABIL=\{gluten:'volley',huevo:'volley',pescado:'volley',frutos:'summon',crust:'summon',lacteos:'zone',soja:'zone',sulfitos:'zone',chef:'volley',/.test(body),
    'every allergen family (and the chef) must map to its boss ability');
  // los 6 alérgenos nuevos (UE) también tienen habilidad de jefe definida
  for (const k of ['cacahuete','apio','mostaza','sesamo','molusco','altramuz'])
    assert(new RegExp(k + ":'(volley|summon|zone)'").test(body), `BOSS_ABIL sin habilidad para ${k}`);
  assert(/function bossAbility\(e\)/.test(body) && /eshots:\[\], zones:\[\]/.test(body),
    'bossAbility() and the eshots/zones state arrays must exist');
  assert(/e\.wind-=dt; spdMul=0\.15; if\(e\.wind<=0\) bossAbility\(e\);/.test(body),
    'abilities must be telegraphed by a windup that slows the boss');
  assert(/jefe cargando su habilidad: aro dorado/.test(body),
    'the golden windup ring must be drawn so the special never comes from nowhere');
  assert(/G\.eshots\.push\(/.test(body) && /G\.zones\.push\(\{x:G\.px,y:G\.py/.test(body) && /spawnMini\(e\.x\+Math\.cos/.test(body),
    'the three ability families (volley / zone / summon) must be wired');
  assert(/G\.hp-=8; G\.ifr=30;/.test(body),
    'boss shots must deal modest damage and grant i-frames (dodgeable, never a shred-loop)');
  assert(/pvx\*=0\.6; pvy\*=0\.6;/.test(body) && /G\.hp-=0\.06\*dt/.test(body),
    'active puddles must slow the player and burn slowly (not instantly kill)');
  assert(/if\(G\.enemies\.length<70\)/.test(body),
    'the summon ability must respect an enemy-count cap (no flooding)');
});

test('Camarero Survivors: meta-progresión — propinas persistentes, tienda, oficios y otra ronda (jul 2026)', () => {
  // El bucle de retención de Vampire Survivors ("vamos con todo" del
  // propietario): las propinas se GUARDAN al morir (cada derrota es
  // progreso), compran mejoras permanentes en la tienda de inicio, hay 4
  // oficios de sala con arranque distinto y un cambio de cartas por partida
  // (ampliable en la tienda). Los récords del ranking no se tocan.
  const i = html.indexOf('function launchElTurno(');
  const body = html.slice(i, i + 150000);
  // cartera por empleado y dispositivo + tienda
  assert(/localStorage\.getItem\('etMeta:'\+currentUser\)/.test(body) && /localStorage\.setItem\('etMeta:'\+currentUser/.test(body),
    'the tips wallet must persist per employee+device (same pattern as etBestTime)');
  assert(/const ET_PERKS=\[/.test(body) && /const ET_PERK_COST=\[25,60,140,320,700\]/.test(body),
    'the permanent-perk catalog and its cost curve must exist');
  assert(/function _etRenderShop\(\)/.test(body) && /Mejoras del oficio/.test(body),
    'the shop panel must render on the start screen');
  // ganancia al morir + botón de tienda en el fin de servicio
  assert(/_mm\.tips\+=_earn; _etMetaSave\(_mm\); _etRenderShop\(\);/.test(body),
    'gameOver must bank the earned tips and refresh the shop');
  assert(/G\.closed\?60:0/.test(body), 'reaching the closing time must pay a fat tip bonus');
  assert(/id="etShopBtn"/.test(body), 'the game-over screen must link back to the shop');
  // lo permanente entra en newGame (perks + oficio elegido)
  assert(/for\(const p of ET_PERKS\)\{ const n=_m\.up\[p\.k\]\|\|0; if\(n\) p\.fx\(G,n\); \}/.test(body),
    'newGame must apply the purchased perk levels');
  assert(/const ET_CHARS=\[/.test(body) && /\(ET_CHARS\.find\(c=>c\.k===_m\.char\)\|\|ET_CHARS\[0\]\)\.fx\(G\);/.test(body),
    'newGame must apply the selected trade (oficio)');
  const chars = [...body.slice(body.indexOf('const ET_CHARS=['), body.indexOf('];', body.indexOf('const ET_CHARS=['))).matchAll(/\{k:'([a-z]+)'/g)].map(m => m[1]);
  assert(chars.length === 4 && chars.includes('camarero') && chars.includes('sumiller') && chars.includes('cortador') && chars.includes('maitre'),
    'there must be exactly 4 trades: camarero/sumiller/cortador/maitre');
  // otra ronda: botón en el level-up, gastable, ampliable con el perk 'ronda'
  assert(/id="etReroll"/.test(body) && /G\.rerolls<=0\) return; G\.rerolls--;/.test(body),
    'the level-up reroll button must exist and burn a charge per use');
  assert(/\{k:'ronda'/.test(body) && /g\.rerolls\+=n/.test(body), 'the shop must sell extra rerolls');
  // CSS de tienda y oficios
  const css = read('styles.css');
  for (const sel of ['.et-shop{', '.et-shop-buy', '.et-char{', '.et-char.on']) {
    assert(css.includes(sel), `styles.css must style ${sel}`);
  }
});

test('Camarero Survivors: carrito de postres del jefe y cloche con pregunta de la carta REAL (jul 2026)', () => {
  // (1) El cofre de VS: el jefe abatido suelta un carrito dorado; recogerlo
  // abre una ceremonia tragaperras que regala 1 mejora (2 si era EL CHEF).
  // (2) El cloche misterioso: pregunta Sí/No derivada de DISHES (la carta
  // real — mismos nombres de alérgeno que el roster del juego); acertar paga
  // gordo (limpieza/imán/banquete) y fallar deja la lección a la vista.
  const i = html.indexOf('function launchElTurno(');
  const body = html.slice(i, i + 150000);
  // carrito: drop en la muerte del jefe + ceremonia + limpieza del interval
  assert(/G\.pickups\.push\(\{x:e\.x,y:e\.y,chest:true,dbl:!!e\.chef,life:9999\}\)/.test(body),
    'a defeated boss must drop the dessert cart (chef: guaranteed double)');
  assert(/function showChest\(dbl\)/.test(body) && /id="etChest"/.test(body),
    'the chest ceremony overlay must exist');
  assert(/_etChestIv=setInterval\(/.test(body) && (body.match(/clearInterval\(_etChestIv\)/g) || []).length >= 3,
    'the slot-machine interval must be cleaned on settle, on start and in teardown');
  // cloche: solo con datos de carta, ventana de spawn, pregunta 50/50 honesta
  assert(/typeof DISHES!=='undefined'&&DISHES\.length/.test(body),
    'the cloche must only spawn when the real menu data is present');
  assert(/G\.time>=G\.nextClo&&G\.time<560/.test(body), 'the cloche must not spawn during the closing stretch');
  assert(/const askYes=has\.length>0&&\(Math\.random\(\)<0\.5\|\|!not\.length\)/.test(body),
    'the question must be a fair 50/50 between allergens the dish has and lacks');
  assert(/dish\.allergens\|\|\[\]\)\.includes\(a\.name\)/.test(body),
    'the answer key must derive from the dish allergen list (same names as the roster)');
  // recompensas + feedback educativo siempre
  assert(/¡LIMPIEZA DE SALA!/.test(body) && /¡PROPINA TOTAL!/.test(body) && /¡BANQUETE!/.test(body),
    'the three cloche rewards must be wired');
  assert(/lleva: <b>\$\{escapeHTML\(full\)\}/.test(body),
    'both outcomes must show the dish\'s full allergen list (the lesson always lands)');
  // los overlays de decisión mandan sobre la pausa
  assert(/for\(const id of \['etLevelup','etChest','etQuiz'\]\)/.test(body),
    'pause must defer to the level-up/chest/quiz overlays');
  const css = read('styles.css');
  for (const sel of ['.et-quiz-dish', '.et-quiz-btns', '.et-slot .et-pick-ic']) {
    assert(css.includes(sel), `styles.css must style ${sel}`);
  }
});

test('Camarero Survivors: CIERRE DEL LOCAL a las 10:00 — la inspectora imbatible y SERVICIO COMPLETO (jul 2026)', () => {
  // El final de partida de VS (la Muerte a los 30:00), versión sala: aviso a
  // las 9:30, LA INSPECTORA entra a las 10:00 (inmune, acelera sin tregua),
  // los eventos programados se apagan y llegar al cierre es la victoria.
  const i = html.indexOf('function launchElTurno(');
  const body = html.slice(i, i + 150000);
  assert(/if\(!G\.warned&&G\.time>=570\)/.test(body) && /CIERRE EN 30s/.test(body),
    'the 30-second warning must fire at 9:30');
  assert(/if\(!G\.closed&&G\.time>=600\)\{ G\.closed=true; spawnInspectora\(\); \}/.test(body),
    'the inspector must arrive exactly at closing time');
  assert(/function spawnInspectora\(\)/.test(body) && /hp:1e9,maxhp:1e9/.test(body) && /inspec:true/.test(body),
    'the inspector must spawn effectively unkillable');
  assert(/if\(e\.inspec\) return;\s+\/\/ la inspectora no se negocia/.test(body),
    'hurtEnemy must ignore the inspector entirely (no damage, no flash)');
  assert(/if\(e\.inspec\) e\.spd\+=dt\*0\.0011/.test(body),
    'the inspector must accelerate relentlessly (the end always arrives)');
  assert(/if\(G\.time<600\)\{/.test(body),
    'scheduled events (elites/surges/bosses/chef) must stop at closing time');
  assert(/boss\.inspec\?'★ LA INSPECTORA · CIERRE ★'/.test(body),
    'the boss bar must announce the inspector');
  assert(/G\.closed\?'¡SERVICIO COMPLETO!'/.test(body),
    'surviving to the close must be celebrated as SERVICIO COMPLETO');
});

test('Camarero Survivors: música v2 — swing, batería sintetizada, lead que respira, modos jefe y cierre (jul 2026)', () => {
  // El loop viejo eran 16 pasos idénticos con un blip de 2600 Hz por batería.
  // La v2 sigue sin archivos (CSP-safe) pero suena a servicio: compás doble
  // Am7→D9 con bajo caminante, swing, bombo/escobilla/ride sintetizados,
  // comping, lead que calla un loop de cada dos, tritono con jefe y +5
  // semitonos con ride a semicorcheas en el cierre. Compresor propio.
  const i = html.indexOf('function launchElTurno(');
  const body = html.slice(i, i + 150000);
  assert(/const M_SWING=0\.045/.test(body) && /sw=\(st%4===2\)\?M_SWING:0/.test(body),
    'weak eighths must be delayed by the swing constant');
  assert(/const M_WALK=\[0,3,7,10, 5,9,12,11\]/.test(body),
    'the walking bass must vamp Am7→D9 with a chromatic approach note');
  assert(/function mDrum\(kind,when,vol\)/.test(body) && /exponentialRampToValueAtTime\(42,when\+\.09\)/.test(body),
    'the kick must be a pitch-dropping sine, not a beep');
  assert(/mNoiseBuf=b/.test(body) && /f\.type='highpass'; f\.frequency\.value=7000/.test(body) && /f\.type='bandpass'; f\.frequency\.value=1900/.test(body),
    'ride and brush must be filtered noise from a generated buffer');
  assert(/mComp=AC\.createDynamicsCompressor\(\)/.test(body),
    'music must run through its own compressor so it never fights the sfx');
  assert(/const M_BOSS_BASS=\[0,6\]/.test(body), 'boss mode must ride the tritone ostinato');
  assert(/closing\?5:0/.test(body) && /closing&&st%2===1/.test(body),
    'the closing stretch must transpose up and double the ride to 16ths');
  assert(/if\(mLoop%2===0\)/.test(body), 'the lead must breathe: silent every other loop');
  assert(/mStep=0; mLoop=0;/.test(body), 'start() must reset both sequencer counters');
  assert(/musicIv=setInterval\(musicTick,138\)/.test(body) && /clearInterval\(musicIv\)/.test(body),
    'the sequencer lifecycle (start with run, die in teardown) must stay intact');
});

test('Quiz del día antiguo (5 preguntas): RETIRADO — solo existe el Reto del día (jul 2026)', () => {
  // Decisión del propietario: el quiz de 5 preguntas convivía con el nuevo
  // «Reto del día» (1 pregunta compartida, racha y liga) y el nombre casi
  // idéntico confundía. Se retiró entero: tile, vistas, temporizador, RNG
  // propio y escritura de scores (topic=quizdia). Este guard evita que
  // vuelva por una caché vieja o un copy-paste.
  assert(!/renderQuizDia|id="qdTile"|_qdTileSync|_qdDayKey|_qdState|_qdTimer/.test(html),
    'el quiz del día antiguo debe seguir retirado (tile, vistas y estado)');
  assert(!/topic: 'quizdia'|topic=eq\.quizdia/.test(html),
    'nada puede volver a escribir o leer scores con topic=quizdia');
  // El sustituto sigue vivo: el Reto del día con su generador determinista.
  assert(/function _dqQuestion\(/.test(html) && /openDailyReto/.test(html),
    'el Reto del día (1 pregunta compartida) debe seguir siendo la mecánica diaria');
});

test('SW: la recarga por versión nueva no interrumpe una sesión en curso (jul 2026, doble pantalla de carga)', () => {
  // El handler de controllerchange recargaba la página al activarse un SW
  // nuevo. Si el auto-login ya había corrido, la carga se veía DOS veces. Se
  // guarda para no recargar cuando el usuario ya entró (currentUser set).
  const h = html.slice(html.indexOf("addEventListener('controllerchange'"), html.indexOf("addEventListener('controllerchange'") + 400);
  assert(/if \(typeof currentUser !== 'undefined' && currentUser\) return;/.test(h),
    'the controllerchange reload must bail out when a session is already active (no double loading screen)');
  assert(/if \(_swReloaded\) return;/.test(h) && /_swReloaded = true;/.test(h),
    'the once-only reload guard must remain');
});

test('sync: el upsert de empleado es MONÓTONO — nunca pisa la nube con ceros (jul 2026, pérdida de Alexis)', () => {
  // Bug real: al entrar en un origen nuevo (meseo.es) sin datos locales, si la
  // restauración desde la nube fallaba un instante, el login creaba una ficha
  // a cero y el upsert la subía con merge-duplicates, BORRANDO xp/known/exam
  // del usuario. El upsert ahora lee la nube primero y fusiona sin reducir.
  const fn = html.slice(html.indexOf('async function supaUpsertEmployee'), html.indexOf('async function supaFetchAllEmployees'));
  assert(fn.length > 400, 'supaUpsertEmployee not found');
  // (1) lee la nube antes de escribir (columnas sin pin: _EMP_COLS)
  assert(/employees\?name=ilike\.\$\{encodeURIComponent\(name\)\}&select=\$\{_EMP_COLS\}/.test(fn),
    'the upsert must read the current cloud row before writing');
  // (2) aborta si no puede leer la nube y la ficha local está vacía
  assert(/const _localEmpty =/.test(fn) && /if\(!cloudReadOk && _localEmpty\) \{[^}]*return true;/.test(fn),
    'the upsert must abort when the cloud is unreadable AND local is empty (never clobber with zeros)');
  // (3) fusión monótona: max en números, unión en mapas
  assert(/xp=Math\.max\(xp, cloud\.xp\|\|0\)/.test(fn) && /_etMergeMap\(JSON\.parse\(cloud\.known_dishes/.test(fn),
    'numeric fields must take max(local,cloud) and maps must merge (union)');
  // (4) el upsert ya NO toca el pin (el hash vive en el servidor; se fija/verifica
  //     por RPC). No debe leerlo del cloud ni enviarlo en el payload.
  assert(!/cloud\.pin/.test(fn) && !/\bpin:/.test(fn),
    'the upsert must not read or write the pin (server-side now)');
  // (5) el helper de fusión de mapas existe y hace max por clave
  assert(/function _etMergeMap\(a, b\)\{/.test(html) && /Math\.max\(av, bv\)/.test(html),
    'the _etMergeMap helper must do per-key max');
  // (6) el upsert señala éxito (para el outbox): true al confirmar, false si falla
  assert(/return true;\s*\} catch\(e\) \{/.test(fn) && /return false;\s*\}\s*\}/.test(fn),
    'supaUpsertEmployee debe devolver true al confirmar y false si queda pendiente');
});

test('resiliencia: outbox de sincronización (no se pierden datos con mal WiFi)', () => {
  // Cola persistente de fichas con cambios locales sin confirmar en la nube.
  // Se reintenta hasta que la nube confirme; sobrevive a cerrar la app.
  assert(/const _OUTBOX_KEY = 'txk_sync_outbox';/.test(html), 'debe existir la clave persistente del outbox');
  assert(/function _outboxFlush\(\)\{[\s\S]*?const ok = await supaUpsertEmployee\(name\);|let ok = false;[\s\S]*?ok = await supaUpsertEmployee\(name\)/.test(html) || /ok = await supaUpsertEmployee\(name\)/.test(html),
    'el flush debe reintentar cada ficha vía supaUpsertEmployee');
  assert(/if\(ok\) _outboxRemove\(name\);/.test(html), 'solo se desencola cuando la nube confirma');
  // _saveDBNow encola SIEMPRE y desencola al confirmar
  const saveNow = html.slice(html.indexOf('function _saveDBNow'), html.indexOf('function _flushSaveDB'));
  assert(/_outboxAdd\(currentUser\);/.test(saveNow) && /supaUpsertEmployee\(_u\)\.then\(ok => \{ if\(ok\) _outboxRemove\(_u\); \}\)/.test(saveNow),
    '_saveDBNow debe encolar antes de subir y desencolar al confirmar');
  // Disparadores del flush: online, volver a primer plano y temporizador
  assert(/window\.addEventListener\('online', \(\) => setTimeout\(_outboxFlush/.test(html), 'el outbox debe reintentar al volver la conexión');
  assert(/setInterval\(_outboxFlush, 120000\)/.test(html), 'el outbox debe reintentar periódicamente');
  // El chip refleja "pendiente" sin pisar el estado offline
  // El chip de sincronización es SILENCIOSO: solo se muestra 'offline'; los
  // estados de sincronizando/guardando/sincronizado ya no molestan al usuario.
  const pill = html.slice(html.indexOf('function _setSyncPill'), html.indexOf('function _updateOnlineStatus'));
  assert(/if\(state==='offline'\)\{/.test(pill) && !/pill\.classList\.add\('synced','visible'\)/.test(pill) && !/'Sincronizando…'/.test(pill),
    'el chip solo debe mostrarse offline (sin avisos de sincronizando/guardado/sincronizado)');
});

test('resiliencia: guardia anti-duplicados en el alta', () => {
  assert(/function _nameSimilar\(a,b\)\{/.test(html) && /function _levDist\(a,b\)\{/.test(html),
    'deben existir los helpers de similitud de nombres');
  // Reglas: igual salvo acentos, subconjunto, y distancia ≤1
  const sim = html.slice(html.indexOf('function _nameSimilar'), html.indexOf('let _nameListCache'));
  assert(/if\(na===nb\) return true;/.test(sim) && /ta\[0\]===tb\[0\] && \(ta\.length===1 \|\| tb\.length===1\)/.test(sim) && /_levDist\(na,nb\)<=1/.test(sim),
    '_nameSimilar debe cubrir acentos/mayúsculas, subconjunto y distancia 1');
  assert(/async function _fetchEmployeeNames\(\)/.test(html), 'debe listar nombres de la nube para comparar');
  // La guardia solo actúa al CREAR cuenta y ofrece entrar en el existente
  const login = html.slice(html.indexOf('if(isSignup && !localExists){'), html.indexOf('// Get the employee (may have been restored'));
  assert(/_names\.find\(nm => _normName\(nm\)!==_normName\(name\) && _nameSimilar\(nm, name\)\)/.test(login) && /setLoginMode\('signin'\)/.test(login),
    'al crear cuenta, un nombre muy parecido debe ofrecer entrar en el perfil existente');
});

test('telemetría Fase 1: captura local-first (track + opt-out + IndexedDB + retención)', () => {
  // El módulo de captura debe existir con su sobre común versionado.
  assert(/const TELEMETRY_V = 1;/.test(html), 'debe existir la versión del esquema de telemetría');
  assert(/function track\(name, props\)\{/.test(html), 'debe existir la API pública track()');
  assert(/const _TM_STORE = 'events';/.test(html) && /indexedDB\.open\(_TM_DB_NAME, 1\)/.test(html),
    'los eventos deben persistir en un store IndexedDB');
  assert(/const _TM_MAX_AGE_DAYS = 30;/.test(html) && /function _tmPurgeOld\(\)/.test(html),
    'debe haber retención rodante de 30 días (RGPD)');
  assert(/function _telemetryOn\(\)/.test(html) && /function _telemetrySetOptOut\(off\)/.test(html) && /function _tmPurgeAll\(\)/.test(html),
    'opt-out y purga total (derecho de borrado) deben existir');
  // Flush en tiempo idle, no bloqueante.
  assert(/requestIdleCallback\(run, \{ timeout:2000 \}\)/.test(html), 'el flush debe ir en tiempo idle');

  // Los 7 eventos del núcleo deben estar instrumentados en sus sitios reales.
  assert(/track\('tab\.switch', \{ to: tab, from: currentTab \}\);/.test(html), 'falta tab.switch en showTab');
  assert(/track\('exam\.answer', \{ dishId: q\.dish\.id, ok: ok\?1:0, topic: q\.topic\.key \}\);/.test(html), 'falta exam.answer');
  assert(/track\('drill\.finish', \{ score, total: questions\.length, ms: \(time\|0\)\*1000, pct \}\);/.test(html), 'falta drill.finish');
  assert(/track\('dish\.view', \{ dishId: dish\.id, from: 'repaso' \}\);/.test(html), 'falta dish.view');
  assert(/track\('duel\.finish', \{ won: iWon\?1:0 \}\);/.test(html), 'falta duel.finish');
  assert(/track\('session\.start',/.test(html) && /track\('session\.end',/.test(html), 'faltan session.start/end');
  assert(/_tmTrackSearch\(query\.length, dishes\.length \+ wines\.length \+ lqas\.length\);/.test(html), 'falta search.query');

  // PRIVACIDAD: la búsqueda NUNCA guarda el texto tecleado (solo longitud/hits).
  const searchTrk = html.slice(html.indexOf('function _tmTrackSearch'), html.indexOf('function _tmMaybePrivacyNotice'));
  assert(/qLen: qLen\|0, hits: hits\|0/.test(searchTrk) && !/\braw\b/.test(searchTrk),
    'search.query solo debe registrar longitud y nº de resultados, jamás el texto');

  // Ajustes › Privacidad: interruptor, contador y borrado cableados.
  const aj = html.slice(html.indexOf('function openAjustes'), html.indexOf('function openAvatarPicker'));
  assert(/id="ajTmToggle"/.test(aj) && /_telemetrySetOptOut\(!tog\.checked\)/.test(aj),
    'Ajustes debe tener el interruptor de telemetría');
  assert(/id="ajTmWipe"/.test(aj) && /_tmPurgeAll\(\)/.test(aj), 'Ajustes debe permitir borrar el comportamiento');

  // ── Prueba FUNCIONAL del corazón de la captura (opt-out + buffer + no-lanza) ──
  const mod = html.slice(html.indexOf('const TELEMETRY_V = 1;'), html.indexOf('// ═══ GUARDIA ANTI-DUPLICADOS'));
  const store = new Map();
  const ls = { getItem:(k)=>store.has(k)?store.get(k):null, setItem:(k,v)=>store.set(k,String(v)), removeItem:(k)=>store.delete(k) };
  const noop = ()=>0;
  const win = {}; // sin requestIdleCallback → usa la rama setTimeout (no-op)
  const doc = { addEventListener: noop, visibilityState:'visible' };
  const factory = new Function('window','document','indexedDB','localStorage','setInterval','setTimeout','requestIdleCallback',
    mod + '\n; return { track, _telemetryOn, _telemetrySetOptOut, _buf: ()=>_tmBuf };');
  const api = factory(win, doc, null, ls, noop, noop, noop);
  // Por defecto activa; session.start ya se encoló al evaluar el módulo.
  assert(api._telemetryOn() === true, 'la telemetría debe estar activa por defecto');
  const n0 = api._buf().length;
  api.track('test.event', { a: 1 });
  assert(api._buf().length === n0 + 1, 'track() debe encolar un evento cuando está activa');
  const ev = api._buf()[api._buf().length - 1];
  assert(ev.v === 1 && ev.e === 'test.event' && typeof ev.t === 'number' && ev.p.a === 1,
    'el sobre común (v,e,t,p) debe estar bien formado');
  // Opt-out: deja de capturar y no lanza.
  api._telemetrySetOptOut(true);
  assert(api._telemetryOn() === false, 'el opt-out debe desactivar la captura');
  const n1 = api._buf().length;
  api.track('should.be.ignored', {});
  assert(api._buf().length === n1, 'con opt-out, track() no debe encolar nada');
  // Nunca lanza aunque le pasen basura.
  api._telemetrySetOptOut(false);
  api.track(); api.track(null); api.track('ok', undefined);
  assert(true, 'track() nunca debe lanzar');
  // REGRESIÓN (bug real): en el arranque, session.start se emite cuando
  // `currentUser` aún está en la zona muerta temporal (TDZ). `typeof` sobre un
  // binding léxico en TDZ LANZA, así que el evento se perdía en silencio. El
  // acceso a currentUser debe ir con su propia guarda try/catch → u=null.
  const trackFn = html.slice(html.indexOf('function track(name, props){'), html.indexOf('let _tmFlushing = false;'));
  assert(/try\{ if\(typeof currentUser!=='undefined'\) u = currentUser \|\| null; \}catch\(_\)\{ u = null; \}/.test(trackFn),
    'track() debe leer currentUser con guarda TDZ (no romper session.start en el arranque)');
  assert(trackFn.indexOf('_tmBuf.push') > trackFn.indexOf('catch(_){ u = null; }'),
    'la lectura protegida de currentUser debe preceder al push');
});

test('supervisor: "Conectados Hoy" usa lastActiveAt (además de lastLoginTs) y el login siempre sincroniza', () => {
  // Bug real (verificado con datos reales en Supabase): Alexis y Sol tenían
  // last_active_at DE HOY (el PATCH ligero de supaUpdateLastActive, que
  // SIEMPRE se manda al entrar, había funcionado) pero last_login de días
  // atrás (el PATCH pesado de supaUpsertEmployee — topic_scores, known_dishes,
  // sessions… — puede fallar en silencio con el WiFi de sala). El panel de
  // supervisor solo miraba last_login → las mostraba como "sin conectarse
  // hoy" pese a haber usado la app. Faride (0 XP) ni siquiera tenía
  // last_login: el login lo saltaba del todo para empleados sin XP.
  assert(/lastActiveAt: r\.last_active_at \|\| null/.test(html),
    'supaFetchAllEmployees debe mapear last_active_at (antes se descartaba)');
  const sup = html.slice(html.indexOf('function renderSupervisor('), html.indexOf('function renderSupDeleteEmployee'));
  assert(/const _supSeen = n => \{ const a=allEmps\[n\]\.lastLoginTs, b=allEmps\[n\]\.lastActiveAt;/.test(sup),
    'falta el helper _supSeen (la marca más reciente de login/actividad)');
  assert(/connectedToday = empNames\.filter\(n => \{\s*const lt = _supSeen\(n\);/.test(sup),
    '"Conectados Hoy" debe filtrar con _supSeen, no solo lastLoginTs');
  assert(!/if\(emp\.xp && emp\.xp > 0\) supaUpsertEmployee\(currentUser\);/.test(html),
    'el login ya no debe saltarse la sincronización para empleados con 0 XP');
});

test('logros: el registro de logros desbloqueados se sincroniza en la nube (no se re-disparan entre dispositivos)', () => {
  // Bug real (propietario): al entrar en otro dispositivo re-saltaban las
  // notificaciones de logros ya desbloqueados, porque emp.achievements solo
  // vivía en local. El dispositivo nuevo restauraba el XP alto pero con el
  // ledger vacío → checkNewAchievements() los trataba a todos como nuevos.
  assert(/const _EMP_COLS='[^']*\bachievements\b[^']*'/.test(html),
    '_EMP_COLS debe incluir achievements para leer el ledger de la nube');
  assert(/achievements: JSON\.stringify\(ach\)/.test(html),
    'supaUpsertEmployee debe escribir el ledger de logros en la nube');
  // La restauración reconstruye el ledger (nube ⊕ local ⊕ logros ya ganados por
  // stats) antes de entrar, para que un dispositivo nuevo no re-notifique.
  const restore = html.slice(html.indexOf('async function supaRestoreEmployee('),
    html.indexOf('async function supaRestoreEmployee(') + 7000);
  assert(/JSON\.parse\(r\.achievements\|\|'\[\]'\)/.test(restore),
    'supaRestoreEmployee debe leer r.achievements de la nube');
  assert(/getUnlockedAchievements\(emp\)\.map\(a=>a\.id\)/.test(restore),
    'la restauración debe sembrar el ledger con los logros que ya corresponden a las stats (usuarios existentes con ledger vacío en la nube)');
});

test('reto del día + liga semanal: pregunta compartida determinista y XP semanal sincronizado (jul 2026)', () => {
  // Enganche diario pedido por el propietario: «no logramos que los usuarios
  // se enganchen y la usen a diario». Reto del día = la MISMA pregunta para
  // todo el equipo (generador sembrado con la fecha — sin Math.random, o cada
  // móvil vería una pregunta distinta) + Liga semanal que se reinicia cada
  // lunes (el ranking histórico solo motivaba a los 2 primeros).
  const dq = html.slice(html.indexOf('function _dqQuestion('), html.indexOf('function _dqIsDone('));
  assert(dq.length > 100 && !/Math\.random\(/.test(dq),
    '_dqQuestion debe ser determinista: PROHIBIDA la llamada Math.random() (rompería la pregunta compartida)');
  assert(/function _mulberry32\(/.test(html), 'falta el PRNG sembrado _mulberry32');
  assert(/_wkEnsure\(emp\); emp\.wkXP=\(emp\.wkXP\|\|0\)\+granted/.test(html),
    'awardXP debe acumular el XP ganado en la liga semanal (wkXP)');
  assert(/const _EMP_COLS='[^']*\bextras\b[^']*'/.test(html),
    '_EMP_COLS debe incluir extras (estado de liga y reto en la nube)');
  assert(/extras: _extrasCompose\(emp\)/.test(html),
    'supaUpsertEmployee debe escribir extras (liga + reto) en la nube');
  const restore = html.slice(html.indexOf('async function supaRestoreEmployee('),
    html.indexOf('async function supaRestoreEmployee(') + 8000);
  assert(/_extrasMergeInto\(emp, r\.extras\)/.test(restore),
    'la restauración debe heredar liga/reto de la nube (evita repetir el reto de hoy en otro dispositivo)');
  assert(/Liga semanal/.test(html) && /weekMap/.test(html) && /se reinicia cada lunes/.test(html),
    'el ranking debe mostrar la Liga semanal con reinicio los lunes');
  assert(/openDailyReto\(\)/.test(html) && /Reto del día/.test(html),
    'el inicio debe ofrecer el Reto del día');
});

test('El Código del Camarero: manual de oficio consultable (jul 2026)', () => {
  // Petición del propietario: «crear el mejor camarero del mundo… eso que solo
  // te enseñan los años y la experiencia». No es un examen: es un manual de
  // campo — la lectura de la mesa, qué decir, qué hacer, nunca, y el porqué.
  const raw = read('data/codigo-camarero.json');
  let data;
  try { data = JSON.parse(raw); } catch(e){ assert(false, 'codigo-camarero.json debe ser JSON válido: '+e.message); }
  assert(Array.isArray(data.cats) && data.cats.length >= 8, 'debe haber al menos 8 categorías del código');
  assert(Array.isArray(data.cards) && data.cards.length >= 50, 'debe haber al menos 50 códigos (hay '+(data.cards||[]).length+')');
  const catIds = new Set(data.cats.map(c=>c.id));
  for(const card of data.cards){
    for(const k of ['t','t_en','read','read_en','steps','steps_en','why','why_en']){
      assert(card[k] && (!Array.isArray(card[k]) || card[k].length), `código #${card.id} («${card.t}») sin campo ${k} — cada ficha va completa y bilingüe`);
    }
    assert(catIds.has(card.cat), `código #${card.id} con categoría desconocida: ${card.cat}`);
  }
  assert(/function startCodigo\(/.test(html) && /codigo-camarero\.json/.test(html),
    'la app debe cargar el Código (lazy) con startCodigo()');
  assert(/El Código del Camarero/.test(html) && /startCodigo\(\)/.test(html),
    'el hub de Protocolo debe tener la entrada al Código del Camarero');
  // Regla del propietario: «que ningún código actúe en contra del estándar de
  // Forbes». La vista lo declara y los códigos sensibles lo respetan (p. ej.
  // la cuenta se OFRECE con prisa, nunca se planta sin pedirla).
  assert(/ante la duda, manda el estándar/.test(html),
    'la vista del Código debe declarar que ante la duda manda el estándar Forbes/LQA');
  assert(/la cuenta está lista/.test(raw) && !/Lleva la cuenta preparada con el último pase, sin que la pidan/.test(raw),
    'con prisa la cuenta se OFRECE (estándar: se presenta al pedirla) — no se lleva sin pedirla');
});

test('Actualidad: robot de noticias + calendario de eventos (jul 2026)', () => {
  // Petición del propietario (inspirado en Tenet Research): feed de noticias
  // gastro AUTOMÁTICO (Canarias/Tenerife, Michelin, vinos) + eventos con
  // cuenta atrás. El robot corre en GitHub Actions cada 6 h; la app solo lee
  // data/noticias.json (cero servidores, cero claves).
  const wf = read('.github/workflows/noticias.yml');
  assert(/schedule:/.test(wf) && /cron:/.test(wf) && /workflow_dispatch:/.test(wf),
    'el workflow debe correr por cron Y a mano (workflow_dispatch)');
  assert(/fetch-noticias\.mjs/.test(wf) && /contents: write/.test(wf),
    'el workflow ejecuta el robot y puede hacer commit');
  const sc = read('scripts/fetch-noticias.mjs');
  assert(/news\.google\.com\/rss\/search/.test(sc), 'el robot lee Google News RSS');
  assert(/gastronomía Canarias/.test(sc) && /Tenerife/.test(sc) && /Guía Michelin/.test(sc),
    'las búsquedas fijas deben cubrir Canarias/Tenerife/Michelin');
  assert(/MIN_ITEMS/.test(sc) && /process\.exit\(0\)/.test(sc),
    'a prueba de fallos: con pocas noticias NO se escribe (se conserva la edición anterior)');
  assert(/BLOCKLIST/.test(sc), 'el filtro de titulares que no pintan nada debe existir');
  let noticias, eventos;
  try { noticias = JSON.parse(read('data/noticias.json')); } catch(e){ assert(false, 'noticias.json debe ser JSON válido'); }
  assert(Array.isArray(noticias.items), 'noticias.json debe tener items[]');
  for(const i of noticias.items) assert(i.t && i.u && Array.isArray(i.tags), 'cada noticia lleva título, url y tags');
  try { eventos = JSON.parse(read('data/eventos.json')); } catch(e){ assert(false, 'eventos.json debe ser JSON válido'); }
  assert(Array.isArray(eventos.eventos) && eventos.eventos.length >= 4, 'el calendario debe traer eventos');
  for(const e of eventos.eventos) assert(e.t && /^\d{4}-\d{2}-\d{2}$/.test(e.d) && Array.isArray(e.tags),
    'cada evento lleva título, fecha ISO y tags');
  assert(eventos.eventos.every(e => e.aprox !== undefined),
    'las fechas estimadas van marcadas (aprox) — nunca se presentan como confirmadas');
  // UI cableada como subpestaña de Aprender, con enlaces seguros.
  assert(/function renderActualidad\(/.test(html) && /actualidad:renderActualidad/.test(html),
    'renderActualidad debe existir y estar en el dispatch de Aprender');
  assert(/\['actualidad',_en\?'News':'Actualidad'/.test(html), 'el chip Actualidad debe estar en la barra');
  assert(/target="_blank" rel="noopener noreferrer"/.test(html.slice(html.indexOf('function _actHTML'), html.indexOf('function renderActualidad'))),
    'las noticias abren fuera con rel=noopener');
  assert(/\.act-card\{/.test(read('styles.css')), 'estilos del feed ausentes');
  // Ago 2026 (propietario): «dejamos las noticias en su sección y las
  // quitamos del inicio». El Inicio ya no las trae ni las carga.
  const dash2 = html.slice(html.indexOf('function renderDashboard()'), html.indexOf('// ═══════ FLASHCARDS'));
  assert(!/dashNews/.test(dash2), 'el inicio no debe traer el teaser de noticias');
  assert(!/dashNews/.test(html), 'no puede quedar código del teaser de noticias');
  // Miniaturas (jul 2026): el robot resuelve el enlace real del artículo y
  // extrae su og:image; la tarjeta pinta la foto solo si existe y se repliega
  // a solo-texto si el medio bloquea el hotlink.
  assert(/extractOgImage/.test(sc) && /og:image/.test(sc) && /garturlres/.test(sc),
    'el robot debe extraer og:image y resolver el enlace real del artículo');
  assert(/AbortController/.test(sc), 'toda descarga del robot lleva tope de tiempo');
  // Regla del propietario: solo la foto PROPIA de la noticia — nunca logos,
  // placeholders ni la cabecera genérica que el medio repite en todo.
  assert(/IMG_GENERIC/.test(sc) && /og:image:width/.test(sc) && /byImg/.test(sc),
    'el robot debe vetar imágenes genéricas: por nombre, por tamaño de icono y por foto repetida entre noticias');
  const imgUrls = noticias.items.filter(i => i.img).map(i => i.img);
  assert(new Set(imgUrls).size === imgUrls.length,
    'ninguna foto puede repetirse entre noticias (repetida = genérica del medio)');
  const actSlice = html.slice(html.indexOf('function _actHTML'), html.indexOf('function renderActualidad'));
  assert(/act-thumb/.test(actSlice) && /loading="lazy"/.test(actSlice)
    && /referrerpolicy="no-referrer"/.test(actSlice) && /onerror=/.test(actSlice),
    'las miniaturas cargan perezosas, sin referrer y con repliegue si la foto falla');
  assert(/\.act-thumb\{/.test(read('styles.css')), 'estilos de la miniatura ausentes');
});

test('Cuadrante: la tabla horarios no acepta escrituras con la clave pública', () => {
  // La tabla guarda nombres y turnos del personal y tenía el RLS DESACTIVADO:
  // cualquiera con la clave pública (que va en la app) podía leerla Y
  // modificarla. Se cerró la escritura por RLS y se canalizó por save_rota
  // (SECURITY DEFINER + verificación del PIN de supervisor en servidor).
  assert(/rest\/v1\/rpc\/save_rota/.test(html), 'el guardado debe ir por save_rota');
  // Lectura: la app sigue leyendo el cuadrante con la clave pública.
  assert(/rest\/v1\/horarios\?select=/.test(html), 'la lectura del cuadrante debe seguir funcionando');
  // Ninguna escritura directa (POST/PATCH/DELETE) contra la tabla.
  for (const m of ["method:'POST'", "method:'PATCH'", "method:'DELETE'"]) {
    const idx = html.indexOf('rest/v1/horarios`');
    if (idx !== -1) assert(!html.slice(idx, idx + 400).includes(m),
      `queda una escritura directa (${m}) contra horarios`);
  }
});

test('Panel de dirección: la preparación LQA está en el titular (ago 2026)', () => {
  // Para presentar a dirección/propiedad, la métrica que importa es la de la
  // auditoría Forbes/LQA, no el XP. Estaba calculada pero enterrada en otra
  // pantalla; ahora encabeza el análisis del equipo junto al resto de KPIs.
  assert(/function _lqaReady\(e\)\{/.test(html), 'debe existir el helper compartido _lqaReady');
  // Una sola fórmula: el panel LQA y el titular miden lo mismo.
  assert((html.match(/if\(e\.ghostBest\) parts\.push/g) || []).length === 1,
    'la fórmula de preparación LQA no puede estar duplicada');
  assert(/const readiness = emps\.map\(_lqaReady\)/.test(html),
    'el panel LQA debe usar el helper compartido');
  const an = html.slice(html.indexOf('function renderSupAnalytics'), html.indexOf('function _lqaReady'));
  assert(/_rdyAll = empNames\.map\(n=>allEmps\[n\]\)\.filter\(Boolean\)\.map\(_lqaReady\)/.test(an),
    'el titular debe calcular la preparación del equipo con el helper');
  assert(/\.filter\(r=>r\.runs>0\)/.test(an),
    'solo cuentan quienes han hecho alguna prueba (si no, la media sale falseada)');
  assert(/'LQA readiness':'preparación LQA'/.test(an), 'la pastilla debe estar rotulada en ambos idiomas');
  const css = read('styles.css');
  assert(/\.sup-hl\{[^}]*flex-wrap:wrap/.test(css), 'el titular debe poder envolver con 4 pastillas');
});

test('showTab fija la subpestaña de destino (Flashcards no cae en Emplatado)', () => {
  // Reporte del propietario (ago 2026): «el botón flashcards lleva a plating
  // guide». renderAprender/renderRankingHub pintan lo que dice _subTab, NO el
  // destino de showTab(), así que showTab('flashcards') caía en la subpestaña
  // de aterrizaje (Emplatado). Igual le pasaba a showTab('stats') → Ranking.
  const st = _xFn('showTab');
  assert(/const _subParent = parentMap\[tab\]/.test(st), 'showTab debe derivar el padre de la subpestaña');
  assert(/if\(_subParent === 'aprender'\) _subTab\.aprender = tab;/.test(st),
    'entrar por una subpestaña de Aprender debe fijar _subTab.aprender');
  assert(/else if\(_subParent === 'ranking'\) _subTab\.ranking = tab;/.test(st),
    'entrar por una subpestaña de Ranking debe fijar _subTab.ranking');
  // El arreglo debe ocurrir ANTES de pintar (si no, se pinta lo anterior).
  assert(st.indexOf('_subTab.aprender = tab') < st.indexOf('renderMap'),
    'la subpestaña debe fijarse antes de elegir el renderer');
  // Los atajos del índice del inicio siguen apuntando a sus subpestañas.
  const dash = html.slice(html.indexOf('function renderDashboard()'), html.indexOf('// ═══════ FLASHCARDS'));
  assert(/onclick="showTab\('flashcards'\)"/.test(dash), 'el atajo Flashcards debe seguir en el índice');
  assert(/onclick="showTab\('repaso'\)"/.test(dash), 'el atajo Repaso debe seguir en el índice');
});

test('Actualidad: una pantalla que se lee de arriba abajo (ago 2026)', () => {
  // Petición del propietario: «haz que sea más elegante y se entienda fácil».
  // Antes había 8 controles (3 segmentos + 5 etiquetas) antes del primer
  // titular, emoji en los divisores y jerga («fecha aprox.»).
  const act = html.slice(html.indexOf('function _actHTML'), html.indexOf('function renderTecnicas'));
  // Fuera los filtros: ni segmentos, ni chips de etiqueta, ni su estado.
  for (const dead of ['_actFilter', '_actTag', '_actSetFilter', '_actTagChip'])
    assert(!html.includes(dead), `el filtro ${dead} debe seguir retirado`);
  assert(!/act-tag\b/.test(html), 'las etiquetas por tarjeta deben seguir fuera');
  // Cabecera que explica la pantalla en una frase.
  assert(/class="act-head"/.test(act) && /act-head-s/.test(act),
    'la sección debe abrir con un titular y una frase que la explique');
  // Cuenta atrás en lenguaje llano, no en jerga.
  assert(/function _actFalta\(/.test(html) && /'Es hoy'/.test(html) && /'Es mañana'/.test(html),
    'la cuenta atrás debe decir «Es hoy» / «Es mañana» / «Faltan N días»');
  assert(/function _actFecha\(/.test(html) && /month:'long'/.test(html),
    'la fecha del evento debe ir en texto largo y legible');
  assert(!/fecha aprox\./.test(html), 'la jerga «fecha aprox.» debe desaparecer');
  // Divisores sin emoji de color (el resto de la app es tipográfica).
  assert(!/📰|📅/.test(act), 'los divisores de Actualidad no deben llevar emoji');
  // La barra de fecha/servicio/racha era contexto de otra pantalla.
  assert(!/act-pulse/.test(html), 'la barra de fecha/servicio debe seguir fuera');
  // Lista acotada con «ver más» en vez de scroll infinito.
  assert(/EV_N=3, NEWS_N=6/.test(act) && /function _actMore\(/.test(html),
    'cada bloque muestra unos pocos y ofrece «ver más»');
  // La noticia sigue avisando de que abre fuera, y de forma segura.
  assert(/target="_blank" rel="noopener noreferrer"/.test(act), 'las noticias abren fuera con rel=noopener');
  assert(/class="act-go"/.test(act), 'la tarjeta debe indicar que el enlace sale de la app');
  const css = read('styles.css');
  assert(/\.act-head\{/.test(css) && /\.act-when\{/.test(css) && /\.act-go\{/.test(css),
    'estilos de la nueva Actualidad ausentes');
  assert(!/\.act-mini\{/.test(css), 'el estilo del teaser del inicio debe irse con él');
});

test('Horarios del equipo: cuadrante desde Supabase, leyenda fiel y cambio asistido (jul 2026)', () => {
  // Petición del propietario: el cuadrante vivía en un Excel del hotel tras
  // el login corporativo (que NUNCA se automatiza) y en capturas de WhatsApp.
  // Ahora: tabla horarios en Supabase, vistas Hoy/Mi semana/Cuadrante/Cambio,
  // editor en el panel de supervisor y acceso desde el inicio.
  assert(/id="navHorarios"/.test(html) && /horarios:renderHorarios/.test(html),
    'la sección Horarios debe estar en la navegación y el render map');
  assert(/rest\/v1\/horarios\?select=week_start,data/.test(html),
    'el cuadrante se lee de la tabla horarios de Supabase');
  assert(/txk_horarios_v1/.test(html) && /HORARIOS=\(cached&&cached\.weeks\)\|\|\[\]/.test(html),
    'sin red debe servir la última caché (uso en servicio, offline primero)');
  // Leyenda CONFIRMADA por el propietario — la app no inventa significados;
  // los códigos desconocidos se muestran tal cual (kind otro).
  assert(/Fijo discontinuo/.test(html) && /Devolución de horas/.test(html)
    && /Vacaciones \(bolsa\)/.test(html) && /Libre pedido/.test(html),
    'la leyenda de códigos debe llevar los significados confirmados por el propietario');
  assert(/return _HOR_CODES\[c\] \? _HOR_CODES\[c\]\.k : 'otro';/.test(html),
    'un código desconocido se clasifica otro y se muestra verbatim, nunca inventado');
  // El cambio de turno solo SUGIERE: aprueba el manager. Mensaje listo para WhatsApp.
  assert(/lo aprueba el manager/.test(html), 'el asistente debe dejar claro que aprueba el manager');
  assert(/wa\.me\/\?text=/.test(html) && /navigator\.clipboard/.test(html),
    'el mensaje del cambio sale por WhatsApp o portapapeles');
  // Editor del supervisor: herramienta en el panel + upsert a Supabase.
  assert(/horarios: \(\)=>renderSupHorarios\(\),/.test(html) && /_supTool\('horarios'\)/.test(html),
    'el editor de horarios debe colgar del panel de supervisor');
  // Ago 2026 — el cuadrante lleva datos de personal: la tabla `horarios`
  // quedó en SOLO LECTURA para la clave pública (RLS) y el guardado pasa por
  // la función save_rota, que verifica el PIN de supervisor en el servidor.
  assert(/_horSupSave/.test(html) && /rest\/v1\/rpc\/save_rota/.test(html),
    'guardar semana debe ir por la función save_rota, no por la tabla');
  assert(!/rest\/v1\/horarios`,\{\s*method:'POST'/.test(html),
    'no puede quedar escritura directa a horarios con la clave pública');
  const _hs = html.slice(html.indexOf('async function _horSupSave'), html.indexOf('// ═══ ACTUALIDAD'));
  assert(/pin_input:_supPin/.test(_hs), 'save_rota debe recibir el PIN de supervisor');
  assert(/\(await r\.json\(\)\)!==true/.test(_hs),
    'si save_rota devuelve false (PIN inválido) la app debe avisar, no dar por guardado');
  // Lector de capturas con IA: la imagen se comprime en el móvil, viaja a la
  // Edge Function leer-horario con el PIN de supervisor, y el resultado SOLO
  // rellena el editor (revisar antes de guardar — nunca se autopublica).
  assert(/functions\/v1\/leer-horario/.test(html) && /supPin:_supPin/.test(html),
    'el lector de capturas debe pasar por la Edge Function con el PIN');
  assert(/toDataURL\('image\/jpeg'/.test(html) && /2400\/Math\.max/.test(html),
    'la captura se comprime en el dispositivo antes de enviarse');
  // Subir la foto tiene que ser FÁCIL (propietario): botón grande arriba del
  // editor, dudas visibles en pantalla y salto directo al botón de guardar.
  assert(/Subir foto del horario/.test(html) && /id="horSupOcrBtn" class="ri-cta"/.test(html),
    'la acción principal del editor debe ser el botón grande de subir foto');
  assert(/id="horSupDudas"/.test(html) && /Celdas dudosas/.test(html),
    'las dudas de la lectura se enseñan en pantalla, no en consola');
  assert(/horSupSaveBtn/.test(html) && /scrollIntoView/.test(html),
    'tras la lectura se desplaza al botón de guardar');
  const ocrFn = html.slice(html.indexOf('async function _horSupOCR'), html.indexOf('async function _horSupSave'));
  assert(!/_horSupSave\(/.test(ocrFn),
    'la lectura IA nunca guarda sola: rellena el editor y el supervisor revisa');
  assert(!/sk-ant/.test(html),
    'ninguna clave de API de Anthropic puede vivir en la app (va en secretos de Supabase)');
  // Rangos de servicio (regla del propietario): almuerzo 09:00–15:00, cena
  // 16:00–00:00, y quien hace 9-10 h (≥540 min) va en LOS DOS rangos como
  // doble. Los supervisores envían el mensaje de rangos cada día.
  assert(/if\(t\.dur>=540\) return 'ambos';/.test(html),
    'la regla del doble turno (9 h o más → ambos rangos) debe estar en _horRango');
  assert(/Math\.max\(t\.s,540\)/.test(html) && /Math\.max\(t\.s,960\)/.test(html),
    'las ventanas de rango deben ser 09:00–15:00 y 16:00–00:00');
  assert(/_horRangosMsg/.test(html),
    'el mensaje de rangos del día debe poder copiarse/enviarse por WhatsApp');
  assert(/solo almuerzo/.test(html) && /solo cena/.test(html) && /_horShareRangos/.test(html),
    'debe poder compartirse el día completo, solo almuerzo o solo cena');
  // Compartir A LA VISTA (propietario): icono real de WhatsApp y botones en
  // el encabezado del día y de cada servicio, no al fondo de la página.
  assert(/_WA_ICO/.test(html) && /M17\.472 14\.382/.test(html),
    'el botón de WhatsApp debe llevar el icono oficial, no el texto WA');
  assert(/hor-svc-head/.test(html) && !/>WA</.test(html),
    'los botones de compartir viven en los encabezados; el texto «WA» no debe volver');
  assert(/_horSetDay/.test(html),
    'la vista Hoy debe permitir elegir cualquier día de la semana (rangos diarios)');
  // Blindaje multi-semana (propietario: «que no haya errores cuando se suba
  // la semana siguiente o dos») — 4 fallos reales cazados y sus guardas:
  assert(/week_start=gte\./.test(html),
    'la carga debe filtrar semanas vigentes — sin esto, con historial largo la app enseñaría semanas viejas');
  assert(/getUTCDay\(\)!==1/.test(html) && /LUNES/.test(html),
    'guardar exige que la semana empiece en lunes (evita solapes silenciosos)');
  assert(/demasiados campos/.test(html),
    'el parser avisa si una celda lleva «|» (descuadre silencioso de columnas)');
  assert(/let _horWeekIdx=null/.test(html),
    'el cuadrante abre en la semana actual, no en la más vieja cargada');
  assert(/\[:.\]\(\\d\{2\}\)/.test(html.slice(html.indexOf('function _horShiftMins'), html.indexOf('function _horRango'))),
    'las horas con punto (12:30-16.30, como el Excel real) deben parsearse');
  // Tu turno de hoy y mañana en el inicio (fila Horarios, relleno diferido)
  assert(/_horMyDayLbl/.test(html) && /id="hoyHorMeta"/.test(html),
    'el inicio debe mostrar tu turno de hoy y el de mañana en la fila Horarios');
  // El turno vive DENTRO de la tarjeta verde del Dashboard (dash-hero),
  // bajo la barra de XP — petición explícita del propietario tras dos
  // ubicaciones anteriores en la zona clara.
  const _heroIx = html.indexOf('<div class="dash-hero">');
  const heroCard = html.slice(_heroIx, html.indexOf('renderInstallBanner()', _heroIx));
  assert(/id="hoyHorMeta"/.test(heroCard) && /dash-hero-hor/.test(heroCard),
    'la línea de Horarios debe vivir dentro de la tarjeta dash-hero');
  assert(/\.dash-hero-hor\{/.test(read('styles.css')), 'estilos de la línea de horario del héroe ausentes');
  // Acceso desde el inicio.
  const dash3 = html.slice(html.indexOf('function renderDashboard()'), html.indexOf('// ═══════ FLASHCARDS'));
  assert(/showTab\('horarios'\)/.test(dash3), 'el inicio debe llevar la fila de acceso a Horarios');
  // Cuadrante usable en móvil: scroll propio y columna de nombres fija.
  const css = read('styles.css');
  assert(/\.hor-tblwrap\{[^}]*overflow-x:auto/.test(css) && /\.hor-table \.hor-name\{[^}]*position:sticky/.test(css),
    'la tabla del cuadrante debe hacer scroll con la columna de nombres fija');
  // Reglas de cambio confirmadas por el propietario: la manager (Faride) es
  // intocable; supervisores solo entre supervisores (bloque sin grupo) y la
  // sala con la sala; el puesto de HOSTESS no entra (detectado por zona).
  assert(/_HOR_MANAGERS=\['Faride Navarro'\]/.test(html),
    'Faride debe estar fijada como manager intocable');
  assert(/_horSwapAllowed/.test(html) && /_horTier\(week,me\)===_horTier\(week,other\)/.test(html),
    'los cambios deben respetar el nivel: jefatura con jefatura, sala con sala');
  assert(/_horIsHostess/.test(html) && /HOSTESS/.test(html),
    'el puesto de Hostess debe quedar fuera de los cambios');
  assert(/los cambios los apruebas tú/.test(html),
    'la manager no debe poder pedir cambios desde el asistente');
  assert(/Reglas de la casa: los supervisores solo cambian entre supervisores/.test(html),
    'las reglas deben mostrarse al equipo en el propio asistente');
});

test('auditoría de botones: nada de tinta oscura sobre el fondo oscuro de la página (jul 2026)', () => {
  // Bug real (propietario): «en auditoría los botones para volver atrás no se
  // ven bien». El fondo de la página es oscuro (#1c2a22); un botón transparente
  // con color var(--parch*) (tinta oscura, pensada para tarjetas claras) es
  // invisible. 28 botones (← volver de LQA/supervisor/editor/Código, «Volver
  // al menú», pestañas de turno apagadas) pasaron a dorado tenue. Este guard
  // bloquea el patrón entero: transparente + borde tenue + tinta = prohibido.
  assert(!/color:var\(--parch\d?\);cursor:pointer[^>]*>\s*←\s*</.test(html),
    'ningún botón ← de volver puede usar tinta oscura (var(--parch*)) sobre fondo transparente');
  assert(!/background:transparent;border:1px solid var\(--line\);border-radius:var\(--r2?\);padding:\.4rem \.8rem;font-size:\.75rem;color:var\(--parch/.test(html),
    'patrón de botón de volver con tinta oscura detectado — usa dorado tenue rgba(228,190,104,.85)');
});

test('Rebranding Meseo: la app se llama Meseo; TXOKO queda solo como venue (jul 2026)', () => {
  // Propietario: «evitar demandas — la app es multi-restaurante; Txoko puede
  // aparecer como uno de los restaurantes a escoger, pero el nombre de la
  // app debe ser otro». La identidad del restaurante (TXOKO, Ritz-Carlton,
  // Berasategui) vive SOLO en data/themes.json (venue) y en el contenido de
  // los platos; la app se presenta como Meseo (meseo.es) en manifest,
  // título, icono, login por defecto, créditos, push y compartir.
  const man = JSON.parse(read('manifest.json'));
  assert(man.short_name === 'Meseo' && /^Meseo/.test(man.name), 'manifest must carry the Meseo identity');
  assert(!/txoko|berasategui|ritz/i.test(man.name + man.short_name + man.description),
    'manifest must not present the app as any restaurant brand');
  assert(/<title>Meseo · Formación de sala<\/title>/.test(html), 'the base tab title must be Meseo');
  assert(/id="loginLogoName">Meseo</.test(html) && /id="loginEyebrow">Formación de sala</.test(html),
    'login defaults must be neutral Meseo — venue identity arrives only via themes.json');
  // Ago 2026 (propietario): fuera «fines educativos · sin ánimo de lucro» —
  // contradecía presentar Meseo como producto. El pie afirma la marca.
  assert(!/ánimo de lucro|non-profit|fines educativos/i.test(html),
    'la app no debe seguir declarándose sin ánimo de lucro');
  assert(/app-credit[^>]*>© 2026 Meseo® · Marca registrada</.test(html),
    'el pie debe afirmar la marca');
  // El aviso sobre marcas de TERCEROS se mantiene: es lo que ampara usar
  // TXOKO y Martín Berasategui en contexto formativo.
  assert((html.match(/no está afiliada, patrocinada ni respaldada/g) || []).length >= 1,
    'el aviso de marcas de terceros debe conservarse');
  assert(!/Uso exclusivo Txoko/.test(html) && /app-credit[^>]*>© 2026 [^<]*Meseo/.test(html),
    'the footer credit must be Meseo, not a restaurant');
  assert(/%cMeseo · v/.test(html), 'the console banner must be Meseo');
  assert(/no está afiliada, patrocinada ni respaldada/.test(html) && /sus respectivos titulares/.test(html),
    'the legal modal must keep the trademark disclaimer, generalized to all venues');
  const themes = read('data/themes.json');
  // El document.title es lo que Google indexa (renderiza el JS). Ningún venue
  // debe filtrar la marca del restaurante al título de la pestaña → salía
  // "Meseo · TXOKO" en el buscador. El título público es siempre neutro.
  const themeTitles = (JSON.parse(themes).venues || []).map(v => v.title || '');
  assert(themeTitles.every(t => /^Meseo/.test(t) && !/txoko|berasategui|ritz/i.test(t)),
    'venue tab titles must stay neutral Meseo — no restaurant brand leaks into document.title (SEO)');
  const icon = read('icon.svg');
  assert(/>M<\/text>/.test(icon) && !/TXOKO/i.test(icon) && !/MESEO/.test(icon),
    'the icon must be Meseo-branded (cloche + M monogram), never Txoko');
  assert(/title: 'Meseo'/.test(read('sw.js')), 'the push fallback title must be Meseo');
  assert(/https:\/\/meseo\.es\//.test(html) && !/github\.io\/Txoko-Formacion/.test(html),
    'the share link must point at meseo.es, not the old repo URL');
  // Segunda vuelta (reporte del propietario: «aparece txoko, parpadea meseo
  // y vuelve a txoko»): el héroe del login ya NO se tematiza con el venue —
  // la app se presenta SIEMPRE como Meseo y el restaurante vive en el
  // selector, que ahora se muestra en cuanto hay al menos un venue.
  const themeFn = html.slice(html.indexOf('function applyTheme'), html.indexOf('function _venueTriggerSync'));
  assert(!/loginLogoName|loginEyebrow|loginSubtitle/.test(themeFn),
    'applyTheme must not restyle the login hero (it stays Meseo — no more brand flicker)');
  assert(/if\(all\.length\) renderVenuePicker\(all, current\.id\);/.test(html),
    'the venue picker must render even with a single venue (Txoko as a choice, not as the face)');
  // Tercera vuelta (reporte: «meseo no pertenece a Martín Berasategui»): el
  // sincronizador de idioma (applyLangToApp) era una SEGUNDA fuente que
  // re-inyectaba el subtítulo del venue en el héroe, con el mismo gating >1
  // del selector. El literal del subtítulo del venue no puede existir en el
  // JS de la app — solo en data/themes.json como dato del venue.
  assert(!/by Martín Berasategui · Formación de Equipo|by Martín Berasategui · Team Training/.test(html),
    'no app JS may hardcode a venue subtitle (the login hero is always Meseo)');
  assert(/if\(_all\.length && ACTIVE_VENUE\) renderVenuePicker\(_all, ACTIVE_VENUE\.id\);/.test(html),
    'the language re-render must keep the single-venue picker visible too');
  assert(/is not affiliated with, sponsored by or officially endorsed/.test(html) && /their respective owners/.test(html),
    'the EN legal modal must carry the generalized multi-venue disclaimer like the ES one');
  // Señales explícitas de nombre de sitio para Google (para que no deduzca
  // "TXOKO" del contenido visible). Y el nombre de app para móvil ya no es
  // TXOKO. Son las fuentes que Google prioriza para el site name.
  assert(/<meta property="og:site_name" content="Meseo">/.test(html),
    'head must declare og:site_name=Meseo so Google shows the right site name');
  assert(/"@type":"WebSite","name":"Meseo"/.test(html),
    'head must ship WebSite structured data naming the site Meseo');
  assert(/<meta name="apple-mobile-web-app-title" content="Meseo">/.test(html) &&
    !/apple-mobile-web-app-title" content="TXOKO"/.test(html),
    'the iOS web-app title must be Meseo, never TXOKO');
  // Los placeholders del HTML crudo (los ve un crawler sin ejecutar JS, y la
  // 1ª visita offline) no deben traer la marca del restaurante: el JS los
  // reescribe con el venue activo, pero por defecto la app es Meseo.
  const trigStatic = html.slice(html.indexOf('id="loginVenueTriggerName">') + 27, html.indexOf('</span>', html.indexOf('id="loginVenueTriggerName">')));
  assert(trigStatic === 'Meseo', 'the static venue-trigger placeholder must default to Meseo, not a restaurant');
  const hdrStatic = html.slice(html.indexOf('id="headerLogo"'), html.indexOf('</div>', html.indexOf('id="headerLogo"')));
  assert(!/txoko/i.test(hdrStatic), 'the static header-logo placeholder must not hardcode TXOKO (JS themes it per venue)');
});

test('Mr. Shoesmith está VIVO: respiración en reposo, enfado inmediato por error, celebración y temblor', () => {
  // Petición del propietario: el personaje debe estar animado y cambiar de
  // humor con cada error. Las animaciones antiguas apuntaban a `svg` (muertas
  // desde que el rostro es <img>); este guard fija el sistema vivo.
  // (1) el tick NO reemplaza la imagen cada 100ms (mataría las animaciones CSS)
  const tick = html.slice(html.indexOf('function txTick('), html.indexOf('function txAnswer('));
  assert(/if\(oldMood !== newMood\)\{\s*[\r\n]+\s*txApplyMood\(faceEl/.test(tick),
    'txTick must only swap the face img when the mood actually changes');
  assert(/tx-face-tense'?,\s*pct<=30\)/.test(tick), 'txTick must toggle the low-patience tremble class');
  // (2) el error cambia la cara AL INSTANTE y dispara la reacción de enfado
  const ans = html.slice(html.indexOf('function txAnswer('), html.indexOf('function txAnswer(') + 4000);
  assert(/playSound\('wrong'\)[\s\S]*?txApplyMood\(faceEl,txokoState\.lives/.test(ans),
    'a wrong answer must swap to the angrier face immediately (not wait for the next tick)');
  assert(/tx-face-bad/.test(ans), 'a wrong answer must trigger the tx-face-bad rage reaction');
  assert(/tx-face-ok/.test(ans), 'a correct answer must trigger the tx-face-ok celebration');
  assert(!/shoe-mood-change/.test(html), 'the dead shoe-mood-change hook must be gone');
  // (3) CSS: marioneta viva y sin selectores muertos sobre svg
  const css = read('styles.css');
  assert(/\.tx-rh-face-frame\.tx-mood-calm \.tx-shoe-face\{animation:shoeIdle/.test(css),
    'the face must breathe at rest (shoeIdle via tx-mood-calm) — and WITHOUT an #id in the selector, or the state animations (tremble/nod/rage) lose the specificity war and never run');
  for (const kf of ['@keyframes shoeIdle', '@keyframes shoeFidget', '@keyframes shoeFume', '@keyframes shoeBoil', '@keyframes shoeRage', '@keyframes shoeNod', '@keyframes shoeTremble', '@keyframes shoeFlash']) {
    assert(css.includes(kf), `styles.css must define ${kf}`);
  }
  assert(!/#txokoClientFace svg/.test(css), 'dead svg-based animation selectors must be removed');
  // (4) el humor cambia el COMPORTAMIENTO (calm/mid/mad) y el ENCUADRE (m3/m4)
  assert(/function txMoodClass\(lives\)/.test(html) && /function txApplyMood\(/.test(html),
    'mood-tier helpers (txMoodClass/txApplyMood) must exist');
  assert(/tx-shoe-m'\+mood/.test(html), 'txClientFace must tag the sprite with its per-mood crop class');
  assert(/\.tx-rh-face-frame \.tx-shoe-m3\{/.test(css) && /\.tx-rh-face-frame \.tx-shoe-m4\{/.test(css),
    'the angry poses (m3/m4) need their own framing — a single crop leaves them off-centre');
});

test('Mr. Shoesmith: animación por FOTOGRAMAS (parpadeo, habla, guiño, gruñido, grito alternado)', () => {
  // Hoja de 5 fotogramas del propietario (jul 2026). El personaje alterna
  // poses reales: parpadea en calma, habla al dictar la pregunta, guiña al
  // acierto, mastica su rabia a 2 vidas y grita alternando A/B a 1 vida.
  assert(/const SHOESMITH_ANIM=\{/.test(html), 'SHOESMITH_ANIM frame set missing');
  for (const k of ['blink', 'talk', 'wink', 'growl', 'scream', 'bored', 'irked']) {
    assert(html.includes(`${k}:'img/sprites/shoe-${k}.jpg'`), `SHOESMITH_ANIM must wire the ${k} frame file`);
    assert(existsSync(join(ROOT, `img/sprites/shoe-${k}.jpg`)), `img/sprites/shoe-${k}.jpg missing on disk`);
  }
  const i = html.indexOf('function txAnimTick(');
  assert(i !== -1, 'txAnimTick scheduler missing');
  const body = html.slice(i, html.indexOf('\nfunction txRender(', i));
  assert(/img\.setAttribute\('src',src\)/.test(html.slice(html.indexOf('function _txSetFrame'), html.indexOf('function _txSetFrame') + 300)),
    'frame swaps must touch img.src only (innerHTML would reset the CSS animations)');
  // Generalizado por persona (jul 2026): lee p.anim.xxx desde la persona activa,
  // con guarda de existencia (La Crítica no trae parpadeo). El guard fija que
  // CADA fotograma sigue existiendo por su clave y que Shoesmith los tiene todos.
  assert(/st\.lives<=1 && p\.anim\.scream/.test(body), 'at 1 life he must scream alternating A/B');
  assert(/st\.lives===2 && p\.anim\.growl/.test(body), 'at 2 lives he must chew his rage in a loop');
  assert(/p\.anim\.bored/.test(body) && /p\.anim\.irked/.test(body),
    'at 4/3 lives he must run the slow idle micro-loop (same-camera video frames)');
  assert(/p\.blinkTier && st\.lives===p\.blinkTier && p\.anim\.blink/.test(body), 'at calm he must blink occasionally (only if his persona has a blink frame)');
  assert(/txAnimTick\(\);/.test(html.slice(html.indexOf('function txTick('), html.indexOf('function txAnswer('))),
    'txTick must drive the frame scheduler');
  assert(/\w+\.anim\.wink/.test(html.slice(html.indexOf('function txAnswer('), html.indexOf('function txAnswer(') + 4200)),
    'a correct answer must show the active persona\'s wink frame when available');
  assert(/txAnimOnce\(\['talk'/.test(html.slice(html.indexOf('function txNext('), html.indexOf('function txTick('))),
    'a new question must trigger the talking sequence');
  // Ambas personas siguen aportando su set completo por la clave (registro).
  for (const anim of ['SHOESMITH_ANIM', 'CRITIC_ANIM']) {
    const re = new RegExp('const ' + anim + '=\\{');
    assert(re.test(html), `${anim} frame set missing`);
  }
  for (const k of ['talk', 'bored', 'irked', 'growl', 'scream']) {
    assert(html.includes(`${k}:'img/sprites/critic-${k}.jpg'`), `CRITIC_ANIM must wire the ${k} frame file`);
    assert(existsSync(join(ROOT, `img/sprites/critic-${k}.jpg`)), `img/sprites/critic-${k}.jpg missing on disk`);
  }
});


test('el Cliente IA se eliminó y no puede volver (sep 2026)', () => {
  // Decisión del propietario: meses en la app y sólo dos usos. El motivo que
  // dio: nadie invierte tanto tiempo en una sesión de aprendizaje —eran hasta
  // 12 intervenciones escribiendo en el móvil— y quien compre la aplicación no
  // va a pagar por un chat de texto cuando lo que de verdad prepara para una
  // auditoría es el role play. Su sitio en el inicio y en Repaso lo ocupa el
  // Pase, que es el mismo entrenamiento en treinta segundos y sin cobertura.
  //
  // Con él se van tres cosas que llevaba encima: la factura del LLM, una Edge
  // Function («mesa-infinita») que nunca estuvo en el repo —así que su prompt
  // y sus topes no se podían revisar aquí— y un veredicto de seguridad en
  // alérgenos que dictaba el modelo y que nada verificaba contra DISH_ACTIONS,
  // la única afirmación sobre alérgenos de toda la app que no se comprobaba.
  const css = read('styles.css');
  for (const [f, t] of [[html, 'index.html'], [css, 'styles.css']]) {
    const restos = [...f.matchAll(/_mi[A-Za-z]+|_MI_[A-Z_]+|renderMesaLobby|Mesa Infinita|miStats|mesa-infinita|ri-cta-mesa/g)].map(m => m[0]);
    assert(restos.length === 0, `${t} conserva restos del Cliente IA: ${[...new Set(restos)].join(', ')}`);
  }
  assert(!/Cliente IA|AI Guest/.test(html), 'el nombre no puede reaparecer en la app');
  // Y sobre todo: la app no vuelve a llamar a ninguna función de IA por turno.
  assert(!/functions\/v1\/mesa-infinita/.test(html), 'la Edge Function del huésped IA queda fuera');
  // El acordeón del supervisor y el bloque del resumen semanal se fueron con él.
  assert(!/const mesaSection/.test(html), 'la sección del supervisor debe irse con la función');
  assert(!/_acc\('mesa'/.test(html), 'el acordeón del supervisor debe irse con la función');
});

test('el Pase tiene su acceso destacado, con un handler que de verdad dispara', () => {
  // «Que esté a la vista, un acceso más rápido» (propietario,
  // sep 2026): tarjeta propia en el inicio y en Repaso, al lado de la del
  // para no tener que entrar en una categoría y buscar un plato. Ocupa el sitio
  // que tenía el Cliente IA, retirado por el propietario en sep 2026.
  assert((html.match(/_paseCtaHTML\(_en\)/g) || []).length === 3,
    'la tarjeta del Pase debe pintarse en el inicio Y en Repaso desde su helper');
  assert(/function _paseGo\(\)\{ launchPase\(null\); \}/.test(html),
    'el atajo debe abrir el juego eligiendo plato del turno, sin pedir uno');
  // La primera versión salió con el marcador sin sustituir: el atributo se
  // resolvía a «null» en tiempo de ejecución, así que la tarjeta se veía
  // perfecta y al tocarla no pasaba nada. La única forma de pillarlo fue
  // pulsarla de verdad; el guard lo fija.
  assert((html.match(/class="ri-cta ri-cta-pase"[^>]*onclick="_paseGo\(\)"/g) || []).length === 1,
    'el helper de la tarjeta debe llevar su handler resuelto, no un marcador');
  // Y que sus textos se interpolen de verdad. Esto falló DOS veces al generar
  // el helper: los marcadores salían escapados y la tarjeta se pintaba con el
  // literal en pantalla —«${_en?'Plating pass':…}»— en vez del texto. Se veía
  // perfecta en el código y rota en el móvil; sólo se caza mirando el render.
  const iCta = html.indexOf('function _paseCtaHTML(');
  const cta = html.slice(iCta, iCta + 1600);
  assert(!cta.includes('\\${'), 'el helper de la tarjeta no puede llevar marcadores escapados');
  const css = read('styles.css');
  assert(/\.ri-cta-pase\{/.test(css), 'la tarjeta del Pase necesita su propio estilo');
});

test('Auditoría: al fallar se enseña la jugada que esperaba el inspector', () => {
  // «Reforzar la auditoría» (propietario, sep 2026) = mejor corrección. Antes
  // la nota reprochaba sin enseñar: veías QUÉ estándar rompiste pero no QUÉ
  // había que hacer. Ahora, al elegir peor de lo que podías, se muestra la
  // opción que el inspector esperaba, su consecuencia y los estándares TUYOS
  // que arregla. Todo del dato: 95 de las 96 escenas tienen exactamente una
  // opción que cumple todos sus estándares y las 288 traen feedback bilingüe.
  assert(html.includes('function _ghostEsperada('), 'falta el selector de la jugada esperada');
  assert(html.includes('function _ghostEsperadaHTML('), 'falta el bloque de corrección');
  assert(html.includes('${_ghostEsperadaHTML(sc, opt)}'), 'la nota del inspector debe pintarlo');
  // No se redacta ningún juicio aquí: sale de label/feedback/effects del dato.
  const fn = html.slice(html.indexOf('function _ghostEsperadaHTML('), html.indexOf('function ghostChoose('));
  assert(/esperada\.label_en:esperada\.label/.test(fn) && /esperada\.feedback_en:esperada\.feedback/.test(fn),
    'la jugada y su consecuencia salen del escenario, no se escriben en el código');
  assert(/rotos\.has\(e\.std\)/.test(fn),
    'solo se listan los estándares que TÚ rompiste y esa jugada arregla');

  // Y el barrido de verdad, sobre las 96 escenas: eligiendo siempre la peor
  // opción, todas tienen una jugada mejor que enseñar y ninguna se enseña a
  // sí misma.
  const G = JSON.parse(read('data/ghost-scenarios.json'));
  const esc = (Array.isArray(G) ? G : Object.values(G)).flatMap(s => (s.scenes || []).map(sc => ({ id: s.id, sc })));
  const M = new Function(html.slice(html.indexOf('function _ghostEsperada('), html.indexOf('function _ghostEsperadaHTML(')) // eslint-disable-line no-new-func
    + '; return _ghostEsperada;')();
  const nota = o => (o.effects || []).filter(e => e.met).length - (o.effects || []).filter(e => !e.met).length;
  const sin = [];
  for (const { id, sc } of esc) {
    const peor = [...sc.options].sort((a, b) => nota(a) - nota(b))[0];
    const esperada = M(sc, peor);
    if (!esperada) sin.push(`${id} «${sc.title}» no tiene jugada que enseñar`);
    else if (esperada === peor) sin.push(`${id} «${sc.title}» se enseña a sí misma`);
    else if (nota(esperada) <= nota(peor)) sin.push(`${id} «${sc.title}» enseña una jugada que no es mejor`);
  }
  assert(esc.length >= 90, `esperaba ~96 escenas, hay ${esc.length}`);
  assert(sin.length === 0, `escenas sin corrección útil: ${sin.slice(0, 5).join(' · ')}`);
  // Y al revés, que es donde se cuela el error de verdad: si aciertas con la
  // MEJOR opción no puede ofrecerse ninguna \"jugada esperada\", porque sería
  // enseñar como modelo algo peor que lo que hiciste.
  const sobran = [];
  for (const { id, sc } of esc) {
    const mejor = [...sc.options].sort((a, b) => nota(b) - nota(a))[0];
    if (M(sc, mejor)) sobran.push(`${id} «${sc.title}»`);
  }
  assert(sobran.length === 0,
    `acertando la mejor opción no debe enseñarse otra jugada: ${sobran.slice(0, 5).join(' · ')}`);
});

test('Auditoría: la sección y el ejercicio no se llaman igual', () => {
  // La pestaña ya se llamaba Auditoría; al renombrar la Inspección Fantasma
  // quedaban las dos con el mismo nombre, una dentro de la otra. El ejercicio
  // pasa a «Auditoría completa» y la sección se queda como estaba.
  assert(/navProtocolo: LANG==='en'\?'Audit':'Auditoría',/.test(html),
    'la pestaña sigue llamándose Auditoría');
  assert(html.includes(`'Full audit':'Auditoría completa'`) || html.includes(`'Full audit':'Auditor\\u00eda completa'`),
    'el ejercicio debe llamarse Auditoría completa');
  const banner = html.slice(html.indexOf('hub-banner-title'), html.indexOf('hub-banner-title') + 120);
  assert(/Full audit/.test(banner), 'el banner del hub es el del ejercicio, no el de la sección');
});

test('la Inspección Fantasma se llama Auditoría (sep 2026)', () => {
  // El propietario cambió el nombre: «Fantasma» era jerga interna y lo que el
  // ejercicio simula es exactamente una auditoría — 22 escenarios de 4-5
  // escenas bajo la mirada de un inspector.
  for (const viejo of ['Ghost Inspection', 'Inspección Fantasma', 'Inspecci\\u00f3n Fantasma'])
    assert(!html.includes(viejo), `«${viejo}» debe llamarse Auditoría`);
  assert(html.includes("'Audit':'Auditoría'") || html.includes("'Audit':'Auditor\\u00eda'"),
    'el nombre nuevo tiene que estar en los dos idiomas');
  // Ni en los rótulos cortos de las fichas de estadística ni en la leyenda.
  assert(!/'Ghost':'Fantasma'/.test(html), 'los rótulos de estadística siguen diciendo Fantasma');
  assert(!/F=Fantasma|F=Ghost/.test(html), 'la leyenda de iniciales sigue con la F de Fantasma');
  // El Servicio Fantasma es OTRA cosa —retirada por inactividad— y no se toca:
  // renombrarlo aquí habría mezclado dos funciones distintas.
  assert(html.includes('launchServicioFantasma'),
    'el Servicio Fantasma (otra función, ya retirada) no entra en este renombrado');
});

test('Pase: la corrección no repite lo que las fichas ya dicen con su color', () => {
  // «La corrección debe verse clara y fácil de entender» (propietario, sep
  // 2026). Antes listaba FALTABA / NO LLEVA / METISTE con los nombres
  // completos: tres párrafos que repetían lo que las fichas de abajo ya
  // enseñan pintadas. Ahora arriba va sólo lo que las fichas NO pueden decir
  // —el cuadro de alérgenos, que es lo que decide si alguien corría riesgo—,
  // un recuento que manda a mirarlas y la leyenda de los colores.
  const v = html.slice(html.indexOf('  // ── La comanda que vuelve de cocina'), html.indexOf('function _paseRailHTML('));
  assert(!/V\.faltan\.map\(f=>f\.t\)/.test(v) && !/V\.sobran\.map\(f=>f\.t\)/.test(v),
    'la corrección no puede volver a listar los nombres: para eso están las fichas pintadas');
  assert(/pase-tally/.test(v), 'debe haber un recuento compacto de lo que faltó y lo que sobró');
  assert(/pase-leyenda/.test(v), 'los colores de las fichas necesitan su leyenda');
  assert(/metidos/.test(v) && /dejados/.test(v),
    'el cuadro de alérgenos sí se detalla: es lo único que las fichas no enseñan');
  const css = read('styles.css');
  assert(/\.pase-tally\{/.test(css) && /\.pase-leyenda\{/.test(css), 'faltan sus estilos');
});

test('Pase: el resultado alimenta el SRS y las notas del supervisor', () => {
  // «Que se recopile la información de los resultados en el panel de
  // supervisor» y «el juego debería insistir en los platos que más fallas».
  // Las dos cosas se apoyan en lo que la app ya tenía: el SM-2 por plato
  // (emp.srs) que usan el Viaje y el Repaso Inteligente.
  assert(html.includes('function _paseRegistrar('), 'falta el registro del resultado');
  const reg = html.slice(html.indexOf('function _paseRegistrar('), html.indexOf('function _paseHoy('));
  assert(/_srsUpdate\(emp, dish\.id, q\)/.test(reg), 'el resultado debe entrar en el SRS de la app');
  assert(/V\.perfecto \? 5 : V\.seguro \? 3 : 1/.test(reg),
    'perfecto=5, seguro=3, fallo=1 en la escala SM-2');
  assert(/m\.fallos\[dish\.id\]/.test(reg), 'hay que anotar QUÉ plato se falla, no sólo cuántos');
  assert(/_paseRegistrar\(dish, _paseState\.veredicto\)/.test(html), 'servir el pase debe registrarlo');
  // La ponderación: insiste, pero no bloquea.
  const peso = html.slice(html.indexOf('function _pasePeso('), html.indexOf('function _paseElegir('));
  assert(/if\(fall\) return 6\+Math\.min\(fall,4\)/.test(peso), 'lo fallado pesa más');
  assert(/return 4;/.test(peso) && /return 2;/.test(peso) && /return 1;/.test(peso),
    'vencido en el SRS > nunca jugado > dominado, pero ninguno queda excluido');
  assert(/function _paseElegir\(jugables, emp\)/.test(html) && /r-=pesos\[i\]/.test(html),
    'el sorteo debe ser ponderado, no un filtro');
  // Y viaja a la nube para que el supervisor lo vea de todo el equipo.
  assert(/ps: emp\.paseStats\|\|0,/.test(html), 'las notas del Pase deben subir en extras');
  assert(/const m=emp\.paseStats=emp\.paseStats\|\|\{n:0,perf:0,seg:0,mal:0,fallos:\{\}\};/.test(html),
    'y bajar de la nube fusionadas al máximo');
});

test('Pase: el supervisor ve quién acierta, quién falla y en qué platos', () => {
  const sup = html.slice(html.indexOf('  // ── PASE DE COCINA: quién acierta'), html.indexOf('  // ── DÓNDE FALLA EL EQUIPO'));
  assert(sup.length > 500, 'falta la sección del Pase en el panel');
  assert(/_psSeguro/.test(sup) && /_psPerf/.test(sup),
    'manda el % de pases seguros en alérgenos; los perfectos van detrás');
  assert(/_psRows/.test(sup), 'tiene que verse empleado por empleado');
  assert(/Most failed dishes|Platos que más se fallan/.test(sup),
    'y los platos que más falla el equipo, que es donde hay que insistir');
  assert(/_acc\('pase'/.test(html), 'la sección necesita su acordeón en el panel');
});

test('Pase: la piscina es lo que lleva alérgeno MÁS lo que se ve en el plato', () => {
  // Dos correcciones seguidas del propietario, y el punto medio es este.
  // Primero (sep 2026): «lo encuentro complicado para camareros que no son
  // cocineros; ¿dónde va la vainilla?, ¿dónde va la canela?» — montar el plato
  // entero era un ejercicio de cocina, así que la piscina se redujo a
  // DISH_COMPONENTS. Después, jugándolo: «en el pase a veces faltan
  // ingredientes importantes, como en la focaccia las verduras y en el arroz
  // negro los txipirones» y «hay que añadir los ingredientes que están a la
  // vista» — con sólo los componentes se enseñaba el 42% de la carta (415 de
  // 992 ingredientes) y la focaccia nunca enseñaba su berenjena.
  //
  // El corte es la estructura de la ficha: lo de nivel superior va montado en el
  // plato; lo que cuelga de un rótulo —«Focaccia: Harina, Levadura»— está DENTRO
  // de una preparación y no se ve. Los sazonadores y los aditivos técnicos no
  // entran por ninguna vía.
  assert(html.includes('function _paseComponentes('), 'falta el constructor de la piscina');
  const comp = html.slice(html.indexOf('function _paseComponentes('), html.indexOf('function _paseVisibles('));
  assert(/DISH_COMPONENTS\[dish\.id\]/.test(comp), 'los alérgenos siguen saliendo del dato que cocina valida');
  assert(/dec\.has\(a\)/.test(comp),
    'nunca se enseña un alérgeno que el plato no declare: la ficha, el buscador y el juego dicen lo mismo');
  const vis = html.slice(html.indexOf('function _paseVisibles('), html.indexOf('function _paseMismoPrefijo('));
  assert(/_paseRotulos\(dish, _en\)/.test(vis) && /if\(hijos\.has\(_djClave\(it\.t\)\)\) continue;/.test(vis),
    'lo que cuelga de un rótulo está dentro de una preparación y no se ve');
  // Los rótulos se leen de la ficha ESPAÑOLA y se traducen nombre a nombre, igual
  // que _djIngredients. Leerlos con getDish() era el fallo: en inglés devuelve la
  // ficha de DISHES_EN entera, los rótulos salían en otro idioma que los
  // ingredientes y no casaba ni uno. Comprobado en el navegador con LANG='en':
  // el arroz negro ofrecía «Zanahoria», «Puerro» y «Cebolla blanca» como si
  // fueran del plato, cuando van dentro del bisque y no se ven.
  const rot = html.slice(html.indexOf('function _paseRotulos('), html.indexOf('function _pasePlegar('));
  assert(/String\(dish\.ingredients\|\|''\)/.test(rot), 'los rótulos salen de la ficha española');
  assert(!/getDish/.test(rot), 'getDish devuelve la ficha del otro idioma entera: aquí no vale');
  assert(/_djClave\(_djIngName\(m\[1\], _en\)\)/.test(rot), 'y cada nombre se traduce igual que en _djIngredients');
  assert(/_pasePlegar\(dish, items, _en\)/.test(html) || /function _pasePlegar\(dish, items, _en\)/.test(html),
    '_pasePlegar necesita el idioma: arrastraba el mismo fallo desde que existe');
  assert(/a:\(it\.a\|\|\[\]\)\.filter\(a=>dec\.has\(a\)\)/.test(vis),
    'tampoco por esta vía puede aparecer un alérgeno que el plato no declara');
  const fich = html.slice(html.indexOf('function _paseFichas('), html.indexOf('function _paseSenuelos('));
  assert(/_paseComponentes\(dish,_en\)/.test(fich) && /_paseVisibles\(dish,_en\)/.test(fich),
    'la piscina real es la unión de las dos');
  assert(/_paseMismoPrefijo\(c\.t, x\.t\)/.test(fich),
    '«Bisque» y «Bisque Caldo de Langostino» son lo mismo y no pueden salir las dos');
  assert(/!_paseEsSazonador\(it\)/.test(fich), 'la sal y los aditivos técnicos no entran');
  // Los señuelos salen de la MISMA fuente. Si siguieran saliendo sólo de los
  // componentes, todos llevarían insignia de alérgeno y muchas fichas correctas
  // no: «sin insignia = es del plato» resolvería la fase 1 sin saber nada.
  const sen = html.slice(html.indexOf('function _paseSenuelos('), html.indexOf('const _PASE_TOPE'));
  assert(/_paseFichas\(o,_en\)/.test(sen), 'los señuelos salen de las fichas de OTROS platos, no sólo de sus componentes');
  assert(/o\.cat!==dish\.cat/.test(sen), 'de la MISMA categoría: un brócoli en un postre se descarta por absurdo');
  assert(/_djSameThing\(m, it\.t\)/.test(sen), 'y no puede colarse como señuelo algo que el plato sí lleva');
});

test('Pase: los ingredientes que el propietario echó en falta están en la piscina', () => {
  // Los tres casos que él nombró jugando, clavados sobre el dato real. No es
  // una comprobación de que la regla existe: es la lista concreta que faltaba.
  //   «en la focaccia las verduras y en el arroz negro los txipirones»
  //   «falta carne de wagyu madurada, cebolleta, cebollino, Tabasco y huevo
  //    (yema de huevo), crujiente de papa y trufa negra»
  const cut = (ini, fin) => { const i = html.indexOf(ini); return html.slice(i, html.indexOf(fin, i) + fin.length); };
  const fn = n => { const i = html.indexOf('function ' + n + '('); let d = 0;
    for (let k = html.indexOf('{', i); k < html.length; k++) {
      if (html[k] === '{') d++; else if (html[k] === '}') { d--; if (!d) return html.slice(i, k + 1); } } };
  // _djIngBase hace falta aunque no se cargue: _djIngredients lo referencia y sin
  // él lanza, y _paseVisibles se come la excepción y devuelve la piscina vieja.
  const src = `var LANG='es', _djIngBase=null; function getDish(d){return d;} function _djIngName(n){return n;}
    const _DJ_SECCION = ${/^(masa|topping|base|relleno|guarnicion|sabores disponibles|salsa base|sazonador|marinada|elaboracion)$/};`
    + cut('const DISHES = [', '\n];') + cut('const DISH_COMPONENTS = ', '};')
    + html.slice(html.indexOf('const _djNorm ='), html.indexOf('async function _djLoadIngBase'))
    + fn('_djTrozos') + fn('_djSplitIngredients') + fn('_djSameThing') + fn('_djIngredients')
    + html.slice(html.indexOf('const _PASE_SAZONADOR'), html.indexOf('function _paseSenuelos('))
    + `
    const pide = {
      88: ['Berenjena','Calabacín','Espinaca aliñada'],
      92: ['Calamar','Arroz bomba'],
      18: ['Carne de Wagyu madurada dry','Cebolleta','Cebollino','Tabasco','Huevo','Crujiente de papa','Trufa negra'],
    };
    const faltan=[], vacios=[], repes=[];
    for(const d of DISHES){
      const F=_paseFichas(d,false), et=F.map(x=>_djNorm(x.t));
      if(!F.length) vacios.push(d.id);
      if(new Set(et).size!==et.length) repes.push(d.id);
      for(const q of (pide[d.id]||[])) if(!et.includes(_djNorm(q))) faltan.push(d.id+':'+q);
      // Ni sal ni aditivos técnicos por ninguna de las dos vías.
      for(const mal of ['sal','pimienta','levadura','gelatinas','xantana','laurel'])
        if(et.includes(mal)) faltan.push(d.id+':sobra «'+mal+'»');
    }
    return {faltan, vacios, repes};`;
  const R = new Function(src)(); // eslint-disable-line no-new-func
  assert(R.faltan.length === 0, `la piscina no cuadra: ${R.faltan.slice(0, 8).join(', ')}`);
  assert(R.vacios.length === 0, `platos con la piscina vacía: ${R.vacios.join(', ')}`);
  assert(R.repes.length === 0, `la ficha y el componente salen dos veces en: ${R.repes.join(', ')}`);
});

test('Pase: se juegan los 98 platos y ninguno se queda sin fichas', () => {
  // Petición del propietario: que sigan los 98. Mientras la piscina salía sólo
  // de los componentes alergénicos había 14 platos que no declaran ninguno, y
  // para ésos existía el botón «No lleva ninguno»: acertar era no señalar nada.
  // Con los ingredientes que se ven ya no hay ni un plato con la piscina vacía
  // —medido sobre los 97 jugables—, así que ese botón pasó a ser una respuesta
  // siempre falsa y se quitó. El barrido funcional de más abajo comprueba que
  // sigue sin haber ninguno; si algún día lo hubiera, hay que devolverlo.
  const arm = html.slice(html.indexOf('function _paseArmar(){'), html.indexOf('function _paseKeydown('));
  assert(/reales\.length\s*\n?\s*\? Math\.min\(5/.test(arm), 'un plato sin componentes también arma piscina');
  assert(/function _paseServir\(ninguno\)/.test(html), 'servir conserva el enganche por si volviera a hacer falta');
  assert(/if\(ninguno\) _paseState\.sel=new Set\(\);/.test(html),
    '«no lleva ninguno» es responder con la selección vacía');
  assert(!/onclick="_paseServir\(true\)"/.test(html),
    'el botón «No lleva ninguno» ya no puede acertar nunca: es una trampa');
  // Jugables: todos los que su categoría pueda surtir de señuelos.
  const jug = html.slice(html.indexOf('function _paseJugables(){'), html.indexOf('function _pasePeso('));
  assert(/\.length >= 3/.test(jug), 'sólo se exige que haya al menos tres señuelos entre los que elegir');
  assert(!/_djIngredients\(d,false\)\.length>=4/.test(jug),
    'ya no se exige tener 4 ingredientes: eso era del ejercicio de montaje');
});

test('Pase: la respuesta correcta gana en todos los platos jugables', () => {
  // Barrido funcional sobre el dato real: señalar EXACTAMENTE los componentes
  // del plato (o ninguno, si no tiene) tiene que dar pase perfecto y un cuadro
  // de alérgenos idéntico al declarado en la ficha.
  const cut = (ini, fin) => { const i = html.indexOf(ini); return html.slice(i, html.indexOf(fin, i) + fin.length); };
  const fn = n => { const i = html.indexOf('function ' + n + '('); let d = 0;
    for (let k = html.indexOf('{', i); k < html.length; k++) {
      if (html[k] === '{') d++; else if (html[k] === '}') { d--; if (!d) return html.slice(i, k + 1); } } };
  const stub = `
    var LANG='es', _studyShift=null, _paseState=null, _paseVistos=[], _djIngBase=null;
    function getDish(d){return d;} function allergenLocal(a){return a;} function getEmp(){return null;}
    function catLocal(c){return c;} function escapeHTML(s){return String(s);} function saveDB(){}
    function _shiftDishes(a){return a;} function _paseRegistrar(){} function _paseRender(){} function playSound(){}
    const _DJ_SECCION = ${/^(masa|topping|base|relleno|guarnicion|sabores disponibles|salsa base|sazonador|marinada|elaboracion)$/};
    var document={getElementById:()=>null,createElement:()=>({setAttribute(){},style:{},querySelector:()=>null,querySelectorAll:()=>[]}),
      body:{appendChild(){}},addEventListener(){},removeEventListener(){}};
  `;
  const src = stub
    + cut('const DISHES = [', '\n];')
    + cut('const DISH_COMPONENTS = ', '};')
    + html.slice(html.indexOf('const _djNorm ='), html.indexOf('async function _djLoadIngBase'))
    + fn('_djTrozos') + fn('_djSplitIngredients') + fn('_djSameThing') + fn('_djIngName') + fn('_djIngredients')
    + fn('_lqaShuffle')
    + html.slice(html.indexOf('const _PASE_SAZONADOR'), html.indexOf('function _paseRecortar('))
    + fn('_paseRecortar') + fn('_pasePlegar') + fn('_paseFusionar') + fn('_paseComponentes')
    + fn('_paseVisibles') + fn('_paseMismoPrefijo') + fn('_paseFichas') + fn('_paseSenuelos') + fn('_paseArmar')
    + fn('_paseJugables') + fn('_paseAlergenosMontados') + fn('_paseServir')
    + `
    let ok=0, malos=[], dup=[], pocos=[], sinAl=0, delata=[];
    for(const d of _paseJugables()){
      _paseState={dishId:d.id, fase:'montaje', sel:new Set(), piscina:null, veredicto:null};
      _paseArmar();
      const P=_paseState.piscina;
      const reales=P.filter(i=>!i.falso), falsos=P.filter(i=>i.falso);
      if(!reales.length) sinAl++;
      const et=P.map(i=>_djNorm(i.t));
      if(new Set(et).size!==et.length) dup.push(d.id);
      if(falsos.length<3) pocos.push(d.id);
      // La insignia de alérgeno no puede separar las correctas de los señuelos.
      // Antes todas las correctas Y todos los señuelos llevaban insignia, así
      // que no delataba; desde que entran los ingredientes que sólo se ven, si
      // los señuelos siguieran saliendo sólo de los componentes se resolvería
      // con «sin insignia = es del plato». Se mide en 20 rondas por plato.
      let sep=0;
      for(let k=0;k<20;k++){
        _paseState={dishId:d.id, fase:'montaje', sel:new Set(), piscina:null, veredicto:null};
        _paseArmar();
        const Q=_paseState.piscina;
        const r=Q.filter(i=>!i.falso), f=Q.filter(i=>i.falso);
        const rA=r.filter(i=>(i.a||[]).length).length, fA=f.filter(i=>(i.a||[]).length).length;
        if(r.length&&f.length&&((rA===r.length&&fA===0)||(rA===0&&fA===f.length))) sep++;
      }
      if(sep>15) delata.push(d.id+':'+sep+'/20');
      _paseState={dishId:d.id, fase:'montaje', sel:new Set(), piscina:null, veredicto:null};
      _paseState.piscina=P;
      P.forEach((it,i)=>{ if(!it.falso) _paseState.sel.add(i); });
      _paseServir();
      const V=_paseState.veredicto;
      const dec=(d.allergens||[]).slice().sort().join('|');
      const mon=V.montados.slice().sort().join('|');
      if(V.perfecto && dec===mon) ok++;
      else malos.push(d.id+':'+(V.perfecto?'alérgenos «'+mon+'»≠«'+dec+'»':'montaje'));
    }
    return {ok, malos, dup, pocos, sinAl, delata, n:_paseJugables().length};
  `;
  const R = new Function(src)(); // eslint-disable-line no-new-func
  assert(R.n >= 90, `esperaba jugar casi los 98 platos, hay ${R.n}`);
  assert(R.malos.length === 0, `la respuesta correcta NO gana en: ${R.malos.slice(0,6).join(', ')}`);
  assert(R.ok === R.n, `ganan ${R.ok} de ${R.n}`);
  assert(R.dup.length === 0, `piscina con fichas repetidas: ${R.dup.join(', ')}`);
  assert(R.pocos.length === 0, `menos de 3 señuelos en: ${R.pocos.join(', ')}`);
  assert(R.sinAl === 0,
    `${R.sinAl} platos se quedan con la piscina vacía y ya no hay botón para responder «no lleva ninguno»`);
  // El umbral es 16 de 20, y sale de medir, no de elegirlo a ojo:
  //   · con los señuelos saliendo de _paseFichas (como está), el peor plato
  //     —Lomo bajo de Simmental— separa en el 30% de las rondas por puro azar,
  //     porque tiene pocas fichas. Medido sobre 600 rondas por plato.
  //   · volviendo a sacarlos sólo de _paseComponentes —la regresión que este
  //     guard existe para cazar— hay 14 platos que separan el 100% de las veces.
  // Entre 30% y 100% hay sitio de sobra. El umbral anterior estaba en 11 de 20
  // y hacía fallar el CI sin que nada estuviera roto el 2% de las tiradas: pasó
  // una vez en pleno trabajo. Con 16 la probabilidad baja a 6 de cada millón.
  assert(R.delata.length === 0,
    `la insignia de alérgeno delata cuál es el señuelo en: ${R.delata.slice(0,8).join(', ')}`);
});

test('Pase: la fase de la alergia no lleva la respuesta escrita en las fichas', () => {
  // El propietario, jugándolo en el móvil: «cuando llega un cliente alérgeno la
  // pantalla te dice la alergia». Y era peor que eso: cada ficha llevaba su
  // alérgeno impreso, así que «retira lo que aporta Sulfitos» se resolvía
  // tocando la que ponía «Sulfitos». Medido: el 100% de las retiradas se
  // acertaba leyendo, sin saber nada del plato.
  // Las insignias se ocultan mientras se responde y aparecen al corregir, que
  // es cuando enseñan algo.
  const chip = html.slice(html.indexOf('function _paseChip('), html.indexOf('function _paseRender('));
  assert(/ocultarAl/.test(chip), '_paseChip debe poder pintar la ficha sin su insignia');
  assert(/const al=ocultarAl \? '' :/.test(chip), 'ocultarAl tiene que suprimir la insignia, no atenuarla');
  const des = html.slice(html.indexOf('function _paseDesmontajeHTML('), html.indexOf('function renderRepaso('));
  const sinResolver = des.slice(0, des.indexOf('const chips=S.plato.map'));
  assert(/_paseToggleQuitar\(\$\{i\}\)`,'',true\)/.test(sinResolver),
    'mientras se responde la fase 2, las fichas van SIN insignia');
  // y al corregir sí se ven
  assert(/_paseChip\(it,i,on,'void 0',cls\)/.test(des),
    'al corregir la fase 2 las insignias vuelven, que es cuando enseñan');
});

test('Pase: la corrección no promete más de lo que ha preguntado', () => {
  // El propietario, jugando el Tartar de Wagyu dry: «falta carne de wagyu
  // madurada, cebolleta, cebollino, Tabasco, crujiente de papa y trufa negra».
  // Comprobado en la base: ninguno de esos aporta alérgeno, así que es correcto
  // que no entren en el juego — pero la corrección decía «Todos los ingredientes
  // bien», que promete el plato ENTERO. El fallo era del texto, y encima la
  // pantalla dejaba la impresión de que el plato es sólo esas fichas.
  const des = html.slice(html.indexOf('function _paseDesmontajeHTML('), html.indexOf('function renderRepaso('));
  const mon = html.slice(html.indexOf('function _paseMontajeHTML('), html.indexOf('function _paseRailHTML('));
  assert(!/[Tt]odos los ingredientes bien|[Ee]very ingredient right/.test(mon),
    'la corrección no puede decir «todos los ingredientes»: sólo se pregunta por los que aportan alérgeno');
  assert(!/Fallaste el montaje|You missed the plating/.test(mon),
    'vuelve el vocabulario del ejercicio de montaje, que se retiró');
  // Y se nombra lo que el plato lleva y NO entró en juego, para que nadie salga
  // pensando que el plato son cuatro fichas.
  assert(/const _resto = \(function\(\)\{/.test(mon), 'falta la línea que nombra el resto del plato');
  assert(/ninguno aporta alérgeno/.test(mon) && /none of these carries an allergen/.test(mon),
    'esa línea tiene que decir por qué no entraron, en los dos idiomas');
  assert(/\$\{_resto\}/.test(mon), 'y tiene que pintarse en el veredicto');
  // Barrido funcional: en los 98 platos, lo que se nombra como «también lleva»
  // no puede contener nada que sí aporte alérgeno — sería decir una falsedad
  // sobre seguridad alimentaria.
  const cut = (ini, fin) => { const i = html.indexOf(ini); return html.slice(i, html.indexOf(fin, i) + fin.length); };
  const fn = n => { const i = html.indexOf('function ' + n + '('); let d = 0;
    for (let k = html.indexOf('{', i); k < html.length; k++) {
      if (html[k] === '{') d++; else if (html[k] === '}') { d--; if (!d) return html.slice(i, k + 1); } } };
  const src = `var LANG='es', _djIngBase=null;
    function getDish(d){return d;}function _djIngName(n){return n;}
    const _DJ_SECCION = /^(masa|topping|base|relleno|guarnicion|sabores disponibles|salsa base|sazonador|marinada|elaboracion)$/;`
    + cut('const DISHES = [', '\n];') + cut('const DISH_COMPONENTS = ', '};')
    + html.slice(html.indexOf('const _djNorm ='), html.indexOf('async function _djLoadIngBase'))
    + fn('_djTrozos') + fn('_djSplitIngredients') + fn('_djSameThing') + fn('_djIngredients') + fn('_lqaShuffle')
    + html.slice(html.indexOf('const _PASE_SAZONADOR'), html.indexOf('function _paseRecortar('))
    + fn('_paseComponentes')
    + `
    const malos=[], vistos=[];
    for(const d of DISHES){
      const dentro=new Set(_paseComponentes(d,false).map(c=>_djClave(c.t)));
      for(const it of _djIngredients(d,false)){
        if(dentro.has(_djClave(it.t)) || _paseEsSazonador(it)) continue;
        // Estos son el peligro: la ficha los nombra, su nombre NO casa con
        // ningún componente, y sin embargo aportan alérgeno. Si el filtro del
        // código sólo mirase la coincidencia con los componentes, saldrían
        // anunciados como «no aporta alérgeno».
        if((it.a||[]).length) malos.push(d.name+' → «'+it.t+'» ('+it.a.join(',')+')');
        else vistos.push(d.name+':'+it.t);
      }
    }
    return {malos, n:vistos.length};`;
  const R = new Function(src)(); // eslint-disable-line no-new-func
  assert(R.n > 200, `esperaba cientos de ingredientes sin alérgeno que nombrar, hay ${R.n}`);
  // El barrido demuestra que el peligro EXISTE en el dato real: hay fichas que
  // nombran compuestos («Alioli cítrico y alioli de tinta de calamar: Huevo»)
  // que aportan alérgeno sin casar con ningún componente. Por eso el filtro del
  // código tiene que mirar lo que el ingrediente APORTA, no sólo si coincide.
  assert(R.malos.length > 0,
    'ya no hay compuestos con alérgeno fuera de los componentes: revisa si este guard sigue teniendo sentido');
  const resto = mon.slice(mon.indexOf('const _resto = '), mon.indexOf('const puedeSeguir'));
  assert(/\(it\.a\|\|\[\]\)\.length/.test(resto),
    `el filtro debe mirar lo que el ingrediente APORTA, o se anunciarían como inocuos: ${R.malos.slice(0,3).join(' | ')}`);
  // Y no puede repetir: un plato nombra el mismo ingrediente en dos
  // elaboraciones —el ajo y el limón de los dos aliolis de los Calamares— y
  // salían dos veces en la misma línea.
  assert(/visto\.has\(k\)/.test(resto), 'la línea no puede repetir el mismo ingrediente');
  // Ni listar la preparación y su contenido a la vez, como hacía con
  // «Batata confitada en almíbar · Batata» en la tabla de quesos.
  assert(/_pasePlegar\(dish, _djIngredients\(dish,_en\)\)/.test(resto),
    'la línea tiene que plegar las preparaciones igual que la piscina');
});

test('Pase: un botón desactivado tiene que parecerlo', () => {
  // Reportado en el móvil: «el botón no se puede retirar no funciona». Y no era
  // que no funcionara: está desactivado a propósito hasta que se señala qué
  // aporta el alérgeno. El fallo era de estilo — .pase-serve tenía su regla
  // :disabled y .pase-retry no, así que el dorado se veía apagado y el blanco
  // idéntico a uno activo. Parecía que debía funcionar y no hacía nada.
  const css = read('styles.css');
  // Todo botón del Pase al que el marcado pueda ponerle `disabled` necesita su
  // regla, o volvemos al mismo sitio.
  for (const clase of ['pase-serve', 'pase-retry']) {
    const puedeApagarse = new RegExp('class="' + clase + '"[^>]*\\$\\{[^}]*disabled').test(html);
    if (!puedeApagarse) continue;
    assert(new RegExp('\\.' + clase + ':disabled\\{[^}]*opacity').test(css),
      `.${clase} puede quedar desactivado y no tiene regla :disabled: se ve igual que uno activo`);
    assert(new RegExp('\\.' + clase + ':disabled\\{[^}]*cursor:not-allowed').test(css),
      `.${clase}:disabled debe decir que no se puede pulsar`);
  }
  // Y el :hover no puede seguir respondiendo a un botón apagado.
  assert(/\.pase-retry:hover:not\(:disabled\)/.test(css),
    'el hover de .pase-retry tiene que excluir el estado desactivado');
});

test('Pase: la fase 2 no se aprueba pulsando siempre «no se puede retirar»', () => {
  // Barrido funcional sobre el dato real, no sobre el texto del código: se
  // juega la fase 2 de todos los platos con las dos estrategias ciegas y se
  // comprueba que ninguna gana. Antes, «no se puede» a ciegas acertaba el
  // 74,3% de 5.150 partidas simuladas.
  const cut = (ini, fin) => { const i = html.indexOf(ini); return html.slice(i, html.indexOf(fin, i) + fin.length); };
  const fn = n => { const i = html.indexOf('function ' + n + '('); let d = 0;
    for (let k = html.indexOf('{', i); k < html.length; k++) {
      if (html[k] === '{') d++; else if (html[k] === '}') { d--; if (!d) return html.slice(i, k + 1); } } };
  const stub = `
    var LANG='es', _studyShift=null, _paseState=null, _paseVistos=[], _djIngBase=null;
    var _paseRacha={n:0,perf:0}, currentUser=null;
    function getDish(d){return d;} function allergenLocal(a){return a;} function getEmp(){return null;}
    function catLocal(c){return c;} function escapeHTML(s){return String(s);} function saveDB(){}
    function _shiftDishes(a){return a;} function _paseRegistrar(){} function _paseRender(){}
    function _paseClose(){} function playSound(){} function _paseRegistrarAlergia(){}
    var document={getElementById:()=>null,createElement:()=>({setAttribute(){},style:{},querySelector:()=>null,querySelectorAll:()=>[]}),
      body:{appendChild(){}},addEventListener(){},removeEventListener(){}};
  `;
  const src = stub
    + cut('const DISHES = [', '\n];') + cut('const DISH_COMPONENTS = ', '};') + cut('const DISH_ACTIONS = ', '};')
    + html.slice(html.indexOf('const _djNorm ='), html.indexOf('async function _djLoadIngBase'))
    + fn('_djTrozos') + fn('_djSplitIngredients') + fn('_djSameThing') + fn('_djIngName') + fn('_lqaShuffle')
    + html.slice(html.indexOf('const _PASE_SAZONADOR'), html.indexOf('function _paseRecortar('))
    + fn('_paseRecortar') + fn('_pasePlegar') + fn('_paseFusionar') + fn('_paseComponentes') + fn('_paseSenuelos') + fn('_paseArmar')
    + fn('_paseJugables') + fn('_paseAlergiasPosibles') + fn('_paseIrDesmontaje') + fn('_paseConfirmarRetirada')
    + `
    let n=0, ciegoNo=0, ciegoSi=0, sabiendo=0, sinPortador=[];
    for(const d of _paseJugables()){
      if(!_paseAlergiasPosibles(d).length) continue;
      for(let rep=0; rep<6; rep++){
        _paseState={dishId:d.id, fase:'montaje', sel:new Set(), piscina:null, veredicto:null,
                    alergia:null, quitar:new Set(), resuelto:null};
        _paseArmar(); _paseIrDesmontaje();
        const A=_paseState.alergia;
        const portan=_paseState.plato.map((it,i)=>i).filter(i=>(_paseState.plato[i].a||[]).includes(A));
        if(!portan.length){ sinPortador.push(d.id+':'+A); continue; }
        n++;
        // ciego 1 · pulsar «no se puede» sin señalar nada
        _paseState.quitar=new Set(); _paseState.resuelto=null;
        _paseConfirmarRetirada(true); if(_paseState.resuelto.bien) ciegoNo++;
        // ciego 2 · pulsar «sí se puede» sin señalar nada
        _paseState.quitar=new Set(); _paseState.resuelto=null;
        _paseConfirmarRetirada(false); if(_paseState.resuelto.bien) ciegoSi++;
        // sabiendo · señalar los portadores y acertar la retirabilidad
        _paseState.quitar=new Set(portan); _paseState.resuelto=null;
        const ret=(DISH_ACTIONS[d.id][A]||{}).r===1;
        _paseConfirmarRetirada(!ret); if(_paseState.resuelto.bien) sabiendo++;
      }
    }
    return {n, ciegoNo, ciegoSi, sabiendo, sinPortador:[...new Set(sinPortador)]};
  `;
  const R = new Function(src)(); // eslint-disable-line no-new-func
  assert(R.n > 400, `esperaba cientos de casos de fase 2, hay ${R.n}`);
  assert(R.ciegoNo === 0, `«no se puede» a ciegas gana ${R.ciegoNo}/${R.n} = ${(100*R.ciegoNo/R.n).toFixed(1)}%`);
  assert(R.ciegoSi === 0, `«sí se puede» a ciegas gana ${R.ciegoSi}/${R.n}`);
  assert(R.sabiendo === R.n, `quien sabe la respuesta debe ganar siempre: ${R.sabiendo}/${R.n}`);
  // Si algún alérgeno no lo aportara ninguna ficha del plato, exigir el
  // portador dejaría ese caso sin respuesta posible. Medido: no pasa nunca.
  assert(R.sinPortador.length === 0,
    `hay alergias que ninguna ficha del plato aporta: ${R.sinPortador.slice(0,5).join(', ')}`);
});

test('Pase: el andamio se retira — dos pases perfectos y el plato se pide de memoria', () => {
  // Idea del propietario (sep 2026), del método de Duolingo: primero eliges de
  // un banco de opciones, y cuando ya lo llevas te lo piden de memoria. Lo que
  // había era sólo reconocimiento; en sala nadie te da la lista.
  assert(/const _PASE_ASCENSO = 2;/.test(html), 'falta el umbral de ascenso');
  const niv = (() => { const i = html.indexOf('function _paseNivel('); let d = 0;
    for (let k = html.indexOf('{', i); k < html.length; k++) {
      if (html[k] === '{') d++; else if (html[k] === '}') { d--; if (!d) return html.slice(i, k + 1); } } })();
  assert(/r\[dishId\]\|\|0\) >= _PASE_ASCENSO \? 2 : 1/.test(niv), 'el nivel sale de la racha del plato');
  // La racha sube con el pase perfecto y se CORTA al fallar: el plato vuelve al
  // nivel con fichas, que es donde se vuelve a aprender.
  const reg = (() => { const i = html.indexOf('function _paseRegistrar('); let d = 0;
    for (let k = html.indexOf('{', i); k < html.length; k++) {
      if (html[k] === '{') d++; else if (html[k] === '}') { d--; if (!d) return html.slice(i, k + 1); } } })();
  assert(/if\(V\.perfecto\) m\.rachas\[dish\.id\]=\(m\.rachas\[dish\.id\]\|\|0\)\+1;/.test(reg), 'la racha sube al acertar');
  assert(/else m\.rachas\[dish\.id\]=0;/.test(reg), 'y se corta al fallar');
  assert(/const nivel = _paseNivel\(getEmp\(currentUser\), dish\.id\);/.test(html),
    'launchPase decide el nivel antes de armar');
  assert(/fase: nivel===2\?'memoria':'montaje'/.test(html), 'el nivel 2 entra por la fase de memoria');
  // La piscina se arma igual en el nivel 2 aunque no se enseñe, porque la fase
  // de la alergia trabaja sobre ella.
  assert(/const mem=_paseState\.fase==='memoria';/.test(html), '_paseRender tiene que enrutar la fase nueva');
  // Y las rachas viajan a la nube: si no, el nivel se perdería al cambiar de
  // dispositivo y el camarero volvería a las fichas.
  const merge = html.slice(html.indexOf('if(x.ps && typeof x.ps'), html.indexOf('function renderLeaderboard'));
  assert(/m\.rachas\[id\]=Math\.max\(m\.rachas\[id\]\|\|0, v\|\|0\)/.test(merge), 'las rachas deben sincronizarse');
  assert(/'mem','memOk'/.test(merge), 'y los contadores del nivel 2 también');
});

test('Pase de memoria: la respuesta correcta gana en los 98, y no se adivina', () => {
  // Barrido funcional sobre el dato real. Además del acierto, se mide lo que
  // justificó el diseño: ninguna estrategia fija —marcar siempre los alérgenos
  // más comunes de la carta— puede aprobar.
  const cut = (ini, fin) => { const i = html.indexOf(ini); return html.slice(i, html.indexOf(fin, i) + fin.length); };
  const fn = n => { const i = html.indexOf('function ' + n + '('); let d = 0;
    for (let k = html.indexOf('{', i); k < html.length; k++) {
      if (html[k] === '{') d++; else if (html[k] === '}') { d--; if (!d) return html.slice(i, k + 1); } } };
  const src = `
    var LANG='es', _paseState=null, _paseRacha={n:0,perf:0,xp:0}, currentUser=null;
    function getEmp(){return null;} function saveDB(){} function playSound(){}
    function _paseRender(){} function _srsUpdate(){} function awardXP(){}
    function _paseHoy(){return '';}
    `
    + cut('const DISHES = [', '\n];')
    + html.slice(html.indexOf('const _PASE_ALERGENOS'), html.indexOf('function _paseToggleAl('))
    + fn('_paseRegistrar') + fn('_paseServirMemoria')
    + `
    let ok=0, n=0, fuera=[];
    for(const d of DISHES){
      // todo alérgeno declarado tiene que existir en la lista de los 14, o el
      // plato sería irresoluble de memoria
      for(const a of d.allergens||[]) if(!_PASE_ALERGENOS.includes(a)) fuera.push(d.id+':'+a);
      _paseState={dishId:d.id, nivel:2, fase:'memoria', sel:new Set(), veredicto:null};
      _PASE_ALERGENOS.forEach((a,i)=>{ if((d.allergens||[]).includes(a)) _paseState.sel.add(i); });
      _paseServirMemoria();
      n++; if(_paseState.veredicto.perfecto) ok++;
    }
    // estrategias ciegas: marcar siempre los N alérgenos más frecuentes
    const cuenta={};
    for(const d of DISHES) for(const a of d.allergens||[]) cuenta[a]=(cuenta[a]||0)+1;
    const orden=Object.entries(cuenta).sort((a,b)=>b[1]-a[1]).map(x=>x[0]);
    let mejorCiego=0;
    for(let N=0;N<=6;N++){
      const fijo=orden.slice(0,N);
      let g=0;
      for(const d of DISHES){
        const dec=(d.allergens||[]).slice().sort().join('|');
        if(dec===fijo.slice().sort().join('|')) g++;
      }
      if(g>mejorCiego) mejorCiego=g;
    }
    return {ok, n, fuera:[...new Set(fuera)], mejorCiego};
  `;
  const R = new Function(src)(); // eslint-disable-line no-new-func
  assert(R.fuera.length === 0,
    `hay alérgenos declarados que no están entre los 14 de la lista: ${R.fuera.join(', ')}`);
  assert(R.ok === R.n, `de memoria, la respuesta correcta gana en ${R.ok} de ${R.n}`);
  // Medido al diseñarlo: la mejor estrategia fija acierta 14/98 (marcar nada,
  // que sólo vale en los platos sin alérgenos). Si subiera mucho, el ejercicio
  // se habría vuelto adivinable.
  assert(R.mejorCiego <= R.n * 0.2,
    `una estrategia fija aprueba ${R.mejorCiego}/${R.n}: el nivel de memoria se ha vuelto adivinable`);
});

test('Pase: la preparación y sus ingredientes no salen como fichas hermanas', () => {
  // El propietario, en los Raviolis de espinaca: «hay dos parmesano». Eran tres
  // —Queso parmesano, Espuma de parmesano, Parmesano rayado— porque la ficha
  // nombra la preparación y su contenido en la misma línea: «Espuma de
  // parmesano: Parmesano rayado, Leche, Nata, Sal». Ambos acababan en el juego.
  // En sala lo que hay en el plato es la preparación.
  const pleg = (() => { const i = html.indexOf('function _pasePlegar('); let d = 0;
    for (let k = html.indexOf('{', i); k < html.length; k++) {
      if (html[k] === '{') d++; else if (html[k] === '}') { d--; if (!d) return html.slice(i, k + 1); } } })();
  assert(pleg, 'falta el plegado de preparaciones');
  // Regla nueva (sep 2026), tras verlo el propietario en el Arroz negro: la
  // ficha dice «Fondo: Calamar, Cebolleta, Vino blanco», así que el calamar
  // —lo único que aporta Moluscos— desaparecía dentro de «Fondo» y en la fase
  // de la alergia había que adivinar que el fondo lleva calamar. Un hijo que
  // trae un alérgeno que el padre no tiene NO se pliega: es justo la ficha que
  // el camarero debe señalar. Medido: pasaba con 15 ingredientes.
  assert(/const suyo = new Set\(padre\.a \|\| \[\]\)/.test(pleg),
    'hay que mirar lo que el padre aporta POR SÍ MISMO antes de plegar nada');
  assert(/if\(\(c\.a\|\|\[\]\)\.some\(al => !suyo\.has\(al\)\)\) continue;/.test(pleg),
    'un hijo que trae un alérgeno que el padre no tiene no puede plegarse');
  // Barrido funcional sobre el dato real: cuántas fichas se pliegan, y sobre
  // todo que no se pierda ni un alérgeno por el camino — medido antes de
  // hacerlo, en 28 casos el hijo aporta algo que el padre no declaraba solo
  // (el huevo dentro del rebozado, las anchoas dentro de la salsa tártara).
  const cut = (ini, fin) => { const i = html.indexOf(ini); return html.slice(i, html.indexOf(fin, i) + fin.length); };
  const fn = n => { const i = html.indexOf('function ' + n + '('); let d = 0;
    for (let k = html.indexOf('{', i); k < html.length; k++) {
      if (html[k] === '{') d++; else if (html[k] === '}') { d--; if (!d) return html.slice(i, k + 1); } } };
  const src = `var LANG='es', _djIngBase=null;
    function getDish(d){return d;} function _djIngName(n){return n;}
    const _DJ_SECCION = /^(masa|topping|base|relleno|guarnicion|sabores disponibles|salsa base|sazonador|marinada|elaboracion)$/;`
    + cut('const DISHES = [', '\n];') + cut('const DISH_COMPONENTS = ', '};')
    + html.slice(html.indexOf('const _djNorm ='), html.indexOf('async function _djLoadIngBase'))
    + fn('_djTrozos') + fn('_djSplitIngredients') + fn('_djSameThing') + fn('_djIngredients') + fn('_lqaShuffle')
    + html.slice(html.indexOf('const _PASE_SAZONADOR'), html.indexOf('function _pasePlegar('))
    + fn('_pasePlegar') + fn('_paseFusionar') + fn('_paseComponentes')
    + `
    let plegadas=0, perdidos=[], escondidos=[];
    for(const d of DISHES){
      const antes=_paseFusionar(_paseComponentes(d,false));
      const alAntes=new Set(antes.flatMap(x=>x.a||[]));
      const propio=new Map(antes.map(c=>[_djClave(c.t), new Set(c.a||[])]));
      const despues=_pasePlegar(d, _paseFusionar(_paseComponentes(d,false)));
      plegadas += antes.length - despues.length;
      const alDespues=new Set(despues.flatMap(x=>x.a||[]));
      for(const a of alAntes) if(!alDespues.has(a)) perdidos.push(d.name+' pierde '+a);
      // Ninguna ficha con alérgeno puede quedar escondida bajo un padre que no
      // lo aporte por sí mismo: es la que el camarero tiene que señalar.
      const quedan=new Set(despues.map(c=>_djClave(c.t)));
      for(const c of antes){
        if(quedan.has(_djClave(c.t)) || !(c.a||[]).length) continue;
        const cubierto = despues.some(p=>{
          const suyo = propio.get(_djClave(p.t));
          return suyo && (c.a||[]).every(a=>suyo.has(a));
        });
        if(!cubierto) escondidos.push(d.name+' esconde «'+c.t+'» ('+c.a.join('/')+')');
      }
    }
    return {plegadas, perdidos, escondidos};`;
  const R = new Function(src)(); // eslint-disable-line no-new-func
  assert(R.plegadas > 50, `esperaba plegar ~100 fichas, se plegaron ${R.plegadas}`);
  assert(R.perdidos.length === 0,
    `al plegar se pierde un alérgeno del plato: ${R.perdidos.slice(0,5).join(' | ')}`);
  assert(R.escondidos.length === 0,
    `el plegado esconde la ficha que aporta el alérgeno: ${R.escondidos.slice(0,5).join(' | ')}`);
});

test('Pase: la piscina tiene techo y el cuadro de alérgenos sobrevive al recorte', () => {
  // Auditoría sep 2026: la piscina no tenía tope. El Tataki de Atún (Almuerzo)
  // salía con 20 fichas —15 correctas— y llenaba una pantalla de móvil entera;
  // 20 platos pasaban de 12 fichas. Se recorta a 10 correctas, pero jamás a
  // costa del cuadro: primero entra un conjunto que cubra todos los alérgenos
  // declarados (7 en el peor plato de la carta, así que cabe).
  //
  // El tope subió de 8 a 10 al entrar los ingredientes que se ven: con 8, el
  // Tartar de Wagyu se quedaba sin «Crujiente de papa» ni «Trufa negra», que
  // son dos de los siete que el propietario echó en falta por su nombre. Lo que
  // NO sube es la piscina entera: sigue en 13 fichas, y los señuelos ceden el
  // sitio que ganan las correctas.
  assert(/const _PASE_TOPE = 10;/.test(html), 'falta el tope de fichas correctas');
  const rec = (() => { const i = html.indexOf('function _paseRecortar('); let d = 0;
    for (let k = html.indexOf('{', i); k < html.length; k++) {
      if (html[k] === '{') d++; else if (html[k] === '}') { d--; if (!d) return html.slice(i, k + 1); } } })();
  assert(rec && /falta=new Set\(dish\.allergens/.test(rec),
    'el recorte parte de los alérgenos declarados, no de un corte a ciegas');
  assert(/const reales = _paseRecortar\(dish, _pasePlegar\(dish, _paseFichas\(dish,_en\), _en\)\)/.test(html),
    'el recorte se aplica al armar la piscina, después de plegar las preparaciones');
  assert(/const comp=resto\.filter\(c=>!c\.vis\), vis=resto\.filter\(c=>c\.vis\)/.test(rec),
    'el relleno alterna alérgeno y visible: si no, el arroz negro gasta las plazas y pierde el «Arroz bomba»');
  assert(!/_lqaShuffle\(resto\)/.test(rec),
    'el relleno respeta el orden de cocina: barajarlo cambiaba el plato correcto en cada ronda');
  // El barrido funcional que ya existe («la respuesta correcta gana») comprueba
  // que el cuadro montado sigue siendo idéntico al declarado en los 98 platos,
  // así que aquí basta con fijar el techo medido.
  const cut = (ini, fin) => { const i = html.indexOf(ini); return html.slice(i, html.indexOf(fin, i) + fin.length); };
  const fn = n => { const i = html.indexOf('function ' + n + '('); let d = 0;
    for (let k = html.indexOf('{', i); k < html.length; k++) {
      if (html[k] === '{') d++; else if (html[k] === '}') { d--; if (!d) return html.slice(i, k + 1); } } };
  const src = `var LANG='es', _djIngBase=null;function getDish(d){return d;}function _djIngName(n){return n;}
    const _DJ_SECCION = ${/^(masa|topping|base|relleno|guarnicion|sabores disponibles|salsa base|sazonador|marinada|elaboracion)$/};`
    + cut('const DISHES = [', '\n];') + cut('const DISH_COMPONENTS = ', '};')
    + html.slice(html.indexOf('const _djNorm ='), html.indexOf('async function _djLoadIngBase'))
    + fn('_djTrozos') + fn('_djSplitIngredients') + fn('_djSameThing') + fn('_djIngredients') + fn('_lqaShuffle')
    + html.slice(html.indexOf('const _PASE_SAZONADOR'), html.indexOf('function _paseRecortar('))
    + fn('_paseRecortar') + fn('_pasePlegar') + fn('_paseFusionar') + fn('_paseComponentes')
    + fn('_paseVisibles') + fn('_paseMismoPrefijo') + fn('_paseFichas') + fn('_paseSenuelos')
    + fn('_paseArmar') + fn('_paseJugables')
    + `
    let max=0, maxR=0, doce=0, peor='';
    for(const d of _paseJugables()){
      _paseState={dishId:d.id, fase:'montaje', sel:new Set(), piscina:null, veredicto:null};
      _paseArmar();
      const P=_paseState.piscina, r=P.filter(i=>!i.falso).length;
      if(P.length>max){ max=P.length; peor=d.name; }
      if(r>maxR) maxR=r;
      if(P.length>=14) doce++;
    }
    return {max, maxR, doce, peor};`;
  const R = new Function('var _paseState=null;' + src)(); // eslint-disable-line no-new-func
  assert(R.maxR <= 10, `el tope de fichas correctas se ha roto: ${R.maxR}`);
  assert(R.max <= 13, `la piscina más larga es de ${R.max} fichas (${R.peor}); antes del tope eran 20`);
  assert(R.doce === 0, `${R.doce} platos vuelven a pasar de 13 fichas`);
});

test('Pase: los señuelos no pueden ser cosas que el plato lleva', () => {
  // Auditoría sep 2026: el Vitello tonnato ofrecía «Soja» como señuelo y el
  // Fish and chips (Almuerzo) «Pepinillo», y sus fichas los listan — el juego
  // llamaba error a algo que el plato lleva de verdad. El filtro miraba sólo
  // DISH_COMPONENTS (lo que aporta alérgeno), no la ficha entera.
  const sen = (() => { const i = html.indexOf('function _paseSenuelos('); let d = 0;
    for (let k = html.indexOf('{', i); k < html.length; k++) {
      if (html[k] === '{') d++; else if (html[k] === '}') { d--; if (!d) return html.slice(i, k + 1); } } })();
  assert(/for\(const it of _djIngredients\(dish,_en\)\) vistos\.add\(_djClave\(it\.t\)\)/.test(sen),
    'la ficha completa del plato tiene que excluirse de los señuelos');
  // Y por una clave que ignore el plural: «Huevo» de señuelo con «Huevos» de
  // ficha hacía que señalar el huevo en un flan contara como error.
  assert(/const vistos=new Set\(reales\.map\(r=>_djClave\(r\.t\)\)\)/.test(sen),
    'los componentes se excluyen por la clave sin plural');
  assert(/const k=_djClave\(it\.t\);/.test(sen), 'y el candidato se compara con la misma clave');
  // Coincidencia EXACTA y nada más: con _djSameThing («Aceite» dentro de
  // «Vinagreta de mostaza Aceite de oliva») se caían 64 señuelos legítimos.
  assert(!/_djSameThing\([^)]*_djIngredients/.test(sen),
    'excluir por parecido, no por igualdad, dejaría el juego sin señuelos');
  // Y el eco del título: si lo correcto repite una palabra del nombre del plato
  // y ningún señuelo lo hace, se resuelve leyendo. Se fuerza un señuelo con el
  // mismo eco cuando lo haya (12 de los 31 platos afectados lo tienen).
  assert(/const eco = t =>/.test(sen) && /conEco/.test(sen),
    'debe intentarse que algún señuelo haga el mismo eco que el título');
  // Pero un señuelo cuyo nombre ENTERO está en el título no es un señuelo, es
  // el plato: salía «Flan» de opción falsa en el «Flan tradicional con
  // chantilly». Se compara el nombre completo, no palabra a palabra, o se
  // caerían los 41 legítimos que comparten una palabra sin ser lo mismo
  // («Tartar de tomate y queso ← Queso azul»). Medido: quita 1 de 42.
  assert(/_djWordIn\(_djNorm\(it\.t\), _djNorm\(dish\.name\)\)/.test(sen),
    'un señuelo no puede ser el propio plato');
});

test('Pase: ningún señuelo es lo mismo que algo correcto, ni en singular', () => {
  // El propietario, jugando el Flan tradicional con chantilly: «hay huevo dos
  // veces». Y no era cosmético — «Huevos» era la ficha correcta y «Huevo» un
  // señuelo, así que señalar el huevo en un flan contaba como error. Barrido
  // funcional: se pide el catálogo ENTERO de señuelos de cada plato y se coteja
  // con sus componentes por una clave que ignora el plural.
  const cut = (ini, fin) => { const i = html.indexOf(ini); return html.slice(i, html.indexOf(fin, i) + fin.length); };
  const fn = n => { const i = html.indexOf('function ' + n + '('); let d = 0;
    for (let k = html.indexOf('{', i); k < html.length; k++) {
      if (html[k] === '{') d++; else if (html[k] === '}') { d--; if (!d) return html.slice(i, k + 1); } } };
  const src = `
    var LANG='es';
    function getDish(d){return d;} function _djIngName(n){return n;}
    const _DJ_SECCION = /^(masa|topping|base|relleno|guarnicion|sabores disponibles|salsa base|sazonador|marinada|elaboracion)$/;
    `
    + cut('const DISHES = [', '\n];') + cut('const DISH_COMPONENTS = ', '};')
    + html.slice(html.indexOf('const _djNorm ='), html.indexOf('async function _djLoadIngBase'))
    + fn('_djTrozos') + fn('_djSplitIngredients') + fn('_djSameThing') + fn('_djIngredients') + fn('_lqaShuffle')
    + html.slice(html.indexOf('const _PASE_SAZONADOR'), html.indexOf('function _paseRecortar('))
    + fn('_paseRecortar') + fn('_pasePlegar') + fn('_paseFusionar') + fn('_paseComponentes') + fn('_paseSenuelos')
    + `
    const choques=[], dobles=[];
    for(const d of DISHES){
      const reales=_paseFusionar(_paseComponentes(d,false)).filter(it=>!_paseEsSazonador(it));
      // 1 · la piscina correcta no puede traer dos fichas que sean lo mismo
      const claves=reales.map(r=>_djClave(r.t));
      if(new Set(claves).size!==claves.length) dobles.push(d.name);
      // 2 · ningún señuelo posible puede ser lo mismo que algo correcto
      const mios=new Set(claves);
      for(const s of _paseSenuelos(d, reales, 9999, false)){
        if(mios.has(_djClave(s.t))) choques.push(d.name+' ← «'+s.t+'»');
      }
    }
    return {choques:[...new Set(choques)], dobles:[...new Set(dobles)]};
  `;
  const R = new Function(src)(); // eslint-disable-line no-new-func
  assert(R.dobles.length === 0, `fichas correctas repetidas en: ${R.dobles.slice(0,5).join(', ')}`);
  assert(R.choques.length === 0,
    `hay señuelos que son lo mismo que una ficha correcta: ${R.choques.slice(0,5).join(', ')}`);
});

test('Pase: el aviso de XP no tapa la corrección', () => {
  // Medido en la auditoría: el aviso se planta abajo (bottom:80px) y tapaba
  // tres fichas de la revisión durante 2,5 s — justo lo que hay que leer.
  // El XP no se pierde: se acumula en la tanda y se enseña al acabar el plato.
  const toast = (() => { const i = html.indexOf('function showXPToast('); let d = 0;
    for (let k = html.indexOf('{', i); k < html.length; k++) {
      if (html[k] === '{') d++; else if (html[k] === '}') { d--; if (!d) return html.slice(i, k + 1); } } })();
  assert(/if\(document\.getElementById\('paseOverlay'\)\)\{/.test(toast),
    'con el Pase abierto el aviso no debe pintarse');
  assert(/_paseRacha\.xp=\(_paseRacha\.xp\|\|0\)\+amount/.test(toast), 'pero el XP se suma a la tanda');
  assert(/\+\$\{x\} XP/.test(html), 'y la tanda lo enseña');
  // El hueco del plato decía dos cosas distintas según cómo se vaciara, y una
  // de ellas era de la era del montaje («mise en place»), la jerga que se quitó
  // al cambiar la pregunta.
  const tog = (() => { const i = html.indexOf('function _paseToggle('); let d = 0;
    for (let k = html.indexOf('{', i); k < html.length; k++) {
      if (html[k] === '{') d++; else if (html[k] === '}') { d--; if (!d) return html.slice(i, k + 1); } } })();
  assert(!/mise en place/i.test(tog), 'nada de «mise en place» en la fase 1');
  assert(/Todavía no has señalado nada/.test(tog),
    'el hueco tiene que decir lo mismo se llegue como se llegue');
});

test('Pase: la fase de la alergia también llega al panel del supervisor', () => {
  // Hasta sep 2026 _paseRegistrar sólo se llamaba desde _paseServir: la fase 2
  // no se anotaba en ningún sitio —ni paseStats, ni SRS, ni panel— justo la
  // mitad que mide la competencia de alérgenos, que es lo que el propietario
  // pidió poder seguir. Se registra aparte porque son dos destrezas distintas.
  assert(/_paseRegistrarAlergia\(dish, _paseState\.resuelto\)/.test(html),
    'resolver la alergia tiene que registrarse');
  // Corte por llaves balanceadas: cortar «hasta la siguiente función» me ha
  // fallado ya por orden de declaración y el guard se quedaba mirando vacío.
  const reg = (() => { const i = html.indexOf('function _paseRegistrarAlergia('); let d = 0;
    for (let k = html.indexOf('{', i); k < html.length; k++) {
      if (html[k] === '{') d++; else if (html[k] === '}') { d--; if (!d) return html.slice(i, k + 1); } } })();
  assert(reg && reg.length > 200, 'no se ha podido recortar _paseRegistrarAlergia');
  assert(/m\.al=\(m\.al\|\|0\)\+1/.test(reg) && /m\.alOk=\(m\.alOk\|\|0\)\+1/.test(reg),
    'se cuentan las alergias resueltas y las acertadas');
  assert(/m\.fallos\[dish\.id\]=\(m\.fallos\[dish\.id\]\|\|0\)\+1/.test(reg),
    'fallar la alergia cuenta como fallo del plato, para que el juego insista en él');
  assert(/_srsUpdate\(emp, dish\.id, 1\)/.test(reg), 'y baja el SRS de ese plato');
  assert(/saveDB\(\)/.test(reg), 'sin guardar no llega al panel');
  // Los contadores nuevos tienen que viajar en la columna extras, o el
  // supervisor sólo vería lo del dispositivo en el que se jugó.
  const merge = html.slice(html.indexOf('if(x.ps && typeof x.ps'), html.indexOf('function renderLeaderboard'));
  assert(/'n','perf','seg','mal','al','alOk'/.test(merge),
    'al y alOk deben sincronizarse como el resto de contadores');
  // Y verse: un porcentaje propio, separado del cuadro de alérgenos.
  assert(/const _psAlPct = _psAl \? Math\.round\(100\*_psAlOk\/_psAl\) : 0;/.test(html),
    'el panel calcula el acierto de la fase de la alergia');
  assert(/alergias<\/span>|in \$\{_psAl\} allergy calls/.test(html), 'y lo enseña');
});

test('Pase: al acabar un plato el botón dorado sigue jugando, no sale', () => {
  // Propietario, sep 2026: «terminas un plato y la aplicación te lanza al
  // inicio». Medido en los cuatro accesos (tarjeta del inicio, tarjeta de
  // Repaso y el botón de dos listas de platos): ni la pestaña, ni la vista, ni
  // el scroll cambian al cerrar — no había salto. Lo que había era que el
  // juego se abre desde el inicio y el ÚNICO botón dorado de la pantalla final
  // era «Terminar»: pulsas lo que el diseño te pide y apareces donde entraste.
  const des = html.slice(html.indexOf('function _paseDesmontajeHTML('), html.indexOf('function renderRepaso('));
  const fin = des.slice(des.lastIndexOf('<div class="pase-actions">'));
  assert(/class="pase-serve" onclick="_paseOtroPlato\(\)"/.test(fin),
    'el botón principal de la pantalla final debe seguir jugando');
  assert(/class="pase-retry" onclick="_paseClose\(\)"/.test(fin),
    'salir es la acción discreta, nunca la dorada');
  assert(!/class="pase-serve" onclick="_paseClose\(\)"/.test(html),
    'ninguna pantalla del Pase puede tener el cierre como acción dorada');
  // Y el dorado va SIEMPRE a la derecha, como en las otras tres pantallas del
  // juego (Reintentar→Llega un alérgico, No se puede retirar→Confirmar,
  // No lleva ninguno→Servir Pase). Se coló al revés y el propietario lo vio
  // en el móvil a la primera.
  assert(fin.indexOf('pase-retry') < fin.indexOf('pase-serve'),
    'el botón dorado va a la derecha: primero el discreto en el marcado');
  // Y pedir el plato nuevo ANTES de borrar el viejo: si no quedara ninguno
  // jugable, quitar primero dejaba al usuario en la pantalla de detrás — que
  // es literalmente el salto que se denunció.
  const otro = html.slice(html.indexOf('function _paseOtroPlato('), html.indexOf('function _paseClose('));
  assert(otro.indexOf('launchPase(null)') < otro.indexOf('.remove()'),
    'se pide el plato antes de retirar la partida anterior');
  // La tanda se cuenta, para que seguir tenga un porqué y salir sea una
  // decisión en vez del gesto por defecto.
  assert(/function _paseRachaHTML\(/.test(html), 'falta el recuento de la tanda');
  assert(/_paseRacha\.n\+\+/.test(html), 'la tanda se cuenta al registrar el plato');
  assert(/_paseRacha=\{n:0, perf:0, xp:0\}/.test(html.slice(html.indexOf('function _paseClose('))),
    'cerrar el juego reinicia la tanda');
  assert(/\.pase-racha\{/.test(read('styles.css')), 'el recuento de la tanda necesita su estilo');
});

test('Pase: los sazonadores no entran en la piscina', () => {
  // «Hay ingredientes que no tiene sentido que estén, como el agua y la sal»
  // (propietario, sep 2026). No identifican el plato —la sal sale en 33 de los
  // 98— ni llevan alérgeno nunca: sólo alargaban la mise en place. Medido: la
  // mediana de la piscina baja de 15 fichas a 13, y el máximo de 31 a 27.
  assert(/const _PASE_SAZONADOR = new Set\(/.test(html), 'falta la lista de sazonadores');
  const lista = html.slice(html.indexOf('const _PASE_SAZONADOR'), html.indexOf('function _paseEsSazonador'));
  for (const x of ['sal', 'agua', 'azucar', 'aceite de oliva', 'pimienta'])
    assert(lista.includes(`'${x}'`), `el sazonador «${x}» debe estar en la lista`);
  // Verduras y frutas NO: el tomate o la lechuga sí dicen qué plato es.
  for (const x of ['tomate', 'lechuga', 'cebolla', 'zanahoria', 'papa'])
    assert(!new RegExp(`'${x}'`).test(lista), `«${x}» identifica el plato y no puede filtrarse`);
  // Y las dos listas tienen que valer en inglés. Están escritas en español, y
  // en inglés las fichas llegan ya traducidas: medido en el navegador con
  // LANG='en', el Tartar de Wagyu ofrecía «Salt» y «Pepper» como ingredientes
  // del plato. Se traduce la lista con el mismo diccionario, no se duplica.
  const fuera = html.slice(html.indexOf('const _PASE_TRAD'), html.indexOf('function _paseEsSazonador'));
  assert(/en\.add\(_djNorm\(_djIngName\(k, true\)\)\)/.test(fuera),
    'la lista se traduce con _djIngName, que es el mismo diccionario que traduce las fichas');
  assert(/_paseFuera\(_PASE_SAZONADOR, _djNorm\(it\.t\)\)/.test(html), 'los sazonadores pasan por ahí');
  assert(/_paseFuera\(_PASE_GENERICO, _djNorm\(t\)\)/.test(html), 'los rótulos genéricos también');
  // Un sazonador que llegara a llevar alérgeno dejaría de filtrarse solo.
  const fn = html.slice(html.indexOf('function _paseEsSazonador'), html.indexOf('function _paseSecDe('));
  assert(/!\(it\.a\|\|\[\]\)\.length &&/.test(fn),
    'sólo se filtra lo que NO lleva alérgeno: si mañana la sal llevara uno, vuelve a la piscina');
  // Aditivos técnicos y aromáticos de cocción: entraron con los ingredientes
  // que se ven, porque la ficha los lista en el nivel de arriba igual que la
  // berenjena. Nadie los canta en sala y ninguno lleva alérgeno.
  for (const x of ['levadura', 'gelatina', 'xantana', 'maizena', 'laurel', 'canela'])
    assert(lista.includes(`'${x}'`), `«${x}» no se ve en el plato y no puede entrar en la piscina`);
  // «Pimienta verde» NO: es un plato de la carta y se quedaría sin fichas.
  assert(!/'pimienta verde'/.test(lista), '«pimienta verde» es la Salsa de pimienta verde, no un sazonador');
  // Rótulos que no nombran nada enseñable.
  const gen = html.slice(html.indexOf('const _PASE_GENERICO'), html.indexOf('const _PASE_TRAD'));
  for (const x of ['alino', 'bano', 'guarnicion emplatada'])
    assert(gen.includes(`'${x}'`), `«${x}» es un encabezado de ficha, no un ingrediente`);
  // Y las TÉCNICAS. La ficha de la carrillera dice «Cocción a baja temperatura:
  // Ajo, Puerros, Cebolla…» y el rótulo salía de ficha para escoger, como si
  // fuera algo que lleva el plato. Lo que lleva es el ajo.
  for (const x of ['coccion a baja temperatura', 'marinada'])
    assert(gen.includes(`'${x}'`), `«${x}» es una técnica, no un ingrediente`);
  // Se filtran de los reales Y de los señuelos, y ambos salen de _paseFichas.
  const fich = html.slice(html.indexOf('function _paseFichas('), html.indexOf('function _paseSenuelos('));
  assert(/\.filter\(it=>!_paseEsSazonador\(it\)\)/.test(fich), 'los ingredientes reales se filtran');
  const dis = html.slice(html.indexOf('function _paseSenuelos('), html.indexOf('const _PASE_TOPE'));
  assert(/if\(_paseEsSazonador\(it\)\) continue;/.test(dis), 'un señuelo de sal no engaña a nadie');
});

test('Pase: tema pergamino, como el resto de la app', () => {
  // «Muy confuso, el diseño muy oscuro» (propietario, viéndolo en el móvil).
  // Era un overlay oscuro heredado del Viaje Inmersivo: entrar desde un Repaso
  // claro era saltar a otra app. Ojo con los tokens, que están al revés de lo
  // que parece: --ink (#f4ede2) es el PAPEL claro y --parchment (#1c2a22) la
  // TINTA. Poner --color-bg de fondo dejaba texto oscuro sobre fondo oscuro.
  const css = read('styles.css');
  assert(/\.pase-overlay\{[^}]*background:var\(--ink\)/.test(css),
    'el fondo del pase es el papel claro (--ink), no --color-bg ni --parchment');
  assert(!/\.pase-overlay\{[^}]*background:var\(--color-bg\)/.test(css),
    '--color-bg es la tinta oscura: no vale como fondo');
  // El oro de la casa es demasiado claro para texto blanco encima.
  assert(/\.pase-serve\{[^}]*color:var\(--parchment\)/.test(css),
    'el botón dorado lleva texto en tinta: en blanco no llegaba a AA (medido 2.94)');
  assert(!/\.pase-serve\{[^}]*color:#fff/.test(css), 'nada de texto blanco sobre el oro');
  // El overlay pinta claro pero el body de la app es OSCURO: sin un color
  // explícito, cualquier texto sin color propio hereda el claro y desaparece.
  // Ya pasó con la pregunta de la fase 1, que se quedó invisible en pantalla
  // estando bien en el HTML.
  assert(/\.pase-overlay\{[^}]*color:var\(--parchment\)/.test(css),
    'el overlay debe fijar el color de texto, no heredar el del body oscuro');
  assert(/\.pase-intro\{[^}]*color:var\(--parch/.test(css), 'la pregunta necesita su color');
});

test('el troceador de ingredientes no parte dentro de un paréntesis', () => {
  // «Granadina (Vinagre de manzana, Azúcar)» es UN ingrediente y salía partido
  // en «Granadina (Vinagre de manzana» y «Azúcar)»; la txuleta «(1,2 kg)»
  // quedaba en «(1». Medido: 15 chips con el paréntesis descompensado. Esto lo
  // pinta también el Viaje Inmersivo, así que llevaba tiempo a la vista.
  assert(html.includes('function _djTrozos(raw)'), 'falta el troceador que respeta los paréntesis');
  assert(!html.includes(".split(/[,.]/).forEach(tr=>{"),
    'nadie puede volver a trocear la ficha con un split ciego por comas');
  const tro = html.slice(html.indexOf('function _djTrozos('), html.indexOf('function _djSplitIngredients('));
  assert(tro.includes('prof++') && tro.includes('prof=Math.max(0,prof-1)') && tro.includes('&& !prof'),
    'el corte debe contar la profundidad de paréntesis y no cortar dentro');
  // Y el resultado: ninguna ficha puede sacar un chip con el paréntesis abierto.
  const iD = html.indexOf('const DISHES = ['), jD = html.indexOf('\n];', iD);
  const DISHES = new Function(html.slice(iD, jD + 3) + '; return DISHES;')(); // eslint-disable-line no-new-func
  const fn = n => { const i = html.indexOf('function ' + n + '('); let d = 0;
    for (let k = html.indexOf('{', i); k < html.length; k++) {
      if (html[k] === '{') d++; else if (html[k] === '}') { d--; if (!d) return html.slice(i, k + 1); } } };
  const M = new Function(`${html.slice(html.indexOf('const _djNorm ='), html.indexOf('async function _djLoadIngBase'))}
    const _DJ_SECCION = ${/^(masa|topping|base|relleno|guarnicion|sabores disponibles|salsa base|sazonador|marinada|elaboracion)$/};
    ${fn('_djTrozos')}${fn('_djSplitIngredients')}; return _djSplitIngredients;`)(); // eslint-disable-line no-new-func
  const rotos = [];
  for (const d of DISHES)
    for (const t of M(d.ingredients))
      if ((t.match(/\(/g) || []).length !== (t.match(/\)/g) || []).length) rotos.push(`${d.id}: «${t}»`);
  assert(rotos.length === 0, `chips con el paréntesis descompensado: ${rotos.slice(0, 6).join(' · ')}`);
});

test('Pase de cocina: el desmontaje obedece a lo que validó cocina', () => {
  // La fase 2 no puede inventarse qué se retira: sale de DISH_ACTIONS, que es
  // la matriz que cocina validó.
  const conf = html.slice(html.indexOf('function _paseConfirmarRetirada('), html.indexOf('function _paseOtroPlato('));
  assert(/DISH_ACTIONS\[dish\.id\]/.test(conf), 'el veredicto del desmontaje debe leer DISH_ACTIONS');
  assert(/act\.r===1/.test(conf), 'la retirabilidad se decide por r===1, no por si hay comanda');
  // Señalar QUÉ aporta el alérgeno se exige SIEMPRE, se pueda retirar o no.
  // Antes bastaba pulsar «no se puede» cuando era estructural y la selección se
  // ignoraba; medido sobre 5.150 partidas simuladas, pulsarlo a ciegas acertaba
  // el 74,3%, porque 199 de las 271 alergias posibles de la carta son
  // estructurales. Ese reparto es la verdad de la cocina y no se toca: lo que
  // se quita es el premio por adivinarlo. Con el portador exigido, el atajo
  // baja al 0% (y no hay ningún caso en que ninguna ficha porte el alérgeno).
  assert(/bien:\s*acertoQue && \(retirable \? !noSePuede : !!noSePuede\)/.test(conf),
    'acertar exige señalar el portador Y decir bien si se puede retirar');
  // La función entera, no los primeros N caracteres: al reordenarla el guard
  // dejaba de mirar donde importaba sin que nadie se enterase.
  const des = html.slice(html.indexOf('function _paseDesmontajeHTML('), html.indexOf('function renderRepaso('));
  assert(/const cls = debe && on \? ' ok'/.test(des),
    'la revisión pinta el portador igual sea estructural o no: ahora también se exigía señalarlo');
  // Los dos botones responden SIEMPRE. Estuvieron desactivados hasta señalar el
  // portador y el propietario avisó dos veces de que «no funcionan»: un botón
  // que no responde es peor que una respuesta corregida, y el atajo ya no vive
  // ahí — vive en el veredicto, que exige acertoQue. Se comprueba con el
  // barrido funcional de más abajo, no con el marcado.
  const preg = des.slice(0, des.indexOf('const chips=S.plato.map'));
  const botones = preg.slice(preg.indexOf('<div class="pase-actions">'));
  assert(!/disabled/.test(botones),
    'los botones de la fase 2 no pueden desactivarse: hay que poder contestar y que el veredicto corrija');
  assert(/_paseConfirmarRetirada\(true\)/.test(botones) && /_paseConfirmarRetirada\(false\)/.test(botones),
    'faltan las dos respuestas de la fase 2');
  // La comanda que se enseña es la de cocina, en el idioma de la app.
  assert(/act\.c_en\|\|act\.c/.test(conf) && /act\.c\|\|''/.test(conf),
    'la comanda debe salir de DISH_ACTIONS (c / c_en), nunca redactada por el juego');
});

test('Pase de cocina: cableado, accesibilidad y sin foto', () => {
  // Se lanza desde las DOS listas de Repaso (la de categoría y la del buscador).
  assert((html.match(/onclick="event\.stopPropagation\(\);launchPase\(\$\{d\.id\}\)"/g) || []).length === 2,
    'el botón del pase debe estar en las dos listas de Repaso');
  // El nombre del plato SE DA: la foto no añadiría nada y la regla de la casa
  // es que las fotos no entran en los ejercicios. El juego no la pinta.
  const juego = html.slice(html.indexOf('let _paseState = null;'), html.indexOf('function renderRepaso('));
  assert(!/dishPhotoSrc|img\/platos/.test(juego), 'el juego del pase no debe pintar la foto del plato');
  // Accesibilidad y dedo: las fichas son botones con aria-pressed, y el overlay
  // es un diálogo modal que se cierra con ESC.
  assert(/aria-pressed="\$\{on\?'true':'false'\}"/.test(juego), 'las fichas deben exponer aria-pressed');
  assert(/setAttribute\('aria-modal','true'\)/.test(juego) && /_paseKeydown/.test(juego),
    'el overlay debe ser un diálogo modal cerrable con ESC');
  const css = read('styles.css');
  assert(/\.pase-chip\{[^}]*min-height:44px/.test(css), 'las fichas necesitan altura de dedo (44px)');
  assert(/\.pase-serve,\.pase-retry\{[^}]*min-height:48px/.test(css), 'los botones de acción necesitan 48px');
  assert(/\.pase-chip-t\{[^}]*overflow-wrap:break-word/.test(css),
    'los nombres largos de ingrediente deben partir, no desbordar');
});

test('Guía de emplatado: mapa de fotos íntegro, sección cableada, overlay y CSS', () => {
  // El personal leía el PDF del plating guide; esta sección lo sustituye con
  // las fotos reales del propietario. Guard: integridad del mapa + cableado.
  const map = JSON.parse(read('data/dish-photos.json'));
  const keys = Object.keys(map);
  assert(keys.length >= 50, `expected ≥50 dish photos, found ${keys.length}`);
  // Regresión (jul 2026, reporte del propietario): el emparejador difuso por
  // nombre de página coló dos fotos de OTROS platos por coincidencia parcial
  // de palabras ("Tarta de limón"→"Tarta de queso" id 105, "Salsa Bearnesa"→
  // "Salsa de hongos" id 38). La página del 38 en el plating guide 2026 sigue
  // sin llevar foto (sólo texto y pictogramas), así que el 38 se queda sin ella.
  assert(!('38' in map), 'dish 38 (Salsa de hongos) must stay photo-less — its page in the 2026 guide carries no photo');
  // El 105 sí la recuperó: la página 47 del plating guide de almuerzo 2026 se
  // titula «Tarta de queso» y su foto es la tarta con confitura de frutos rojos
  // que describe la ficha (ya no la de limón del guide antiguo).
  assert(map['105'] === 'img/platos/105-tarta-de-queso.webp',
    'dish 105 must use its own cheesecake photo from the 2026 lunch guide');
  // Cada plato tiene su propio fichero: si dos ids apuntan a la misma ruta es
  // que un emparejamiento se coló (los gemelos por turno llevan copia propia).
  //
  // La ÚNICA excepción, y es deliberada: las cinco croquetas premium. Los dos
  // guides las agrupan en una sola página («Croquetas premium», cena p3 y
  // lunch p8) con una foto de las dos tablas de madera donde se distingue cada
  // una por su topping. No hay foto por sabor, así que las cinco comparten esa
  // —una copia, no cinco ficheros idénticos—, y por eso su nombre no lleva id.
  const COMPARTIDA = 'img/platos/croquetas-premium.webp';
  const CROQUETAS = ['124', '125', '126', '127', '128'];
  const porRuta = new Map();
  for (const [id, p] of Object.entries(map)) {
    if (!porRuta.has(p)) porRuta.set(p, []);
    porRuta.get(p).push(id);
  }
  for (const [p, dup] of porRuta) {
    if (p === COMPARTIDA) {
      assert(dup.sort().join(',') === CROQUETAS.join(','),
        `only the five croquetas may share ${COMPARTIDA}, found ${dup.join(', ')}`);
      continue;
    }
    assert(dup.length === 1, `photo ${p} is shared by dishes ${dup.join(', ')}`);
  }
  // el nombre del fichero empieza por el id del plato que lo usa
  for (const [id, p] of Object.entries(map))
    assert(p === COMPARTIDA || p.startsWith(`img/platos/${id}-`),
      `photo for dish ${id} is named after another dish: ${p}`);
  // y si una croqueta deja de compartirla, que sea porque tiene la suya propia
  for (const id of CROQUETAS)
    assert(!map[id] || map[id] === COMPARTIDA || map[id].startsWith(`img/platos/${id}-`),
      `croqueta ${id} must use either the shared board photo or its own`);
  // Cotejo completo de las 101 fichas de los dos guides contra la carta de la
  // app (sept 2026): sólo una página no tiene plato, «Pimientos rojos
  // confitados» (cena p62). El propietario confirma que ya NO está en carta,
  // así que no se añade — queda anotado aquí para que el próximo repaso no la
  // vuelva a levantar como plato que falta.
  assert(!/Pimientos rojos confitados/i.test(html),
    'los pimientos rojos confitados salieron de carta (propietario, sept 2026) — no re-añadir desde el guide');
  // cada ruta del mapa debe existir físicamente en el repo
  for (const [id, p] of Object.entries(map)) {
    assert(/^img\/platos\/[a-z0-9-]+\.webp$/.test(p), `photo path malformed for dish ${id}: ${p}`);
    assert(existsSync(join(ROOT, p)), `mapped photo file missing on disk: ${p}`);
  }
  // cada clave debe ser un plato real de DISHES
  const ids = new Set([...html.matchAll(/\{id:(\d+),cat:'/g)].map(m => m[1]));
  for (const id of keys) assert(ids.has(id), `dish-photos.json maps unknown dish id ${id}`);
  // sección cableada como subtab de Aprender + overlay + búsqueda
  assert(/\['emplatado','Plating guide'/.test(html), 'Plating guide subtab missing from Aprender hub');
  assert(/emplatado:renderEmplatado/.test(html), 'renderEmplatado not wired into the Aprender dispatch');
  // CADA subtab de Aprender debe existir en el enrutador global: _subTabBar
  // conmuta con showTab('<subkey>'), así que renderMap y parentMap deben
  // conocer todas las claves (bug real en producción: "renderMap[tab] is not
  // a function" al tocar Emplatado).
  // La barra vive en _aprChipsBar (extraída de renderAprender para poder
  // re-inyectarla tras los re-renders internos — «se desaparecieron las
  // subcategorías»).
  const hubSrc = html.slice(html.indexOf('function _aprChipsBar('), html.indexOf('function _aprEnsureChips('));
  const subkeys = [...hubSrc.matchAll(/\['([a-z]+)',/g)].map(m => m[1]);
  assert(subkeys.length >= 5, `expected ≥5 Aprender subtabs, found ${subkeys.length}`);
  const renderMapSrc = html.slice(html.indexOf('const renderMap = {'), html.indexOf('const renderMap = {') + 600);
  const parentMapSrc = html.slice(html.indexOf('const parentMap = {'), html.indexOf('const parentMap = {') + 300);
  for (const k of subkeys) {
    assert(renderMapSrc.includes(k + ':'), `Aprender subtab '${k}' missing from showTab renderMap — tapping it crashes`);
    if (k !== 'smart') assert(parentMapSrc.includes(k + ':'), `Aprender subtab '${k}' missing from showTab parentMap — nav highlight breaks`);
  }
  assert(/function renderEmplatado\(/.test(html) && /function _emplOpen\(/.test(html), 'guide renderer/overlay functions missing');
  assert(/loadLazyData\('data\/dish-photos\.json'/.test(html), 'photo map must lazy-load like other data files');
  assert(/loading="lazy"/.test(html), 'grid images must lazy-load');
  assert(/_shiftDishes\(DISHES\)/.test(html.slice(html.indexOf('function _emplRender'), html.indexOf('function _emplRender') + 800)),
    'the guide must respect the active shift filter');
  // y el selector de turno debe REFRESCARLA al instante (bug real: emplatado
  // faltaba en la lista blanca de _setStudyShift y el cambio no se veía)
  assert(/const _shiftTabs = \{[^}]*emplatado:1/.test(html),
    "_setStudyShift's instant-refresh whitelist must include 'emplatado'");
  // el aviso de platos sin foto es SOLO para el propietario (dispositivo que
  // ha desbloqueado el panel de supervisor con PIN)
  assert(/missing\.length && _isSupDevice\(\)/.test(html),
    'the missing-photos notice must be gated behind _isSupDevice()');
  assert(/function _isSupDevice\(/.test(html) && /txk_sup_device/.test(html),
    '_isSupDevice must exist and persist via the supervisor-PIN device mark');
  const css = read('styles.css');
  for (const sel of ['.empl-grid{', '.empl-card{', '.empl-ov-card{', '.empl-chip{']) {
    assert(css.includes(sel), `styles.css must style ${sel}`);
  }
});

test('Flashcards cómodas: volteo reversible y altura fija (nada empuja el layout)', () => {
  // Quejas del propietario (jul 2026): al entrar a ingredientes no se podía
  // volver, y la cara trasera crecía empujando los botones fuera de pantalla.
  // (1) volteo reversible: tocar la tarjeta volteada vuelve a la delantera
  const fc = html.slice(html.indexOf('let _fcAnimating'), html.indexOf('let _fcAnimating') + 1600);
  assert(/function unflipCard\(\)/.test(fc), 'unflipCard must exist');
  assert(/if\(fcFlipped\)\{ unflipCard\(\); return; \}/.test(fc),
    'tapping a flipped card must flip it back (it used to be a dead tap)');
  assert(/toca la tarjeta para volver/.test(html), 'the back face must hint that tapping goes back');
  // (2) altura FIJA con scroll interno: el volteo no mueve el layout
  const css = read('styles.css');
  assert(/\.fc-scene\{[^}]*height:clamp\(280px,44vh,400px\)/.test(css),
    'the card scene must have a FIXED height (front and back identical — no layout jump)');
  assert(/\.fc-face\{[^}]*overflow:hidden/.test(css.slice(css.indexOf('.fc-face{'), css.indexOf('.fc-face{') + 600)),
    'the face clips; scrolling lives in the back content wrapper');
  assert(/id="fcBackScroll"[^>]*overflow-y:auto/.test(html),
    'long ingredients must scroll INSIDE the card, not grow the page');
});

test('Fotos en toda la app: helper precargado + Explorar + ficha + flashcard + ambas búsquedas', () => {
  // Petición del propietario (jul 2026): fotos en todas las superficies de
  // CONSULTA. Nunca en exámenes/juegos donde el nombre del plato sea la
  // respuesta (chivarían la solución).
  assert(/function dishPhotoSrc\(id\)/.test(html), 'dishPhotoSrc helper missing');
  // La ventana subió de 900 a 1800: la carga de la carta por restaurante entró
  // por delante en closePinAndEnter y empujó esta línea. Sigue comprobando que
  // la precarga va al principio de la función, que es lo que importa.
  assert(/loadDishPhotos\(\);/.test(html.slice(html.indexOf('function closePinAndEnter('), html.indexOf('function closePinAndEnter(') + 1800)),
    'the photo map must preload on login so sync renders can use it');
  // Explorar: la foto vive dentro del hexágono de la fila
  const topic = html.slice(html.indexOf('function renderRepasoTopic('), html.indexOf('function renderRepasoDishDetail('));
  assert(/repaso-row-icon">\$\{_ph\?`<img loading="lazy"/.test(topic), 'Explorar rows must show the dish photo in the hex icon');
  // Ficha: foto-plato circular con respaldo al plato SVG decorativo
  const det = html.slice(html.indexOf('function renderRepasoDishDetail('), html.indexOf('function renderRepasoDishDetail(') + 9000);
  assert(/dish-hero-photo/.test(det) && /`:`[\s\S]{0,40}<svg width="\$\{plateSize\}"/.test(det),
    'dish detail must show the real photo with the SVG plate as fallback');
  // Flashcard: foto circular sobre el nombre
  assert(/class="fc-photo"/.test(html), 'flashcard front must show the dish photo when available');
  // Búsqueda global + búsqueda de Aprender: miniaturas
  assert(/gs-hit-ph/.test(html), 'global search dish hits must show photo thumbnails');
  assert(/_aprenderOpenDish\(\$\{d\.id\}\)/.test(html) && /dishPhotoSrc\(d\.id\)\)\?`<img loading="lazy"[^`]*width:36px/.test(html),
    'Aprender quick-search results must show photo thumbnails');
  const css = read('styles.css');
  for (const sel of ['.repaso-row-icon img{', '.dish-hero-photo{', '.fc-photo{', '.gs-hit-ph{']) {
    assert(css.includes(sel), `styles.css must style ${sel}`);
  }
});

test('Fotos del equipo: subida con moderación (guía completa, ficha "foto mejor", cola del supervisor)', () => {
  // Jul 2026: cualquier camarero sube la foto desde el pase; el supervisor
  // aprueba desde su panel; la aprobada pisa a la del repo al instante.
  // (1) subida: picker + compresión + storage + insert pending
  assert(/function _dishPhotoPick\(/.test(html) && /function _dishPhotoUpload\(/.test(html), 'upload helpers missing');
  assert(/_chatDownscale\(file,1100/.test(html), 'uploads must compress client-side (reuses the chat downscaler)');
  assert(/storage\/v1\/object\/dish-photos\//.test(html), 'uploads must go to the dish-photos bucket');
  assert(/rest\/v1\/dish_photo_submissions/.test(html), 'submissions must be recorded in dish_photo_submissions');
  // (2) merge en runtime: aprobadas pisan al repo; pendientes marcadas
  const lp = html.slice(html.indexOf('async function loadDishPhotos('), html.indexOf('async function loadDishPhotos(') + 1600);
  assert(/status=in\.\(pending,approved\)/.test(lp) && /DISH_PHOTO_PENDING/.test(lp),
    'loadDishPhotos must merge approved submissions and track pending ones');
  // (3) guía: TODOS los platos — placeholder con botón de subir o "en revisión"
  assert(/empl-card-nophoto/.test(html) && /empl-upload-btn/.test(html) && /empl-pend/.test(html),
    'the guide must show placeholder cards with upload button / in-review state');
  // (4) ficha ampliada: "¿tienes una foto mejor?"
  assert(/empl-ov-upload/.test(html), 'the dish overlay must offer submitting a better photo');
  // (4b) LA INFORMACIÓN CONSTRUIDA MANDA (propietario, jul 2026): la ficha
  // ampliada muestra la matriz validada de adaptaciones con comanda exacta
  // (DISH_ACTIONS), las notas de servicio y el salto a la ficha completa —
  // la foto puede quedar vieja; la ficha es la fuente de verdad.
  const ov = html.slice(html.indexOf('function _emplOpen('), html.indexOf('function _emplOpen(') + 5000);
  assert(/DISH_ACTIONS\[d\.id\]/.test(ov) && /empl-ov-adapt/.test(ov),
    'the overlay must render the validated adaptation matrix, not just allergen chips');
  assert(/act\.r===1/.test(ov) && /Se adapta/.test(ov) && /Estructural/.test(ov),
    'each allergen must show its verdict (adaptable + comanda / structural)');
  assert(/empl-ov-note/.test(ov), 'service notes must surface in the overlay when present');
  assert(/empl-ov-ficha/.test(ov) && /repasoView='dish'/.test(ov),
    'the overlay must link to the full dish sheet (the built knowledge)');
  // (5) panel supervisor: cola de moderación cableada
  assert(/fotos: \(\)=>renderSupPhotoQueue\(\)/.test(html) && /_supTool\('fotos'\)/.test(html),
    'the supervisor panel must expose the photo moderation queue');
  assert(/function renderSupPhotoQueue\(/.test(html) && /function _supPhotoModerate\(/.test(html), 'moderation functions missing');
  assert(/status=eq\.pending/.test(html) && /reviewed_at/.test(html), 'moderation must PATCH status + reviewed_at');
  const css = read('styles.css');
  for (const sel of ['.empl-card-nophoto{', '.empl-upload-btn{', '.sup-photo-card{', '.sup-photo-actions button.rej{']) {
    assert(css.includes(sel), `styles.css must style ${sel}`);
  }
});

test('Ficha ampliada: la información vital no se pierde ni se tergiversa (jul 2026)', () => {
  // «Que no se pierda información vital» (propietario, jul 2026). Tres cierres:
  const i = html.indexOf('function _emplOpen(');
  const ov = html.slice(i, i + 5000);
  // (1) La matriz se consulta con los alérgenos CANÓNICOS (d.allergens, ES).
  //     dd.allergens llega TRADUCIDO en modo inglés («Dairy» vs clave «Lácteos»):
  //     el lookup fallaba siempre y 61 alérgenos adaptables se mostraban como
  //     «Structural — not suitable» — dato de seguridad FALSO. Nunca más.
  assert(/d\.allergens&&d\.allergens\.length/.test(ov) && /d\.allergens\.map/.test(ov),
    'overlay must key DISH_ACTIONS with canonical d.allergens (ES)');
  assert(!/dd\.allergens\.map/.test(ov),
    'localized dd.allergens must NEVER key the matrix (EN-mode false "not suitable" verdicts)');
  // (2) Sin dato en la matriz NO se inventa veredicto: «estructural» exige
  //     r===0 explícito; el hueco se manda a cocina, no se afirma.
  assert(/act&&act\.r===0/.test(ov), 'structural verdict requires explicit r===0');
  assert(/empl-ov-adapt unk/.test(ov) && /Consultar con cocina/.test(ov) && /Check with the kitchen/.test(ov),
    'missing matrix data must render "consultar con cocina", never an invented verdict');
  // (3) La ficha abre AUNQUE el plato no tenga foto — la información construida
  //     no depende de la foto (y las tarjetas sin foto también la abren).
  assert(!/if\(!d\|\|!DISH_PHOTOS\) return/.test(ov), 'overlay must not require a photo to open');
  assert(/empl-ov-nophoto/.test(ov), 'photo-less dishes get a placeholder hero with the info intact');
  const grid = html.slice(html.indexOf('function _emplRender('), i);
  const noph = grid.slice(grid.indexOf('empl-card-nophoto'));
  assert(/onclick="_emplOpen\(\$\{d\.id\}\)"/.test(noph) && /role="button"/.test(noph),
    'no-photo cards must open the expanded sheet too');
  assert(/event\.stopPropagation\(\);_dishPhotoPick/.test(noph),
    'the upload button inside the card must not also trigger the overlay');
  const css = read('styles.css');
  assert(css.includes('.empl-ov-adapt.unk') && css.includes('.empl-ov-nophoto{'),
    'styles.css must style the unknown verdict + the photo-less hero');
});

test('Aprender: la barra de subcategorías sobrevive a la navegación interna (jul 2026)', () => {
  // «Se desaparecieron las subcategorías» (propietario, captura): los renderers
  // internos de Explorar/Flashcards/Repaso Inteligente reescriben appContent
  // ENTERO al navegar dentro de su subpestaña y borraban la barra de chips.
  // Dos capas: _aprEnsureChips (re-inyección idempotente) + navegación interna
  // enrutada por el host (renderAprender).
  assert(/function _aprChipsBar\(/.test(html) && /function _aprEnsureChips\(/.test(html),
    'chips bar builder + idempotent re-injector must exist');
  const ens = html.slice(html.indexOf('function _aprEnsureChips('), html.indexOf('function _aprEnsureChips(') + 600);
  assert(/querySelector\('\.subtab-chips'\)/.test(ens), '_aprEnsureChips must be idempotent (skip if bar present)');
  // renderRepaso re-asegura la barra tras CUALQUIER re-render interno de Explorar
  const rr = html.slice(html.indexOf('function renderRepaso('), html.indexOf('function renderRepaso(') + 700);
  assert(/_aprEnsureChips\(\)/.test(rr), 'renderRepaso must re-ensure the chips bar');
  // openRepasoCat entra por renderRepaso (no salta directo a renderRepasoTopic)
  assert(/function openRepasoCat\(cat\)\{repasoCat=cat;repasoView='topic';renderRepaso\(\);\}/.test(html),
    'openRepasoCat must route through renderRepaso');
  // Flashcards y Repaso Inteligente re-renderizan por el host
  assert(/function changeFcCat\(cat\)\{initFlashcards\(fcTopic,cat\);renderAprender\(\);\}/.test(html)
      && /function changeFcTopic\(t\)\{fcTopic=t;initFlashcards\(t\);renderAprender\(\);\}/.test(html),
    'flashcard cat/topic switches must re-render via renderAprender');
  assert(!/onclick="initFlashcards\(fcTopic,'all'\);renderFlashcards\(\)"/.test(html),
    'the new-deck button must not call renderFlashcards() directly');
  assert(!/onclick="renderSmartReview\(\)"/.test(html),
    'the reshuffle button must not call renderSmartReview() directly');
});

test('Dashboard: tarjeta de acceso directo a la Guía de Emplatado (1 toque desde el inicio)', () => {
  // La guía es consulta, no formación: debe estar a 1 toque de abrir la app.
  // Tarjeta premium con abanico de fotos reales, cableada por la ruta enrutada.
  assert(/class="dash-plating"/.test(html), 'dashboard must render the plating quick-access card');
  assert(/dash-plating"[^>]*onclick="_subTab\.aprender='emplatado';showTab\('emplatado'\)"/.test(html.replace(/\s+/g,' ')),
    'the card must navigate via the ROUTED path (_subTab + showTab emplatado)');
  // las 3 fotos del abanico deben existir físicamente
  const strip = [...html.matchAll(/dash-plating-strip[\s\S]{0,400}?<\/div>/g)][0][0];
  const photos = [...strip.matchAll(/src="(img\/platos\/[^"]+)"/g)].map(m => m[1]);
  assert(photos.length === 3, `the fan must show 3 photos, found ${photos.length}`);
  for (const p of photos) assert(existsSync(join(ROOT, p)), `fan photo missing on disk: ${p}`);
  const css = read('styles.css');
  for (const sel of ['.dash-plating{', '.dash-plating-strip img{', '.dash-plating-shine{']) {
    assert(css.includes(sel), `styles.css must style ${sel}`);
  }
  assert(/"Plating guide"/.test(read('manifest.json')), 'the icon shortcut must be renamed to match its landing');
  assert(/dash-plating-title">Plating guide</.test(html), 'the dashboard card must use the official name (Plating guide)');
});

test('Acceso en 1 toque: sesión deslizante 90d, banner de instalación, hoja iOS, atajos del manifest', () => {
  // Fricción reportada por el propietario (jul 2026): el personal leía el PDF
  // porque abrir la app costaba. Este guard fija el paquete anti-fricción.
  // (1) sesión deslizante: 90 días y renovación del sello en cada apertura
  const al = html.slice(html.indexOf('(function autoLogin('), html.indexOf('(function autoLogin(') + 1400);
  assert(/90\*24\*60\*60\*1000/.test(al), 'session must be valid for 90 days (was 30 — monthly re-login killed the habit)');
  assert(/txoko_session', JSON\.stringify\(\{user, hash, ts: Date\.now\(\)\}\)/.test(al),
    'auto-login must RENEW the session timestamp on each open (sliding session)');
  // (2) banner de instalación en el dashboard, con snooze y detección standalone
  assert(/function renderInstallBanner\(/.test(html) && /\$\{renderInstallBanner\(\)\}/.test(html),
    'the dashboard must render the install banner');
  assert(/function _isStandalone\(/.test(html) && /display-mode: standalone/.test(html),
    'the banner must hide when already installed (standalone detection)');
  assert(/txk_install_snooze/.test(html) && /14\*24\*60\*60\*1000/.test(html),
    'dismissing the banner must snooze it for 14 days (not forever, not never)');
  // (3) hoja visual de pasos (iOS no tiene prompt nativo; el alert() era hostil)
  assert(/function showInstallSheet\(/.test(html) && /Añadir a pantalla de inicio/.test(html),
    'the iOS/generic install sheet with visual steps must exist');
  assert(!/alert\(LANG==='en'\s*\?\s*'On iPhone/.test(html), 'the old hostile alert() fallback must be gone');
  // (4) atajos del icono (long-press) via #tab= (el boot ya los procesa)
  const mf = read('manifest.json');
  assert(/"shortcuts"\s*:/.test(mf) && /#tab=aprender/.test(mf) && /#tab=txoko/.test(mf),
    'manifest.json must define home-screen shortcuts deep-linking via #tab=');
  // CSS del banner y la hoja
  const css = read('styles.css');
  for (const sel of ['.install-banner{', '.install-sheet{', '.install-step{']) {
    assert(css.includes(sel), `styles.css must style ${sel}`);
  }
});

test('Camarero Survivors UX: invisible joystick base + plain-language upgrade descriptions', () => {
  // Petición del propietario: no mostrar el círculo oscuro del joystick al
  // mover, y una breve explicación de lo que hace cada habilidad al escoger.
  const css = read('styles.css');
  const joy = css.slice(css.indexOf('#etJoy{'), css.indexOf('#etJoy{') + 220);
  assert(/border:none/.test(joy) && /background:none/.test(joy) && /box-shadow:none/.test(joy),
    'the joystick base (#etJoy) must be invisible — no dark disc over the player');
  const i = html.indexOf('const UPGRADES=[');
  const ups = html.slice(i, i + 1400);
  // upgrade blurbs must be full sentences, not terse tokens like "+1 bandeja"
  assert(/Lanzas una bandeja más a la vez/.test(ups), 'upgrade descriptions must explain what the ability does in plain language');
  assert(/Cuchillos que orbitan y cortan al tocar/.test(ups) && /Te mueves \+14% más rápido/.test(ups),
    'each upgrade must carry its plain-language explanation');
});

test('EL TURNO markup/CSS is fully scoped under an et- prefix — no collision with app-wide selectors', () => {
  const i = html.indexOf('function launchElTurno(');
  assert(i !== -1, 'launchElTurno not found');
  const end = html.indexOf('\n// ── Game flow', i);
  const body = html.slice(i, end > i ? end : i + 40000);
  // every id/class the overlay creates must carry the et prefix
  const bareIds = body.match(/id="(?!et[A-Z])[a-zA-Z][^"]*"/g) || [];
  assert(bareIds.length === 0, `unprefixed id(s) inside launchElTurno risk colliding with existing app ids: ${bareIds.slice(0,5).join(', ')}`);
  assert(body.includes("overlay.id = 'etOverlay'"), 'overlay root id missing');
  assert(body.includes("class=\"et-screen\""), 'et-screen class missing — game screens are not scoped');
  // the CSS file must define #etOverlay scoped at high z-index, not a bare .screen/.card that would hit app-wide rules
  const css = read('styles.css');
  assert(css.includes('#etOverlay{'), 'styles.css has no #etOverlay rule');
  assert(!/^\.screen\{[^}]*100000/m.test(css), 'the game overlay z-index leaked onto the generic .screen rule');
});

// ─── 6z. Correctness audit guards (owner-reported, Jul 2026) ────
// Five owner reports in one week, all the same two defect classes:
// multiple-correct options and false claims from regex heuristics.
// These guards EXECUTE the real generators on the real carta.
console.log('\nQuestion correctness (owner bugs 1-6, Jul 2026)');

function _xFn(name) {
  const i = html.indexOf('function ' + name + '(');
  assert(i !== -1, `function ${name} not found`);
  let k = html.indexOf('{', i), depth = 0;
  for (;;) {
    const ch = html[k];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (!depth) return html.slice(i, k + 1); }
    k++;
  }
}
function _xConst(name, closer) {
  const i = html.indexOf('const ' + name + ' =');
  assert(i !== -1, `const ${name} not found`);
  const j = html.indexOf(closer, i);
  return html.slice(i, j + closer.length);
}
let SIM = null;
test('real generators extract and run (harness sanity)', () => {
  const src = [
    "let LANG='es'; const t=()=>''; let WINES=null;",
    _xConst('DISHES_EN', '\n];'),
    _xFn('getDish'),
    _xConst('DISHES', '\n];'),
    _xFn('_djShuffle'),
    _xFn('_simPick'),
    _xFn('_simExtractIngredients'),
    _xFn('_simNonRemovableAllergens'),
    _xFn('_scenarioModification'),
    _xFn('_scenarioVegetarian'),
    'return {DISHES, DISHES_EN, getDish, _simExtractIngredients, _simNonRemovableAllergens, _scenarioModification, _scenarioVegetarian};'
  ].join('\n');
  SIM = new Function(src)(); // eslint-disable-line no-new-func
  assert(SIM.DISHES.length > 50, 'DISHES extraction failed');
});

test('bug 1: no Modification option may be a valid comanda of the dish (Tartar de solomillo)', () => {
  // Owner screenshot: "¿Cómo se comanda?" offered BOTH "SIN MOSTAZA SAVORA"
  // (correct) and "SIN EL PAN" — but the card also says "Comandar SIN PAN
  // CARASAU", so two options were right. The collision sets are now seeded
  // with EVERY real pair and word-overlapping fakes are excluded.
  const tartar = SIM.DISHES.find(d => d.id === 16);
  assert(tartar, 'Tartar de solomillo (id 16) missing');
  for (let i = 0; i < 300; i++) {
    const q = SIM._scenarioModification(tartar, tartar, false);
    assert(q && q.correctIdx >= 0 && new Set(q.options).size === 4, 'malformed modification question');
    q.options.forEach((opt, oi) => {
      if (oi === q.correctIdx) return;
      assert(!/\bPAN\b|CARASAU|MOSTAZA|SAVORA/i.test(opt),
        `distractor overlaps a real comanda of the dish: "${opt}" (correct: "${q.options[q.correctIdx]}")`);
    });
  }
});

test('bug 2: vegetarian variant claim requires REAL variant data', () => {
  // Owner: "Ravioli solo hay de pularda y de espinaca, no hay de boletus."
  // The old heuristic matched the word "boletus" inside the FILLING and told
  // vegetarians that a Boletus ravioli exists. The variant verdict now needs
  // a `variants` array with a verifiably vegetarian flavour.
  const ravioli = SIM.DISHES.find(d => d.id === 23);
  const qv = SIM._scenarioVegetarian(ravioli, ravioli, false);
  assert(qv, 'vegetarian scenario must fire for Ravioli de pularda');
  assert(/^No — lleva productos animales/.test(qv.options[qv.correctIdx]),
    `Ravioli de pularda must be a plain NO, got: "${qv.options[qv.correctIdx]}"`);
  assert(!/Boletus/i.test(qv.explain), 'explain must not invent a Boletus ravioli');
  // (Las croquetas se separaron en fichas individuales sin variantes; el caso
  // positivo de "variante vegetariana real" ya no aplica a ellas.)
});

test('bug 3: no oil may ever be an ingredient question subject', () => {
  // Owner: "La mayoría de platos están hechos con aceite de Oliva, no usamos
  // otro aceite" — oil compounds (Aceite de oliva / olive oil / Aceite Dauro)
  // slipped past the bare-word pantry filter and produced unanswerable
  // questions ("¿cuál llevaba aceite de oliva?").
  for (const d of [...SIM.DISHES, ...SIM.DISHES_EN]) {
    for (const ing of SIM._simExtractIngredients(d)) {
      assert(!/^aceite\b/i.test(ing) && !/\boil\b/i.test(ing),
        `oil leaked as a question target: "${ing}" (${d.name})`);
    }
  }
});

test('bug 4: substitution vocabulary counts as retirability (ostras, tartar, drill)', () => {
  // Owner: "El gluten se puede evitar. Se prepararía la selección de ostras
  // sin la frita con panko." The card says "se puede sustituir" — posRe now
  // recognizes preparation/substitution phrasings.
  const ostras = SIM.DISHES.find(d => d.id === 10);
  const nrO = SIM._simNonRemovableAllergens(ostras);
  for (const a of ['Gluten', 'Huevos', 'Soja']) {
    assert(!nrO.includes(a), `Selección de ostras: ${a} must be REMOVABLE (se puede sustituir / SIN PANKO)`);
  }
  const tartar = SIM.DISHES.find(d => d.id === 16);
  assert(!SIM._simNonRemovableAllergens(tartar).includes('Apio'),
    'Tartar de solomillo: Apio must be removable (puede prepararse sin mostaza savora)');
  assert(/sustituir\|cambiar\|evitar/.test(html), 'posRe substitution vocabulary missing');
  // The allergen drill must use the same clause-scoped parser — its old
  // segment heuristic said "blocked" while the adapt option quoted the real
  // comanda (two defensible answers on screen).
  const drill = html.slice(html.indexOf('function buildAllergenQuestions'), html.indexOf('function startAllergenTest'));
  assert(/_simNonRemovableAllergens\(dish\)/.test(drill), 'drill must classify retirability via _simNonRemovableAllergens');
  assert(/_fakeBank = _comandaBank\.filter/.test(drill), "drill fake comanda must exclude the dish's own comandas");
  assert(/_ownComandas/.test(drill), 'drill adapt verdict must quote a real comanda of THIS dish');
});

test('bug 5+6: recommendations exclude side-named twins; avoid/adapt pools are twin-safe and removability-aware', () => {
  // Owner: "No está bien recomendar una guarnición como sustituto de un
  // entrante o principal" — lunch/dinner copies of Guarniciones items pass
  // the category filter, so recommendation pools filter by display name too.
  // And a dish the guest "should avoid" must carry the allergen NON-removably
  // (SharedAllergen once said Selección de ostras' gluten "no se puede
  // retirar" — false premise) for EVERY dish sharing the display name (both
  // tatakis are "Tuna tataki" in EN with different cards).
  assert(/function _simIsSideNamed\(/.test(html), '_simIsSideNamed helper missing');
  assert(/function _simDisplayTwins\(/.test(html) && /function _simTwinsAll\(/.test(html), 'display-twin helpers missing');
  const sa = html.slice(html.indexOf('function _scenarioSafeAlternative'), html.indexOf('function _srShuffleOpts'));
  assert(/_simOfferable\(d\)/.test(sa), 'SafeAlternative must offer only offerable dishes (no sides, no kids menu, no Vegetariano)');
  assert(/_simTwinsAll\(d, t=>t\.allergens && t\.allergens\.includes\(allergen\) && _simNonRemovableAllergens\(t\)\.includes\(allergen\)\)/.test(sa),
    'SafeAlternative wrongs must be non-removable carriers for every twin');
  const sh = html.slice(html.indexOf('function _scenarioSharedAllergen'), html.indexOf('function _scenarioWinePairing'));
  assert(/_simNonRemovableAllergens\(t\)\.includes\(a\)/.test(sh) && /_simTwinsAll/.test(sh),
    'SharedAllergen correct pool must be twin-safe non-removable carriers');
  const wa = html.slice(html.indexOf('function _scenarioWhichAdaptable'), html.indexOf('function _srWaitMins'));
  assert(/(_simOfferable\(d\)|!_simIsSideNamed\(d\))/.test(wa) && /_simTwinsAll/.test(wa),
    'WhichAdaptable must exclude side-named dishes and be twin-safe');
  const iw = html.slice(html.indexOf('function _scenarioIngredientWhere'), html.indexOf('function _srGenerateQuiz'));
  assert(/_simTwinsAll\(target/.test(iw) && /_simTwinsAll\(s/.test(iw), 'IngredientWhere must be twin-safe on target and clean pool');
});

test('exam reversed questions: identical passages / duplicate names cannot yield two corrects', () => {
  // Data audit: embutidos/jamón/cecina share one history verbatim; lunch and
  // dinner twins share ingredient lists; Ensalada verde exists twice. A
  // distractor with the same answer text or display name as the correct dish
  // made two options right in "which dish is this?" questions.
  // Ampliado jul 2026 (reporte del propietario, tomates con/sin ventresca): la
  // guarda de nombre pasó de igualdad exacta (_seenNames) a gemelo de nombre
  // (_acceptedNames + _txNameTwin) para excluir también variantes veg / turnos /
  // prefijos indistinguibles como opciones.
  const ex = html.slice(html.indexOf('function startExam'), html.indexOf('function renderExamQuestion'));
  assert(/_correctAns/.test(ex) && /_acceptedNames/.test(ex) && /_txNameTwin\(/.test(ex) && /_twNorm\(a\.replace/.test(ex),
    'startExam reversed twin/duplicate guard missing');
});

// ─── Navigation restructure (v7.196): clean categories/subcategories ──
console.log('\nNavigation IA (v7.196)');

test('vinos: Flash+Quiz merged into a single Práctica subtab with mode toggle', () => {
  // Owner approved merging the two practice chips — the Vinos bar overflowed
  // with 8 chips and Flash/Quiz are the same activity (practice).
  assert(!/\['wineFlash','Flash',''\]/.test(html) && !/\['wineQuiz','Quiz',''\]/.test(html),
    'old wineFlash/wineQuiz chips must be gone from the Vinos bar');
  assert(/\['practica',_en\?'Practice':'Práctica',''\]/.test(html),
    'the Práctica chip must exist (ES/EN)');
  assert(/function _renderWinePractica\(/.test(html) && /sub === 'practica'/.test(html),
    'renderVinos must dispatch practica to _renderWinePractica');
  // Legacy deep links ('wineFlash'/'wineQuiz') normalize instead of 404ing
  // into the carta fallback.
  assert(/sub==='wineFlash' \|\| sub==='wineQuiz'/.test(html) && /_vinoSubTab = 'practica'/.test(html),
    'legacy wineFlash/wineQuiz values must normalize to practica');
  // The toggle is part of the bar string so both renderers keep it on re-render.
  const wp = html.slice(html.indexOf('function _renderWinePractica'), html.indexOf('function _renderWineFlashcards'));
  assert(/wine-practice-toggle/.test(wp) && /_renderWineQuiz\(c, bar \+ seg\)/.test(wp) && /_renderWineFlashcards\(c, bar \+ seg\)/.test(wp),
    'practica must inject the mode toggle into the bar for both modes');
  // Sommelier quick-access entries route through the merged subtab.
  assert(/_vinoSubTab='practica';_vinoPractica='flash';renderVinos\(\)/.test(html)
      && /_vinoSubTab='practica';_vinoPractica='quiz';renderVinos\(\)/.test(html),
    'quick-access index must deep-link into practica modes');
  const css = read('styles.css');
  assert(/\.wine-practice-toggle\{/.test(css) && /\.wp-seg\.on\{/.test(css),
    'practice toggle styles missing');
});

test('nav tab renamed LQA → Auditoría (labels only, ids/routes intact)', () => {
  // "LQA" was internal jargon; the tab is named after what you do there.
  assert(/<\/svg> Auditoría<\/button>/.test(html), 'nav button label must be Auditoría');
  assert(!/<\/svg> LQA<\/button>/.test(html), 'nav button must not say LQA anymore');
  assert(/navProtocolo: LANG==='en'\?'Audit':'Auditoría',/.test(html),
    'applyLangToApp must localize the tab as Audit/Auditoría');
  // Internal wiring unchanged — localStorage compat and deep links.
  assert(/id="navProtocolo" onclick="showTab\('protocolo'\)"/.test(html),
    'button id and protocolo route must not change');
  assert(/'Practicar en Auditoría →'/.test(html),
    'global-search LQA card must point at the renamed tab');
  // LQA remains as the real standard name INSIDE the section.
  assert(/Leading Quality Assurance/.test(html), 'the LQA hub hero keeps the standard name');
});

test('allergen drill moved from Examen to Aprender → Repaso Inteligente', () => {
  // Training belongs in Aprender; Examen stays pure evaluation.
  const exam = html.slice(html.indexOf('function renderExamSetup'), html.indexOf('function _examToggleCustom'));
  assert(!/startAllergenTest/.test(exam), 'renderExamSetup must no longer offer the drill');
  const smart = html.slice(html.indexOf('function renderSmartReview'), html.indexOf('function _aprenderGlobalSearch'));
  assert(/class="ri-drill"/.test(smart) && /startAllergenTest\(null\)/.test(smart),
    'Repaso Inteligente must host the drill as a terminal mission');
  assert(/SIMULACRO DE ALÉRGENOS/.test(smart) && /ALLERGEN DRILL/.test(smart),
    'drill card must be bilingual');
  // Results screen returns to its new home, not to Examen.
  const res = html.slice(html.indexOf('function renderAllergenResults'), html.indexOf('function renderSupAnalytics'));
  assert(/_subTab\.aprender='smart';showTab\('aprender'\)/.test(res),
    'drill results must navigate back to Aprender (smart)');
  assert(!/renderExam\(\)/.test(res), 'drill results must not route back to Examen');
  const css = read('styles.css');
  assert(/\.ri-drill\{/.test(css) && /\.ri-drill-title\{/.test(css),
    'ri-drill styles missing');
  assert(!/ri-drill-blink/.test(css),
    'el parpadeo de terminal del drill no debe volver (rediseño pergamino jul 2026)');
});

test('ranking hub aggregates game records (local-first + Supabase merge)', () => {
  // Owner: "toda la competición en un solo sitio" — the Ranking tab now
  // aggregates the Mr. Shoesmith and Camarero Survivors boards; the
  // in-context boards (Juegos hub, game start screen) stay where they are.
  assert(/function _renderRankingGames\(/.test(html), '_renderRankingGames missing');
  assert(/id="rankingGames"/.test(html), 'renderRanking must include the games host div');
  const fn = html.slice(html.indexOf('function _renderRankingGames'), html.indexOf('function renderRanking()'));
  assert(/supaFetchTxokoTop10/.test(fn) && /supaFetchEtTop/.test(fn),
    'both game leaderboards must be fetched');
  // Local paint must happen BEFORE the remote fetch resolves (instant UI).
  assert(fn.indexOf('paint(shoeLocal, etLocal)') < fn.indexOf('Promise.all'),
    'must paint local records before awaiting Supabase');
  assert(/if\(!document\.getElementById\('rankingGames'\)\) return;/.test(fn),
    'remote repaint must bail if the user navigated away');
  assert(/class="tx-top10"/.test(fn), 'boards must reuse the tx-top10 style');
});

test('onboarding guide matches the real Juegos hub (no Modo Error promise)', () => {
  // The guide promised "Modo Error" inside Juegos but the mode only lives in
  // the dashboard "Débiles" shortcut; the games page now lists what exists.
  assert(!/Modo Error/.test(html) && !/Error Mode/.test(html),
    'guide must not promise Modo Error anywhere');
  const games = html.slice(html.indexOf("title_es:'Juegos y Duelos'"), html.indexOf("title_es:'Juegos y Duelos'") + 900);
  assert(/Camarero Survivors/.test(games), 'games guide page must mention Camarero Survivors');
  // Dead leftovers of the removed Modo Error card must stay gone.
  const hub = html.slice(html.indexOf('function renderTxoko()'), html.indexOf('function renderTxTop10()'));
  assert(!/getFailedDishes|failedLabel/.test(hub), 'renderTxoko must not compute unused failed-dish counters');
  // The mode itself still exists from the dashboard shortcut.
  assert(/onclick="startPersonalErrorMode\(\)"/.test(html), 'dashboard Débiles shortcut must survive');
});

test('la actividad lleva UN solo nombre en todas partes: Repaso Inteligente', () => {
  // Auditoría A1 + rediseño jul 2026: mismo criterio de siempre (un nombre
  // único), nombre nuevo — «Simulación» murió con el disfraz de terminal.
  assert(/title_es:'Repaso inteligente',title_en:'Smart review'/.test(html),
    'la guía de onboarding debe usar el nombre nuevo');
  assert(/Aprender → Repaso/.test(html) && /Learn → Review/.test(html),
    'la guía debe decir DÓNDE vive ahora la sesión (renombrada a Repaso, jul 2026)');
  // El titular de la pantalla, sea cual sea la caja: lo que se comprueba es
  // que la actividad se llame igual aquí que en la guía, no que vaya en
  // mayúsculas (sept 2026 dejó de ir en versalitas forzadas).
  const tit = html.match(/class="ri-title">\$\{_en\?'([^']+)':'([^']+)'\}/);
  assert(tit, 'no encuentro el titular de la pantalla de Repaso');
  assert(/^smart review$/i.test(tit[1]) && /^repaso inteligente$/i.test(tit[2]),
    `la cabecera de la pantalla debe decir Repaso Inteligente, dice «${tit[2]}»`);
  assert(/'Smart review' : 'Repaso inteligente'/.test(html),
    'el historial de XP debe usar el nombre nuevo');
});

test('dashboard «Hoy»: héroe pergamino de dos estados + stats + filas numeradas (rediseño jul 2026)', () => {
  // Exploración de diseño aprobada por el propietario: UNA tarjeta pergamino
  // dominante con dos estados (Reto del día pendiente ⇄ Plato del día al
  // terminarlo), tira de stats (racha · precisión · liga) y filas numeradas
  // compactas; el detalle sigue en el acordeón #hoyDetail (fila 03).
  const dash = html.slice(html.indexOf('function renderDashboard()'), html.indexOf('// ═══════ FLASHCARDS'));
  assert(/\$\{_en\?'Today':'Hoy'\}/.test(dash), 'the Hoy divider must exist');
  assert(/_pddHeroHTML\(emp,_en\)/.test(dash), 'el héroe de dos estados debe renderizarse en Hoy');
  // El héroe: estado A = reto pendiente (CTA Empezar), estado B = plato del día.
  const hero = html.slice(html.indexOf('function _pddHeroHTML('), html.indexOf('function _pddAsyncFill('));
  assert(/_dqIsDone\(emp\)/.test(hero) && /openDailyReto\(\)/.test(hero),
    'estado A del héroe: reto pendiente con CTA Empezar');
  assert(/_pddDishOfDay\(todayStr\(\)\)/.test(hero) && /_emplOpen\(\$\{d\.id\}\)/.test(hero),
    'estado B del héroe: plato del día con Ver ficha');
  assert(/RETO HECHO ✓/.test(hero), 'el estado B debe mostrar el sello RETO HECHO');
  // Plato del día determinista: mismo día ⇒ mismo plato para todo el equipo.
  const pdd = html.slice(html.indexOf('function _pddDishOfDay('), html.indexOf('function _pddTecFor('));
  assert(/_mulberry32\(/.test(pdd) && !/Math\.random\(/.test(pdd),
    '_pddDishOfDay debe ser determinista (semilla por fecha, sin Math.random)');
  // Chips honestos: SIN GLUTEN ✓ solo si el plato NO declara gluten.
  assert(/!al\.includes\('Gluten'\)/.test(hero), 'el chip SIN GLUTEN solo sale si no hay gluten declarado');
  // Tira de stats + filas numeradas + acordeón.
  assert(/class="hoy-stats"/.test(dash) && /id="hoyLigaPos"/.test(dash),
    'la tira de stats (racha · precisión · liga) debe existir');
  assert(/class="hoy-numrow"/.test(dash) && /_hoyToggle\(\)/.test(dash),
    'las filas numeradas deben existir y la 03 abre el acordeón');
  assert(/id="hoyDetail" style="display:none/.test(dash), 'detail must start collapsed');
  assert(/\$\{renderWeeklyChallenge\(\)\}\s*\$\{_m\.rows\}/.test(dash),
    'challenge and mission rows must live inside #hoyDetail');
  assert(!/'Needs practice':'Necesita práctica'/.test(dash),
    'the redundant weak-topic alert row must stay removed');
  // «Próximo rango» se retiró del Inicio entero (ago 2026): duplicaba la
  // barra de XP con otra escalera distinta y confundía (0% junto a Lv.7).
  assert(!/_rankProg/.test(dash), 'la fila «Próximo rango» debe seguir fuera del Inicio');
  // renderDailyMissions exposes per-mission state for the rows/detail.
  assert(/return \{ rows, done: doneCount, total: missions\.length, list \};/.test(html),
    'renderDailyMissions must return the per-mission list');
  assert(/function _hoyToggle\(\)/.test(html), '_hoyToggle accordion missing');
  // Rellenos asíncronos: foto (dish-photos), maridaje (wines) y liga (nube).
  assert(/_pddAsyncFill\(\);/.test(dash), 'renderDashboard debe disparar _pddAsyncFill tras pintar');
  const fill = html.slice(html.indexOf('function _pddAsyncFill('), html.indexOf('// ═══ LIGA SEMANAL'));
  assert(/loadDishPhotos/.test(fill) && /_pddWineFor/.test(fill) && /_ligaPosCache/.test(fill),
    '_pddAsyncFill debe rellenar foto, maridaje y posición de liga (con caché)');
  const css = read('styles.css');
  assert(/\.pdd-hero\{/.test(css) && /\.hoy-stats\{/.test(css) && /\.hoy-numrow\{/.test(css),
    'estilos del héroe/stats/filas numeradas ausentes');
});

test('Line Up: ritual de antes del servicio — 5 pasos reales, rotación determinista (fase 2, jul 2026)', () => {
  // Fase 2 del rediseño aprobado. El propietario llama «Line Up» a la reunión
  // de antes del servicio (no «briefing»). 5 pasos con contenido REAL que rota
  // determinista (mismo día ⇒ mismo contenido para todo el equipo): Reto ·
  // Plato del día · Vino de la semana · Protocolo Forbes · Código del día.
  assert(/function renderLineUp\(/.test(html) && /id="lineupWrap"/.test(html),
    'la pantalla Line Up debe existir');
  const lu = html.slice(html.indexOf('// ═══ LINE UP'), html.indexOf('// ═══ LIGA SEMANAL'));
  assert(lu.length>500 && !/Math\.random\(/.test(lu),
    'los contenidos del Line Up deben rotar con semilla determinista, sin Math.random()');
  assert(/_luWineOfWeek/.test(lu) && /_luStdOfDay/.test(lu) && /_luCodeOfDay/.test(lu),
    'vino de la semana, protocolo del día y código del día deben existir');
  assert(/_wkKey\(\)\.replace/.test(lu), 'el vino rota por SEMANA (clave del lunes), no por día');
  assert(/LQA_STANDARDS\[/.test(lu) && /CODIGO_CAMARERO\.cards\[/.test(lu),
    'protocolo y código del día deben salir del contenido real (LQA_STANDARDS / codigo-camarero.json)');
  assert(/emp\.luPddDay/.test(lu) && /emp\.luWineWk/.test(lu) && /emp\.luStdDay/.test(lu) && /emp\.luCdgDay/.test(lu),
    'cada paso debe marcar su estado hecho');
  assert(/SIGUIENTE/.test(lu) || /'NEXT'/.test(lu), 'la tarjeta SIGUIENTE del mockup debe existir');
  assert(/renderLineUp\(\)/.test(html.slice(html.indexOf('function renderDashboard()'), html.indexOf('// ═══════ FLASHCARDS'))),
    'el inicio debe tener la entrada al Line Up');
  // El término de la casa es «Line Up», no «briefing», en el texto de la app.
  assert(!/briefing/i.test(html.slice(html.indexOf('// ═══ LINE UP'), html.indexOf('// ═══ LIGA SEMANAL'))),
    'en la pantalla se dice Line Up, no briefing');
  const css = read('styles.css');
  assert(/\.lu-row\{/.test(css) && /\.lu-row\.done .lu-t\{/.test(css),
    'estilos de las filas del Line Up ausentes (incluido el tachado de hechas)');
});

test('vinos: Sensorial+Mapa merged under Estudio — the bar holds 5 chips', () => {
  // IA audit (C2+A2): 7 chips overflowed on a phone and "Aprende" clashed
  // with the main "Aprender" tab. Estudio = Conceptos · Sensorial · Mapa.
  assert(!/\['sensorial',_en\?'Sensory':'Sensorial',''\]/.test(html) && !/\['mapa',_en\?'Map':'Mapa',''\]/.test(html),
    'sensorial/mapa chips must be gone from the Vinos bar');
  assert(/\['aprende',_en\?'Study':'Estudio',''\]/.test(html),
    'the Estudio chip must exist (no more Aprende/Aprender clash)');
  assert(/function _renderWineStudy\(/.test(html) && /sub === 'aprende'\)\{ _renderWineStudy\(c, bar\); \}/.test(html),
    'renderVinos must dispatch aprende to _renderWineStudy');
  assert(/sub==='sensorial' \|\| sub==='mapa'/.test(html) && /_vinoAprendeView = sub/.test(html),
    'legacy sensorial/mapa values must normalize into Estudio');
  const ws = html.slice(html.indexOf('function _renderWineStudy'), html.indexOf('function _renderWinePractica'));
  assert(/wine-practice-toggle wp3/.test(ws) && /_renderSensoryMap\(c, bar \+ seg\)/.test(ws)
      && /_renderWineMap\(c, bar \+ seg\)/.test(ws) && /_renderWineLearn\(c, bar \+ seg\)/.test(ws),
    'Estudio must delegate to the three views with the toggle in the bar');
  const css = read('styles.css');
  assert(/\.wine-practice-toggle\.wp3\{grid-template-columns:1fr 1fr 1fr\}/.test(css),
    'wp3 three-column toggle style missing');
});

test('EN mode: stats known-by-category bars are localized', () => {
  // Same class of bug as the Emplatado dividers (v7.198), other screen.
  const st = html.slice(html.indexOf('function renderStats()'), html.indexOf('function renderVideos()'));
  assert(/catLocal\(cat\):cat\}<\/span><div class="t-stat-track">/.test(st),
    'renderStats category bars must localize via catLocal');
});

test('EN mode: ranking chips and plating category dividers are localized', () => {
  // EN sweep (v7.198): the Ranking hub chip said "Estadísticas" and the
  // Emplatado guide grouped dishes under raw Spanish category keys.
  assert(/\['stats',LANG==='en'\?'Stats':'Estadísticas','◇'\]/.test(html),
    'ranking Stats chip must localize');
  const empl = html.slice(html.indexOf('function _emplRender'), html.indexOf('function _emplOpen'));
  assert(/catLocal\(cat\)/.test(empl),
    'plating dividers must localize the canonical category key via catLocal');
  // Canonical key must still drive the grouping/icons (only the label localizes).
  assert(/CAT_ICONS\[dd\.cat\]/.test(empl), 'CAT_ICONS must keep using the canonical key');
});

test('nav sheet: grouped into Consulta/Formación/Equipo (labels only)', () => {
  // UX audit: 8 flat root options read as 3 chunks — no added taps/depth.
  assert(/id="navGrpConsulta"/.test(html) && /id="navGrpFormacion"/.test(html) && /id="navGrpEquipo"/.test(html),
    'the three nav group labels must exist');
  const nav = html.slice(html.indexOf('id="appNav"'), html.indexOf('</nav>'));
  const order = ['navSearchEntry','navGrpConsulta','navDashboard','navGrpFormacion','navAprender','navExam','navProtocolo','navVinos','navGrpEquipo','navTxoko','navRanking','navChat'];
  let last = -1;
  for (const id of order) {
    const i = nav.indexOf('id="' + id + '"');
    assert(i > last, 'nav order broken at ' + id);
    last = i;
  }
  assert(/id="navChat" onclick="showTab\('chat'\)"/.test(nav), 'chat route/id must not change');
  assert(/navGrpFormacion: LANG==='en'\?'Training':'Formación'/.test(html), 'group labels must localize');
  const css = read('styles.css');
  assert(/\.nav-group-lbl\{/.test(css), 'nav group label style missing');
});

test('renames: Terraza / Repaso / Repasar fallos (labels only)', () => {
  // One place, one name: the tab matches the screen (La Terraza); the dish
  // browser is "Repaso" («La Carta es muy confuso», propietario jul 2026);
  // the error-mode shortcut says what it does.
  assert(/<\/svg> Terraza<\/button>/.test(html) && !/<\/svg> Chat<\/button>/.test(html),
    'nav tab must say Terraza');
  assert(/navChat: LANG==='en'\?'Terrace':'Terraza'/.test(html), 'applyLangToApp must localize Terraza');
  assert(/\['repaso',_en\?'Review':'Repaso',''\]/.test(html), 'Aprender chip must say Repaso');
  assert(!/'The Menu':'La Carta'/.test(html), 'no visible label may still say La Carta/The Menu');
  assert(/'Review misses':'Repasar fallos'/.test(html),
    'dashboard error-mode shortcut must say Repasar fallos');
  assert(/'Abrir Terraza'/.test(read('sw.js')), 'push action must match the tab name');
});

test('Logros live as a Ranking chip; Inicio keeps a one-row summary', () => {
  // The 42-gem gallery was buried at the bottom of the longest screen.
  assert(/\['logros',LANG==='en'\?'Achievements':'Logros','◆'\]/.test(html),
    'Logros chip missing from Ranking hub');
  assert(/logros:renderLogros/.test(html) && /function renderLogros\(/.test(html), 'renderLogros not wired');
  assert(/logros:renderRankingHub/.test(html), 'logros route missing from renderMap');
  assert(/stats:'ranking', logros:'ranking'/.test(html), 'logros parent mapping missing (nav highlight breaks)');
  const dash = html.slice(html.indexOf('function renderDashboard()'), html.indexOf('function checkActiveLiveSession'));
  assert(!/\$\{renderAchievementsSection\(\)\}/.test(dash), 'the full gallery must leave the dashboard');
  assert(/_subTab\.ranking='logros';showTab\('logros'\)/.test(dash),
    'dashboard summary row must deep-link to Ranking → Logros');
  assert(/function renderAchievementsSection\(/.test(html) && /function _toggleAchievements\(/.test(html),
    'gallery renderer and its toggle must survive (they render inside renderLogros now)');
});

test('wine map degrades gracefully without maplibre (offline)', () => {
  // P2: with the CDN unreachable the map died silently; now a note replaces
  // the frame and the D.O.s render as a static list grouped by region.
  const idx = html.indexOf('async function _initWineLeafletMap');
  const init = html.slice(idx, idx + 4500);
  assert(/typeof maplibregl === 'undefined'/.test(init), 'offline guard missing');
  assert(/wineDOList/.test(init) && /regionDots\.filter/.test(init),
    'offline fallback must render the region/D.O. list');
  assert(init.indexOf("typeof maplibregl === 'undefined'") < init.indexOf('_webglOk'),
    'offline guard must run before the WebGL check');
});

test('Hook F1: record cards, crowns, duel juice and the overtaken trigger', () => {
  // The social bridge Juegos → Ranking → Terraza: records stop dying on the
  // player's own screen. 1-tap opt-in sharing; auto-post ONLY when taking #1.
  assert(/function _refreshChampions\(/.test(html) && /function _txCrownFor\(/.test(html)
      && /function _txShareRecord\(/.test(html) && /function _txRecordMsg\(/.test(html)
      && /function _txThroneCheck\(/.test(html) && /function _hoyCheckOvertaken\(/.test(html),
    'social-loop helpers missing');
  assert(/_txShareRecord\(_txRecordMsg\('shoesmith',\$\{txokoState\.score\}\),this\)/.test(html),
    'Mr. Shoesmith record screen must offer the share button');
  assert(/id="etShareBtn"/.test(html) && /_txRecordMsg\('survivors',_secs,_ord\)/.test(html),
    'Camarero Survivors game over must offer the share button');
  assert(/_txRecordMsg\('duelo','\$\{dScore\}-\$\{cScore\}',remoteDuelState\.rivalName\)/.test(html),
    'duel victory must offer the share button');
  assert(/if\(isRecord\) _txThroneCheck\('txoko', txokoState\.score\);/.test(html)
      && /_txThroneCheck\('elturno', Math\.floor\(G\.time\)\)/.test(html),
    'taking the #1 must auto-post the crown card');
  // The Terrace dresses [récord] messages as cards and crowns the champions.
  assert(/chat-record-card/.test(html) && /\[récord\] /.test(html),
    'chat must style [récord] messages as cards');
  assert(/chat-author">\$\{_chatEsc\(m\.employee\)\}\$\{_txCrownFor\(m\.employee\)\}/.test(html),
    'chat authors must wear the champion crown');
  assert(/\$\{escapeHTML\(emp\.name\)\}\$\{_txCrownFor\(emp\.name\)\}/.test(html),
    'ranking XP rows must wear the champion crown');
  assert(/<div class="chat-title">La Terraza<\/div>/.test(html),
    'the chat screen title must match the tab (La Terraza)');
  // Duel victory juice: confetti + streak (loss resets, draw keeps it).
  assert(/if\(iWon && typeof launchConfetti==='function'\) launchConfetti/.test(html),
    'duel win must fire confetti');
  assert(/emp\.duelStreak=\(emp\.duelStreak\|\|0\)\+1/.test(html) && /else if\(cWins\)\{ emp\.duelStreak=0; \}/.test(html),
    'duel streak must grow on win and reset on loss');
  assert(/duel-victory-ico/.test(html) && /duel-streak/.test(html),
    'victory trophy/streak visuals missing');
  // Overtaken trigger on the dashboard.
  assert(/id="hoyOvertaken"/.test(html) && /_hoyCheckOvertaken\(\);/.test(html),
    'dashboard must host and fire the overtaken check');
  const css = read('styles.css');
  assert(/\.chat-record-card\{/.test(css) && /\.tx-crown\{/.test(css) && /\.tx-share-btn\{/.test(css)
      && /\.hoy-overtaken\{/.test(css) && /\.duel-victory-ico\{/.test(css),
    'hook-loop styles missing');
  // Anti-spam: record cards must NOT blast push notifications.
  const share = html.slice(html.indexOf('async function _txShareRecord'), html.indexOf('function _txThroneCheck'));
  assert(!/send-push/.test(share), 'record cards must not send mass push');
});

// ─── Recuperación de PIN por correo ─────────────────────────────
console.log('\nRecuperación de PIN por correo');
test('backend reset-pin existe y cubre las tres acciones', () => {
  assert(existsSync(join(ROOT, 'supabase/functions/reset-pin/index.ts')),
    'falta supabase/functions/reset-pin/index.ts');
  const fn = read('supabase/functions/reset-pin/index.ts');
  for (const a of ["'set-email'", "'request'", "'confirm'"])
    assert(fn.includes(a), `la Edge Function debe manejar la acción ${a}`);
  // set-email exige que el hash del PIN coincida (prueba de identidad)
  assert(/emp\.pin\s*!==\s*pinHash/.test(fn) && /'auth'/.test(fn),
    'set-email debe rechazar (auth) si el PIN no coincide');
  // los tokens se guardan HASHEADOS, nunca en claro
  assert(/token_hash/.test(fn) && /sha256hex\(token\)/.test(fn),
    'los tokens deben guardarse como sha256(token)');
  // los correos NO viven en employees (allow_all público) sino en la tabla protegida
  assert(/employee_recovery/.test(fn), 'los correos deben ir a employee_recovery (tabla protegida)');
  // request no debe filtrar si un correo existe (siempre ok:true)
  assert(/no revelar existencia/.test(fn) || /no filtrar/.test(fn),
    'request no debe revelar si el correo existe');
});
test('la app cablea recuperación de PIN sin enviar el PIN en claro', () => {
  // helpers de red
  for (const f of ['supaSetRecoveryEmail', 'supaRequestPinReset', 'supaConfirmPinReset',
                   'openPinRecovery', 'showPinReset', 'promptRecoveryEmail'])
    assert(html.includes('function ' + f), `falta la función ${f}`);
  // deep-link #reset= capturado en el arranque y disparado en autoLogin
  assert(/#reset=/.test(html) && /_pendingPinReset/.test(html),
    'debe capturarse el deep-link #reset= y guardarlo en _pendingPinReset');
  assert(/if\(_pendingPinReset\)\{[\s\S]*showPinReset/.test(html),
    'autoLogin debe abrir showPinReset cuando hay token pendiente');
  // la clave nueva se cifra en el cliente antes de confirmar (hashPin → hash)
  const reset = html.slice(html.indexOf('function showPinReset'), html.indexOf('function promptRecoveryEmail'));
  assert(/await hashPin\(a\)/.test(reset) && /supaConfirmPinReset\(token,\s*h\)/.test(reset),
    'showPinReset debe hashear la clave en el cliente y enviar solo el hash');
  // la pantalla de reset acepta contraseña de texto libre (sirve a ambos flujos)
  assert(/id="pinResNew"/.test(reset) && /id="pinResConf"/.test(reset),
    'showPinReset debe usar campos de contraseña de texto libre');
  // el correo se guarda con el hash del PIN como prueba (nunca sin verificar)
  assert(/supaSetRecoveryEmail\(name,\s*pinHash,\s*email\)/.test(html),
    'set-email debe llevar el hash del PIN como prueba de identidad');
  // el enlace "olvidaste" solo aparece al INTRODUCIR el PIN, no al configurarlo
  const modal = html.slice(html.indexOf('function showPinModal'), html.indexOf('// ═══════ RECUPERACIÓN'));
  assert(/pinStep==='enter'/.test(modal) && /openPinRecovery\(\)/.test(modal),
    'el enlace de recuperación solo debe mostrarse en el paso "enter"');
});
test('filtro de turno (DISH_SERVICE) coherente con las cartas reales', () => {
  const m = html.match(/const DISH_SERVICE = (\{[^}]*\});/);
  assert(m, 'no se encontró DISH_SERVICE');
  const SV = eval('(' + m[1] + ')');
  // valores válidos únicamente
  for (const [id, v] of Object.entries(SV))
    assert(v === 'a' || v === 'c' || v === 'ambos', `#${id} tiene servicio inválido: ${v}`);
  // gemelos por turno (recetas distintas) — cada uno a SU carta
  // Ya no son gemelos: el de cena salió de la carta y queda uno, de almuerzo.
  assert(SV[69] === 'a', 'Fish and chips: solo almuerzo');
  assert(SV[109] === undefined, 'el Fish and chips de cena ya no está en la carta');
  assert(SV[78] === 'a' && SV[9] === 'c', 'Tataki: 78 almuerzo · 9 cena');
  // lunch-only reales (no deben salir en cena)
  for (const id of [95, 96, 97, 92, 93, 94, 73, 74, 84, 102, 104, 105, 86, 91])
    assert(SV[id] === 'a', `#${id} debe ser solo ALMUERZO`);
  // dinner-only reales (no deben salir en almuerzo) — incluye veg de solo-cena
  // El 49 se fusionó con el 15 (mismo plato, dos páginas del plating guide);
  // el 15 es «ambos», así que sale de esta lista de solo-cena.
  for (const id of [23, 24, 25, 26, 40, 41, 34, 17, 18, 19, 20, 21, 22, 112, 48, 52, 53, 54])
    assert(SV[id] === 'c', `#${id} debe ser solo CENA`);
  // vegetarianos de solo-almuerzo
  for (const id of [120, 121]) assert(SV[id] === 'a', `#${id} debe ser solo ALMUERZO`);
  // reparto razonablemente equilibrado (no todo 'ambos')
  const cnt = { a: 0, c: 0, ambos: 0 };
  for (const v of Object.values(SV)) cnt[v]++;
  assert(cnt.a >= 30 && cnt.c >= 30, `reparto desequilibrado: ${JSON.stringify(cnt)}`);
});
test('zona de Ajustes: entrada, perfil, correo, cambio de clave', () => {
  // botón de entrada en la cabecera
  assert(/id="ajustesBtn"[^>]*onclick="openAjustes\(\)"/.test(html),
    'la cabecera debe tener el botón ⚙ que abre openAjustes()');
  assert(html.includes('function openAjustes('), 'falta la función openAjustes');
  // helpers de red para estado de correo y cambio de clave
  assert(html.includes('function supaEmailStatus') && html.includes('function supaChangePin'),
    'faltan los helpers supaEmailStatus / supaChangePin');
  const aj = html.slice(html.indexOf('function openAjustes'), html.indexOf('// Sync visible dots from hidden input'));
  // secciones clave presentes
  assert(/ajEmail/.test(aj) && /ajPass1/.test(aj) && /ajPass2/.test(aj) && /ajLogout/.test(aj) && /ajAvatar/.test(aj),
    'Ajustes debe incluir correo, cambio de clave, avatar y cerrar sesión');
  // el cambio de clave se cifra en el cliente y usa el hash actual como prueba
  assert(/await hashPin\(a\)/.test(aj) && /supaChangePin\(currentUser,\s*pinHash,\s*h\)/.test(aj),
    'cambiar clave debe hashear en cliente y probar identidad con el hash actual');
  // el correo se guarda con prueba de identidad (mismo helper que la recuperación)
  assert(/supaSetRecoveryEmail\(currentUser,\s*pinHash,\s*email\)/.test(aj),
    'guardar correo en Ajustes debe llevar el hash del PIN como prueba');
  // backend cubre las acciones nuevas
  const fn = read('supabase/functions/reset-pin/index.ts');
  assert(/'email-status'/.test(fn) && /'change-pin'/.test(fn),
    'la Edge Function debe manejar email-status y change-pin');
  assert(/maskEmail/.test(fn), 'el estado del correo debe devolverse enmascarado');
});
test('la recuperación está cableada también en el login por contraseña', () => {
  // enlace "¿Olvidaste tu PIN o contraseña?" en el formulario visible
  assert(/id="loginForgotLink"[^>]*onclick="openPinRecovery\(\)"/.test(html) ||
         (/id="loginForgotRow"/.test(html) && /id="loginForgotLink"/.test(html) && /openPinRecovery\(\)/.test(html)),
    'el login por contraseña debe ofrecer "¿Olvidaste tu PIN o contraseña?"');
  // se muestra al iniciar sesión y se oculta al crear cuenta
  assert(/forgot\.style\.display\s*=\s*'block'/.test(html) && /forgot\.style\.display\s*=\s*'none'/.test(html),
    'el enlace de recuperación debe alternarse con el modo del login');
  // usuario nuevo por contraseña → se le ofrece el correo de recuperación
  assert(/promptRecoveryEmail\(resolvedName,\s*hashed\)/.test(html),
    'un usuario nuevo (contraseña) debe recibir el prompt de correo');
  // usuario existente → aviso único por dispositivo
  assert(/recEmailAsked:/.test(html) && /promptRecoveryEmail\(userName,\s*hashedPin\)/.test(html),
    'un usuario existente debe recibir el aviso de correo una sola vez por dispositivo');
  // ...pero NO si la cuenta ya tiene correo en el servidor (evita re-preguntar
  // al entrar desde otro dispositivo, donde la bandera local no existe)
  assert(/const st=await supaEmailStatus\(userName, hashedPin\)[\s\S]{0,120}hasEmail=!!st\.data\.hasEmail/.test(html),
    'el aviso de correo debe comprobar el servidor (email-status) antes de pedirlo');
  assert(/if\(hasEmail\)\{[^}]*recEmailAsked:'\+userName[\s\S]{0,120}else \{ promptRecoveryEmail\(userName, hashedPin\); \}/.test(html),
    'si el servidor dice que ya tiene correo se marca y no se pregunta; si no, decide la puerta');
});

test('Primera sesión: los avisos hacen cola, no se apilan', () => {
  // Auditoría ago 2026: al darse de alta salían la guía de 9 pasos, el diálogo
  // del correo (900 ms después, sin mirar si la guía seguía abierta) y el aviso
  // de métricas (a los 6 s). Medido en captura: dos overlays a la vez encima del
  // dashboard. Para una plantilla que ya encuentra la app complicada, son tres
  // muros antes del primer contenido útil.
  assert(/function _uiOverlayUp\(\)/.test(html) && /function _uiWhenClear\(/.test(html),
    'debe existir la cola de primeras impresiones');
  assert(/_UI_OVERLAY_SEL\s*=\s*\[[^\]]*'#onboardingOverlay'[^\]]*'#recEmailOverlay'/.test(html),
    'la cola debe reconocer la guía y el diálogo de correo como overlays');
  assert(/_uiQueueBusy/.test(html), 'la cola debe impedir que dos avisos salgan a la vez');
  // Trampa encontrada al verificar: .gs-overlay (el buscador) vive SIEMPRE en el
  // DOM con display:none. Comprobar solo si el elemento existe dejaba la cola
  // bloqueada para siempre y ningún aviso salía nunca. Hay que mirar si se ve.
  const up = _xFn('_uiOverlayUp');
  assert(/_uiVisible/.test(up), '_uiOverlayUp debe comprobar visibilidad, no solo presencia');
  const visFn = _xFn('_uiVisible');
  assert(/display==='none'/.test(visFn) && /visibility==='hidden'/.test(visFn)
      && /getBoundingClientRect/.test(visFn),
    '_uiVisible debe descartar display:none, visibility:hidden y cajas de tamaño cero');
  assert(/'\.gs-overlay'/.test(html), 'el buscador debe estar en la lista (es el que reveló la trampa)');
  // El aviso de métricas pasa por la cola.
  assert(/_uiWhenClear\(_tmMaybePrivacyNotice\)/.test(html),
    'el aviso de métricas debe esperar turno');
  // La puerta del correo: nada en la primera sesión, y la marca «ya preguntado»
  // se pone al mostrarlo — si se pusiera antes, aplazar sería no preguntar nunca.
  const gate = _xFn('promptRecoveryEmail');
  assert(/recEmailSesiones:/.test(gate) && /if\(n < 2\) return;/.test(gate),
    'el correo no puede pedirse en la primera sesión');
  assert(/_uiWhenClear\(\(\)=>\{[\s\S]*recEmailAsked:'\+name, '1'[\s\S]*_recEmailShow\(name, pinHash\)/.test(gate),
    'la marca «ya preguntado» debe ponerse dentro de la cola, al mostrarlo');
  assert(gate.indexOf('_uiWhenClear') < gate.indexOf('_recEmailShow'),
    'el diálogo solo se muestra a través de la cola');
  // Y el diálogo en sí no puede invocarse saltándose la puerta. Solo hay dos
  // sitios legítimos: la propia puerta y el repintado por cambio de idioma
  // (que reabre uno que YA estaba en pantalla, no lo estrena).
  const permitidos = [_xFn('promptRecoveryEmail'), _xFn('_langRemountOverlays'), _xFn('_recEmailShow')];
  const totales = (html.match(/_recEmailShow\(/g) || []).length;
  const justificadas = permitidos.reduce((n, f) => n + (f.match(/_recEmailShow\(/g) || []).length, 0);
  assert(totales === justificadas,
    `_recEmailShow se llama desde algún sitio que no es la puerta ni el repintado de idioma (${totales} usos, ${justificadas} justificados)`);
});

// ─── Endurecimiento de seguridad ────────────────────────────────
console.log('\nSeguridad');
test('custom_dishes: escrituras por Edge Function gateada, no anon directo', () => {
  // backend con verificación de supervisor
  assert(existsSync(join(ROOT, 'supabase/functions/manage-content/index.ts')),
    'falta supabase/functions/manage-content/index.ts');
  const fn = read('supabase/functions/manage-content/index.ts');
  assert(/verify_supervisor_pin/.test(fn) && /'dish-upsert'/.test(fn) && /'dish-delete'/.test(fn),
    'manage-content debe verificar el PIN de supervisor y cubrir upsert/delete');
  assert(/error:\s*'auth'/.test(fn), 'manage-content debe rechazar sin PIN de supervisor');
  // cliente: las escrituras van por manage-content, NO por el POST directo a la tabla
  const up = html.slice(html.indexOf('async function supaUpsertCustomDish'), html.indexOf('async function syncCustomDishesFromCloud'));
  assert(/functions\/v1\/manage-content/.test(up) && /supPin/.test(up),
    'supaUpsertCustomDish debe llamar a manage-content con el PIN de supervisor');
  assert(!/rest\/v1\/custom_dishes[^?]*`,\s*\{\s*method:\s*'POST'/.test(up),
    'no debe quedar escritura directa (POST) a rest/v1/custom_dishes');
  // el PIN de supervisor se guarda en memoria al autenticar y se borra al salir
  assert(/let _supPin\s*=\s*null/.test(html) && /_supPin\s*=\s*entered/.test(html) && /_supPin\s*=\s*null;/.test(html),
    '_supPin debe fijarse al autenticar y limpiarse al salir');
});

test('simulacro de alérgenos: abre desde Aprender y sale hacia donde se lanzó', () => {
  // Reporte del propietario (jul 2026): «el simulacro de alérgenos no
  // funciona». El drill se movió de Examen a Aprender → Repaso, pero la
  // guarda anti-repintado seguía comparando currentTab con 'exam' fijo, así
  // que renderAllergenQuestion salía sin pintar y el toque no hacía nada.
  assert(/startTime: Date\.now\(\), cat, tab: currentTab/.test(html),
    'startAllergenTest debe registrar la pestaña de lanzamiento en el estado');
  assert(/if\(!allergenTestState \|\| currentTab!==\(allergenTestState\.tab\|\|'exam'\)\) return;/.test(html),
    'la guarda anti-repintado debe comparar contra la pestaña registrada, no contra exam fijo');
  assert(!/if\(!allergenTestState \|\| currentTab!=='exam'\) return;/.test(html),
    'la guarda antigua (exam fijo) no debe volver — mataba el drill desde Aprender');
  // La salida ← vuelve a Aprender si se lanzó desde ahí (antes saltaba a Examen)
  const abortFn = html.slice(html.indexOf('function abortAllergenTest'), html.indexOf('function renderAllergenQuestion'));
  assert(/_subTab\.aprender='smart';\s*showTab\('aprender'\)/.test(abortFn) && /else renderExam\(\)/.test(abortFn),
    'abortAllergenTest debe volver a Aprender cuando el drill se lanzó desde ahí');
  // Y el punto de entrada sigue existiendo en el terminal de Repaso
  assert(/onclick="startAllergenTest\(null\)" class="ri-drill"/.test(html),
    'la tarjeta del simulacro debe seguir en el terminal de Repaso Inteligente');
});

test('quiz del Viaje del plato: ingrediente falso limpio y de la misma categoría', () => {
  // Reporte del propietario (jul 2026): pregunta del Flan marmolado con
  // respuesta «brócoli» — el split(',') crudo dejaba tokens rotos
  // ("brócoli)", "Flan: Leche") y el falso salía de CUALQUIER plato, así que
  // la pregunta se respondía por absurdo. Ahora comparte tokenizador con los
  // escenarios y el falso solo sale de platos hermanos de categoría.
  // La pregunta del ingrediente ausente vive ahora en su propia función, justo
  // antes del ensamblado: se retiró de dentro de _djGenerateQuiz para que las
  // preguntas puedan elegirse sin repetir tipo (sept 2026, «también se están
  // repitiendo preguntas»). La ventana empieza ahí para seguir cubriéndola.
  const djGen = html.slice(html.indexOf('function _djQIngredienteAusente('), html.indexOf('var allergenData_en'));
  assert(/const ingredients = _simExtractIngredients\(dd\);/.test(djGen),
    'los ingredientes reales del quiz deben pasar por _simExtractIngredients (limpia paréntesis)');
  assert(!/dish\.ingredients\.split\(','\)/.test(djGen),
    'el split(",") crudo no debe volver — producía opciones rotas tipo "brócoli)"');
  assert(/d\.cat===dish\.cat\)/.test(djGen),
    'el ingrediente falso debe salir SOLO de platos de la misma categoría');
  assert(/_simIngredientOverlapsDish\(i, dd\)/.test(djGen),
    'el falso debe pasar el filtro de sinónimos (papa/patata) para no mentir al huésped');
  assert(!/Aceite de trufa/.test(djGen),
    'sin relleno inventado: si no hay falso válido, la pregunta cae al fallback de historia/recuento');
  // Idioma: los ingredientes salen del plato LOCALIZADO (dd), no del base ES
  // — en inglés se mostraban ingredientes en español.
  assert(/const ingredients = _simExtractIngredients\(dd\);/.test(djGen),
    'los ingredientes del quiz deben salir del plato localizado (dd), no del base ES');
  assert(/otherDishes\.map\(d=>getDish\(d\)\)\.flatMap\(d=>_simExtractIngredients\(d\)\)/.test(djGen),
    'los ingredientes falsos deben localizarse también (getDish) para no mezclar idiomas');
  assert(/if\(il === _dishNameLow\) return false;/.test(djGen),
    'el nombre del propio plato no puede salir como ingrediente (Tarta de queso)');
  // Alérgenos: comparación por sinónimos para no ofrecer como ausente un
  // alérgeno que el plato sí tiene con otro nombre (Sésamo/Granos de sésamo).
  assert(/const _allNorm = a =>/.test(djGen) && /dishAllNorm\.has\(_allNorm\(a\)\)/.test(djGen),
    'el distractor de alérgeno debe compararse por sinónimos (Granos de sésamo ≡ Sésamo)');
  assert(/dishAllNorm\.has\('crustaceo'\) \|\| dishAllNorm\.has\('molusco'\)\) dishAllNorm\.add\('marisco'\)/.test(djGen),
    'Mariscos debe contar como presente si el plato lleva Crustáceos o Moluscos');
  assert(/'Granos de sésamo':'Sesame'/.test(html) && /'Cacahuete':'Peanut'/.test(html),
    'allergenData_en debe traducir Granos de sésamo y Cacahuete (los usa la carta)');
});

test('ficha técnica del plato: muestra el maridaje ordenado por precio', () => {
  // Reporte del propietario (jul 2026): «en la ficha técnica de los platos no
  // aparece el maridaje». renderRepasoDishDetail no tenía tarjeta de vinos.
  assert(/function _dishPairWines\(dish, limit\)\{/.test(html),
    'debe existir el helper _dishPairWines que cruza plato ↔ vinos');
  const helper = html.slice(html.indexOf('function _dishPairWines(dish, limit){'), html.indexOf('function renderRepasoDishDetail'));
  // Orden por precio: la copa y los recomendados ya no viven en los datos.
  assert(/sort\(\(a,b\)=>\(a\.price\|\|0\)-\(b\.price\|\|0\)\)/.test(helper),
    'el maridaje debe ordenarse por precio');
  assert(/return null;/.test(helper),
    'debe devolver null si la lista de vinos aún no ha cargado (carga diferida)');
  // La ficha inserta la tarjeta y sabe recargar cuando llegan los vinos
  const ficha = html.slice(html.indexOf('function renderRepasoDishDetail(dishId){'), html.indexOf('function changeRepasoTopic'));
  assert(/const _pairWines = _dishPairWines\(dish, 3\);/.test(ficha),
    'la ficha debe calcular el maridaje (máx 3)');
  assert(/🍷 \$\{LANG==='en'\?'Wine pairing':'Maridaje'\}/.test(ficha),
    'la ficha debe pintar una tarjeta de Maridaje');
  assert(/\$\{maridajeHtml\}/.test(ficha),
    'la tarjeta de maridaje debe insertarse en el cuerpo de la ficha');
  assert(/if\(_pairWines === null && typeof loadLazyData/.test(ficha) && /repasoView==='dish' && repasoDishId===dishId\) renderRepasoDishDetail\(dishId\)/.test(ficha),
    'si los vinos no habían cargado, la ficha debe recargarse al recibirlos (solo si sigue abierta)');
});

test('Horarios: la semana nueva aparece sin reabrir la app (refresco >5 min)', () => {
  // Bug real (jul 2026): el supervisor subió la semana del lunes 27 y en los
  // móviles con la PWA ya abierta «no aparecía» — el array HORARIOS en
  // memoria no caducaba nunca. Ahora renderHorarios refresca en silencio si
  // los datos tienen más de 5 min y solo repinta si el cuadrante cambió.
  assert(/let _horAt=0;/.test(html), 'falta la marca de tiempo de la carga de HORARIOS');
  const rh = html.slice(html.indexOf('function renderHorarios()'), html.indexOf('function _horHoyHTML'));
  assert(/Date\.now\(\)-_horAt > 5\*60000/.test(rh), 'renderHorarios debe refrescar los datos con más de 5 min');
  assert(/_horLoad\(true\)/.test(rh) && /JSON\.stringify\(HORARIOS\)!==prev/.test(rh),
    'el refresco es silencioso: red directa y repintado SOLO si el cuadrante cambió');
  assert(/_horAt=Date\.now\(\);\s*\/\/ una sola petición/.test(rh),
    'la marca se adelanta para no disparar una petición por cada re-render');
  const hl = html.slice(html.indexOf('async function _horLoad'), html.indexOf('function _horDayISO'));
  assert(/_horAt=new Date\(cached\.at\)\.getTime\(\)/.test(hl) && /_horAt=Date\.now\(\)/.test(hl),
    '_horLoad debe fechar los datos tanto de caché como de red');
});

test('Supervisor: resumen semanal listo para compartir (liga + actividad)', () => {
  // Ecosistema F1 (propietario): la palanca de enganche es la visibilidad —
  // un mensaje semanal que el supervisor reenvía por WhatsApp con el podio
  // de la liga, quién entrenó y quién no.
  const fn = html.slice(html.indexOf('function _supResumenTxt'), html.indexOf('function renderSupAnalytics'));
  assert(fn.length > 100, 'falta el generador _supResumenTxt');
  // ── Este guard EJECUTA el generador; antes solo leía su código fuente. ──
  // La versión de lectura no vio que el PR #433 («Fuera el Cliente IA») se
  // llevó por delante las CINCO líneas que construían el mensaje y dejó
  // `return L.join('\n')` apuntando a una variable borrada. Todas sus
  // expresiones regulares seguían encontrando lo que buscaban: «Sin
  // actividad» estaba, sí, pero en un COMENTARIO. Resultado: la pantalla de
  // Análisis del supervisor reventaba entera desde la v7.386 —y con ella el
  // Código de acceso, que vive dentro— hasta que el propietario lo vio.
  const lunes = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10); })();
  const ahora = new Date().toISOString();
  const hace60 = new Date(Date.now() - 60 * 86400000).toISOString();
  const mk = o => Object.assign({ extras: {}, lastActiveAt: ahora }, o);
  const equipo = {
    Nube:  mk({ extras: { wk: { k: lunes, xp: 900 } } }),   // XP solo en la nube
    Local: mk({ wkKey: lunes, wkXP: 400 }),                  // XP solo en el dispositivo
    Vago:  mk({}),                                           // vivo y sin entrenar
    Viejo: mk({ lastActiveAt: hace60 })                      // perfil fantasma
  };
  const nombres = Object.keys(equipo);
  const cargar = new Function('LANG', '_wkKey', '_dispName', fn + '; return _supResumenTxt;'); // eslint-disable-line no-new-func
  const run = (lang, prev) => cargar(lang, () => lunes, n => n)(equipo, nombres, prev);

  for (const lang of ['es', 'en']) {
    const txt = run(lang, false);
    assert(typeof txt === 'string' && txt.length > 0, `el resumen (${lang}) no devuelve texto`);
    const L = txt.split('\n');
    assert(L.length >= 3, `el resumen (${lang}) sale con ${L.length} línea(s): ${JSON.stringify(txt)}`);
    // El podio fusiona nube Y dispositivo: solo nube dejaba fuera al propio
    // supervisor («Duvan no estudió» mientras la Liga lo ponía 3º, jul 2026).
    assert(/🥇 Nube \+900/.test(txt), `el podio debe leer la XP de la nube (${lang}): ${txt}`);
    assert(/🥈 Local \+400/.test(txt), `el podio debe leer la XP del dispositivo (${lang}): ${txt}`);
    // «Sin actividad» nombra a quien no entrenó, pero solo al equipo VIVO.
    assert(/Vago/.test(txt), `el mensaje debe nombrar a quien no entrenó (${lang}): ${txt}`);
    assert(!/Viejo/.test(txt), `un perfil sin señal de vida en 30 días no cuenta (${lang}): ${txt}`);
    assert(/\(2\/3\)/.test(txt), `entrenaron 2 de una plantilla viva de 3 (${lang}): ${txt}`);
  }
  // Semana en curso y semana cerrada dan cabeceras distintas (lunes por la
  // mañana el supervisor quiere la que acaba de terminar).
  assert(run('es', false).split('\n')[0] !== run('es', true).split('\n')[0],
    'la semana cerrada debe generar una cabecera distinta de la semana en curso');
  // El mensaje se reenvía por WhatsApp: van los nombres VISIBLES.
  assert(/🥇 Ada L\./.test(cargar('es', () => lunes, n => (n === 'Nube' ? 'Ada L.' : n))(equipo, nombres, false)),
    'el resumen debe usar el nombre visible, no el usuario');
  // La sección del panel: alternador de semana + copiar + WhatsApp
  const sec = html.slice(html.indexOf('const resumenSection'), html.indexOf('// ── DÓNDE FALLA EL EQUIPO'));
  assert(/window\._supResWk/.test(html) && /'prev' : 'cur'/.test(html),
    'el lunes debe abrirse en la semana CERRADA por defecto');
  assert(/window\._supResText/.test(sec) && /wa\.me\/\?text=/.test(sec) && /clipboard\.writeText/.test(sec),
    'la sección debe ofrecer copiar y compartir por WhatsApp sin pelear con comillas');
  assert(/_acc\('res',[\s\S]{0,220}resumenSection\)/.test(html),
    'la sección debe pintarse en el panel de análisis (acordeón Resumen semanal)');
});

test('Supervisor: «Conectados hoy» compara en hora LOCAL, no UTC', () => {
  // Bug real (captura del propietario a las 00:11 locales): las marcas de
  // conexión son ISO UTC y se comparaban con todayStr() (fecha local) —
  // entre medianoche y la 01:00 en Canarias todo el equipo salía como
  // desconectado. _supLocalDay convierte la marca a día local.
  assert(/function _supLocalDay\(iso\)/.test(html), 'falta el conversor a día local');
  assert(/_supLocalDay[\s\S]{0,220}timeZone:'Atlantic\/Canary'/.test(html),
    'el conversor debe usar la MISMA zona que todayStr() (día canario), no la del navegador');
  const sup = html.slice(html.indexOf('function _supLocalDay'), html.indexOf('function renderSupAnalytics'));
  assert((sup.match(/_supLocalDay\(lt\)/g)||[]).length>=3,
    'KPI y listado de Conectados Hoy deben comparar con el día local');
  assert(!/lt\.substring\(0,10\)\s*[=!]==?\s*today/.test(sup),
    'no puede quedar ninguna comparación de fecha UTC contra todayStr()');
});

test('Horarios: entrar a las 14:00 cuenta también en almuerzo', () => {
  // Petición del propietario: un 14:00-22:00 cubre el final del almuerzo
  // aunque el grueso del turno sea de cena — debe salir en AMBOS rangos.
  const fn = html.slice(html.indexOf('function _horRango('), html.indexOf('function _horDayRangos'));
  assert(/if\(r==='cena' && t\.s<=840\) r='ambos';/.test(fn),
    'los turnos que empiezan a las 14:00 o antes deben contar también en almuerzo');
  assert(/t\.dur>=540/.test(fn), 'los dobles de 9h+ siguen contando en ambos');
});

test('Analítica del supervisor: titular + acordeones (rediseño anti-scroll)', () => {
  // Propietario jul 2026: «hay que deslizar mucho y la información es
  // abrumadora». La pantalla abre con 3 números (semáforo) y todas las
  // secciones plegadas — la cabecera de cada una lleva su dato clave.
  const ana = html.slice(html.indexOf('function renderSupAnalytics'), html.indexOf('function renderSupLqaStats'));
  assert(/class="sup-hl"/.test(ana) && /sup-hl-pill/.test(ana),
    'falta el titular con las píldoras de lo esencial');
  assert(/const _acc=\(id,icon,title,meta,body\)=>/.test(ana) && /<details class="sup-acc"/.test(ana),
    'las secciones deben ser acordeones <details> plegables');
  assert(/window\._supAccOpen = new Set\(_riskN \? \['alg'\] : \[\]\)/.test(ana),
    'solo Alérgenos se abre sola, y únicamente cuando hay riesgo');
  assert(/window\._supAccOpen\.add\('\$\{id\}'\)/.test(ana),
    'el estado abierto/cerrado debe recordarse entre re-renders');
  // El acordeón 'mesa' era el del Cliente IA, retirado en sep 2026.
  for (const id of ['alg','res','act','perf','dish'])
    assert(new RegExp("_acc\\('"+id+"'").test(ana), `falta el acordeón '${id}'`);
  const css = read('styles.css');
  assert(/\.sup-acc summary\{[^}]*min-height:48px/.test(css), 'cabeceras de acordeón con área táctil de 48px');
  assert(/\.sup-acc\[open\] \.sup-acc-ch\{transform:rotate\(90deg\)\}/.test(css), 'el chevrón debe girar al abrir');
});

test('Horarios: sin apellidos en pantalla (solo nombre de pila)', () => {
  // Petición del propietario: los apellidos no salen en Horarios. El nombre
  // COMPLETO sigue en los datos (es la clave de cada fila); _horShort lo
  // recorta al pintar y añade la inicial del apellido solo si dos personas
  // comparten nombre («Ana K.» / «Ana M.»).
  assert(/function _horShort\(n\)/.test(html), 'falta el recortador _horShort');
  assert(/first\+' '\+parts\[1\]\[0\]\+'\.'/.test(html),
    'con nombres repetidos debe añadirse la inicial del apellido');
  assert(/hor-row-n">\$\{escapeHTML\(_horShort\(x\.n\)\)\}/.test(html),
    'las filas de rangos deben pintar el nombre corto');
  assert(/hor-name">\$\{escapeHTML\(_horShort\(r\.n\)\)\}/.test(html),
    'el cuadrante debe pintar el nombre corto');
  assert(/- \$\{_horShort\(x\.n\)\}/.test(html),
    'el mensaje de rangos (copiar/WhatsApp) debe llevar el nombre corto');
  assert(/_horPickName\('\$\{escapeHTML\(n\)/.test(html),
    'el selector «¿cuál eres tú?» guarda el nombre COMPLETO aunque muestre el corto');
  // Los títulos de servicio van limpios: solo «ALMUERZO» / «CENA», sin la
  // franja horaria (petición del propietario) — la ventana sigue viva en la
  // lógica de clasificación (_horRango), que no es cosa de pantalla.
  assert(/'LUNCH':'ALMUERZO'\}\$\{cubFor\('almuerzo'\)\}/.test(html)
      && /'DINNER':'CENA'\}\$\{cubFor\('cena'\)\}/.test(html),
    'los títulos de servicio de la vista Hoy no llevan franja horaria');
  assert(/'Lunch':'Almuerzo'\}\$\{cub\('almuerzo'\)\}/.test(html)
      && /'Dinner':'Cena'\}\$\{cub\('cena'\)\}/.test(html),
    'el mensaje de rangos tampoco lleva franja horaria');
});

test('Chip de actualización: aviso sutil en cabecera (sin push masivo)', () => {
  // Propietario jul 2026: el empujón por push «resulta molesto». En su lugar,
  // un chip dorado discreto aparece en la cabecera cuando el sw.js del
  // servidor trae versión nueva; el usuario decide cuándo tocar.
  assert(/id="updChip"[^>]*onclick="_updGo\(\)"/.test(html), 'falta el chip de actualización en la cabecera');
  assert(/id="updChip"[^>]*style="display:none/.test(html), 'el chip debe nacer oculto');
  const chk = html.slice(html.indexOf('function _updGo'), html.indexOf('function _renderShiftBar'));
  assert(/Date\.now\(\)-_updLastCheck < 10\*60000/.test(chk),
    'la comprobación debe autolimitarse a una cada 10 minutos');
  assert(/fetch\('\.\/sw\.js', \{ cache:'no-store' \}\)/.test(chk),
    'la versión del servidor se lee de sw.js sin caché');
  assert(/m\[1\]===APP_VERSION/.test(chk), 'solo se muestra si la versión difiere de la instalada');
  assert(/\.catch\(\(\)=>\{\}\)/.test(chk), 'un fallo de red no puede romper nada (silencioso)');
  assert(/if\(confirm\([^)]*\)\) forceAppUpdate\(\)/.test(chk),
    'tocar el chip confirma y lanza forceAppUpdate');
  assert(/typeof _updCheckInApp==='function' && typeof currentUser!=='undefined' && currentUser\) _updCheckInApp\(\)/.test(html),
    'la comprobación debe engancharse a la navegación (showTab)');
  const css = read('styles.css');
  assert(/\.upd-dot\{[^}]*animation:updPulse/.test(css), 'el punto dorado debe latir');
  assert(/prefers-reduced-motion:reduce\)\{ \.upd-dot\{ animation:none \} \}/.test(css),
    'sin latido con movimiento reducido');
});

// ─── 6b. Alta, acuerdo de confidencialidad y nombre visible ─────
console.log('\nAcceso');

test('Acceso: la cuenta la crea el SERVIDOR, no el móvil', () => {
  // Llega con M.B.: el restaurante quiere que su plating guide y los datos de su
  // equipo no se vean desde fuera. La clave anónima va escrita en el HTML, así
  // que un código comprobado en el móvil se salta abriendo las herramientas del
  // navegador: la única comprobación que vale es la del servidor.
  assert(/function supaRegisterEmployee\(/.test(html), 'falta la llamada de alta');
  assert(/_supaRpc\('employee_register'/.test(html),
    'el alta pasa por employee_register, que es quien valida el código');
  const log = html.slice(html.indexOf('async function loginWithPassword(){'),
                         html.indexOf('function showLegalModal('));
  assert(/alta = await supaRegisterEmployee\(resolvedName, hashed, codigo\)/.test(log),
    'la rama de cuenta nueva tiene que llamar al servidor');
  assert(!/emp\.pin = hashed;\s*\n\s*emp\.lang = LANG;\s*\n\s*saveDB\(\);\s*\n\s*setEmployeePinServer/.test(log),
    'ya no se crea la cuenta en local y se sube después: eso saltaba el código');
  assert(/if\(!isSignup\)\{/.test(log),
    'entrar con una cuenta que no existe ya no la crea en silencio');
  // El código decide el restaurante. Si lo eligiera quien se registra, entrar en
  // M.B. sería tan fácil como tocar otra tarjeta en el selector del login.
  assert(/if\(alta\.venue\) selectVenue\(alta\.venue\)/.test(log),
    'el restaurante lo fija el código, no el selector');
  // Y el campo sólo aparece al crear cuenta.
  assert(/id="loginFieldCode"/.test(html), 'falta el campo del código');
  assert(/if\(fieldCode\) fieldCode\.style\.display = 'block';/.test(html)
      && /if\(fieldCode\) fieldCode\.style\.display = 'none';/.test(html),
    'el código se enseña en alta y se esconde al entrar');
});

test('Acceso: el acuerdo de confidencialidad se firma una vez y con su versión', () => {
  // La firma vale para el TEXTO que se firmó. Si el acuerdo cambia, se sube la
  // versión en data/nda.json y vuelve a pedirse: una firma vieja no cubre un
  // texto nuevo.
  const nda = JSON.parse(read('data/nda.json'));
  assert(nda.version && typeof nda.version === 'string', 'el acuerdo necesita versión');
  // El interruptor. Hoy está en false a petición del propietario, que paró el
  // asunto de las firmas mientras cierra la parte legal; el texto y el
  // mecanismo se quedan montados. Encenderlo es poner 'activo': true.
  assert(typeof nda.activo === 'boolean', 'el acuerdo necesita su interruptor «activo»');
  assert(/if\(nda\.activo === false\) return false;/.test(html),
    'con el interruptor apagado no se le pide la firma a nadie');
  for (const lang of ['es', 'en']) {
    const t = nda[lang];
    assert(t && t.titulo && t.intro, `falta el acuerdo en ${lang}`);
    assert(Array.isArray(t.clausulas) && t.clausulas.length >= 4,
      `el acuerdo en ${lang} se ha quedado sin cláusulas`);
    for (const c of t.clausulas) assert(c && c.t && c.p, `cláusula incompleta en ${lang}`);
    assert(t.firma_boton && t.firma_ayuda && t.firma_placeholder, `falta la firma en ${lang}`);
  }
  assert(/_supaRpc\('nda_sign'/.test(html), 'la firma la guarda el servidor');
  assert(/supaNdaSign\(name, v, \(_NDA\|\|\{\}\)\.version\)/.test(html),
    'la versión del texto viaja con la firma');
  // Nombre y apellidos: dos palabras de verdad. Se comprueba aquí Y en el
  // servidor; «asdf» no es firmar.
  const val = html.slice(html.indexOf('function _ndaNombreValido('),
                         html.indexOf('async function ndaFirmar('));
  assert(/\{2,\}\( \[A-Za-z/.test(val), 'la firma exige al menos dos palabras');
  assert(/try\{ ndaPendiente\(pinTarget\)\.then\(hay => \{ if\(hay\) ndaMostrar\(pinTarget\)/.test(html),
    'el acuerdo se comprueba al entrar');
  const css = read('styles.css');
  assert(/\.nda-overlay\{[^}]*position: fixed[^}]*inset: 0/.test(css), 'el acuerdo tapa la app entera');
  assert(/\.nda-firma-input\{[^}]*font-size: 16px/.test(css),
    '16px reales: por debajo iOS Safari hace zoom al enfocar y descoloca el documento');
  assert(/\.nda-boton\{[^}]*min-height: 48px/.test(css), 'el botón se toca con el dedo');
});

test('Acceso: el nombre visible se cambia, el usuario no', () => {
  // Con dos restaurantes habrá dos Marías. El usuario es la clave primaria y de
  // ella cuelgan el chat, el marcador, los duelos y los avisos, así que no se
  // toca; lo que se personaliza es el nombre que ve el equipo.
  assert(/const _DISP = new Map\(\)/.test(html) && /function _dispName\(name\)/.test(html),
    'falta el resolutor de nombre visible');
  assert(/_EMP_COLS='[^']*display_name/.test(html) && /_EMP_COLS='[^']*nda_version/.test(html),
    'las consultas de siempre tienen que bajar display_name y nda_version');
  assert(/_dispLearn\(rows\)/.test(html), 'la caché se llena con lo que ya baja el ranking');
  assert(/escapeHTML\(_dispName\(pinTarget\)\)/.test(html), 'la cabecera enseña el nombre visible');
  // El cambio va por el servidor con el hash como prueba: la policy de
  // employees deja escribir a cualquiera, así que un PATCH desde el móvil
  // permitiría renombrar a un compañero.
  assert(/_supaRpc\('employee_set_display_name', \{p_name:currentUser, p_sha:pinHash/.test(html),
    'renombrarse exige la contraseña y lo hace el servidor');
});

test('Acceso: ninguna consulta cruza de un restaurante a otro', () => {
  // Hasta ahora el selector de restaurante del login sólo pintaba colores: el
  // chat, el marcador, los duelos, los avisos y los horarios eran comunes. El
  // día que entrara M.B., su equipo habría visto el chat y el ranking de Txoko,
  // que es justo lo que el restaurante no quiere.
  //
  // Se barren TODAS las URLs sobre tablas compartidas y se exige el filtro a
  // las que leen una colección. Las de una sola fila (id=eq., name=eq.) no lo
  // necesitan: ya van a una fila concreta.
  assert(/function _venueActual\(\)/.test(html) && /function _vq\(\)/.test(html),
    'falta el resolutor de restaurante');
  // Manda el de la nube, que lo fijó el código del manager. El selector del
  // login no vale como fuente: es estética y se cambia tocando otra tarjeta.
  const va = html.slice(html.indexOf('function _venueActual(){'), html.indexOf('function _vq()'));
  assert(va.indexOf('DB.employees[currentUser]') < va.indexOf('ACTIVE_VENUE'),
    'el restaurante de la nube manda sobre el del selector');

  const TABLAS = ['chat_messages','scores','notifications','duels','horarios','employees','live_sessions'];
  const re = /\/rest\/v1\/(\w+)([^`'"]*)/g;
  const fugas = [], colecciones = [];
  let m;
  while ((m = re.exec(html))) {
    const [, tabla, resto] = m;
    if (!TABLAS.includes(tabla)) continue;
    // Ojo con la frontera: sin el [?&] delante, «season_id=eq.» contiene
    // «id=eq.» y dos consultas de duelos se colaban como si fueran de una fila.
    const unaFila = /[?&](id|name|endpoint|employee_name)=(eq|ilike)\./.test(resto);
    const lee = /select=|order=|&or=|state=eq\.|expires_at=/.test(resto);
    if (!lee || unaFila) continue;
    const linea = html.slice(0, m.index).split('\n').length;
    colecciones.push(linea);
    if (!/_vq\(\)/.test(resto)) fugas.push(`L${linea} ${tabla}${resto.slice(0, 70)}`);
  }
  assert(colecciones.length >= 12,
    `el barrido sólo ve ${colecciones.length} consultas de colección: el detector se ha quedado ciego`);
  assert(fugas.length === 0,
    `consultas sin filtro de restaurante: ${fugas.slice(0, 6).join(' · ')}`);
  // Y lo que se escribe queda sellado, o el filtro de mañana no lo encuentra.
  for (const marca of [
    "_vSello({ employee, score: record, total: 1, topic: 'txoko'",
    "_vSello({ employee, score: secs, total: orders, topic: 'elturno'",
    '_vSello({ target, message, type, read: false })',
    '_vSello({ employee: me, room: CHAT_ROOM })',
    '_vSello({ challenger: fromUser, challenged: toUser,',
  ]) assert(html.includes(marca), `falta el sello de restaurante en: ${marca.slice(0, 50)}`);
});

test('Quesos: nunca se le dice a un vegetariano que sí sin saberlo', () => {
  // Sección de consulta, no de plato: 48 fichas no caben como uno. Lo que se
  // pregunta en mesa no es la maduración, es «¿puedo comerlo?».
  assert(/function renderQuesos\(\)/.test(html), 'falta la sección de quesos');
  assert(/'lqa','vinos','quesos','sala','chat'/.test(html), 'quesos tiene que ser una ruta válida');
  assert(/renderMap = \{quesos:renderQuesos,/.test(html), 'y tener quien la pinte');
  assert(/id="navQuesos"[^>]*style="display:none"/.test(html),
    'el botón sale sólo si el restaurante tiene carro, así que arranca escondido');

  // LA regla: sin cuajo anotado NO se afirma que valga. Decirle a un vegetariano
  // que un queso le vale cuando no se sabe es peor que no saberlo.
  const apto = html.slice(html.indexOf('function _qApto(q){'), html.indexOf('function _qCruda('));
  assert(/if\(!c\) return null;/.test(apto),
    'sin cuajo anotado se devuelve null (no consta), nunca true');
  assert(/return c !== 'animal';/.test(apto), 'sólo el cuajo no animal vale');
  assert(/_qApto\(q\) !== true/.test(html),
    'el filtro de vegetarianos exige true: «no consta» no cuela');
  assert(/apto === null[\s\S]{0,160}?q-m-duda/.test(html),
    'un queso sin cuajo anotado tiene que llevar su marca de duda en la ficha');

  // El filtro de cerdo mira «cerdo», no «manteca»: el Cerro del Ángel está
  // «madurado de manteca floral» y se le escondía a quien no come cerdo.
  assert(/function _qCerdo\(q\)\{ return \/cerdo\/i\.test/.test(html),
    '«manteca» sola no es cerdo');

  // Y el dato, con la polaridad buena: rojo en el PDF = NO está en el carro.
  const q = JSON.parse(read('data/quesos-mb.json'));
  assert(Array.isArray(q.quesos) && q.quesos.length >= 40, 'el carro se ha quedado corto');
  const hoy = q.quesos.filter(x => x.en_carro);
  assert(hoy.length > 0 && hoy.length < q.quesos.length,
    'en_carro tiene que separar los que hay de los que descansan');
  for (const x of q.quesos) {
    assert(x.nombre && x.grupo, 'cada queso necesita nombre y grupo');
    assert(typeof x.en_carro === 'boolean', `«${x.nombre}» sin en_carro`);
    assert(!x.cuajo || /^(animal|vegetal|láctica)$/i.test(x.cuajo),
      `«${x.nombre}» tiene un cuajo que la app no sabe leer: ${x.cuajo}`);
  }
  const css = read('styles.css');
  assert(/\.q-busca\{[^}]*font-size: 16px/.test(css),
    '16px reales: por debajo iOS Safari hace zoom al enfocar el buscador');
  assert(/\.q-chip\{[^}]*min-height: 36px/.test(css), 'los filtros se tocan con el dedo');
});

test('Administración: mira cualquier restaurante y no deja rastro', () => {
  // Cuenta para revisar el contenido antes de que lo vea el equipo: entra en
  // cualquier restaurante, incluidos los que aún no están abiertos, y no escribe
  // ni aparece en ninguna puntuación. Si contara, el ranking mediría a quien
  // está revisando la carta y no a quien se la está aprendiendo.
  assert(/function _esAdmin\(nombre\)/.test(html), 'falta el resolutor de administración');
  assert(/_EMP_COLS='[^']*,role'/.test(html), 'el rol tiene que bajar con la ficha');

  // Para el administrador manda el restaurante ELEGIDO; para el resto, el de la
  // nube, que lo fijó el código del manager y no se cambia tocando una tarjeta.
  const va = html.slice(html.indexOf('function _venueActual(){'), html.indexOf('function _vq()'));
  assert(/if\(e && e\.role === 'admin'\)/.test(va) && /localStorage\.getItem\('txk_venue'\)/.test(va),
    'el administrador elige restaurante; el resto no');
  assert(va.indexOf("role === 'admin'") < va.indexOf('if(e && e.venue) return e.venue;'),
    'la preferencia del administrador va ANTES del restaurante de su ficha');

  // Se corta ANTES de escribir. Una fila que no existe no se cuela en un ranking.
  const fn = n => { const i = html.indexOf('async function ' + n + '('); let d = 0;
    for (let k = html.indexOf('{', i); k < html.length; k++) {
      if (html[k] === '{') d++; else if (html[k] === '}') { d--; if (!d) return html.slice(i, k + 1); } } };
  for (const [nombre, arg] of [['supaInsertScore', 'employee'], ['supaInsertTxokoRecord', 'employee'],
                               ['supaInsertEtRecord', 'employee'], ['supaUpsertEmployee', 'name']]) {
    const cuerpo = fn(nombre);
    assert(cuerpo, `no encuentro ${nombre}`);
    assert(new RegExp(`if\\(_esAdmin\\(${arg}\\)\\) return`).test(cuerpo),
      `${nombre} tiene que cortar antes de escribir si es la cuenta de administración`);
    assert(cuerpo.indexOf('_esAdmin') < cuerpo.indexOf('rest/v1/'),
      `en ${nombre} el corte va ANTES de la llamada, no después`);
  }

  // Cinturón y tirantes: además de no escribir, tampoco se lista.
  const listas = [...html.matchAll(/\/rest\/v1\/employees\?select=([^`'"]*)/g)]
    .map(m => m[1]).filter(u => /order=|limit=/.test(u) && !/name=(eq|ilike)\./.test(u));
  assert(listas.length >= 3, `el barrido sólo ve ${listas.length} listados de empleados`);
  for (const u of listas)
    assert(/role=neq\.admin/.test(u),
      `este listado no excluye a la cuenta de administración: ${u.slice(0, 70)}`);

  // Y el cambio de restaurante desde dentro falla CERRADO.
  const aj = html.slice(html.indexOf('if(_esAdmin()){'), html.indexOf('// Nombre visible.'));
  assert(/const ok = await cargarCarta\(id\);/.test(aj), 'cambiar de restaurante carga su carta');
  assert(/if\(!ok\)\{[\s\S]{0,400}?cargarCarta\(anterior\)/.test(aj),
    'si la carta no llega, se vuelve al restaurante anterior: enseñar la de otro es justo lo que no debe pasar');
});

// ─── El cargador de cartas, ejecutado de verdad ──────────────────
// M.B. tiene su carro de quesos listo y su carta todavía no (espera a que
// cocina diga de dónde salen diecisiete alérgenos). La cuenta que existe para
// revisar contenido tiene que poder entrar a revisar lo que sí hay. Lo que NO
// puede pasar bajo ningún concepto: que al entrar a M.B. se queden puestos los
// platos de Txoko bajo el rótulo de M.B.
//
// Se EJECUTA cargarCarta con un fetch de mentira, porque lo que hay que
// demostrar es qué queda en DISHES al terminar, y eso no se lee en el código.
// El await va aquí fuera: test() es síncrono y una prueba async se tragaría
// los fallos en silencio — la otra manera de escribir un guard que no muerde.
const _cartaRes = await (async () => {
  const src = html.slice(html.indexOf('let _cartaPuesta = _VENUE_POR_DEFECTO;'),
                         html.indexOf('// Derivación automática:'));
  if (src.length < 500) return { roto: 'no encuentro el cargador de cartas' };
  const monta = (esAdmin, responder) => {
    const D = [], DE = [], DC = {}, DA = {}, DS = {};
    const BASE = { DISHES:[{id:1,name:'Croqueta de jamón'}], DISHES_EN:[{id:1,name:'Ham croquette'}],
                   DISH_COMPONENTS:{1:['jamon']}, DISH_ACTIONS:{1:{}}, DISH_SERVICE:{1:'a'} };
    const F = new Function('DISHES','DISHES_EN','DISH_COMPONENTS','DISH_ACTIONS','DISH_SERVICE', // eslint-disable-line no-new-func
      '_CARTA_BASE','_VENUE_POR_DEFECTO','_esAdmin','loadLazyData','showToast','LANG',
      src + '; return { cargarCarta, estado: () => ({ platos: DISHES.map(d=>d.name), en: DISHES_EN.length, comp: Object.keys(DISH_COMPONENTS).length, turnos: Object.keys(DISH_SERVICE).length }) };');
    return F(D, DE, DC, DA, DS, BASE, 'txoko', () => esAdmin, responder, () => {}, 'es');
  };
  const plato = (id,es,en) => ({ venue:null, DISHES:[{id,name:es}], DISHES_EN:[{id,name:en}],
                                 DISH_COMPONENTS:{[id]:['x']}, DISH_ACTIONS:{} });
  // Una carta con turnos propios, para comprobar que la tabla se cambia y no
  // se hereda: el id 9 es el mismo que usa el otro montaje.
  const cartaConTurnos = v => Object.assign(carta(v), { DISH_SERVICE:{9:'c'} });
  const carta = v => Object.assign(plato(9,'Chipirón','Baby squid'), { venue:v });
  const falta404 = () => Promise.reject(new Error('HTTP 404'));
  const sinRed   = () => Promise.reject(new Error('Failed to fetch'));
  // El repartidor mira la RUTA: así un mismo montaje puede tener carta para un
  // restaurante y no tenerla para otro, que es el caso que hay que probar.
  const porRuta = mapa => ruta => {
    const v = (ruta.match(/carta-([^.]+)\.json/) || [])[1];
    return Object.prototype.hasOwnProperty.call(mapa, v) ? mapa[v]() : falta404();
  };

  // ── El escenario que importa ──
  // Hay que llegar a M.B. con OTRA carta ya puesta. Ojo con 'txoko': cargarCarta
  // sale por el atajo `venue === _cartaPuesta` sin aplicar nada, así que usarlo
  // de punto de partida dejaba DISHES vacío y la comprobación no probaba nada
  // (mordió en la verificación: la mutación «no vaciar» pasaba tan campante).
  const admin = monta(true, porRuta({ otro: () => Promise.resolve(carta('otro')) }));
  const rOtro = await admin.cargarCarta('otro');
  const puestosAntes = admin.estado().platos.length;
  const rVacia = await admin.cargarCarta('mb');
  // ── Los turnos son de la carta, no de la app ──
  const turnos = await (async () => {
    const out = {};
    // Ojo: cargarCarta('txoko') sale por el atajo `venue === _cartaPuesta` si
    // nadie ha movido la carta, así que siempre se empieza por OTRA.
    const conT = monta(true, porRuta({ x: () => Promise.resolve(cartaConTurnos('x')) }));
    await conT.cargarCarta('x');
    out.conTurnos = conT.estado().turnos;      // pone los suyos, no los suma
    await conT.cargarCarta('txoko');
    out.txoko = conT.estado().turnos;          // y al volver, los de Txoko
    const sinT = monta(true, porRuta({ x: () => Promise.resolve(cartaConTurnos('x')),
                                       y: () => Promise.resolve(carta('y')) }));
    await sinT.cargarCarta('x');
    await sinT.cargarCarta('y');
    out.sinTurnos = sinT.estado().turnos;      // una carta sin turnos deja cero
    const vac = monta(true, porRuta({ x: () => Promise.resolve(cartaConTurnos('x')) }));
    await vac.cargarCarta('x');
    await vac.cargarCarta('mb');               // 404 + admin → carta vacía
    out.vaciada = vac.estado().turnos;
    return out;
  })();

  return {
    rOtro, puestosAntes, vacia: rVacia, estado: admin.estado(), turnos,
    sinRed: await monta(true,  sinRed).cargarCarta('mb'),
    staff:  await monta(false, falta404).cargarCarta('mb'),
    propia: await monta(true,  porRuta({ mb: () => Promise.resolve(carta('mb')) })).cargarCarta('mb'),
    ajena:  await monta(true,  porRuta({ mb: () => Promise.resolve(carta('txoko')) })).cargarCarta('mb')
  };
})();

test('Administración: un restaurante sin carta se abre VACÍO, nunca con la del vecino', () => {
  const R = _cartaRes;
  assert(!R.roto, R.roto);
  // 0) El escenario tiene que partir de una carta REALMENTE puesta; si no,
  //    comprobar que M.B. queda vacío no demuestra nada.
  assert(R.rOtro === true && R.puestosAntes > 0,
    'la prueba no arranca con otra carta puesta: no estaría probando nada');
  // 1) Administrador + restaurante sin carta → entra, y entra vacío.
  assert(R.vacia === 'vacia',
    `el administrador debería entrar a un restaurante sin carta; devolvió ${JSON.stringify(R.vacia)}`);
  assert(R.estado.platos.length === 0,
    `PELIGRO: al entrar a M.B. se quedan puestos los platos del anterior: ${R.estado.platos.join(', ')}`);
  assert(R.estado.en === 0 && R.estado.comp === 0,
    'la carta en inglés y los componentes también tienen que quedar a cero');
  // 2) Sin red NO es «no hay carta»: ahí no se entra ni siendo administrador.
  assert(R.sinRed === false,
    'un fallo de red no puede confundirse con «este restaurante no tiene carta»');
  // 3) Quien NO es administrador sigue sin entrar a un restaurante sin carta.
  assert(R.staff === false, 'sólo la cuenta de administración entra a un restaurante sin carta');
  // 4) Con carta de verdad, se aplica la suya.
  assert(R.propia === true, 'con carta propia se entra normal');
  // 5) Y un archivo que dice ser de otro restaurante se sigue rechazando.
  assert(R.ajena === false, 'un archivo que dice ser de otro restaurante no se aplica');
});

test('Multi-restaurante: nadie lee el nombre del vecino en su propia formación', () => {
  // El nombre del restaurante estaba escrito a fuego en seis sitios que ve el
  // empleado: dos títulos de nivel, la bienvenida, la guía de emplatado y las
  // técnicas. Con M.B. de camino eso significa que su equipo iba a formarse
  // leyendo «Leyenda Viviente de Txoko».
  assert(/function _venueCasa\(\)/.test(html) && /function _venueRotulo\(\)/.test(html),
    'falta el nombre de la casa');
  const casa = html.slice(html.indexOf('function _venueCasa(){'), html.indexOf('function _venueRotulo(){'));
  assert(/ACTIVE_VENUE\.casa \|\| ACTIVE_VENUE\.name \|\| 'Meseo'/.test(casa),
    'un restaurante sin nombre configurado no puede dejar un hueco en la frase');

  // Los títulos de nivel llevan {casa} y se sustituyen en getLevelInfo, que es
  // por donde pasan TODOS antes de pintarse.
  const gli = html.slice(html.indexOf('function getLevelInfo(xp){'), html.indexOf('function getNextLevel('));
  assert(/replace\(\/\\\{casa\\\}\/g, casa\)/.test(gli) && /replace\(\/\\\{CASA\\\}\/g, casa\.toUpperCase\(\)\)/.test(gli),
    'los títulos de nivel tienen que tomar el nombre del restaurante activo');
  assert(/title:'Leyenda Viviente de \{casa\}'/.test(html) && /title:'\{CASA\} ASCENDIDO ∞'/.test(html),
    'los dos títulos con marca usan el marcador, no el nombre escrito a fuego');

  // themes.json trae el nombre de cada restaurante en sus dos formas, y los
  // ocho colores de marca en el formato que applyTheme acepta.
  const th = JSON.parse(read('data/themes.json'));
  const TOKENS = ['primary','secondary','accent','accentHi','accent2','accentDeep','ink','paper'];
  for (const v of th.venues) {
    assert(v.casa, `al restaurante «${v.id}» le falta «casa» (el nombre dentro de una frase)`);
    assert(v.rotulo, `al restaurante «${v.id}» le falta «rotulo» (el nombre con el que se presenta)`);
    for (const k of TOKENS)
      assert(/^#[0-9a-fA-F]{6}$/.test((v.brand || {})[k] || ''),
        `«${v.id}» necesita el color ${k} en formato #rrggbb: applyTheme descarta cualquier otra cosa y el token se queda con el del restaurante anterior`);
  }
  assert(th.venues.some(v => v.id === 'mb'), 'falta M.B. en el registro de restaurantes');

  // La plantilla de copiar-pegar NO es un restaurante y no puede salir en el
  // selector: aparecía como «NUEVO RESTAURANTE · Próximamente» al lado de los
  // de verdad, anunciando algo que no existe.
  assert(/v\.id !== 'plantilla'/.test(html), 'la plantilla no puede salir en el selector');
  assert((html.match(/v\.id !== 'plantilla'/g) || []).length >= 2,
    'hay dos sitios que listan restaurantes (el selector y el sincronizador de idioma): los dos la esconden');

  // Y el barrido: ningún texto NUEVO puede volver a nombrar Txoko a fuego. La
  // carta queda fuera —ahí el nombre es contenido del restaurante y se sustituye
  // con ella— y el aviso legal también, que menciona la marca a propósito.
  const iEn = html.indexOf('const DISHES_EN = [');
  const jEs = html.indexOf('\n];', html.indexOf('const DISHES = ['));
  const sinCarta = html.slice(0, iEn) + html.slice(jEs);
  const PERMITIDOS = [
    'TXOKO DIAGNÓSTICO',                 // consola de depuración
    'restaurante (TXOKO, Berasategui',   // comentario del código
    'incluidos TXOKO y Martín',          // aviso legal: menciona la marca a propósito
    'including TXOKO and Martín',
    'Papas bravas al estilo Txoko',      // es el NOMBRE de un plato
    'papas bravas al estilo txoko',
    'Las papas bravas Txoko',
  ];
  const fugas = [];
  const re = /['"`]([^'"`\n]{4,140}?[Tt][Xx][Oo][Kk][Oo][^'"`\n]{0,90})['"`]/g;
  let m;
  while ((m = re.exec(sinCarta))) {
    const t = m[1].trim();
    if (/txoko_|localStorage|topic|_record|showTab|navTxoko|renderTxoko|tec-txoko|TXOKO_LEVELS|\/|\.js|\.json|#/.test(t)) continue;
    if (PERMITIDOS.some(p => t.includes(p))) continue;
    fugas.push(t.slice(0, 90));
  }
  assert(fugas.length === 0,
    `textos que nombran Txoko a fuego y los verá otro restaurante: ${fugas.join(' · ')}`);
});

test('Pase: lo que va montado encima no se esconde como si fuera relleno', () => {
  // «Topping» y «Guarnición» no son preparaciones: son secciones de EMPLATADO.
  // Tratarlas como preparación escondía justo lo que distingue un plato de su
  // gemelo — la Croqueta de Jamón enseñaba Leche, Harina, Mantequilla, Nata y
  // Huevo, y NO el jamón, y las cinco croquetas tenían la misma piscina.
  // «Masa», «Relleno» o «Marinada» sí son preparaciones y siguen escondiendo lo
  // suyo: la bechamel de dentro de la croqueta no se ve.
  assert(/const _PASE_SECCION_VISIBLE = /.test(html), 'falta la lista de secciones de emplatado');
  const rot = html.slice(html.indexOf('function _paseRotulos('), html.indexOf('function _pasePlegar('));
  assert(/if\(_PASE_SECCION_VISIBLE\.test\(_djNorm\(m\[1\]\)\)\) continue;/.test(rot),
    'una sección de emplatado no puede tratarse como preparación');
  const lista = html.slice(html.indexOf('const _PASE_SECCION_VISIBLE'), html.indexOf('function _paseRotulos('));
  for (const x of ['topping', 'guarnicion']) assert(lista.includes(x), `falta «${x}»`);
  for (const x of ['masa', 'relleno', 'marinada'])
    assert(!new RegExp(`\\|${x}\\||\\(${x}\\||\\|${x}\\)`).test(lista),
      `«${x}» ES una preparación: lo que lleva dentro no se ve`);

  // Y funcional: cada croqueta tiene que poder distinguirse de sus hermanas.
  const cut = (ini, fin) => { const i = html.indexOf(ini); return html.slice(i, html.indexOf(fin, i) + fin.length); };
  const fn = n => { const i = html.indexOf('function ' + n + '('); let d = 0;
    for (let k = html.indexOf('{', i); k < html.length; k++) {
      if (html[k] === '{') d++; else if (html[k] === '}') { d--; if (!d) return html.slice(i, k + 1); } } };
  const src = `var LANG='es', _djIngBase=null; function getDish(d){return d;} function _djIngName(n){return n;}
    const _DJ_SECCION = ${/^(masa|topping|base|relleno|guarnicion|sabores disponibles|salsa base|sazonador|marinada|elaboracion)$/};`
    + cut('const DISHES = [', '\n];') + cut('const DISH_COMPONENTS = ', '};')
    + html.slice(html.indexOf('const _djNorm ='), html.indexOf('async function _djLoadIngBase'))
    + fn('_djTrozos') + fn('_djSplitIngredients') + fn('_djSameThing') + fn('_djIngredients')
    + html.slice(html.indexOf('const _PASE_SAZONADOR'), html.indexOf('function _paseSenuelos('))
    + `
    const croquetas = [124,125,126,127,128];
    const iguales = [], sinLoSuyo = [];
    const firmas = new Map();
    for(const id of croquetas){
      const d = DISHES.find(x=>x.id===id); if(!d) continue;
      const f = _paseFichas(d,false).map(x=>_djNorm(x.t)).sort().join('|');
      if(firmas.has(f)) iguales.push(id + ' = ' + firmas.get(f)); else firmas.set(f, id);
    }
    // El jamón de la croqueta de jamón, por su nombre.
    const j = DISHES.find(x=>x.id===124);
    const tieneJamon = j ? _paseFichas(j,false).some(x=>/jamon/.test(_djNorm(x.t))) : false;
    return {iguales, tieneJamon, n:firmas.size};`;
  const R = new Function(src)(); // eslint-disable-line no-new-func
  assert(R.tieneJamon, 'la Croqueta de Jamón tiene que enseñar el jamón');
  assert(R.iguales.length === 0,
    `croquetas con la piscina idéntica: ${R.iguales.join(', ')} — no hay forma de distinguirlas`);
  assert(R.n === 5, `esperaba 5 croquetas distinguibles, hay ${R.n}`);
});

test('Pase: los nombres pegados se limpian al PINTAR, nunca en el dato', () => {
  // La ficha dice «Migas de Ibérico (Ibéricos y miga de pan)» y, al trocearla
  // quitando los paréntesis, queda «Migas de Ibérico Ibéricos y miga de pan».
  // Esa forma pegada es la clave con la que la base encuentra el alérgeno: se
  // intentó renombrarla en el dato y el plato 6 se quedó sin quien explicara su
  // Gluten. Por eso se limpia SÓLO la etiqueta, y este guard existe para que a
  // nadie —yo el primero— se le ocurra volver a tocar el dato.
  assert(/const _PASE_PEGADOS = \{/.test(html), 'falta la tabla de nombres pegados');
  const tabla = html.slice(html.indexOf('const _PASE_PEGADOS = {'), html.indexOf('function _paseEtiqueta('));
  const claves = [...tabla.matchAll(/'([^']+)':\s*'([^']+)'/g)].map(m => [m[1], m[2]]);
  assert(claves.length >= 10, `la tabla se ha quedado en ${claves.length} nombres`);

  // Cada clave tiene que existir TAL CUAL como componente. Si no, es un typo
  // que no limpia nada y nadie se entera.
  const comps = html.slice(html.indexOf('const DISH_COMPONENTS = '), html.indexOf('\n};', html.indexOf('const DISH_COMPONENTS = ')));
  for (const [pegado, limpio] of claves) {
    assert(comps.includes(`n:'${pegado}'`), `«${pegado}» no existe como componente: la tabla no limpia nada`);
    assert(limpio && limpio !== pegado && pegado.startsWith(limpio),
      `«${limpio}» tiene que ser el principio de «${pegado}»: es recortar, no renombrar`);
  }

  // Cuatro quedan fuera A PROPÓSITO y no pueden colarse:
  //  · Granadina — «Granadina» a secas NO lleva alérgeno en la base y los
  //    Sulfitos vienen del vinagre: acortarla los borra del plato en silencio.
  //  · Porto y Sake — son cebolla encurtida 24 h, no licores sueltos; su nombre
  //    bueno es otro y está pendiente de que lo confirme el propietario.
  //  · Bisque — «Bisque» a secas enseña menos: la palabra que avisa del
  //    crustáceo es «Langostino».
  for (const fuera of ['Granadina Vinagre de manzana', 'Porto Vinagre de jerez',
                       'Sake Vinagre de cabernet', 'Bisque Caldo de Langostino'])
    assert(!tabla.includes(`'${fuera}'`),
      `«${fuera}» está fuera a propósito: léete el comentario antes de meterlo`);

  // Y se usa SÓLO al pintar la ficha. Si apareciera en el armado, la clave
  // cambiaría y con ella el emparejado contra la base de alérgenos.
  const usos = (html.match(/_paseEtiqueta\(/g) || []).length;
  assert(usos === 2, `_paseEtiqueta debe usarse una sola vez (su definición + el chip); hay ${usos}`);
  const chip = html.slice(html.indexOf('function _paseChip('), html.indexOf('function _paseRender('));
  assert(/pase-chip-t">\$\{escapeHTML\(_paseEtiqueta\(it\.t\)\)\}/.test(chip),
    'la etiqueta limpia va en el chip');
});

test('Carta: cada restaurante carga la suya, y si no llega no se entra', () => {
  // Los cuatro bloques de la carta se quedan dentro del HTML a propósito: 42
  // puntos de las pruebas y de la auditoría de alérgenos los leen de ahí, y
  // sacarlos obligaría a reescribir todo eso por ninguna ganancia. La carta de
  // un restaurante nuevo llega en data/carta-<restaurante>.json y sustituye a
  // las cuatro EN EL SITIO —son const y de ellas cuelgan treinta mil líneas—.
  assert(/const _CARTA_BASE = \{/.test(html), 'falta la copia intacta de la carta de Txoko');
  const ap = html.slice(html.indexOf('function _cartaAplicar('), html.indexOf('async function cargarCarta('));
  assert(/DISHES\.length = 0;/.test(ap) && /DISHES_EN\.length = 0;/.test(ap),
    'la sustitución tiene que ser en el sitio: const impide reasignar, no modificar');
  assert(/for\(const k of Object\.keys\(DISH_COMPONENTS\)\) delete DISH_COMPONENTS\[k\];/.test(ap)
      && /for\(const k of Object\.keys\(DISH_ACTIONS\)\) delete DISH_ACTIONS\[k\];/.test(ap),
    'las claves viejas se borran: si no, quedarían platos del otro restaurante mezclados');

  const cc = html.slice(html.indexOf('async function cargarCarta('), html.indexOf('// Derivación automática'));
  // Volver a Txoko tiene que REPONER la carta original. Sin esto, cerrar sesión
  // desde M.B. y entrar con una cuenta de Txoko dejaba puesta la de M.B.
  assert(/_cartaAplicar\(_CARTA_BASE\)/.test(cc),
    'volver a Txoko repone su carta: si no, la del otro restaurante se queda puesta');
  assert(/carta\.venue !== venue/.test(cc),
    'el archivo declara de quién es: soltar la carta equivocada no puede acabar en enseñarla');
  assert(/return false;/.test(cc), 'si no se puede dejar puesta la carta que toca, se dice que no');

  // Y quien llama FALLA CERRADO. Enseñarle a alguien de M.B. la carta de Txoko
  // sería exactamente la fuga que todo esto viene a cerrar.
  const i = html.indexOf('async function closePinAndEnter(');
  assert(i > 0, 'entrar tiene que poder esperar a la carta: closePinAndEnter debe ser async');
  const cuerpo = (() => { let d = 0;
    for (let k = html.indexOf('{', i); k < html.length; k++) {
      if (html[k] === '{') d++; else if (html[k] === '}') { d--; if (!d) return html.slice(i, k + 1); } } })();
  assert(/let _v = \(_e && _e\.venue\) \|\| _VENUE_POR_DEFECTO;/.test(cuerpo),
    'el restaurante de quien entra sale de SU ficha, no del selector del login');
  assert(/if\(!\(await cargarCarta\(_v\)\)\) return;/.test(cuerpo),
    'sin la carta de su restaurante no se entra');
  // La cuenta de administración vuelve al restaurante que ELIGIÓ: todo lo demás
  // ya se guía por _venueActual(), y cargar aquí el de su ficha la devolvía a
  // Txoko con el resto de la app puesta en M.B.
  assert(/_esAdmin\(pinTarget\)/.test(cuerpo) && /localStorage\.getItem\('txk_venue'\)/.test(cuerpo),
    'el administrador vuelve al restaurante que dejó elegido');
  assert(cuerpo.indexOf('_esAdmin(pinTarget)') < cuerpo.indexOf('await cargarCarta(_v)'),
    'esa elección se resuelve ANTES de cargar la carta');
  const iCarta = cuerpo.indexOf('cargarCarta'), iApp = cuerpo.indexOf('screenApp');
  assert(iCarta > 0 && iApp > 0 && iCarta < iApp,
    'la carta se resuelve ANTES de pintar la app');
});

test('Acceso: el código del restaurante no se pinta solo', () => {
  // El panel se abre encima de una mesa en pleno pase: un código que se enseña
  // sin querer deja de ser un código.
  assert(/function renderSupCodigoHTML\(\)/.test(html), 'falta la tarjeta del código');
  const card = html.slice(html.indexOf('function renderSupCodigoHTML()'),
                          html.indexOf('function _supVenueId('));
  assert(/••••••/.test(card), 'el código sale tapado hasta que se pide');
  assert(!/venue_code_show/.test(card), 'la tarjeta no trae el código dentro');
  assert(/_supaRpc\('venue_code_show', \{p_pin:_supPin/.test(html),
    'verlo exige el PIN de supervisor');
  assert(/_supaRpc\('venue_code_rotate', \s*\{p_pin:_supPin/.test(html.replace(/\n\s*/g, ' ')),
    'renovarlo también');
  assert(/if\(!confirm\(_en[\s\S]{0,400}?\)\) return;/.test(
      html.slice(html.indexOf('async function supRenovarCodigo('))),
    'renovar se confirma: deja fuera a quien tenga el código viejo');
});

// ─── El PIN de supervisor es DE UN RESTAURANTE ──────────────────
// El del manager de M.B. no puede abrir el panel de Txoko: vería su equipo, su
// cuadrante y sus notas, y podría renovarle el código de acceso dejando a
// veintiún empleados sin poder registrarse. El del propietario abre todos.
//
// Se EJECUTA el verificador con un fetch de mentira, porque lo que hay que
// demostrar es qué viaja en la petición.
const _pinEnvio = await (async () => {
  const i = html.indexOf('async function verifySupervisorPin(');
  if (i < 0) return { roto: 'no encuentro verifySupervisorPin' };
  const src = (() => { let d = 0;
    for (let k = html.indexOf('{', i); k < html.length; k++) {
      if (html[k] === '{') d++; else if (html[k] === '}') { d--; if (!d) return html.slice(i, k + 1); } } })();
  const llamar = (venue, actual) => {
    let cuerpo = null, ruta = null;
    const fakeFetch = (u, o) => { ruta = u; cuerpo = JSON.parse(o.body);
      return Promise.resolve({ ok: true, json: () => Promise.resolve(true) }); };
    const F = new Function('USE_SERVER_PIN_VERIFY','SUPA_URL','SUPA_KEY','fetch', // eslint-disable-line no-new-func
      '_venueActual','dbgw','hashPin','SUP_PIN_HASH',
      src + '; return verifySupervisorPin;')(
      true, 'https://x', 'k', fakeFetch, () => actual, () => {}, () => '', '');
    return F('1234', venue).then(() => ({ cuerpo, ruta }));
  };
  return { explicito: await llamar('mb', 'txoko'), pordefecto: await llamar(undefined, 'txoko') };
})();

test('El PIN de supervisor va atado a un restaurante', () => {
  const R = _pinEnvio;
  assert(!R.roto, R.roto);
  assert(/rpc\/verify_supervisor_pin/.test(R.explicito.ruta), 'el PIN se sigue verificando en el servidor');
  // 1) Si se dice de qué restaurante se pregunta, se manda ése.
  assert(R.explicito.cuerpo.p_venue === 'mb',
    `la petición tiene que llevar el restaurante; llevaba ${JSON.stringify(R.explicito.cuerpo)}`);
  // 2) Si no se dice, sale el del que ha entrado — nunca en blanco.
  assert(R.pordefecto.cuerpo.p_venue === 'txoko',
    `sin restaurante explícito debe ir el de quien entró; llevaba ${JSON.stringify(R.pordefecto.cuerpo)}`);
  assert(R.explicito.cuerpo.pin_input === '1234', 'el PIN se sigue mandando');

  // 3) El panel actúa sobre el restaurante de quien entró, no sobre la tarjeta
  //    del login (que es estética): renovar el código del restaurante
  //    equivocado deja a un equipo entero sin poder registrarse.
  const sv = html.slice(html.indexOf('function _supVenueId(){'), html.indexOf('async function supVerCodigo('));
  assert(/return _venueActual\(\);/.test(sv), '_supVenueId debe salir de _venueActual()');
  assert(sv.indexOf('_venueActual()') < sv.indexOf('ACTIVE_VENUE'),
    'ACTIVE_VENUE sólo vale de último recurso, nunca como primera opción');

  // 4) Y el servidor, que es quien manda de verdad.
  const sql = read('supabase/supervisor_pin_por_restaurante.sql');
  assert(/create table if not exists public\.supervisor_pins/.test(sql), 'falta la tabla de PINes por restaurante');
  assert(/revoke all on function public\.sup_pin_scope\(text\) from public, anon, authenticated/.test(sql),
    'sup_pin_scope NO puede llamarse desde el navegador: sería un oráculo de fuerza bruta sin limitador');
  for (const fn of ['venue_code_show', 'venue_code_rotate', 'save_rota'])
    assert(new RegExp('function public\\.' + fn + '\\([\\s\\S]{0,1400}?verify_supervisor_pin\\([a-z_]+, ?[a-z_]*venue[a-z_]*\\)').test(sql),
      `${fn} tiene que comprobar el PIN CONTRA SU RESTAURANTE, no sólo que el PIN valga`);
  assert(/p_role in \('admin','manager'\) and public\.sup_pin_scope\(p_pin\) <> '\*'/.test(sql),
    'sólo el propietario reparte administración y mando: si no, un manager se da la llave de todos los restaurantes');
  assert(/sup_pin_ok\(p_pin, v_venue\)/.test(sql), 'nadie cambia el rol de alguien de otro restaurante');
  // El limitador por IP sigue ahí, y un PIN bueno en el restaurante equivocado
  // no cuenta como fallo (si contara, un manager despistado bloquearía por IP a
  // todo el hotel, que sale por la misma línea).
  assert(/locked_until = case when fails \+ 1 >= 10/.test(sql), 'el limitador por IP no puede desaparecer');
  assert(/if v_scope is not null then\s*\n\s*return false;/.test(sql),
    'un PIN válido en otro restaurante no debe contar como intento fallido');
});

test('Panel: Análisis es para MIRAR, Acciones para HACER', () => {
  // Petición del propietario (sep 2026). Un botón que renueva el código de
  // acceso —y deja a veintiún empleados sin poder registrarse— no puede estar
  // escondido dentro de la pantalla de las estadísticas.
  const ana = html.slice(html.indexOf('function renderSupAnalytics'), html.indexOf('function renderSupCodigoHTML(){'));
  for (const id of ['alg','res','act','pase','perf','dish'])
    assert(new RegExp("_acc\\('"+id+"'").test(ana), `falta el acordeón de mirar '${id}'`);
  for (const [id, qué] of [['acc','el código de acceso'], ['adm','la cuenta de administración']])
    assert(!new RegExp("_acc\\('"+id+"'").test(ana), `${qué} sigue dentro de Análisis: va en Acciones`);
  assert(!/renderSupCodigoHTML\(\)/.test(ana), 'Análisis no puede pintar el código de acceso');

  // Y están en Acciones, cada una con su pantalla.
  const acciones = html.slice(html.indexOf('data-sec="acciones"'), html.indexOf('function renderSupDeleteEmployee'));
  for (const [k, qué] of [['codigo','el código de acceso'], ['cuentas','las cuentas']])
    assert(new RegExp("_supTool\\('"+k+"'\\)").test(acciones), `${qué} debe tener su botón en Acciones`);
  const tool = html.slice(html.indexOf('function _supTool(k){'), html.indexOf('function _supSetSection'));
  for (const k of ['codigo','cuentas'])
    assert(new RegExp('\\b'+k+': \\(\\)=>render').test(tool), `_supTool no sabe abrir '${k}'`);
});

test('Cuentas: sólo el propietario reparte mando, y la administración sólo se ve desde ella', () => {
  // Paso 2 del multi-restaurante: dar de alta managers desde el panel.
  const cu = html.slice(html.indexOf('function renderSupCuentas(){'), html.indexOf('async function supPonerManager('));
  assert(/venue_staff_list/.test(cu) && /supPonerManager\(/.test(cu),
    'la pantalla de cuentas tiene que listar el equipo y poder nombrar manager');
  assert(/venue_pin_set/.test(html), 'tiene que poder poner el PIN de este restaurante');
  const pone = html.slice(html.indexOf('async function supPonerManager('), html.indexOf('function _supErrorRol('));
  assert(/p_venue:v\}\)/.test(html.slice(html.indexOf('async function supCargarCuentas('), html.indexOf('async function supPonerManager('))),
    'el listado va SIEMPRE atado a un restaurante');
  // Buscar sólo «confirm(» no vale: el texto sigue ahí aunque la condición sea
  // `false &&` (mordió en la verificación). Se comprueba la condición entera.
  assert(/if\(hacer && !confirm\(/.test(pone),
    'nombrar manager da acceso al panel: se confirma antes, y la condición tiene que depender de `hacer`');
  assert(/\breturn;\s*\n/.test(pone.slice(pone.indexOf('confirm('))),
    'si se cancela la confirmación, no se llama al servidor');
  // Sólo el PROPIETARIO reparte y RETIRA mando. La regla era «sólo el
  // propietario asciende» y dejaba una asimetría: un manager no podía nombrar a
  // nadie pero sí podía degradar a otro manager de su restaurante y dejarlo sin
  // panel. Comprobado contra la base: devolvía ok y el rol cambiaba.
  assert(/function _esPropietario\(nombre\)/.test(html), 'falta el resolutor de propietario');
  const prop = html.slice(html.indexOf('function _esPropietario(nombre){'), html.indexOf('function _esMando(nombre){'));
  assert(/e\.role === 'owner'/.test(prop), 'propietario es exactamente el rol owner');
  assert(/\$\{_esPropietario\(\) \? `<button onclick="supPonerManager/.test(html),
    'los botones de rol sólo se pintan para el propietario');
  const sql2 = read('supabase/supervisor_pin_por_restaurante.sql');
  assert(/-- CUALQUIER cambio de rol es del propietario/.test(sql2)
      && /if public\.sup_pin_scope\(p_pin\) <> '\*' then\s*\n\s*return json_build_object\('ok', false, 'error', 'solo_propietario'\);/.test(sql2),
    'el servidor tiene que exigir propietario para CUALQUIER cambio de rol, no sólo para los ascensos');

  // El error del servidor se traduce, no se traga: si un manager intenta
  // nombrar a otro, tiene que leer por qué no puede.
  const err = html.slice(html.indexOf('function _supErrorRol('), html.indexOf('async function supGuardarPinVenue('));
  for (const cod of ['solo_propietario','otro_restaurante','unknown_employee'])
    assert(new RegExp("'"+cod+"'").test(err), `falta el mensaje para '${cod}'`);

  // La cuenta de administración salió del panel: sólo se ve desde ella misma.
  assert(/\$\{_esAdmin\(\) \? `[\s\S]{0,2200}?renderSupAdminHTML\(\)/.test(html),
    'la sección de administración debe pintarse SÓLO cuando quien mira es la cuenta de administración');
  // Y desde Ajustes no hay PIN de panel en memoria: se teclea.
  const adm = html.slice(html.indexOf('function renderSupAdminHTML(){'), html.indexOf('async function supPonerRol('));
  assert(/id="supAdmPin"/.test(adm), 'en Ajustes el PIN de supervisor se teclea: allí no se ha pasado por el panel');
  const rol = html.slice(html.indexOf('async function supPonerRol('), html.indexOf('// El restaurante sobre el que actúa'));
  assert(/p_pin:pin\b/.test(rol), 'el rol se cambia con el PIN tecleado, no con uno vacío');
  assert(/if\(!pin\)\{/.test(rol), 'sin PIN no se llama al servidor siquiera');
});

// ─── El panel de dirección: que los números sean de verdad ──────
// `scores` guarda dos cosas con la misma forma: evaluaciones (score sobre
// total de preguntas) y MARCADORES de juego — récord Txoko (total=1, score
// hasta 41) y El Turno (total hasta 2042), donde `total` no es un
// denominador. Son el 56% de las filas. Mezclarlas daba medias del 243%
// (medido contra la base real, sep 2026). Aquí se ejecuta el cálculo.
const _supNums = await (async () => {
  const src = html.slice(html.indexOf('const _SUP_JUEGOS'), html.indexOf('function renderSupAtencionHTML'));
  if (src.length < 500) return { roto: 'no encuentro el cálculo del panel' };
  const F = new Function('LANG', src + // eslint-disable-line no-new-func
    '; return {perfil:_supPerfil, estado:_supEstado, atencion:_supAtencion, APROB:_SUP_APROBADO, DIAS:_SUP_DIAS_RIESGO};')('es');
  const hace = d => new Date(Date.now() - d * 86400000).toISOString();
  // Ana: seis evaluaciones al 90% … y dos marcadores de juego disparatados.
  const hist = [];
  for (let i = 0; i < 6; i++) hist.push({ employee:'Ana', score:9, total:10, topic:'mixed', cat:'Entrantes', time_sec:60, created_at:hace(30 - i) });
  const conJuegos = hist.concat([
    { employee:'Ana', score:41, total:1,    topic:'txoko',    cat:null, time_sec:0,  created_at:hace(2) },
    { employee:'Ana', score:340, total:2042, topic:'elturno', cat:null, time_sec:90, created_at:hace(1) }
  ]);
  return { F, hist, conJuegos,
    limpio: F.perfil('Ana', hist),
    sucio:  F.perfil('Ana', conJuegos) };
})();

test('Panel de dirección: los marcadores de juego NO cuentan como notas', () => {
  const R = _supNums;
  assert(!R.roto, R.roto);
  assert(R.limpio.pruebas === 6, `esperaba 6 evaluaciones, contó ${R.limpio.pruebas}`);
  assert(R.limpio.nota === 90, `la media de seis 9/10 es 90%, salió ${R.limpio.nota}`);
  // Lo que importa: meter los marcadores de juego NO puede cambiar la nota.
  assert(R.sucio.nota === 90,
    `los marcadores de juego se han colado en la nota: ${R.sucio.nota}% en vez de 90%`);
  assert(R.sucio.pruebas === 6,
    `los marcadores de juego se han contado como pruebas: ${R.sucio.pruebas} en vez de 6`);
  assert(R.sucio.nota <= 100, `una nota del ${R.sucio.nota}% es imposible: vuelve el bug del 243%`);
  const sql = read('index.html');
  assert(/_SUP_JUEGOS = \['txoko', 'elturno'\]/.test(sql), 'la lista de juegos a excluir no puede desaparecer');
});

test('Panel de dirección: la tabla y el aviso dicen lo MISMO', () => {
  // Que la tabla pinte a alguien en verde y el aviso lo llame urgente destruye
  // la confianza en las dos pantallas a la vez. Una sola regla: _supEstado.
  const R = _supNums;
  assert(!R.roto, R.roto);
  const hace = d => new Date(Date.now() - d * 86400000).toISOString();
  const ev = (n, pct, d) => ({ employee:n, score:Math.round(pct/10), total:10, topic:'mixed', cat:'Entrantes', time_sec:60, created_at:hace(d) });
  // Cuatro casos que tienen que caer en tres cajas distintas.
  const hist = [];
  for (let i = 0; i < 6; i++) hist.push(ev('Alta', 95, 6 - i));      // al día y alto
  for (let i = 0; i < 6; i++) hist.push(ev('Floja', 60, 6 - i));     // al día y por debajo
  for (let i = 0; i < 6; i++) hist.push(ev('Perdida', 95, 60 - i));  // buena pero desaparecida
  const emps = { Alta:{}, Floja:{}, Perdida:{}, Nueva:{} };
  const nombres = Object.keys(emps);
  const esperado = { Alta:'verde', Floja:'ambar', Perdida:'rojo', Nueva:'rojo' };
  for (const n of nombres)
    assert(R.F.estado(R.F.perfil(n, hist)) === esperado[n],
      `${n} debería salir ${esperado[n]} y sale ${R.F.estado(R.F.perfil(n, hist))}`);
  // Y el aviso tiene que clasificarlos igual, persona por persona.
  const a = R.F.atencion(emps, nombres, hist);
  const donde = {};
  a.rojo.forEach(x => donde[x.n] = 'rojo');
  a.ambar.forEach(x => donde[x.n] = 'ambar');
  a.verde.forEach(x => donde[x.n] = 'verde');
  for (const n of nombres){
    const est = R.F.estado(R.F.perfil(n, hist));
    if (donde[n] === undefined) { assert(est === 'verde', `${n} no sale en ningún grupo y no está en verde`); continue; }
    assert(donde[n] === est, `${n}: la tabla dice ${est} y el aviso dice ${donde[n]}`);
  }
  // Y cada motivo tiene que decir QUÉ mide: «14 días sin entrenar» de alguien
  // que entró ayer era mentira — se mide la última PRUEBA, y así se escribe.
  const perdida = a.rojo.find(x => x.n === 'Perdida');
  assert(perdida && /sin hacer una prueba/.test(perdida.motivo),
    `el motivo debe decir que lo que falta es una PRUEBA: «${perdida && perdida.motivo}»`);
});

test('Panel de dirección: la tabla no arrastra la página de lado', () => {
  // Nueve columnas no caben en un móvil. La tabla lleva SU propio scroll: el
  // resto de la página no puede moverse de lado (medido a 390px: caja 321,
  // tabla 560, la caja scrollea y el documento no).
  const css = read('styles.css');
  assert(/\.sup-tabla-wrap\{[^}]*overflow-x:auto/.test(css), 'la tabla necesita su propio scroll lateral');
  assert(/\.sup-tabla\{[^}]*min-width:\s*\d+px/.test(css), 'sin min-width la tabla se estruja y no se lee');
  assert(/\.sup-tabla tbody tr\{[^}]*cursor:pointer/.test(css), 'cada fila abre un perfil: tiene que parecer tocable');
  assert(/\.sup-at-r\{[^}]*min-height:44px/.test(css), 'las filas del aviso se tocan con el dedo: 44px');
  // La antigüedad sale de la primera PRUEBA y no de registered_at: esa columna
  // se rellenó el día que se creó y da altas posteriores a la primera
  // actividad (Dian figura de alta en septiembre y entrena desde marzo).
  assert(/no desde `registered_at`/.test(html) || /registered_at/.test(html.slice(html.indexOf('function renderSupTablaHTML'), html.indexOf('async function _supPintarHistorial'))),
    'hay que dejar escrito por qué la antigüedad no sale de registered_at');
  const tabla = html.slice(html.indexOf('function renderSupTablaHTML'), html.indexOf('async function _supPintarHistorial'));
  assert(/p\.desde/.test(tabla) && !/e\.registeredAt/.test(tabla),
    'la antigüedad se cuenta desde su primera prueba');
});

test('El panel sale por ROL, y la cuenta de administración no lo tiene', () => {
  // Paso 3 del multi-restaurante. Antes la pestaña se decidía comparando el
  // usuario con el nombre del propietario, así que no había forma de dársela
  // al manager de otro restaurante.
  const src = html.slice(html.indexOf('function _supSyncMando(){'), html.indexOf('function _venueActual(){'));
  assert(src.length > 200, 'no encuentro el resolutor de mando');
  const F = new Function('DB', 'currentUser', 'document', // eslint-disable-line no-new-func
    html.slice(html.indexOf('function _ficha(nombre){'), html.indexOf('function _venueActual(){')) +
    '; return {mando:_esMando, admin:_esAdmin, sync:_supSyncMando};');
  const caso = (rol) => {
    const boton = { style:{ display:'(sin tocar)' } };
    const doc = { getElementById: id => id === 'navSupervisor' ? boton : null };
    const api = F({ employees: { Yo: { name:'Yo', role: rol } } }, 'Yo', doc);
    api.sync();
    return { visible: boton.style.display === '', mando: api.mando(), admin: api.admin() };
  };
  // Quien manda ve la puerta. Y la cuenta de administración TAMBIÉN: está para
  // revisar contenido, y mirar el panel no deja rastro. Estuvo fuera un día por
  // una extrapolación —«que no aparezca en las puntuaciones» se escribió como
  // «no deja rastro»— y el propietario lo reportó.
  for (const rol of ['owner','manager','admin'])
    assert(caso(rol).visible, `un '${rol}' tiene que ver la pestaña del panel`);
  // Un camarero no, y un rol que no existe tampoco: se falla CERRADO.
  for (const rol of ['staff', undefined, null, 'cualquier_cosa'])
    assert(!caso(rol).visible, `un '${rol}' NO puede ver la pestaña del panel`);
  assert(caso('admin').admin === true, '_esAdmin tiene que seguir reconociendo a la cuenta de administración');

  // El rol se guarda bajo el nombre TAL COMO viene de la nube, pero se entra
  // con el que se tecleó — o con el que quedó en la sesión de hace noventa
  // días. Si difieren en una letra y la búsqueda es exacta, el rol no aparece:
  // la cuenta pierde el panel y el selector de restaurante, y nada parece roto.
  {
    const boton = { style:{ display:'(sin tocar)' } };
    const doc = { getElementById: id => id === 'navSupervisor' ? boton : null };
    // La nube guardó «Administrador»; se entra como «administrador».
    const api = F({ employees: { 'Administrador': { name:'Administrador', role:'admin' } } }, 'administrador', doc);
    assert(api.admin() === true,
      'el rol tiene que encontrarse aunque el nombre venga con otra caja');
    api.sync();
    assert(boton.style.display === '',
      'y con él, la pestaña del panel');
  }

  // Un fallo al bajar la ficha NO se nota: la app sigue con lo que tenga en el
  // dispositivo y el rol, el restaurante, el nombre visible y la firma se
  // quedan como si no existieran. Así estuvo días —las cuatro columnas del
  // multi-restaurante se crearon sin permiso de lectura para la clave anónima
  // y PostgREST rechazaba la consulta entera— y desde fuera sólo se veía «la
  // cuenta no tiene panel». Tiene que quedar anotado y verse.
  const _iRest = html.indexOf('async function supaRestoreEmployee');
  const rest2 = html.slice(_iRest, html.indexOf('const rows = await res.json();', _iRest));
  assert(/window\._syncFallo = \(res\.status === 401 \|\| res\.status === 403\)/.test(rest2),
    'un rechazo de permisos al bajar la ficha tiene que anotarse, no morir en un dbgw');
  assert(/window\._syncFallo = null;/.test(html),
    'y borrarse cuando la nube sí contesta');
  assert(/\$\{window\._syncFallo \? `<br>/.test(html),
    'el fallo de sincronización tiene que salir en Ajustes, donde se puede leer sin consola');
  // La línea de diagnóstico: versión, usuario, rol y restaurante.
  assert(/v\$\{APP_VERSION\} · \$\{escapeHTML\(currentUser\|\|'—'\)\}/.test(html),
    'Ajustes tiene que decir qué versión corre y quién es: preguntarlo a distancia costó dos rondas');

  // Y la raíz: getEmp NO puede crear una ficha nueva cuando ya existe la misma
  // con otra caja. Creaba una vacía y sin rol bajo el nombre tecleado, y a
  // partir de ahí la app leía ESA: la cuenta de administración perdía el panel
  // y el selector de restaurante A MITAD DE SESIÓN. Se reprodujo así —
  // _esAdmin() daba true, se abría Ajustes, y pasaba a false.
  {
    const G = new Function('DB', // eslint-disable-line no-new-func
      html.slice(html.indexOf('function _ficha(nombre){'), html.indexOf('function _esAdmin(nombre){')) +
      html.slice(html.indexOf('function getEmp(name){'), html.indexOf('// ═══ LAZY-LOADED DATA ═══')) +
      '; return {get:getEmp, db:()=>DB.employees};');
    const db = { employees: { 'Administrador': { name:'Administrador', role:'admin' } } };
    const api2 = G(db);
    const e = api2.get('administrador');
    assert(Object.keys(api2.db()).length === 1,
      `getEmp ha creado una ficha duplicada: ${Object.keys(api2.db()).join(', ')}`);
    assert(e.role === 'admin', 'getEmp tiene que devolver la ficha que YA tiene el rol');
    // Y sigue creando la ficha cuando de verdad no existe.
    api2.get('Nuevo');
    assert(api2.db()['Nuevo'] && Object.keys(api2.db()).length === 2,
      'getEmp tiene que seguir creando la ficha de quien no la tiene');
  }
  // Pero enseñar el botón no concede nada: detrás va el PIN del servidor.
  assert(/if\(!supAuthenticated\)\{\s*\n\s*renderSupPinEntry\(\);/.test(html),
    'el panel sigue pidiendo PIN antes de pintar nada');

  // Que la administración no puntúe lo sostiene el SERVIDOR, no el móvil:
  // getEmp() crea la ficha local sin rol, así que entre entrar y que baje la
  // ficha hay una ventana en la que _esAdmin es falso. Por ahí se colaron 50 XP
  // en septiembre y otros 90 después de «arreglarlo».
  // Se quitan los comentarios ANTES de mirar: comentar una línea la deja en el
  // archivo, y una expresión ingenua la encuentra igual (mordió al verificar —
  // comentar `new.extras := null` pasaba tan tranquilo).
  const trg = read('supabase/administracion_no_puntua.sql')
    .split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
  assert(/create trigger trg_admin_no_puntua[\s\S]{0,120}before insert or update on public\.employees/.test(trg),
    'el recorte tiene que ser un trigger sobre employees, no una comprobación del móvil');
  for (const campo of ['xp', 'streak', 'sessions_count', 'txoko_record', 'duel_wins', 'extras'])
    assert(new RegExp('new\\.' + campo + ' :=').test(trg), `el trigger no recorta ${campo}`);
  assert(/new\.extras := null;/.test(trg),
    'extras guarda la liga semanal: también es puntuación');
  assert(/create trigger trg_admin_sin_marcas[\s\S]{0,120}before insert on public\.scores/.test(trg),
    'ninguna marca suya puede entrar en la tabla de puntuaciones');
  // Y lo que NO se toca: la cuenta tiene que poder usar la app.
  for (const campo of ['venue', 'display_name', 'nda_version', 'last_active_at'])
    assert(!new RegExp('new\\.' + campo + ' :=').test(trg),
      `el trigger no puede tocar ${campo}: la cuenta tiene que poder usar la app`);

  // El rol tiene que LLEGAR al dispositivo: bajaba en la consulta y se tiraba,
  // así que _esAdmin era siempre falso en el móvil y la cuenta de
  // administración escribía XP como cualquiera (50 XP encontrados en la nube).
  const rest = html.slice(html.indexOf('emp.displayName = r.display_name || cloudName;'), html.indexOf('// Credenciales: el hash vive en el servidor'));
  assert(/emp\.role = r\.role \|\| 'staff';/.test(rest),
    'el rol tiene que guardarse en la ficha local: si no, quien manda no ve su panel y la administración deja rastro');
  const bulk = html.slice(html.indexOf('displayName: r.display_name || r.name,'), html.indexOf('xp: r.xp || 0,'));
  assert(/role: r\.role \|\| 'staff',/.test(bulk), 'el rol también tiene que llegar en la consulta del panel');

  // Y se repinta cuando el rol llega de la nube: sin la segunda pasada, quien
  // entra por primera vez en un móvil nuevo no vería su panel hasta reabrir.
  assert((html.match(/_supSyncMando\(\);/g) || []).length >= 2,
    'hay que repintar la pestaña cuando el rol termina de bajar');

  // El servidor es quien manda de verdad: sólo el propietario reparte mando.
  const sql = read('supabase/supervisor_pin_por_restaurante.sql');
  assert(/'staff','admin','manager','owner'/.test(sql), 'el rol de propietario tiene que existir en el servidor');
  // Regla endurecida en sep 2026: no es «sólo el propietario ASCIENDE» sino
  // que CUALQUIER cambio de rol es suyo. Antes un manager podía degradar a otro
  // manager de su restaurante y dejarlo sin panel.
  assert(/if public\.sup_pin_scope\(p_pin\) <> '\*' then/.test(sql),
    'cualquier cambio de rol exige ser el propietario');
  assert(!/p_role in \('admin','manager','owner'\) and public\.sup_pin_scope/.test(sql),
    'la regla vieja sólo protegía los ascensos: dejaba degradar a un compañero');
  assert(/ultimo_propietario/.test(sql),
    'quitarle el mando al último propietario dejaría la casa sin nadie que pueda repartirlo');
});

test('Multi-restaurante: ninguna consulta se escapa del filtro de restaurante', () => {
  // Paso 4. Barrido de TODAS las llamadas a Supabase, no de las que uno
  // recuerda. Encontró cuatro tablas sin restaurante; la peor, las
  // suscripciones push: «todo el equipo» seleccionaba todas las de la base, así
  // que el manager de un restaurante hacía sonar el móvil del de al lado.
  //
  // Cada llamada tiene que caer en una de estas cajas:
  //   · lleva _vq()      → lectura filtrada por restaurante
  //   · lleva _vSello()  → escritura sellada con el restaurante
  //   · va por clave     → id=eq. / name=eq. / name=ilike. / endpoint=eq.
  //                        (la clave es única en toda la base)
  //   · está en la lista de excepciones, con su motivo escrito
  const PORCLAVE = /(\?|&)(id|name|endpoint|dish_id)=(eq|ilike)\./;
  const EXCEPCIONES = new Map([
    // La ficha propia se identifica por el usuario, que es único en toda la
    // base; el restaurante lo fija el alta y el cliente no debe pisarlo.
    ['employees?on_conflict=name', 'upsert de la ficha propia, por clave'],
    ['employees', 'upsert de la ficha propia, por clave'],
  ]);
  const lineas = html.split('\n');
  const sueltas = [];
  for (let i = 0; i < lineas.length; i++) {
    const m = lineas[i].match(/rest\/v1\/([a-z_]+)([^`'"]*)/);
    if (!m) continue;
    const tabla = m[1];
    if (tabla === 'rpc') continue;                    // las RPC validan dentro
    const url = m[1] + m[2];
    // La ventana de una escritura: el cuerpo va unas líneas más abajo.
    const bloque = lineas.slice(i, i + 12).join('\n');
    // …salvo cuando el cuerpo se arma antes en una variable (el chat lo hace).
    // Entonces se sigue la variable hasta su declaración en vez de ensanchar la
    // ventana a ciegas, que dejaría pasar cosas de verdad sueltas.
    let selladaFuera = false;
    const via = bloque.match(/body: *JSON\.stringify\(([A-Za-z_$][\w$]*)\)/);
    if (via) {
      const decl = new RegExp('(const|let|var) *' + via[1] + ' *=');
      for (let k = i; k >= Math.max(0, i - 60); k--)
        if (decl.test(lineas[k])) { selladaFuera = /_vSello\(/.test(lineas.slice(k, k + 6).join('\n')); break; }
    }
    const ok = /_vq\(\)/.test(lineas[i])
            || /_vSello\(/.test(bloque)
            || selladaFuera
            || PORCLAVE.test(lineas[i])
            || /method: *'DELETE'/.test(bloque)
            || [...EXCEPCIONES.keys()].some(k => url.startsWith(k) && !/select=/.test(url));
    if (!ok) sueltas.push(`línea ${i + 1}: ${url.slice(0, 80)}`);
  }
  assert(sueltas.length === 0,
    'consultas sin restaurante (o filtra, o sella, o va por clave, o se anota la excepción con su motivo):\n      ' + sueltas.join('\n      '));

  // Y las cuatro que se arreglaron, nombradas, para que no se deshaga.
  assert(/custom_dishes\?select=\*&\$\{_vq\(\)\}/.test(html), 'los platos añadidos a mano son de un restaurante');
  assert((html.match(/dish_photo_submissions\?status=[^`]*\$\{_vq\(\)\}/g) || []).length >= 2,
    'las dos lecturas de fotos tienen que filtrar');
  assert(/_vSello\(\{ dish_id:dishId, url, author/.test(html), 'la foto que sube el equipo se sella');
  assert(/_vSello\(\{\s*employee_name: employeeName/.test(html), 'la suscripción push se sella');

  // El aviso a «todo el equipo» tiene que decir de qué equipo habla.
  // Se cuentan por LÍNEA: una expresión que busque el cierre `})` se para en el
  // primer paréntesis que encuentra y se deja llamadas fuera (vio 3 de 5).
  const push = [];
  for (let i = 0; i < lineas.length; i++)
    if (/functions\/v1\/send-push/.test(lineas[i])) push.push({ n: i + 1, txt: lineas.slice(i, i + 12).join('\n') });
  assert(push.length >= 5, `esperaba las 5 llamadas a send-push, veo ${push.length}`);
  for (const p of push)
    assert(/venue: *_venueActual\(\)/.test(p.txt),
      `la llamada a send-push de la línea ${p.n} no lleva el restaurante: sin él, «todo el equipo» son TODOS los restaurantes`);
  // Y la función del servidor tiene que usarlo.
  const fn = read('supabase/functions/send-push/index.ts');
  assert(/const \{ target, venue,/.test(fn), 'send-push tiene que recibir el restaurante');
  assert(/venue=eq\.\$\{encodeURIComponent\(venue\)\}/.test(fn),
    'send-push tiene que filtrar por restaurante cuando el aviso es para todos');
});

test('Vinos: la bodega es de un restaurante, y quien no tiene no ve la de otro', () => {
  // M.B. probablemente no va a cargar sus vinos (propietario, sep 2026). Eso no
  // quita trabajo: lo cambia. `data/wines.json` se cargaba SIEMPRE y sin
  // restaurante, así que su equipo habría abierto Vinos y visto la bodega
  // entera de Txoko —149 vinos— como si fuera la suya.
  const src = html.slice(html.indexOf('let _vinosVenue = null;'), html.indexOf('// ═══ LA CARTA DE CADA RESTAURANTE'));
  assert(src.length > 400, 'no encuentro el resolutor de bodega');
  const F = new Function('_venueActual', '_VENUE_POR_DEFECTO', 'WINES', 'fetch', // eslint-disable-line no-new-func
    src + '; return {ruta:_vinosRuta, vigilar:_vinosVigilar, venue:()=>_vinosVenue, set:(v)=>{_vinosVenue=v;}};');
  const api = (v) => F(() => v, 'txoko', null, () => Promise.resolve({ ok:false }));
  // Cada restaurante, su archivo. Txoko conserva el de siempre.
  assert(api('txoko').ruta() === 'data/wines.json', 'Txoko mantiene data/wines.json');
  assert(api('mb').ruta() === 'data/wines-mb.json', 'otro restaurante trae data/wines-<id>.json');
  // Y la lista NO puede sobrevivir a un cambio de restaurante: los 71 usos de
  // WINES preguntan «¿hay lista?», nunca «¿es de aquí?».
  const a = api('mb'); a.set('txoko'); a.vigilar();
  assert(a.venue() === null, 'al cambiar de restaurante hay que tirar la bodega del anterior');
  const b2 = api('txoko'); b2.set('txoko'); b2.vigilar();
  assert(b2.venue() === 'txoko', 'si la bodega ya es de este restaurante, no se tira');

  // Ni un solo punto de carga puede apuntar al archivo a pelo.
  const fuera = [];
  html.split('\n').forEach((l, i) => {
    if (/loadLazyData\('data\/wines\.json'/.test(l)) fuera.push(i + 1);
  });
  assert(fuera.length === 0,
    `estas cargas de vinos no pasan por _vinosRuta(): líneas ${fuera.join(', ')}`);
  assert((html.match(/loadLazyData\(_vinosRuta\(\)/g) || []).length >= 6,
    'los seis puntos de carga de vinos tienen que ir por _vinosRuta()');

  // El botón desaparece donde no hay bodega, igual que el del carro de quesos.
  assert(/function _navVinosSync\(\)/.test(html) && /hayCartaDeVinos\(\)\.then\(hay => \{ b\.style\.display = hay \? '' : 'none'/.test(html),
    'sin bodega no hay pestaña de Vinos');
  assert(/_vinosVigilar\(\); _navQuesosSync\(\); _navVinosSync\(\);/.test(html),
    'al entrar hay que tirar la bodega ajena y repintar el botón');
  assert(/WINES = null; _vinosVenue = null;/.test(html),
    'cambiar de restaurante desde Ajustes también tira la bodega');

  // Y si alguien llega igualmente a la pestaña, se le dice la verdad: no es el
  // wifi, es que este restaurante no tiene carta de vinos.
  const rv = html.slice(html.indexOf('async function renderVinos(){'), html.indexOf('function renderVinosCarta('));
  assert(/\/\^HTTP 4\/\.test\(e\.message/.test(rv),
    'un 404 aquí significa «no hay bodega», no «no hay red»');
  assert(/does not have a wine list in the app yet/.test(rv) && /todavía no tiene carta de vinos/.test(rv),
    'hay que decirlo en los dos idiomas');
});

test('Marcaje: la cubertería del plato es un campo, no una frase escondida en las notas', () => {
  // M.B. pidió que el marcaje se vea en la aplicación (propietario, sep 2026).
  // Estaba metido dentro de `notes`, de donde nadie lo saca: las notas son un
  // párrafo de avisos de alérgenos, y el marcaje es lo PRIMERO que hace el
  // camarero, antes de que el plato salga de cocina.

  // ── 1. Se pinta de verdad. La fase de Servicio del recorrido guiado es
  //      código puro: se ejecuta, no se lee.
  const src = html.slice(html.indexOf('function _djNotasHTML(notas){'),
                         html.indexOf('// ── Phase 5: Quiz Generator ──'));
  assert(src.includes('_djPhaseService'), 'no encuentro la fase de Servicio');
  const F = new Function('catLocal', 'allergenLocal', 'escapeHtml', 'WINES', // eslint-disable-line no-new-func
    src + '; return _djPhaseService;');
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const fase = F(c => c, a => a, esc, []);

  const conM = fase({ id: 1, cat: 'Postres', allergens: [], name: 'X' },
                    { marcaje: 'Tenedor y cuchara dorados.' }, false);
  assert(/MARCAJE/.test(conM), 'el plato que trae marcaje tiene que enseñarlo');
  assert(conM.includes('Tenedor y cuchara dorados.'), 'y tiene que enseñar el marcaje que trae');

  // La carta de Txoko NO tiene marcaje. No se inventa uno ni se pinta el
  // hueco vacío.
  const sinM = fase({ id: 1, cat: 'Postres', allergens: [], name: 'X' }, {}, false);
  assert(!/MARCAJE|CUTLERY/.test(sinM), 'sin marcaje en la carta no se pinta nada');

  // En inglés también: «cuchara negra principal» no le sirve a nadie.
  const en = fase({ id: 1, cat: 'Postres', allergens: [], name: 'X' },
                  { marcaje: 'Gold fork and spoon.' }, true);
  assert(/CUTLERY MARKING/.test(en), 'el marcaje sale traducido');

  // Y va escapado: es texto de una carta que se edita a mano.
  const mal = fase({ id: 1, cat: 'Postres', allergens: [], name: 'X' },
                   { marcaje: '<img src=x onerror=alert(1)>' }, false);
  assert(!/<img/.test(mal), 'el marcaje se escapa antes de pintarlo');

  // ── 2. Los otros tres sitios donde se mira un plato ──
  const ficha = html.slice(html.indexOf('function renderRepasoDishDetail(dishId){'),
                           html.indexOf('function changeRepasoTopic('));
  assert(/const dd = getDish\(dish\);/.test(ficha) && /const _marcaje = dd\.marcaje/.test(ficha) &&
         /Cutlery marking':'Marcaje'/.test(ficha) && /escapeHTML\(_marcaje\)/.test(ficha),
    'la ficha completa del plato tiene que enseñar el marcaje');
  assert(/const marcajeHtml = dd\.marcaje/.test(html) && /\$\{marcajeHtml\}/.test(html),
    'el reverso de la tarjeta tiene que enseñar el marcaje');
  assert(/class="empl-ov-marc">🍽️ \$\{escapeHtml\(dd\.marcaje\)\}/.test(html),
    'la ficha rápida del panel tiene que enseñar el marcaje');
  assert(/\.empl-ov-marc\{/.test(read('styles.css')), 'falta el estilo de .empl-ov-marc');

  // ── 3. Y en la carta, el marcaje vive en su campo, no repetido en las
  //      notas: si se queda en los dos sitios, el camarero lo lee dos veces y
  //      uno de los dos se queda viejo.
  const mb = JSON.parse(read('docs/carta-mb-borrador.json'));
  const total = mb.DISHES.length;
  assert(total >= 30, `la carta de M.B. tiene ${total} platos, esperaba 30 o más`);
  for (const lista of [mb.DISHES, mb.DISHES_EN]) {
    for (const d of lista) {
      assert(typeof d.marcaje === 'string' && d.marcaje.length > 3,
        `el plato ${d.id} (${d.name}) se ha quedado sin marcaje`);
      assert(!String(d.notes || '').includes('🍴'),
        `el plato ${d.id} (${d.name}) repite el marcaje dentro de las notas`);
    }
  }
});

test('El turno almuerzo/cena es de la carta, y no se hereda del restaurante de al lado', () => {
  // Medido con la carta de M.B. puesta: 29 de sus 30 platos tenían un id que
  // también existe en la tabla de turnos de Txoko, así que heredaban el turno
  // del plato ajeno con el mismo número. Con «Almuerzo» puesto, a un camarero
  // de M.B. le quedaban 7 platos de 30, elegidos por la carta del vecino.
  const e = _cartaRes.turnos;
  assert(!e.roto, e.roto || '');
  // Txoko trae los suyos, y son los de verdad: se ejecuta el código real que
  // los mete en su carta, no una imitación. (Esta comprobación nació de una
  // mutación que NO mordía: vaciar la tabla de Txoko pasaba desapercibida.)
  const i0 = html.indexOf('const DISH_SERVICE = {');
  const i1 = html.indexOf('// Turno de estudio activo', i0);
  assert(i0 !== -1 && i1 !== -1, 'no encuentro la tabla de turnos');
  const real = new Function('_CARTA_BASE', // eslint-disable-line no-new-func
    html.slice(i0, i1) + '; return _CARTA_BASE.DISH_SERVICE || {};')({});
  assert(Object.keys(real).length > 50,
    `la carta de Txoko tiene que llevarse su tabla de turnos, se lleva ${Object.keys(real).length}`);
  assert(e.txoko > 0, 'al volver a Txoko hay que reponer su tabla de turnos');
  // Una carta SIN turnos deja la tabla vacía — no se queda la del anterior.
  assert(e.sinTurnos === 0,
    `una carta sin turnos tiene que dejar la tabla a cero, quedaron ${e.sinTurnos}`);
  // Y una carta CON turnos propios pone los suyos, no los suma a los de antes.
  assert(e.conTurnos === 1,
    `una carta con turnos propios pone sólo los suyos, quedaron ${e.conTurnos}`);
  // Vaciar la carta vacía también la tabla: si no, el restaurante sin carta
  // arrastra los turnos del anterior.
  assert(e.vaciada === 0, `vaciar la carta tiene que vaciar los turnos, quedaron ${e.vaciada}`);

  // Sin tabla, todo plato es 'ambos': el filtro no puede esconder nada.
  const helpers = html.slice(html.indexOf('let _studyShift'), html.indexOf('function computeDishAllergens'));
  const stub = 'function _renderShiftBar(){} var currentTab=null; function showTab(){}; var localStorage={getItem:()=>null,setItem:()=>{}}; var DISH_SERVICE={};';
  const M = new Function(stub + helpers + // eslint-disable-line no-new-func
    'return {f:_shiftDishes, hay:_hayTurnos, set:(s)=>{_studyShift=s;}};')();
  const mb = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, name: 'Plato ' + (i + 1) }));
  for (const turno of ['a', 'c', 'todo']) {
    M.set(turno);
    assert(M.f(mb).length === 30,
      `sin tabla de turnos, «${turno}» tiene que dejar los 30 platos, dejó ${M.f(mb).length}`);
  }
  assert(M.hay() === false, 'sin tabla de turnos, _hayTurnos() es falso y la barra no se enseña');
});

// Igual que con las cartas: se EJECUTA el cargador con un fetch de mentira,
// porque lo que hay que demostrar es qué archivo pide cada restaurante y qué
// queda cargado al terminar. El await va aquí fuera, a propósito.
const _salaRes = await (async () => {
  const src = html.slice(html.indexOf('let SALA = null, _salaVenue = null;'),
                         html.indexOf('function _salaCoincide(p){'));
  if (src.length < 400) return { roto: 'no encuentro el cargador de procedimientos' };
  const rutas = [];
  const responder = (r) => { rutas.push(r); return r === 'data/procedimientos-mb.json'
    ? Promise.resolve({ secciones: [{ id: 'x', t: 'X', pasos: [] }] })
    : Promise.reject(new Error('HTTP 404')); };
  const monta = (venue, cab) => {
    const F = new Function('_venueActual', 'LANG', 'loadLazyData', 'fetch', 'document', // eslint-disable-line no-new-func
      src + '; return { cargar: cargarSala, hay: hayProcedimientos };');
    return F(() => venue, 'es', responder, cab, { getElementById: () => null });
  };
  const mb = monta('mb', () => Promise.resolve({ ok: true }));
  const mbCarga = await mb.cargar();
  const tx = monta('txoko', () => Promise.resolve({ ok: false }));
  const txCarga = await tx.cargar();
  // El caso de verdad: el MISMO montaje salta de M.B. a Txoko, como hace la
  // cuenta de administración desde Ajustes. Si al fallar la carga no se
  // vacía, el de Txoko se queda leyendo el manual de M.B.
  let quien = 'mb';
  const salto = (() => {
    const F = new Function('_venueActual', 'LANG', 'loadLazyData', 'fetch', 'document', // eslint-disable-line no-new-func
      src + '; return { cargar: cargarSala, dentro: () => SALA };');
    return F(() => quien, 'es', responder, () => Promise.resolve({ ok: true }),
             { getElementById: () => null });
  })();
  await salto.cargar();
  const traeMB = !!salto.dentro();
  quien = 'txoko';
  await salto.cargar();
  const arrastra = !!salto.dentro();
  return { rutas, mbCarga: !!mbCarga, txCarga, txHay: await tx.hay(), mbHay: await mb.hay(),
           traeMB, arrastra };
})();

test('Sala: los procedimientos son de un restaurante, y quien no los tiene no ve los del vecino', () => {
  // M.B. mandó su manual de procedimientos y sus 36 pasos de servicio. Es cómo
  // se trabaja en ESA casa: ni formación de producto ni estándar del hotel.
  // Sale sola en cuanto existe data/procedimientos-<restaurante>.json, igual
  // que el carro de quesos y la bodega — y Txoko, que no tiene el suyo, no ve
  // la pestaña ni de lejos.
  assert(/function renderSala\(\)/.test(html), 'falta la sección de sala');
  assert(/'vinos','quesos','sala','chat'/.test(html), 'sala tiene que ser una ruta válida');
  assert(/renderMap = \{quesos:renderQuesos,sala:renderSala,/.test(html), 'y tener quien la pinte');
  assert(/id="navSala"[^>]*style="display:none"/.test(html),
    'el botón sale sólo donde hay procedimientos, así que arranca escondido');
  assert((html.match(/_navQuesosSync\(\); _navVinosSync\(\); _navSalaSync\(\);/g) || []).length === 2,
    'hay que repintar el botón en los DOS sitios: al entrar y al cambiar de restaurante');
  assert(/SALA = null; _salaVenue = null; _salaSec = null;/.test(html),
    'cambiar de restaurante tiene que tirar los procedimientos del anterior');

  // ── El cargador, ejecutado. El await va FUERA de test(), que es síncrono:
  //    una prueba async se tragaría los fallos en silencio. ──
  const e = _salaRes;
  assert(!e.roto, e.roto || '');
  assert(e.mbCarga, 'M.B. tiene que cargar los suyos');
  assert(e.rutas[0] === 'data/procedimientos-mb.json',
    `cada restaurante pide SU archivo, pidió ${e.rutas[0]}`);
  assert(e.txCarga === null, 'sin archivo no hay procedimientos, y no se inventan');
  assert(e.rutas[1] === 'data/procedimientos-txoko.json',
    `Txoko tiene que pedir el suyo, pidió ${e.rutas[1]}`);
  assert(e.txHay === false, 'sin archivo, el botón no se enseña');
  assert(e.mbHay === true, 'con archivo, el botón se enseña');
  assert(e.traeMB, 'el montaje que empieza en M.B. tiene que traer sus procedimientos');
  assert(e.arrastra === false,
    'al saltar de M.B. a un restaurante sin procedimientos NO se puede arrastrar el manual de M.B.');
});

test('Sala: el manual de M.B. está entero y las frases son las suyas', () => {
  const d = JSON.parse(read('data/procedimientos-mb.json'));
  assert(d.venue === 'mb', 'el archivo declara de quién es');
  assert(Array.isArray(d.secciones) && d.secciones.length === 4,
    `esperaba 4 secciones, hay ${(d.secciones || []).length}`);
  const pasos = d.secciones.flatMap(s => s.pasos);
  // Los 36 pasos del servicio, numerados y sin saltos: si falta uno, el
  // camarero se salta un paso del servicio sin enterarse.
  const serv = d.secciones.find(s => s.id === 'pasos');
  assert(serv, 'falta la sección de pasos del servicio');
  const nums = serv.pasos.map(p => p.n);
  assert(nums.length === 36, `esperaba 36 pasos, hay ${nums.length}`);
  for (let i = 0; i < 36; i++) assert(nums[i] === i + 1, `el paso ${i + 1} no está en su sitio`);
  // Cada entrada dice algo: un título suelto no vale de nada.
  for (const p of pasos) {
    assert(p.t && p.t.length > 3, `una entrada se quedó sin título: ${JSON.stringify(p).slice(0, 60)}`);
    assert(p.d || (p.lista || []).length || (p.frases || []).length || serv.pasos.includes(p),
      `la entrada «${p.t}» no dice nada`);
  }
  // Las frases en tres idiomas son lo que el camarero DICE en mesa.
  const frases = pasos.flatMap(p => p.frases || []);
  assert(frases.length >= 12, `esperaba al menos 12 frases, hay ${frases.length}`);
  for (const f of frases) assert(f.es && f.es.trim(), 'toda frase tiene que estar al menos en español');
  // Las frases van tal cual las escribió M.B., erratas incluidas: corregirlas
  // sería ponerle a su equipo un guion que ellos no han escrito. Lo que se
  // hace es avisar de que ese idioma está sin revisar.
  const conErrata = frases.filter(f => /changie le servillet|Peut etre|vous etes gaucher|droiute/.test(
    [f.en, f.fr].join(' ')));
  assert(conErrata.length === 5,
    `el manual trae 5 frases con erratas de idioma; encontré ${conErrata.length}`);
  for (const f of conErrata) assert(f.revisar,
    `la frase «${(f.fr || f.en || '').slice(0, 40)}» viene con erratas y no está marcada para revisar`);
  assert(/pendiente de revisar con M\.B\./.test(html) && /pending review with M\.B\./.test(html),
    'el aviso de idioma sin revisar tiene que salir en los dos idiomas');
  // Lo que de verdad hay que poder encontrar con prisa, en mitad del servicio.
  const todo = JSON.stringify(d).toLowerCase();
  for (const clave of ['zurdo', 'desmigar', 'oshibori', 'mignardises', 'carro de quesos',
                       'servilletas naranjas', 'un momento por favor', 'nunca inventaremos'])
    assert(todo.includes(clave), `el manual tendría que hablar de «${clave}»`);
});

test('Examen de sala: las preguntas salen del manual y no se contestan con trucos', () => {
  // Ni una pregunta escrita a mano: todas se derivan del manual del
  // restaurante. Si M.B. cambia un paso, la pregunta cambia con él; y lo que
  // no está en su manual, no se pregunta.
  //
  // El guard EJECUTA el generador y MIDE, porque un examen se rompe en
  // silencio: sigue dando preguntas, sólo que contestables sin saber nada.
  // Las tres trampas que se miden son las que ya aparecieron en esta app:
  // elegir la opción más larga, elegir siempre la misma posición, y el eco
  // (una palabra de la respuesta asomando en el enunciado).
  const i0 = html.indexOf('const _SALA_STOP = new Set(');
  const i1 = html.indexOf('let salaQuiz = {');
  assert(i0 !== -1 && i1 > i0, 'no encuentro el generador del examen de sala');
  const j0 = html.indexOf('function _lqaShuffle(arr){');
  // La medida se hace con azar SEMBRADO. Con Math.random() de verdad, el mismo
  // generador daba entre el 26% y el 35% en el sesgo de longitud de un tipo, y
  // la prueba fallaba una de cada tantas sin que nada hubiera cambiado. Una
  // prueba que falla sola enseña a ignorarla. Sembrado, mide siempre lo mismo:
  // si un día se mueve, es que se ha movido el generador.
  let _semilla = 20260912;
  const _azar = () => { _semilla = (_semilla * 1103515245 + 12345) & 0x7fffffff; return _semilla / 0x7fffffff; };
  const G = new Function('LANG', 'Math', // eslint-disable-line no-new-func
    html.slice(j0, html.indexOf('\n}', j0) + 2) + html.slice(i0, i1) + '; return _salaGenerar;')(
      'es', Object.assign(Object.create(Math), { random: _azar }));

  const doc = JSON.parse(read('data/procedimientos-mb.json'));
  const todas = [];
  for (let i = 0; i < 150; i++) for (const q of G(doc, 10)) todas.push(q);
  assert(todas.length > 1000, `el generador se quedó en ${todas.length} preguntas`);

  // Dos entradas con el mismo título en una sección harían que una pregunta
  // tuviera dos respuestas correctas. Es la condición que hace válido el
  // examen, así que se comprueba en el manual, no sólo en el generador.
  for (const s of doc.secciones) {
    const vistos = new Set();
    for (const p of s.pasos) {
      assert(!vistos.has(p.t), `«${p.t}» está dos veces en «${s.t}»: daría dos correctas`);
      vistos.add(p.t);
    }
  }

  // Los títulos que existen en el manual. Ninguna opción puede ser otra cosa.
  const titulos = new Set();
  for (const s of doc.secciones) for (const p of s.pasos) titulos.add(p.t);
  const pal = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/).filter(w => w.length > 3);
  // Se mide POR TIPO de pregunta, no sólo en el total: un tipo puede regalar
  // la respuesta entera y quedar diluido por los otros tres. Pasó: el eco de
  // «¿qué viene después?» llegaba al 21% y en el total no se notaba.
  const M = {};
  const claves = new Set();
  for (const q of todas) {
    claves.add(q.key);
    const tipo = q.key.split(':')[0];
    const m = M[tipo] || (M[tipo] = { n: 0, larga: 0, corta: 0, eco: 0, pos: [0, 0, 0, 0] });
    m.n++;
    assert(q.opts.length === 4, `una pregunta salió con ${q.opts.length} opciones`);
    assert(new Set(q.opts).size === 4, `una pregunta repite opción: ${q.opts.join(' | ')}`);
    assert(q.corr >= 0 && q.corr < 4, 'la correcta se salió del rango');
    for (const o of q.opts) assert(titulos.has(o),
      `la opción «${o}» no está en el manual: el examen no puede inventarse nada`);
    m.pos[q.corr]++;
    const lens = q.opts.map(o => o.length);
    if (lens[q.corr] === Math.max(...lens)) m.larga++;
    if (lens[q.corr] === Math.min(...lens)) m.corta++;
    const enun = pal(q.enun + ' ' + (q.ctx || ''));
    const conEco = q.opts.map(o => pal(o).some(w => enun.includes(w)));
    if (conEco[q.corr] && conEco.filter(Boolean).length === 1) m.eco++;
  }
  assert(Object.keys(M).length === 4,
    `esperaba las cuatro maneras de preguntar, salieron ${Object.keys(M).join(', ')}`);

  // Con cuatro opciones el azar es el 25%. Los márgenes dejan sitio al ruido
  // de muestreo (n≈350 por tipo, ±4,5 puntos) y ninguno al regalo.
  for (const [tipo, m] of Object.entries(M)) {
    const pc = a => 100 * a / m.n;
    assert(pc(m.larga) < 34, `en «${tipo}», elegir la más larga acierta el ${pc(m.larga).toFixed(1)}% (azar 25%)`);
    assert(pc(m.corta) < 34, `en «${tipo}», elegir la más corta acierta el ${pc(m.corta).toFixed(1)}% (azar 25%)`);
    assert(pc(m.eco) < 8, `en «${tipo}», el enunciado delata la respuesta el ${pc(m.eco).toFixed(1)}% de las veces`);
    for (let i = 0; i < 4; i++)
      assert(pc(m.pos[i]) > 15 && pc(m.pos[i]) < 35,
        `en «${tipo}», la correcta cae en la posición ${i + 1} el ${pc(m.pos[i]).toFixed(1)}% de las veces`);
  }

  // «De estos cuatro pasos, ¿cuál va PRIMERO?» pregunta también por el ÚLTIMO,
  // a medias. No es variedad: los títulos de los pasos se acortan según avanza
  // el servicio, así que preguntando siempre por el primero, elegir la opción
  // más larga acertaba el 30%. Preguntar por los dos extremos lo cancela.
  const nPri = todas.filter(q => q.key.startsWith('orden:a:')).length;
  const nUlt = todas.filter(q => q.key.startsWith('orden:z:')).length;
  assert(nPri > 0 && nUlt > 0 && Math.min(nPri, nUlt) / (nPri + nUlt) > 0.35,
    `las preguntas de orden tienen que repartirse entre primero y último; salieron ${nPri} y ${nUlt}`);

  // Y si algún día el manual llega con dos entradas del mismo título, el
  // generador no puede sacar una pregunta con dos respuestas correctas. Se
  // comprueba dándoselo de verdad, no confiando en que no pase.
  const trucado = JSON.parse(JSON.stringify(doc));
  for (const s of trucado.secciones) if (s.pasos.length > 3) s.pasos[1].t = s.pasos[0].t;
  for (let i = 0; i < 40; i++)
    for (const q of G(trucado, 10))
      assert(new Set(q.opts).size === 4,
        `con títulos repetidos en el manual salió una pregunta con dos correctas: ${q.opts.join(' | ')}`);

  // Variedad: si sabe hacer cuatro preguntas, el examen es un trámite.
  assert(claves.size > 300, `sólo sabe hacer ${claves.size} preguntas distintas`);
  // Y dentro de un mismo examen no se repite ninguna.
  for (let i = 0; i < 30; i++) {
    const ex = G(doc, 10);
    assert(ex.length === 10, `un examen salió con ${ex.length} preguntas`);
    assert(new Set(ex.map(q => q.key)).size === 10, 'un examen repitió pregunta');
  }

  // Y la pantalla existe, se puede lanzar y guarda el resultado donde lo ve
  // el panel del supervisor.
  assert(/function startSalaExam\(\)/.test(html), 'falta el examen');
  assert(/class="pr-ex-lanza" onclick="startSalaExam\(\)"/.test(html),
    'falta el botón que lanza el examen desde la pantalla de Sala');
  assert(/_lqaPushScore\(emp, 'sala', s\.score, total, seg\)/.test(html),
    'el resultado tiene que quedar registrado como los demás exámenes');
  assert(/awardXP\(xp, LANG==='en'\?'Floor exam':'Examen de sala'/.test(html),
    'y dar XP, como los demás');
});

test('La ficha del plato se PINTA, y en el idioma elegido', () => {
  // Esta prueba nace de un fallo propio. Al traducir la ficha dejé la variable
  // declarada DESPUÉS de usarla: la pantalla reventaba entera y las 338
  // pruebas seguían en verde, porque todas miraban el texto del archivo y
  // ninguna ejecutaba la función. Es la pantalla más usada de la aplicación.
  //
  // Así que esta la EJECUTA, con un DOM de mentira, y comprueba dos cosas: que
  // pinta sin reventar, y que el contenido sale en el idioma elegido.
  const i0 = html.indexOf('function renderRepasoDishDetail(dishId){');
  const i1 = html.indexOf('function changeRepasoTopic(');
  assert(i0 !== -1 && i1 > i0, 'no encuentro la ficha del plato');

  const PLATO_ES = { id: 1, cat: 'Entrantes', name: 'Croqueta de jamón',
    ingredients: 'Jamón ibérico, Leche, Harina', history: 'La receta de la casa.',
    notes: 'Servir muy caliente.', marcaje: 'Tenedor de plata.', allergens: ['Gluten'] };
  const PLATO_EN = { id: 1, name: 'Ham croquette',
    ingredients: 'Iberian ham, Milk, Flour', history: 'The house recipe.',
    notes: 'Serve very hot.', marcaje: 'Silver fork.' };

  const pintar = (lang) => {
    let salida = '';
    const nodo = () => ({ set innerHTML(v){ salida = v; }, get innerHTML(){ return salida; },
                          style:{}, classList:{add(){},remove(){},toggle(){}}, addEventListener(){} });
    const doc = { getElementById: () => nodo(), querySelector: () => null, querySelectorAll: () => [] };
    const getDish = d => {
      if(lang !== 'en') return d;
      const en = PLATO_EN.id === d.id ? PLATO_EN : null;
      if(!en) return d;
      const m = Object.assign({}, d);
      for(const k of Object.keys(en)) if(en[k] != null) m[k] = en[k];
      return m;
    };
    const F = new Function( // eslint-disable-line no-new-func
      'DISHES','getDish','getEmp','currentUser','track','escapeHTML','escapeHtml','catLocal',
      'dishPhotoSrc','DISH_ACTIONS','DISH_COMPONENTS','_dishPairWines','WINES','t','LANG',
      'document','repasoView','renderRepaso','loadLazyData','_vinosRuta','SRC','repasoDishId',
      html.slice(i0, i1) + '; return renderRepasoDishDetail;');
    const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    F([PLATO_ES], getDish, () => ({ knownDishes:{}, journeyMastered:{} }), 'Ana', () => {},
      esc, esc, c => c, () => null, {}, {}, () => [], [], k => k, lang,
      doc, 'dish', () => {}, () => Promise.resolve(null), () => 'data/wines.json', 'src', 1)(1);
    return salida;
  };

  const es = pintar('es');
  assert(es.length > 500, 'la ficha en español no ha pintado nada');
  assert(es.includes('Croqueta de jamón'), 'falta el nombre del plato en español');
  assert(es.includes('Jamón ibérico'), 'faltan los ingredientes en español');
  assert(es.includes('La receta de la casa.'), 'falta la historia en español');

  const en = pintar('en');
  assert(en.length > 500, 'la ficha en inglés no ha pintado nada');
  assert(en.includes('Ham croquette') && !en.includes('Croqueta de jamón'),
    'en inglés tiene que salir el nombre traducido, no el español');
  assert(en.includes('Iberian ham') && !en.includes('Jamón ibérico'),
    'en inglés tienen que salir los ingredientes traducidos');
  assert(en.includes('The house recipe.') && !en.includes('La receta de la casa.'),
    'en inglés tiene que salir la historia traducida');
  assert(en.includes('Silver fork.'), 'y el marcaje traducido');
});

test('Higiene: ni un alert() del navegador, y los avisos por debajo de la navegación', () => {
  // Los nueve alert() del navegador —«Sesión caducada», «Error al enviar el
  // reto»— salían en la ventanita gris del sistema, con el nombre del dominio
  // arriba, dentro de una aplicación por lo demás cuidada. Ahora usan el mismo
  // sistema de avisos que el resto.
  const alerts = (html.match(/(?<![.\w])alert\(/g) || []).length;
  assert(alerts === 0, `quedan ${alerts} alert() del navegador`);

  // Los avisos se anclan MIDIENDO la cabecera y la navegación, no con un
  // número escrito a mano: la cabecera crece con el notch del iPhone.
  assert(/function _avisosAnclar\(\)/.test(html), 'falta el ancla de los avisos');
  assert(/document\.querySelector\('\.app-header'\)/.test(html) &&
         /document\.querySelector\('\.nav-dd'\)/.test(html),
    'el ancla tiene que medir la cabecera Y la navegación');
  assert(/--avisos-top/.test(read('styles.css')), 'la pila de avisos tiene que usar el ancla');
  assert(/top:var\(--avisos-top,120px\)/.test(html), 'la pila de logros tiene que usar el mismo ancla');
  assert(/_avisosAnclar\(\);\n  const t = document\.createElement/.test(html),
    'showToast tiene que recalcular el ancla antes de pintar');

  // El aviso de XP no puede pintarse por encima del menú desplegado (9991).
  const xp = html.slice(html.indexOf("toast.id = 'xpToast'"), html.indexOf("toast.id = 'xpToast'") + 700);
  const z = (xp.match(/z-index:(\d+)/) || [])[1];
  assert(z && +z < 9991, `el aviso de XP tiene z-index ${z}: taparía el menú abierto`);

  // Un h1 por pantalla, puesto en el armazón para que no dependa de que cada
  // pantalla se acuerde. Los que se inyectaban en el contenido bajan a h2.
  assert((html.match(/<h1/g) || []).length === 2,
    'sólo puede haber dos h1 en el archivo: el del login y el de la pantalla');
  assert(/id="tituloPantalla" class="solo-lectores"/.test(html), 'falta el encabezado de pantalla');
  assert(/_ponerTitulo\(tab\);/.test(html), 'showTab tiene que nombrar la pantalla');
  const rutas = (html.match(/const TAB_ROUTES = \[([^\]]*)\]/) || [])[1] || '';
  const tabs = [...rutas.matchAll(/'([^']+)'/g)].map(m => m[1]);
  const tit = html.slice(html.indexOf('const _TITULOS = {'), html.indexOf('function _ponerTitulo'));
  for (const tb of tabs) assert(new RegExp('\\b' + tb + ':\\[').test(tit),
    `la pantalla «${tb}» no tiene nombre para el encabezado`);

  // Los cinco controles de cabecera que la auditoría midió por debajo de 44 px.
  const cab = html.slice(html.indexOf('<header class="app-header"'), html.indexOf('</header>'));
  const chicos = (cab.match(/min-height:(\d+)px/g) || []).filter(m => +m.replace(/\D/g,'') < 44);
  assert(chicos.length === 0, `quedan controles de cabecera por debajo de 44 px: ${chicos.join(', ')}`);
  const css = read('styles.css');
  assert(/\.btn-logout\{[^}]*min-height:44px/.test(css), 'el botón de salir necesita 44 px');
  assert(/\.header-logo\{[^}]*min-height:44px/.test(css), 'el logo es un botón: necesita 44 px');
  // EXCEPCIÓN MEDIDA, y está aquí para que nadie la "arregle" sin volver a
  // medir: ocho controles de 44 px de ancho suman 352 y un iPhone SE mide 320.
  // Forzarlo dejaba «Salir» FUERA de pantalla con la campana de notificaciones
  // visible (medido: 348/320), que es justo el fallo que estas media queries
  // arreglaron en su día. Por debajo de 400 px el ANCHO se queda comprimido;
  // el ALTO llega a 44 en todas partes. El arreglo de verdad es tener menos
  // botones en la cabecera, y eso es de la fase de navegación.
  for (const m of css.matchAll(/\.app-header #(\w+)\{([^}]*)\}/g)) {
    const alto = (m[2].match(/min-height:(\d+)px/) || [])[1];
    assert(!alto || +alto >= 44,
      `en pantallas estrechas, #${m[1]} baja a ${alto}px de alto: el alto sí cabe siempre`);
  }
});

// El montaje se ejecuta AQUÍ FUERA, y a propósito: test() es síncrono, así que
// una prueba que devuelve una promesa se traga sus propios fallos. Lo comprobé:
// con el guard escrito así, aceptar «allergens» otra vez pasaba en verde.
const _actRes = await (async () => {
  const i0 = html.indexOf('const COMPETENCIAS = [');
  const i1 = html.indexOf('async function supaInsertScore');
  if (i0 === -1 || i1 <= i0) return { roto: 'no encuentro el registro de actividad' };
  const enviados = [];
  const F = new Function('SUPA_URL','SUPA_KEY','_esAdmin','currentUser','_vSello','dbgw','fetch', // eslint-disable-line no-new-func
    html.slice(i0, i1) + '; return { registrar: registrarActividad, deTema: competenciaDeTema };');
  const api = (esAdmin) => F('https://x', 'k', () => esAdmin, 'Ana',
    o => Object.assign({ venue: 'txoko' }, o), () => {},
    (url, opts) => { enviados.push({ url, cuerpo: JSON.parse(opts.body) }); return Promise.resolve({ ok: true }); });
  const a = api(false);
  const o = { temas: {}, rechazadas: [] };

  for (const tm of ['alergenos','allergens','mixed','ingredients','history','protocolo','cutlery','sala','vinos'])
    o.temas[tm] = a.deTema(tm);

  enviados.length = 0;
  o.valida = await a.registrar({ activity:'examen', competency:'carta', kind:'evaluacion',
    score:8, total:10, seconds:240 });
  o.peticiones = enviados.length;
  o.url = enviados[0] && enviados[0].url;
  o.cuerpo = enviados[0] && enviados[0].cuerpo;

  for (const [caso, arg] of [
    ['competencia en otro idioma', { activity:'x', competency:'allergens', kind:'evaluacion', score:1, total:1 }],
    ['competencia inventada',      { activity:'x', competency:'inventada', kind:'evaluacion', score:1, total:1 }],
    ['tipo inventado',             { activity:'x', competency:'carta', kind:'otro', score:1, total:1 }],
    ['evaluación sin competencia', { activity:'x', kind:'evaluacion', score:1, total:1 }],
    ['total cero',                 { activity:'x', competency:'carta', kind:'practica', score:0, total:0 }],
  ]) {
    enviados.length = 0;
    const ok = await a.registrar(arg);
    o.rechazadas.push({ caso, ok, salio: enviados.length });
  }

  enviados.length = 0;
  o.juego = await a.registrar({ activity:'mr_shoesmith', kind:'juego', meta:{ record: 31 } });
  o.juegoCuerpo = enviados[0] && enviados[0].cuerpo;

  enviados.length = 0;
  o.admin = await api(true).registrar({ activity:'examen', competency:'carta', kind:'evaluacion', score:1, total:1 });
  o.adminSalio = enviados.length;

  enviados.length = 0;
  await a.registrar({ activity:'x', competency:'carta', kind:'evaluacion', score:99, total:10 });
  o.tope = enviados[0] && enviados[0].cuerpo;
  return o;
})();

test('Registro de actividad: todas las actividades escriben, y con el mismo vocabulario', () => {
  // FASE 1. Medido antes de empezar: de las diecisiete actividades sólo DOS
  // llegaban a la nube, y de las 427 filas de `scores` 254 eran marcadores de
  // partida, no evaluaciones. Las evaluaciones reales estaban repartidas en
  // nueve nombres de tema, dos de ellos el mismo en dos idiomas.
  const e = _actRes;
  assert(!e.roto, e.roto || '');

  // ── 1. Los nueve nombres de tema de hoy caen en las seis competencias ──
  assert(e.temas.alergenos === 'alergenos' && e.temas.allergens === 'alergenos',
    '«alergenos» y «allergens» son lo mismo y tienen que caer en la misma competencia');
  for (const [tema, esperada] of [['mixed','carta'],['ingredients','carta'],['history','carta'],
                                  ['protocolo','protocolo'],['cutlery','servicio'],['sala','sala'],
                                  ['vinos','vinos']])
    assert(e.temas[tema] === esperada, `el tema «${tema}» tiene que ser «${esperada}», es «${e.temas[tema]}»`);

  // ── 2. Lo válido sale por el cable, con el restaurante estampado ──
  assert(e.valida === true, 'una evaluación válida tiene que registrarse');
  assert(e.peticiones === 1, `tiene que salir una petición, salieron ${e.peticiones}`);
  assert(/\/rest\/v1\/actividad$/.test(e.url), 'tiene que escribir en la tabla actividad');
  assert(e.cuerpo.venue === 'txoko', 'toda fila lleva su restaurante: es el aislamiento de siempre');
  assert(e.cuerpo.employee === 'Ana' && e.cuerpo.activity === 'examen' && e.cuerpo.competency === 'carta'
         && e.cuerpo.kind === 'evaluacion' && e.cuerpo.score === 8 && e.cuerpo.total === 10
         && e.cuerpo.seconds === 240, 'el cuerpo no es el esperado: ' + JSON.stringify(e.cuerpo));

  // ── 3. Lo que NO puede salir ──
  for (const r of e.rechazadas) {
    assert(r.ok === false, `«${r.caso}» no puede registrarse`);
    assert(r.salio === 0, `«${r.caso}» ni siquiera puede salir por el cable`);
  }

  // ── 4. Un juego no lleva competencia y no puede ensuciar una media ──
  assert(e.juego === true, 'un juego sí se registra, como juego');
  assert(e.juegoCuerpo.competency === null && e.juegoCuerpo.kind === 'juego',
    'un juego va sin competencia: es lo que impide que entre en una nota');

  // ── 5. La administración no deja rastro, igual que en scores ──
  assert(e.admin === false, 'la cuenta de administración no puede dejar rastro');
  assert(e.adminSalio === 0, 'y no puede ni salir la petición');

  // ── 6. El acierto nunca puede superar el total ──
  assert(e.tope && e.tope.score <= e.tope.total,
    'un acierto mayor que el total rompería cualquier media');
});

test('Registro de actividad: las actividades reales lo llaman', () => {
  // Que el registrador funcione no sirve de nada si nadie lo llama. Se cuentan
  // las llamadas y se comprueba que cada actividad con resultado tiene la suya.
  const llamadas = [...html.matchAll(/registrarActividad\(\{\s*activity:'([a-z_]+)'/g)].map(m => m[1]);
  const esperadas = ['examen','simulacro_alergenos','examen_lqa','situaciones_lqa','auditor_lqa',
                     'examen_sala','fantasma','repaso','maridaje','reto_dia','quiz_vinos',
                     'recorrido','survivors','mr_shoesmith'];
  for (const e of esperadas)
    assert(llamadas.includes(e), `la actividad «${e}» no registra nada`);
  assert(llamadas.length >= esperadas.length,
    `esperaba al menos ${esperadas.length} llamadas, hay ${llamadas.length}`);

  // Y `scores` sigue recibiendo lo de siempre: el panel actual depende de ella
  // hasta la fase 3. Quitarla ahora dejaría al supervisor a ciegas.
  // Se CUENTAN: cada una aparece dos veces, la llamada y su botón de
  // reintentar. Buscando el texto una sola vez, quitar la llamada de verdad
  // pasaba en verde porque el reintento la seguía mencionando.
  assert((html.match(/supaInsertScore\(session, currentUser\)/g) || []).length === 2,
    'la llamada a scores del examen, y su reintento, tienen que seguir ahí');
  assert((html.match(/supaInsertScore\(_payload, currentUser\)/g) || []).length === 2,
    'la llamada a scores del simulacro, y su reintento, tienen que seguir ahí');
});

// ═══ EL PLAN DE HOY (fase 2) ══════════════════════════════════════════════
// El motor se EJECUTA, no se lee. Es la lección del fallo de `dd`: aquel día
// la pantalla más usada de la aplicación no pintaba nada y las 338 pruebas
// pasaron en verde, porque ninguna llegaba a ejecutar la función.
//
// Por eso `planDeHoy` se escribió puro: se le dan datos inventados y se mira
// el plan que devuelve. Sin navegador, sin DOM y sin red.
const _planM = (() => {
  const i0 = html.indexOf('const PLAN_MAX_TAREAS');
  const i1 = html.indexOf('// ── De la ficha del empleado a lo que el motor necesita');
  if (i0 === -1 || i1 <= i0) return { roto: 'no encuentro el motor del plan de hoy' };
  try {
    return new Function('COMPETENCIAS', // eslint-disable-line no-new-func
      html.slice(i0, i1) +
      '; return { planDeHoy, PLAN_CATALOGO, PLAN_MAX_TAREAS, PLAN_MINUTOS_MAX, _planSemilla, _planCompetenciaFloja };'
    )(['alergenos', 'carta', 'vinos', 'protocolo', 'sala', 'servicio']);
  } catch (e) { return { roto: 'el motor del plan no compila: ' + e.message }; }
})();

// Un empleado impecable: todo al día, todo dominado, sin nada que reprochar.
// Cada prueba estropea UNA cosa y mira qué tarea aparece por eso.
const _planBase = (x) => Object.assign({
  dia: '2026-09-12', empleado: 'Ana', asignaciones: [],
  alergenosMejor: 100, alergenosFallosRecientes: 0,
  srsVencidos: 0, platosSinVer: 0, platosSinDominar: 0, platoSugerido: null,
  competencias: {
    alergenos: { aciertos: 20, total: 20 }, carta: { aciertos: 20, total: 20 },
    vinos: { aciertos: 20, total: 20 }, protocolo: { aciertos: 20, total: 20 },
    sala: { aciertos: 20, total: 20 }, servicio: { aciertos: 0, total: 0 }
  },
  disponibles: { alergenos: true, carta: true, protocolo: true, sala: true, vinos: true, servicio: false },
  racha: 0, estudiadoHoy: true, retoHecho: true, hechas: [], fijadas: null
}, x || {});

// El eslabón entre la fase 1 y la fase 2: el diario. Se monta AQUÍ FUERA
// porque `registrarActividad` es asíncrona y test() es síncrono. Se ejecuta el
// registro de verdad —con la red interceptada— y se mira qué queda guardado.
const _diarioRes = await (async () => {
  const i0 = html.indexOf('const COMPETENCIAS = [');
  const i1 = html.indexOf('// Abrir la tarea. Cada una lleva a la actividad');
  if (i0 === -1 || i1 <= i0) return { roto: 'no encuentro el registro y el diario' };
  const fichas = {};
  let hoy = '2026-09-12', admin = false, red = () => Promise.resolve({ ok: true }), guardados = 0;
  const getEmp = (n) => (fichas[n] = fichas[n] || { name: n });
  let M;
  try {
    M = new Function('SUPA_URL', 'SUPA_KEY', '_esAdmin', 'currentUser', '_vSello', 'dbgw', 'fetch', // eslint-disable-line no-new-func
      'getEmp', 'todayStr', 'saveDB', 'DISHES', '_venueActual', '_haySala', '_hayVinos', '_VENUE_POR_DEFECTO',
      html.slice(i0, i1) +
      '; return { registrar: registrarActividad, datosDeHoy, planDeHoyDe, planDeHoy };'
    )('https://x', 'k', () => admin, 'Ana', o => Object.assign({ venue: 'txoko' }, o), () => {},
      (...a) => red(...a), getEmp, () => hoy, () => { guardados++; return true; },
      [{ id: 1 }, { id: 2 }, { id: 3 }], () => 'txoko',
      new Map([['txoko', false]]), new Map([['txoko', true]]), 'txoko');
  } catch (e) { return { roto: 'no compila: ' + e.message }; }

  // Toda lectura va por aquí: si el diario deja de escribirse, la prueba tiene
  // que fallar diciendo «no hay líneas», no reventar el arranque de la suite.
  const lineas = (d) => (((fichas.Ana || {}).diario || {})[d || hoy] || []);
  const o = {};
  try {
    await M.registrar({ activity: 'examen', competency: 'carta', kind: 'evaluacion', score: 8, total: 10, seconds: 240 });
    await M.registrar({ activity: 'simulacro_alergenos', competency: 'alergenos', kind: 'evaluacion', score: 9, total: 10 });
    o.diario = JSON.parse(JSON.stringify((fichas.Ana || {}).diario || {}));
    o.guardados = guardados;

    // Sin red: la actividad ha ocurrido igual, y el plan tiene que enterarse.
    red = () => Promise.reject(new Error('sin conexión'));
    o.sinRedDevuelve = await M.registrar({ activity: 'repaso', competency: 'carta', kind: 'practica', score: 12, total: 15 });
    o.sinRedAnota = lineas().some(x => x.a === 'repaso');
    red = () => Promise.resolve({ ok: true });

    // Lo que el registro rechaza tampoco puede quedar anotado.
    await M.registrar({ activity: 'inventada', competency: 'nosecual', kind: 'evaluacion', score: 1, total: 1 });
    o.rechazadaAnota = lineas().some(x => x.a === 'inventada');

    // La administración no deja rastro tampoco en el móvil.
    admin = true;
    await M.registrar({ activity: 'examen', competency: 'carta', kind: 'evaluacion', score: 1, total: 1 });
    o.adminAnota = lineas().length;
    admin = false;

    // Poda: lo de hace tres semanas se va solo.
    if (fichas.Ana && fichas.Ana.diario) fichas.Ana.diario['2026-08-01'] = [{ a: 'examen', c: 'carta', k: 'evaluacion', s: 1, t: 1 }];
    await M.registrar({ activity: 'maridaje', competency: 'vinos', kind: 'evaluacion', score: 4, total: 5 });
    o.dias = Object.keys((fichas.Ana || {}).diario || {}).sort();

    // Y el plan lee de ahí lo que está hecho.
    o.datos = M.datosDeHoy(fichas.Ana || { name: 'Ana' }, hoy);
    const plan = M.planDeHoy(Object.assign({}, o.datos, { fijadas: ['seguridad_alergenos', 'repaso_srs'] }));
    o.planHechas = plan.tareas.map(t => ({ id: t.id, hecha: t.hecha }));
  } catch (e) { o.roto = 'el registro reventó: ' + e.message; }
  return o;
})();

test('Plan de hoy: el diario es lo que une la fase 1 con la fase 2', () => {
  const e = _diarioRes;
  assert(!e.roto, e.roto || '');

  // 1 · Cada actividad registrada deja su línea en el móvil, con su nota.
  const hoy = (e.diario || {})['2026-09-12'] || [];
  assert(hoy.length === 2, `esperaba dos líneas anotadas, hay ${hoy.length}`);
  const ex = hoy.find(x => x.a === 'examen');
  assert(ex && ex.c === 'carta' && ex.k === 'evaluacion' && ex.s === 8 && ex.t === 10 && ex.seg === 240,
    'la línea del examen no lleva lo que hace falta: ' + JSON.stringify(ex));
  assert(e.guardados > 0, 'el diario tiene que guardarse, no quedarse en memoria');

  // 2 · Sin conexión, el registro a la nube falla pero la línea se anota
  //     igual: la actividad ha ocurrido. Es lo que permite que el plan
  //     funcione en un móvil sin cobertura en mitad de un servicio.
  assert(e.sinRedDevuelve === false, 'sin red el envío a la nube falla, y se dice');
  assert(e.sinRedAnota === true, 'pero la actividad ha ocurrido y tiene que quedar anotada');

  // 3 · Lo que el registro rechaza no se anota, y la administración tampoco.
  assert(e.rechazadaAnota === false, 'lo que no vale para la nube tampoco vale para el diario');
  assert(e.adminAnota === 3, `la administración no puede dejar rastro; hay ${e.adminAnota} líneas`);

  // 4 · Se poda: catorce días, no un año de historial en el mismo
  //     localStorage donde viven las fichas de todo el equipo.
  assert(!e.dias.includes('2026-08-01'), 'lo de hace tres semanas tiene que podarse: ' + e.dias.join(', '));
  assert(e.dias.includes('2026-09-12'), 'y lo de hoy quedarse');

  // 5 · Y el plan lo lee: `hechas` sale del diario, no de por dónde se navegó.
  assert(e.datos.hechas.includes('examen') && e.datos.hechas.includes('simulacro_alergenos')
         && e.datos.hechas.includes('repaso') && e.datos.hechas.includes('maridaje'),
    'el plan tiene que ver lo hecho hoy: ' + JSON.stringify(e.datos.hechas));
  const marc = e.planHechas.find(t => t.id === 'repaso_srs');
  assert(marc && marc.hecha === true, 'la tarea de repaso tiene que salir marcada');
  const seg = e.planHechas.find(t => t.id === 'seguridad_alergenos');
  assert(seg && seg.hecha === true, 'y la de alérgenos también');

  // 6 · La nota por competencia también sale de ahí: 9 de 10 en alérgenos.
  assert(e.datos.competencias.alergenos.total === 10 && e.datos.competencias.alergenos.aciertos === 9,
    'la nota de alérgenos sale del diario: ' + JSON.stringify(e.datos.competencias.alergenos));
});

test('Plan de hoy: el motor es determinista y respeta sus propios límites', () => {
  assert(!_planM.roto, _planM.roto || '');
  const { planDeHoy } = _planM;

  // 1 · El mismo día con los mismos datos da el mismo plan. Sin azar, sin
  //     aprendizaje automático, sin Date.now(): dos llamadas, un solo plan.
  const d = _planBase({ alergenosMejor: 40, srsVencidos: 12, platosSinVer: 9, racha: 5, estudiadoHoy: false, retoHecho: false });
  const a = planDeHoy(d), b = planDeHoy(d);
  assert(JSON.stringify(a.tareas.map(t => t.id)) === JSON.stringify(b.tareas.map(t => t.id)),
    'dos llamadas idénticas tienen que dar el mismo plan');

  // 2 · Nunca más de tres tareas, aunque haya seis motivos para actuar.
  assert(a.tareas.length <= _planM.PLAN_MAX_TAREAS,
    `el plan no puede pasar de ${_planM.PLAN_MAX_TAREAS} tareas, trae ${a.tareas.length}`);
  assert(a.tareas.length === 3, `con todo pendiente esperaba 3 tareas, hay ${a.tareas.length}`);

  // 3 · Y nunca más de doce minutos: es un plan para un descanso, no un curso.
  //     El 12 va aquí ESCRITO. Comparar contra la propia constante era una
  //     comprobación circular: subirla a 30 pasaba en verde.
  assert(a.minutos <= 12, `el plan no puede pasar de 12 min, suma ${a.minutos}`);
  assert(_planM.PLAN_MINUTOS_MAX === 12, `la franja del plan tiene que seguir siendo 12 min, es ${_planM.PLAN_MINUTOS_MAX}`);
  assert(a.minutos >= 8, `un plan lleno tiene que llenar la franja, suma ${a.minutos}`);

  // 4 · Nunca dos veces la misma actividad. Hay un caso real en el que dos
  //     reglas distintas piden lo mismo: quien va flojo en alérgenos dispara
  //     la regla de seguridad Y la de competencia más floja, y las dos abren
  //     el simulacro. Sin el filtro, el plan mandaba hacerlo dos veces.
  const actos = a.tareas.map(t => t.actividad);
  assert(new Set(actos).size === actos.length, 'el plan repite actividad: ' + actos.join(', '));
  const doble = planDeHoy(_planBase({
    alergenosMejor: 30, srsVencidos: 0,
    competencias: Object.assign(_planBase().competencias, { alergenos: { aciertos: 2, total: 20 } })
  }));
  const dobleActos = doble.tareas.map(t => t.actividad);
  assert(new Set(dobleActos).size === dobleActos.length,
    'flojo en alérgenos dispara dos reglas, pero el simulacro sólo puede salir una vez: ' + dobleActos.join(', '));
  assert(doble.tareas.some(t => t.id === 'seguridad_alergenos'), 'y la que gana es la de seguridad');

  // 5 · Cada tarea sabe decir qué es, por qué está y cuánto dura, en los dos
  //     idiomas. Una tarea sin motivo es una orden, no una recomendación.
  for (const t of a.tareas) {
    assert(t.es && t.en, `la tarea ${t.id} no tiene nombre en los dos idiomas`);
    assert(t.motivo_es && t.motivo_en, `la tarea ${t.id} no explica por qué está ahí`);
    assert(t.minutos > 0, `la tarea ${t.id} no dice cuánto dura`);
    assert(typeof t.hecha === 'boolean', `la tarea ${t.id} no dice si está hecha`);
  }
});

test('Plan de hoy: la seguridad va primero, y sólo cuando hay motivo', () => {
  const { planDeHoy } = _planM;

  // 6 · Por debajo del 90% en alérgenos, el simulacro es la tarea número uno.
  //     Es lo único de esta aplicación que puede mandar a alguien al hospital.
  const bajo = planDeHoy(_planBase({ alergenosMejor: 62, srsVencidos: 30, platosSinVer: 40 }));
  assert(bajo.tareas[0].id === 'seguridad_alergenos',
    'con la marca de alérgenos por debajo del 90%, la seguridad va primera, no ' + bajo.tareas[0].id);
  assert(/62%/.test(bajo.tareas[0].motivo_es), 'el motivo tiene que decir la cifra: ' + bajo.tareas[0].motivo_es);

  // 7 · Con la marca alta pero fallos esta semana, también salta.
  const fallos = planDeHoy(_planBase({ alergenosMejor: 100, alergenosFallosRecientes: 3 }));
  assert(fallos.tareas[0].id === 'seguridad_alergenos', 'los fallos recientes de alérgenos también disparan la seguridad');
  assert(/3 fallos/.test(fallos.tareas[0].motivo_es), 'el motivo tiene que decir cuántos: ' + fallos.tareas[0].motivo_es);

  // 8 · Y con todo en regla, NO aparece. Una alarma que suena siempre no es
  //     una alarma.
  const limpio = planDeHoy(_planBase({ srsVencidos: 5 }));
  assert(!limpio.tareas.some(t => t.id === 'seguridad_alergenos'),
    'sin motivo de seguridad no puede colarse el simulacro');
  assert(limpio.tareas[0].id === 'repaso_srs', 'sin seguridad, manda lo vencido');
});

test('Plan de hoy: cada prioridad entra por su motivo y desaparece al cumplirse', () => {
  const { planDeHoy } = _planM;

  // 9 · Repaso vencido: entra con el número exacto y se va cuando llega a cero.
  const venc = planDeHoy(_planBase({ srsVencidos: 12 }));
  const r = venc.tareas.find(t => t.id === 'repaso_srs');
  assert(r && /12 fichas vencidas/.test(r.motivo_es), 'el repaso tiene que decir cuántas fichas: ' + (r && r.motivo_es));
  assert(!planDeHoy(_planBase({ srsVencidos: 0 })).tareas.some(t => t.id === 'repaso_srs'),
    'sin fichas vencidas no puede pedirse repaso');

  // 10 · Contenido sin ver, con el plato concreto ya elegido: el toque tiene
  //      que abrir un plato, no un índice donde haya que buscarlo.
  const nuevo = planDeHoy(_planBase({ platosSinVer: 7, platoSugerido: 31 }));
  const c = nuevo.tareas.find(t => t.id === 'carta_sin_ver');
  assert(c && c.ref === 31, 'la tarea de carta tiene que llevar el plato concreto');
  assert(/7 platos/.test(c.motivo_es), 'y decir cuántos quedan: ' + c.motivo_es);

  // 11 · Sin platos nuevos pero con platos a medias, cambia el motivo, no la
  //      tarea: el recorrido sirve para las dos cosas.
  const medias = planDeHoy(_planBase({ platosSinVer: 0, platosSinDominar: 4, platoSugerido: 8 }));
  const m = medias.tareas.find(t => t.id === 'carta_sin_ver');
  assert(m && /sin dominar/.test(m.motivo_es), 'con platos a medias el motivo tiene que ser otro: ' + (m && m.motivo_es));

  // 12 · La competencia más floja, con su nota. Y se mide entre las SEIS del
  //      vocabulario de la fase 1, no entre los juegos.
  const flojo = planDeHoy(_planBase({
    competencias: Object.assign(_planBase().competencias, { vinos: { aciertos: 5, total: 20 } })
  }));
  const v = flojo.tareas.find(t => t.competencia === 'vinos');
  assert(v && v.id === 'comp_vinos', 'la competencia más floja tiene que entrar en el plan');
  assert(/25%/.test(v.motivo_es), 'con su nota: ' + (v && v.motivo_es));

  // 13 · Por encima del 90% en todo no hay debilidad que perseguir.
  const bueno = planDeHoy(_planBase());
  assert(!bueno.tareas.some(t => /^comp_/.test(t.id)),
    'quien acierta más del 90% en todo no tiene competencia floja: ' + bueno.tareas.map(t => t.id).join(','));

  // 14 · La racha va la última y sólo si hoy no se ha estudiado: cualquier
  //      tarea de arriba ya la protege.
  const racha = planDeHoy(_planBase({ racha: 9, estudiadoHoy: false, retoHecho: false }));
  const rr = racha.tareas.find(t => t.id === 'racha_reto');
  assert(rr && /9 días seguidos/.test(rr.motivo_es), 'la racha tiene que decir cuántos días: ' + (rr && rr.motivo_es));
  assert(!planDeHoy(_planBase({ racha: 9, estudiadoHoy: true, retoHecho: false })).tareas.some(t => t.id === 'racha_reto'),
    'quien ya ha estudiado hoy no necesita que le recuerden la racha');
  assert(!planDeHoy(_planBase({ racha: 0, estudiadoHoy: false, retoHecho: false })).tareas.some(t => t.id === 'racha_reto'),
    'sin racha que proteger, no hay nada que proteger');
});

test('Plan de hoy: sólo propone lo que este restaurante puede entrenar hoy', () => {
  const { planDeHoy, PLAN_CATALOGO } = _planM;

  // 15 · Un restaurante sin procedimientos de sala y sin bodega propia no
  //      puede recibir un examen de sala ni un quiz de vinos, por flojo que
  //      esté en ellos: son pantallas que allí no existen.
  const sin = planDeHoy(_planBase({
    disponibles: { alergenos: true, carta: true, protocolo: true, sala: false, vinos: false, servicio: false },
    competencias: Object.assign(_planBase().competencias, {
      sala: { aciertos: 0, total: 20 }, vinos: { aciertos: 0, total: 20 }, protocolo: { aciertos: 10, total: 20 }
    })
  }));
  assert(!sin.tareas.some(t => t.competencia === 'sala' || t.competencia === 'vinos'),
    'no se puede mandar a nadie a una pantalla que su restaurante no tiene: ' + sin.tareas.map(t => t.id).join(','));
  assert(sin.tareas.some(t => t.id === 'comp_protocolo'),
    'y sí a la más floja de las que sí existen');

  // 16 · `servicio` es la sexta competencia y no tiene actividad viva: su
  //      único tema, `cutlery`, está retirado. No puede proponerse nunca.
  assert(!PLAN_CATALOGO.comp_servicio,
    'no puede haber tarea de servicio mientras no exista una actividad que lo entrene');
  const serv = planDeHoy(_planBase({
    disponibles: { alergenos: true, carta: true, protocolo: true, sala: true, vinos: true, servicio: true },
    competencias: Object.assign(_planBase().competencias, { servicio: { aciertos: 0, total: 40 } })
  }));
  assert(!serv.tareas.some(t => t.competencia === 'servicio'),
    'aunque alguien marque servicio como disponible, no hay a dónde mandarlo');

  // 17 · Los juegos no son formación y no entran en un plan de formación.
  const ids = Object.keys(PLAN_CATALOGO);
  for (const j of ['survivors', 'mr_shoesmith', 'duelo'])
    assert(!ids.some(k => PLAN_CATALOGO[k].actividad === j), `el juego «${j}» no puede ser una tarea del plan`);
});

test('Plan de hoy: abrir una actividad no es completarla', () => {
  const { planDeHoy } = _planM;

  // 18 · Lo completado son los hechos de la fase 1, nada más. Un plan con
  //      todo pendiente no tiene ni una tarea hecha, por mucho que se navegue.
  const d = _planBase({ alergenosMejor: 40, srsVencidos: 12, platosSinVer: 9 });
  const p = planDeHoy(d);
  assert(p.completadas === 0, 'sin actividades registradas no hay nada hecho');
  assert(p.tareas.every(t => t.hecha === false), 'ninguna tarea puede darse por hecha sola');

  // 19 · Y se marca por ACTIVIDAD registrada, la misma que escribe la fase 1.
  const hecho = planDeHoy(Object.assign({}, d, { hechas: ['simulacro_alergenos'] }));
  assert(hecho.completadas === 1, 'la actividad registrada tiene que marcar su tarea');
  assert(hecho.tareas.find(t => t.actividad === 'simulacro_alergenos').hecha === true,
    'y tiene que ser la suya, no otra');
  assert(hecho.tareas.filter(t => t.hecha).length === 1, 'y sólo la suya');

  // 20 · Una actividad ajena al plan no marca nada.
  const ajeno = planDeHoy(Object.assign({}, d, { hechas: ['mr_shoesmith', 'survivors'] }));
  assert(ajeno.completadas === 0, 'jugar una partida no completa una tarea de formación');
});

test('Plan de hoy: el plan no cambia a mitad de día', () => {
  const { planDeHoy } = _planM;

  // 21 · Terminar el repaso deja de haber fichas vencidas —justo por haberlo
  //      hecho—, y sin fijar el plan la tarea desaparecería y las otras se
  //      recolocarían. El plan se fija y se mantiene: lo hecho se queda a la
  //      vista, tachado, en su sitio.
  const antes = planDeHoy(_planBase({ alergenosMejor: 40, srsVencidos: 12, platosSinVer: 9 }));
  const fijadas = antes.tareas.map(t => t.id);
  const despues = planDeHoy(_planBase({
    alergenosMejor: 40, srsVencidos: 0, platosSinVer: 9,
    hechas: ['repaso'], fijadas, fijadasRef: {}
  }));
  assert(JSON.stringify(despues.tareas.map(t => t.id)) === JSON.stringify(fijadas),
    'el plan fijado no puede recolocarse al completar una tarea: ' + despues.tareas.map(t => t.id).join(','));
  assert(despues.tareas.find(t => t.id === 'repaso_srs').hecha === true,
    'la tarea completada se queda, marcada como hecha');

  // 22 · Y un plan fijado nunca crece por encima del máximo.
  const forzado = planDeHoy(_planBase({ fijadas: ['seguridad_alergenos', 'repaso_srs', 'carta_sin_ver', 'comp_vinos'] }));
  assert(forzado.tareas.length === _planM.PLAN_MAX_TAREAS,
    'ni fijando más de la cuenta puede el plan pasar del máximo');
});

test('Plan de hoy: lo que mande el supervisor irá por delante del motor', () => {
  const { planDeHoy } = _planM;

  // 23 · Hoy no hay fuente de asignaciones —son de la fase 4 y no existe ni
  //      tabla ni pantalla—, así que la lista llega vacía y el plan lo decide
  //      el motor. Esta prueba fija el ORDEN para cuando exista: lo que manda
  //      una persona entra por delante incluso de la seguridad.
  const sin = planDeHoy(_planBase({ alergenosMejor: 40 }));
  assert(sin.tareas[0].id === 'seguridad_alergenos', 'sin asignaciones manda el motor');

  const con = planDeHoy(_planBase({
    alergenosMejor: 40,
    asignaciones: [{ tarea: 'comp_protocolo', motivo_es: 'Te lo ha pedido Marta', motivo_en: 'Marta asked for it' }]
  }));
  assert(con.tareas[0].id === 'comp_protocolo', 'lo asignado va primero, delante del motor');
  assert(con.tareas[0].motivo_es === 'Te lo ha pedido Marta', 'y con el motivo que dé quien lo asigna');
  assert(con.tareas[1].id === 'seguridad_alergenos', 'y la seguridad justo detrás, no fuera');
});

test('Plan de hoy: nunca tres tareas de la misma competencia', () => {
  const { planDeHoy } = _planM;

  // 24 · Tres cosas de carta seguidas es una tarde de carta, no un plan. Se
  //      deja sitio a algo distinto salvo que lo justifique la seguridad.
  const p = planDeHoy(_planBase({
    srsVencidos: 20, platosSinVer: 30, racha: 4, estudiadoHoy: false, retoHecho: false,
    competencias: Object.assign(_planBase().competencias, { carta: { aciertos: 2, total: 20 } })
  }));
  const cuenta = {};
  p.tareas.forEach(t => { cuenta[t.competencia] = (cuenta[t.competencia] || 0) + 1; });
  for (const c of Object.keys(cuenta))
    assert(cuenta[c] <= 2, `hay ${cuenta[c]} tareas de «${c}» en el mismo plan`);
});

test('Plan de hoy: la semilla es estable y reparte', () => {
  // 25 · El plato que toca estudiar sale de fecha + nombre: el mismo empleado
  //      ve el mismo todo el día, y dos compañeros no reciben el mismo.
  const s = _planM._planSemilla;
  assert(s('2026-09-12', 'Ana') === s('2026-09-12', 'Ana'), 'la semilla tiene que ser estable');
  assert(s('2026-09-12', 'Ana') !== s('2026-09-12', 'Luis'), 'dos personas, dos semillas');
  assert(s('2026-09-12', 'Ana') !== s('2026-09-13', 'Ana'), 'dos días, dos semillas');
  const nombres = ['Ana', 'Luis', 'Marta', 'Iker', 'Nerea', 'Jon', 'Ane', 'Unai'];
  const bolsa = new Set(nombres.map(n => s('2026-09-12', n) % 30));
  assert(bolsa.size >= 6, `la semilla reparte mal: 8 personas caen en ${bolsa.size} platos`);
});

test('Plan de hoy: cada tarea del catálogo sabe a dónde va, y se pinta', () => {
  // 26 · Una tarea sin acción es un toque sin efecto — el peor fallo posible
  //      en una pantalla cuyo único propósito es que se toque.
  const i0 = html.indexOf('const PLAN_ACCIONES = {');
  const i1 = html.indexOf('function _planIr(');
  assert(i0 !== -1 && i1 > i0, 'no encuentro las acciones del plan');
  const acciones = html.slice(i0, i1);
  for (const id of Object.keys(_planM.PLAN_CATALOGO))
    assert(new RegExp('\\b' + id + ':\\s*function').test(acciones), `la tarea «${id}» no tiene a dónde ir`);

  // 27 · Y la tarjeta se EJECUTA, no se lee: con tres tareas y una hecha,
  //      tiene que salir su nombre, su motivo, su duración y el progreso.
  const j0 = html.indexOf('function _hoyPlanHTML(');
  const j1 = html.indexOf('function renderDashboard(');
  assert(j0 !== -1 && j1 > j0, 'no encuentro la tarjeta del plan');
  const plan = {
    tareas: [
      { id: 'seguridad_alergenos', actividad: 'simulacro_alergenos', competencia: 'alergenos', minutos: 5,
        es: 'Simulacro de alérgenos', en: 'Allergen drill', motivo_es: 'Tu mejor marca es 62%', motivo_en: 'Your best is 62%', hecha: true, ref: null },
      { id: 'repaso_srs', actividad: 'repaso', competencia: 'carta', minutos: 4,
        es: 'Repaso inteligente', en: 'Smart review', motivo_es: '12 fichas vencidas', motivo_en: '12 cards overdue', hecha: false, ref: null },
      { id: 'carta_sin_ver', actividad: 'recorrido', competencia: 'carta', minutos: 4,
        es: 'Recorrido guiado', en: 'Guided journey', motivo_es: '7 platos sin estudiar', motivo_en: '7 dishes unstudied', hecha: false, ref: 31 }
    ], minutos: 13, completadas: 1
  };
  const monta = (p, esAdmin) => new Function('planDeHoyDe', 'escapeHTML', '_esAdmin', // eslint-disable-line no-new-func
    html.slice(j0, j1) + '; return _hoyPlanHTML;')(() => p, s => String(s), () => !!esAdmin);
  const F = monta(plan, false);
  const out = F({ name: 'Ana' }, false);
  assert(/Simulacro de alérgenos/.test(out), 'la tarjeta no pinta el nombre de la tarea');
  // El motivo, VISIBLE. Buscarlo por texto a secas no bastaba: también va en
  // la etiqueta de accesibilidad, así que borrar la línea de la tarjeta pasaba
  // en verde. Se cuentan los huecos de motivo, uno por tarea.
  assert((out.match(/class="plan-tarea-m">/g) || []).length === 3,
    'cada tarea tiene que decir a la vista por qué está ahí');
  assert(/class="plan-tarea-m">12 fichas vencidas</.test(out), 'y el motivo tiene que ser el suyo');
  assert(/4 min/.test(out) && /5 min/.test(out), 'la tarjeta no pinta la duración');
  assert(/plan-tarea hecha/.test(out), 'la tarjeta no marca lo que ya está hecho');
  assert((out.match(/_planIr\(/g) || []).length === 3, 'las tres tareas tienen que ser tocables');
  assert(/_planIr\('carta_sin_ver',31\)/.test(out), 'la tarea de carta tiene que llevar su plato');
  assert(/<b>1<\/b><span>\/3<\/span>/.test(out), 'la tarjeta no pinta el progreso de hoy');
  assert(/2 tareas · unos 8 min/.test(out), 'la tarjeta no pinta lo que queda: ' + (out.match(/plan-hoy-resumen">[^<]*/) || [''])[0]);

  // 28 · Y en inglés, lo mismo — el equipo lo usa en los dos idiomas.
  const outEn = F({ name: 'Ana' }, true);
  assert(/Allergen drill/.test(outEn) && /12 cards overdue/.test(outEn), 'la tarjeta no está traducida');

  // 29 · Sin tareas, la tarjeta no desaparece: dice que está todo al día.
  const vacio = monta({ tareas: [], minutos: 0, completadas: 0 }, false)({ name: 'Ana' }, false);
  assert(/plan-hoy-vacio/.test(vacio) && /Todo al día/.test(vacio), 'sin tareas hay que decirlo, no dejar un hueco');

  // 30 · La cuenta de administración no tiene plan: no deja rastro al
  //      registrar, así que sus tareas no se marcarían nunca. Un plan que no
  //      se puede terminar es peor que ninguno.
  assert(monta(plan, true)({ name: 'Administrador' }, false) === '',
    'la cuenta de administración no puede tener un plan que nunca se completa');
});

test('Plan de hoy: está en el inicio, y con estilo propio de toque cómodo', () => {
  // 30 · La tarjeta tiene que estar PINTADA en el inicio. El motor puede ser
  //      perfecto y no verse: es exactamente lo que pasó con el fallo de `dd`.
  assert((html.match(/\$\{_hoyPlanHTML\(emp,_en\)\}/g) || []).length === 1,
    'el plan tiene que pintarse en el inicio, una sola vez');
  const i = html.indexOf('${_hoyPlanHTML(emp,_en)}');
  const j = html.indexOf('${_pddHeroHTML(emp,_en)}');
  assert(i > 0 && j > i, 'el plan va lo primero de la sección Hoy');

  // 31 · Y cada fila tiene que poder tocarse con el pulgar en un móvil.
  const css = read('styles.css');
  const fila = (css.match(/\.plan-tarea\{[^}]*\}/) || [''])[0];
  const alto = +(fila.match(/min-height:(\d+)px/) || [0, 0])[1];
  assert(alto >= 44, `las filas del plan miden ${alto}px de alto; el mínimo para el pulgar son 44`);
});

// ─── 7. No leftover git conflict markers ────────────────────────
console.log('\nHygiene');
test('no git conflict markers in tracked source', () => {
  for (const f of ['index.html', 'sw.js', 'data/wines.json', 'data/lqa-situations.json', 'data/ghost-scenarios.json']) {
    const txt = read(f);
    // match at line start to avoid false positives in legitimate content
    assert(!/^<{7}\s|^={7}$|^>{7}\s/m.test(txt), `conflict marker found in ${f}`);
  }
});

// ─── summary ────────────────────────────────────────────────────
console.log(`\n${failed === 0 ? '\x1b[32m' : '\x1b[31m'}${passed} passed, ${failed} failed\x1b[0m`);
if (failed > 0) { console.log('\nFailures:\n  - ' + fails.join('\n  - ')); process.exit(1); }
