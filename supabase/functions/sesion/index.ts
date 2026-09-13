// Meseo — sesion (canje de PIN por sesión real, fase 2.5B-1, sep 2026)
//
// QUÉ HACE
//   Recibe { nombre, sha } —el mismo hash que ya calcula el login de siempre—
//   y, si el PIN es correcto, devuelve una SESIÓN REAL de Supabase. A partir de
//   ahí la base de datos sabe quién pide cada cosa: `auth.uid()` deja de ser
//   nulo y las políticas pueden dejar de fiarse del cliente.
//
// QUÉ NO HACE, Y ES DELIBERADO
//   • No guarda ninguna contraseña por empleado. Ni una.
//   • No decide nada a partir del cliente: el restaurante y el rol salen de
//     `employees`, que la clave pública no puede escribir.
//   • No escribe NADA en `user_metadata` ni en `app_metadata`. Se crean vacíos
//     a propósito: en julio de 2026 alguien se registró en este proyecto
//     plantando {"role":"admin","is_admin":true} en user_metadata, esperando a
//     una aplicación que leyera el rol del token. Aquí no se lee jamás.
//   • No devuelve el PIN, ni el enlace, ni el token de un solo uso.
//
// POR QUÉ ESTE CAMINO
//   `admin.generateLink()` genera el enlace «without sending it» (doc oficial)
//   y devuelve `properties.hashed_token`; `verifyOtp({token_hash})` lo canjea
//   por la sesión completa, y la propia documentación describe justo este uso
//   desde servidor: «the session will be returned in the response body, which
//   can be read by the server». El token es de un solo uso, corta duración y
//   lo emite el servidor para un correo que sólo el servidor conoce.
//
// EL LIMITADOR DE SIEMPRE SIGUE MANDANDO
//   La verificación pasa por `verify_employee_pin_sha`, que lleva su limitador
//   por nombre (10 fallos en 15 minutos y bloquea). No se duplica ni se rodea:
//   si esa función dice que no, aquí no se emite nada.
//
// ESTADO: aislada. El cliente NO la llama todavía. El login de la aplicación
// sigue exactamente como estaba.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPA_URL     = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY') || '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey'
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

// El correo es sintético y `.invalid` es un dominio RESERVADO que no existe ni
// puede existir (RFC 2606): así nunca se le puede mandar un correo a nadie por
// accidente. El empleado no lo ve, no lo teclea y no lo necesita.
const correoDe = (nombre: string, venue: string) =>
  `${nombre.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
           .replace(/[^a-z0-9]+/g,'.').replace(/^\.|\.$/g,'')}@${venue}.meseo.invalid`;

// Lo justo para saber que la sesión es de quien debe ser, sin sacar el token.
//
// Sobre `user_metadata`: NO se puede exigir que esté vacío. GoTrue mete lo suyo
// —`email_verified` y compañía— pase lo que pase, así que «vacío» daba falso
// siempre y no significaba nada. Lo que de verdad importa es que no lleve
// ninguna reclamación de AUTORIDAD, que es el campo que el que se registra
// controla y por donde entró la sonda de julio de 2026.
const RECLAMACIONES_DE_AUTORIDAD =
  ['role','is_admin','isAdmin','admin','venue','employee','permissions','claims','scope'];

function miradaAlToken(jwt: string){
  try{
    const p = JSON.parse(atob(jwt.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
    const um = p.user_metadata || {};
    return { sub: p.sub, role: p.role, exp: p.exp,
             user_metadata: Object.keys(um),   // a la vista, para poder juzgarlo
             sin_reclamaciones_de_autoridad:
               !RECLAMACIONES_DE_AUTORIDAD.some(k => Object.prototype.hasOwnProperty.call(um, k)) };
  }catch(_){ return null; }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST')    return json({ error: 'metodo' }, 405);
  if (!SUPA_URL || !SERVICE_KEY || !ANON_KEY) return json({ error: 'config' }, 500);

  const t0 = Date.now();
  let body: any = {};
  try { body = await req.json(); } catch(_) { return json({ error: 'json' }, 400); }

  const nombre = String(body.nombre || '').trim();
  const sha    = String(body.sha || '').trim().toLowerCase();

  // La forma, antes de gastar una llamada. El hash es SHA-256 en hexadecimal.
  if (!/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 ._-]{3,30}$/.test(nombre)) return json({ error: 'nombre' }, 400);
  if (!/^[0-9a-f]{64}$/.test(sha))                            return json({ error: 'sha' }, 400);

  const admin    = createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const publico  = createClient(SUPA_URL, ANON_KEY,    { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    // ── 1 · El PIN. Con el limitador de siempre, sin rodearlo ────────────
    const { data: pinOk, error: ePin } = await admin.rpc('verify_employee_pin_sha',
      { emp_name: nombre, sha_hex: sha });
    if (ePin) return json({ error: 'verificacion', detalle: ePin.message }, 502);
    if (pinOk === null)  return json({ error: 'sin_pin' }, 409);   // aún no migrado
    if (pinOk !== true)  return json({ error: 'pin' }, 401);        // o bloqueado por el limitador

    // ── 2 · Quién es, de dónde y con qué rol. DEL SERVIDOR ───────────────
    const { data: filas, error: eEmp } = await admin
      .from('employees').select('name,venue,role,auth_user_id').eq('name', nombre).limit(1);
    if (eEmp)               return json({ error: 'ficha', detalle: eEmp.message }, 502);
    if (!filas || !filas.length) return json({ error: 'sin_ficha' }, 404);
    const emp = filas[0];

    // ── 3 · Su identidad de Auth. Se crea la primera vez, y vacía ────────
    let uid = emp.auth_user_id as string | null;
    let cuenta = 'existente';
    const correo = correoDe(emp.name, emp.venue);
    if (!uid) {
      const { data: creado, error: eNuevo } = await admin.auth.admin.createUser({
        email: correo,
        email_confirm: true,      // la crea el servidor: no hay correo que confirmar
        user_metadata: {},        // VACÍOS. El rol vive en employees.role y sólo ahí.
        app_metadata: {}
      });
      if (eNuevo || !creado?.user) return json({ error: 'alta', detalle: eNuevo?.message }, 502);
      uid = creado.user.id;
      const { error: eLink } = await admin.from('employees')
        .update({ auth_user_id: uid }).eq('name', emp.name);
      if (eLink) return json({ error: 'vinculo', detalle: eLink.message }, 502);
      cuenta = 'creada';
    }

    // ── 4 · Un token de un solo uso, emitido por el servidor ─────────────
    const { data: enlace, error: eGen } = await admin.auth.admin.generateLink({
      type: 'magiclink', email: correo
    });
    if (eGen) return json({ error: 'enlace', detalle: eGen.message }, 502);
    const hashed = (enlace as any)?.properties?.hashed_token;
    if (!hashed) return json({ error: 'sin_token' }, 502);

    // ── 5 · Y se canjea por la sesión. Se prueban los dos tipos que la
    //        documentación menciona, y se informa de cuál funcionó: es la
    //        única forma honesta de saberlo sin suponerlo.
    let sesion: any = null, via = '', ultimoFallo = '';
    for (const tipo of ['email', 'magiclink'] as const) {
      const { data, error } = await publico.auth.verifyOtp({ token_hash: hashed, type: tipo as any });
      if (!error && data?.session) { sesion = data.session; via = tipo; break; }
      ultimoFallo = error?.message || 'sin sesión';
    }
    if (!sesion) return json({ error: 'canje', detalle: ultimoFallo }, 502);

    // ── 6 · La respuesta. NO lleva el token entero a propósito: basta para
    //        comprobar que la sesión es real y de quien debe ser.
    const mirada = miradaAlToken(sesion.access_token);
    return json({
      ok: true,
      empleado: emp.name,
      venue: emp.venue,
      role: emp.role,
      cuenta,
      via,
      sesion: {
        creada: true,
        uid,
        coincide_con_la_ficha: mirada?.sub === uid,
        rol_del_token: mirada?.role,
        sin_reclamaciones_de_autoridad: mirada?.sin_reclamaciones_de_autoridad,
        user_metadata: mirada?.user_metadata,
        expira_en_segundos: sesion.expires_in,
        access_token_empieza_por: String(sesion.access_token).slice(0, 12) + '…',
        hay_refresh_token: !!sesion.refresh_token
      },
      ms: Date.now() - t0
    });
  } catch (e) {
    return json({ error: 'inesperado', detalle: String((e as Error)?.message || e).slice(0, 200) }, 500);
  }
});
