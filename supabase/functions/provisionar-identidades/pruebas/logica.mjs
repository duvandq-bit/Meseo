// Banco de pruebas del código REAL de `provisionar-identidades`.
//
// No busca cadenas en el fichero: carga el fichero del repo, le cambia sólo lo
// que Node no puede resolver (los dos imports de Deno y el registro del
// handler) y EJECUTA el handler de verdad contra un cliente de Supabase falso.
// La lógica del bucle, los estados y el cálculo de `ok` son los del fichero.
//
// Las fichas del fixture son INVENTADAS y tienen la misma forma que las reales
// (22 fichas, 1 ya vinculada, 4 sin PIN, 17 pendientes). Ningún PIN real, ningún
// nombre real y ninguna conexión: el cliente de Supabase es de mentira.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const ORIGEN  = new URL('../index.ts', import.meta.url).pathname;
const DESTINO = new URL('./.fn-bajo-prueba.ts', import.meta.url);

let src = readFileSync(ORIGEN, 'utf8');
const antes = src;
src = src.replace(/^import "jsr:@supabase\/functions-js\/edge-runtime\.d\.ts";\n/m, '');
src = src.replace(/^import \{ createClient \} from "npm:@supabase\/supabase-js@2";$/m,
                  'const createClient = globalThis.__createClient;');
if (src === antes) { console.error('FALLO: no se pudo preparar el fichero'); process.exit(1); }
writeFileSync(DESTINO, src);

// ── El entorno que el fichero espera ──────────────────────────────────────
let handler = null;
globalThis.Deno = {
  env: { get: (k) => ({ SUPABASE_URL: 'https://falso.test', SUPABASE_SERVICE_ROLE_KEY: 'clave-falsa' })[k] || '' },
  serve: (fn) => { handler = fn; }
};

// ── Las 22 fichas reales, con el PIN sustituido por un marcador ───────────
// Sólo importa si es null o no: el valor jamás se mira en el bucle.
const FICHAS = JSON.parse(readFileSync(new URL('./fichas.json', import.meta.url), 'utf8'));

// ── El cliente falso ──────────────────────────────────────────────────────
function clienteFalso(opciones = {}) {
  const registro = { createUser: [], updates: [], deleteUser: [], rpc: [] };
  const thenable = (valor) => {
    const p = { data: valor.data, error: valor.error };
    const obj = {
      select: () => obj, order: () => obj, eq: () => obj, is: () => obj, limit: () => obj,
      then: (res) => Promise.resolve(p).then(res)
    };
    return obj;
  };
  const cliente = {
    __registro: registro,
    rpc: async (nombre, args) => {
      registro.rpc.push(nombre);
      if (nombre === 'verify_supervisor_pin_srv') return { data: opciones.pinOk !== false, error: null };
      if (nombre === 'sup_pin_scope') return { data: opciones.ambito ?? '*', error: null };
      return { data: null, error: { message: 'rpc desconocida' } };
    },
    from: (tabla) => ({
      select: () => thenable({ data: FICHAS.map(f => ({ ...f })), error: null }),
      update: (valores) => {
        const ctx = { valores, filtros: {} };
        const enc = {
          eq: (c, v) => { ctx.filtros[c] = v; return enc; },
          is: (c, v) => { ctx.filtros[c] = v; return enc; },
          select: () => { registro.updates.push(ctx); return thenable(opciones.resultadoUpdate || { data: [{ auth_user_id: ctx.valores.auth_user_id }], error: null }); }
        };
        return enc;
      }
    }),
    auth: { admin: {
      createUser: async (arg) => {
        registro.createUser.push(arg.email);
        if (opciones.createUserFalla) return { data: null, error: { message: 'A user with this email address has already been registered' } };
        return { data: { user: { id: 'uid-falso-' + registro.createUser.length } }, error: null };
      },
      deleteUser: async (uid) => { registro.deleteUser.push(uid); return { error: null }; }
    } }
  };
  return cliente;
}

let ultimoCliente = null;
globalThis.__createClient = (...a) => (ultimoCliente = clienteFalso(globalThis.__opciones || {}));

await import(pathToFileURL(DESTINO.pathname).href);
if (typeof handler !== 'function') { console.error('FALLO: el fichero no registró un handler'); process.exit(1); }

const pedir = async (cuerpo, opciones = {}) => {
  globalThis.__opciones = opciones;
  const r = await handler(new Request('https://falso.test/provisionar-identidades', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '203.0.113.7' },
    body: JSON.stringify(cuerpo)
  }));
  return { status: r.status, cuerpo: await r.json(), cliente: ultimoCliente };
};

// ── Las comprobaciones ────────────────────────────────────────────────────
let fallos = 0;
const comprobar = (nombre, condicion, detalle = '') => {
  console.log((condicion ? '  OK   ' : '  FALLA') + '  ' + nombre + (condicion ? '' : '  → ' + detalle));
  if (!condicion) fallos++;
};

console.log('\n1 · SIMULACRO (ejecutar ausente) sobre las 22 fichas reales');
const a = await pedir({ pin: 'pin-de-mentira' });
const rA = a.cuerpo.resumen;
console.log('   resumen →', JSON.stringify(rA));
comprobar('HTTP 200', a.status === 200, String(a.status));
comprobar('ok: true', a.cuerpo.ok === true, String(a.cuerpo.ok));
comprobar('fichas_revisadas = 22', rA.fichas_revisadas === 22, String(rA.fichas_revisadas));
comprobar('already_linked = 1', rA.already_linked === 1, String(rA.already_linked));
comprobar('simulado_crearia = 17', rA.simulado_crearia === 17, String(rA.simulado_crearia));
comprobar('no_pin = 4', rA.no_pin === 4, String(rA.no_pin));
comprobar('created_linked = 0', rA.created_linked === 0, String(rA.created_linked));
comprobar('race_lost = 0', rA.race_lost === 0, String(rA.race_lost));
comprobar('pending_error = 0', rA.pending_error === 0, String(rA.pending_error));

console.log('\n2 · Los 4 sin PIN, uno a uno');
const SIN_PIN = FICHAS.filter(f => f.pin === null).map(f => f.name);
for (const n of SIN_PIN) {
  const fila = a.cuerpo.empleados.find(e => e.employee === n);
  comprobar(`${n} → no_pin`, fila?.resultado === 'no_pin', fila?.resultado);
  comprobar(`${n} sin auth_user_id`, fila?.auth_user_id === null, String(fila?.auth_user_id));
}
comprobar('ninguno de los 4 aparece como simulado_crearia',
  a.cuerpo.empleados.filter(e => SIN_PIN.includes(e.employee) && e.resultado === 'simulado_crearia').length === 0);

console.log('\n3 · no_pin no crea ni escribe NADA (simulacro)');
comprobar('0 llamadas a createUser', a.cliente.__registro.createUser.length === 0, String(a.cliente.__registro.createUser.length));
comprobar('0 UPDATE sobre employees', a.cliente.__registro.updates.length === 0, String(a.cliente.__registro.updates.length));
comprobar('0 llamadas a deleteUser', a.cliente.__registro.deleteUser.length === 0, String(a.cliente.__registro.deleteUser.length));

console.log('\n4 · La ficha ya vinculada sigue siendo already_linked');
const duvan = a.cuerpo.empleados.find(e => e.employee === 'Jefa');
comprobar('la ficha vinculada → already_linked', duvan?.resultado === 'already_linked', duvan?.resultado);
comprobar('conserva su uid intacto', duvan?.auth_user_id === '00000000-0000-4000-8000-000000000001', String(duvan?.auth_user_id));

console.log('\n5 · Segunda pasada en simulacro: idéntica');
const b = await pedir({ pin: 'pin-de-mentira', ejecutar: false });
comprobar('mismo resumen', JSON.stringify(b.cuerpo.resumen) === JSON.stringify(rA), JSON.stringify(b.cuerpo.resumen));
comprobar('mismas filas', JSON.stringify(b.cuerpo.empleados) === JSON.stringify(a.cuerpo.empleados));

console.log('\n6 · pending_error ⇒ ok:false (ejecución real CONTRA EL CLIENTE FALSO)');
const c = await pedir({ pin: 'pin-de-mentira', ejecutar: true }, { createUserFalla: true });
const rC = c.cuerpo.resumen;
console.log('   resumen →', JSON.stringify(rC));
comprobar('ok: false', c.cuerpo.ok === false, String(c.cuerpo.ok));
comprobar('HTTP sigue siendo 200', c.status === 200, String(c.status));
comprobar('pending_error = 17', rC.pending_error === 17, String(rC.pending_error));
comprobar('created_linked = 0', rC.created_linked === 0, String(rC.created_linked));
comprobar('no_pin = 4 también en ejecución real', rC.no_pin === 4, String(rC.no_pin));
comprobar('already_linked = 1', rC.already_linked === 1, String(rC.already_linked));
comprobar('createUser se llamó 17 veces, nunca para los 4 sin PIN',
  c.cliente.__registro.createUser.length === 17, String(c.cliente.__registro.createUser.length));
// Comparación EXACTA, no por subcadena: `mariano@…` contiene «maria» y daría
// un falso positivo. Los correos de los 4 sin PIN se calculan igual que en la
// función y se comprueba que ninguno está en la lista de createUser.
const slug = (n) => n.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu,'')
                      .replace(/[^a-z0-9]+/g,'.').replace(/^\.|\.$/g,'');
const CORREOS_SIN_PIN = SIN_PIN.map(n => `${slug(n)}@txoko.meseo.invalid`);
comprobar('ningún correo de los 4 sin PIN llegó a createUser (' + CORREOS_SIN_PIN.join(' ') + ')',
  !c.cliente.__registro.createUser.some(m => CORREOS_SIN_PIN.includes(m)),
  c.cliente.__registro.createUser.join(','));
comprobar('mario SÍ llegó (no se confunde con maría, que no tiene PIN)',
  c.cliente.__registro.createUser.includes('mario@txoko.meseo.invalid'));
comprobar('0 deleteUser (no se borra a ciegas)', c.cliente.__registro.deleteUser.length === 0);

console.log('\n7 · Ejecución real que SÍ funciona: ok:true y 17 creadas');
const d = await pedir({ pin: 'pin-de-mentira', ejecutar: true }, {});
const rD = d.cuerpo.resumen;
console.log('   resumen →', JSON.stringify(rD));
comprobar('ok: true', d.cuerpo.ok === true, String(d.cuerpo.ok));
comprobar('created_linked = 17', rD.created_linked === 17, String(rD.created_linked));
comprobar('no_pin = 4', rD.no_pin === 4, String(rD.no_pin));
comprobar('pending_error = 0', rD.pending_error === 0, String(rD.pending_error));
comprobar('17 createUser exactos', d.cliente.__registro.createUser.length === 17, String(d.cliente.__registro.createUser.length));
comprobar('17 UPDATE exactos', d.cliente.__registro.updates.length === 17, String(d.cliente.__registro.updates.length));
comprobar('cada UPDATE exige auth_user_id null', d.cliente.__registro.updates.every(u => u.filtros.auth_user_id === null));

console.log('\n8 · MUTACIÓN: si se quita la rama no_pin, la prueba 2 debe caer');
{
  const mutado = readFileSync(DESTINO, 'utf8').replace("if (e.pin === null) {", "if (false) {");
  if (mutado === readFileSync(DESTINO, 'utf8')) { comprobar('la mutación se aplicó', false, 'no se encontró la rama'); }
  else {
    writeFileSync(new URL('./.fn-mutado.ts', import.meta.url), mutado);
    let hMut = null;
    globalThis.Deno.serve = (fn) => { hMut = fn; };
    await import(pathToFileURL(new URL('./.fn-mutado.ts', import.meta.url).pathname).href);
    globalThis.__opciones = {};
    const r = await hMut(new Request('https://falso.test/x', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: 'x' }) }));
    const j = await r.json();
    comprobar('sin la rama, no_pin cae a 0', j.resumen.no_pin === 0, String(j.resumen.no_pin));
    comprobar('sin la rama, simulado_crearia sube a 21', j.resumen.simulado_crearia === 21, String(j.resumen.simulado_crearia));
  }
}

console.log('\n9 · MUTACIÓN: si `ok` vuelve a ser fijo, la prueba 6 debe caer');
{
  const mutado = readFileSync(DESTINO, 'utf8').replace("ok: conError === 0,", "ok: true,");
  writeFileSync(new URL('./.fn-mutado2.ts', import.meta.url), mutado);
  let hMut = null;
  globalThis.Deno.serve = (fn) => { hMut = fn; };
  await import(pathToFileURL(new URL('./.fn-mutado2.ts', import.meta.url).pathname).href);
  globalThis.__opciones = { createUserFalla: true };
  const r = await hMut(new Request('https://falso.test/x', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: 'x', ejecutar: true }) }));
  const j = await r.json();
  comprobar('con `ok` fijo, un fallo parcial se disfraza de éxito', j.ok === true && j.resumen.pending_error > 0,
    JSON.stringify({ ok: j.ok, pending_error: j.resumen.pending_error }));
}

console.log('\n10 · El contrato pobre sigue en pie');
const e1 = await pedir({ pin: 'x', employee: 'Jefa' });
comprobar('campo extra → 400 campos_no_permitidos', e1.status === 400 && e1.cuerpo.error === 'campos_no_permitidos', JSON.stringify(e1.cuerpo));
const e2 = await pedir({ ejecutar: false });
comprobar('sin pin → 400 sin_pin', e2.status === 400 && e2.cuerpo.error === 'sin_pin', JSON.stringify(e2.cuerpo));
const e3 = await pedir({ pin: 'x', ejecutar: 'true' });
comprobar('ejecutar no booleano → 400', e3.status === 400 && e3.cuerpo.error === 'ejecutar_no_booleano', JSON.stringify(e3.cuerpo));
const e4 = await pedir({ pin: 'x' }, { pinOk: false });
comprobar('PIN incorrecto → 401 denegado', e4.status === 401 && e4.cuerpo.error === 'denegado', JSON.stringify(e4.cuerpo));
comprobar('PIN incorrecto: no se consultó el ámbito', !e4.cliente.__registro.rpc.includes('sup_pin_scope'), e4.cliente.__registro.rpc.join(','));

console.log('\n' + (fallos === 0 ? 'TODO EN VERDE' : fallos + ' COMPROBACIONES FALLIDAS'));
process.exit(fallos === 0 ? 0 : 1);
