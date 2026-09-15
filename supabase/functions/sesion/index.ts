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
//   • No devuelve el PIN, ni el enlace de acceso, ni el token de un solo uso
//     con el que se canjeó la sesión.
//
// LO QUE SÍ DEVUELVE, DESDE LA FASE 2.5C
//   El `access_token` y el `refresh_token` de la sesión. Hasta ahora sólo
//   devolvía un resumen para poder juzgarla desde fuera, y con eso el
//   navegador no podía establecer nada. Son los mismos dos tokens que
//   cualquier cliente de Supabase maneja al iniciar sesión —van al
//   almacenamiento del navegador y los renueva la propia librería—, así que
//   esto no abre una puerta nueva: pone la de siempre. Para llegar hasta aquí
//   hay que traer el hash del PIN correcto, y ese camino ya lo cuenta el
//   limitador de `verify_employee_pin_sha`.
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
// ESTADO: el login de la v7.449 la llama después de validar el PIN, sin esperar
// la respuesta y con respaldo si falla. Esa versión todavía NO está publicada,
// así que en producción nadie la llama aún. RLS sigue desactivado: la sesión que
// entrega no se usa todavía para leer ni escribir nada.
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
// Los acentos se quitan con `\p{Diacritic}` y no con un rango `\uXXXX`: así el
// fichero del repositorio y el desplegado son el mismo byte a byte —un rango
// escapado se decodifica por el camino— y no hay caracteres invisibles en el
// código. Produce exactamente los mismos correos que el rango anterior.
const correoDe = (nombre: string, venue: string) =>
  `${nombre.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu,'')
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
    //
    // LA IDENTIDAD CANÓNICA ES `auth_user_id`, NO EL NOMBRE. El correo técnico
    // se calcula UNA sola vez, al crear la cuenta; a partir de ahí se le
    // pregunta a Auth cuál es, y no se recalcula jamás. Si se recalculara, el
    // día que a alguien se le cambiara el nombre —o el correo de su cuenta— el
    // slug dejaría de casar con ninguna cuenta y esa persona no podría entrar.
    // El nombre sólo sirve para encontrar la ficha la PRIMERA vez.
    let uid = emp.auth_user_id as string | null;
    let cuenta = 'existente';
    if (!uid) {
      const { data: creado, error: eNuevo } = await admin.auth.admin.createUser({
        email: correoDe(emp.name, emp.venue),   // el único momento en que se calcula
        email_confirm: true,      // la crea el servidor: no hay correo que confirmar
        user_metadata: {},        // VACÍOS. El rol vive en employees.role y sólo ahí.
        app_metadata: {}
      });
      if (eNuevo || !creado?.user) return json({ error: 'alta', detalle: eNuevo?.message }, 502);
      uid = creado.user.id;
      // ATÓMICO. El `is(auth_user_id, null)` hace que la fila sólo se vincule
      // si SIGUE libre: dos sesiones simultáneas del mismo empleado no pueden
      // acabar las dos vinculadas. Quien pierde la carrera se queda con el
      // vínculo del que ganó y retira su cuenta huérfana, para que no quede
      // una identidad de Auth sin ficha.
      const { data: vinculadas, error: eLink } = await admin.from('employees')
        .update({ auth_user_id: uid })
        .eq('name', emp.name)
        .is('auth_user_id', null)
        .select('auth_user_id');
      if (eLink) return json({ error: 'vinculo', detalle: eLink.message }, 502);
      if (!vinculadas || vinculadas.length === 0) {
        const { data: rel } = await admin.from('employees')
          .select('auth_user_id').eq('name', emp.name).limit(1);
        const ganador = rel?.[0]?.auth_user_id as string | null;
        if (!ganador) return json({ error: 'vinculo_perdido' }, 502);
        if (ganador !== uid) { await admin.auth.admin.deleteUser(uid); uid = ganador; }
        cuenta = 'existente';
      } else {
        cuenta = 'creada';
      }
    }

    // ── 4 · El correo lo dice Auth, no se recalcula ──────────────────────
    // Es lo que hace que un renombrado no rompa el acceso de nadie ya
    // vinculado: la ficha lleva al `uid`, y el `uid` lleva al correo.
    const { data: cuentaAuth, error: eLeer } = await admin.auth.admin.getUserById(uid as string);
    if (eLeer || !cuentaAuth?.user?.email) {
      return json({ error: 'identidad', detalle: eLeer?.message || 'la cuenta no tiene correo' }, 502);
    }
    const correo = cuentaAuth.user.email;

    // ── 5 · Un token de un solo uso, emitido por el servidor ─────────────
    const { data: enlace, error: eGen } = await admin.auth.admin.generateLink({
      type: 'magiclink', email: correo
    });
    if (eGen) return json({ error: 'enlace', detalle: eGen.message }, 502);
    const hashed = (enlace as any)?.properties?.hashed_token;
    if (!hashed) return json({ error: 'sin_token' }, 502);

    // ── 6 · Y se canjea por la sesión. Se prueban los dos tipos que la
    //        documentación menciona, y se informa de cuál funcionó: es la
    //        única forma honesta de saberlo sin suponerlo.
    let sesion: any = null, via = '', ultimoFallo = '';
    for (const tipo of ['email', 'magiclink'] as const) {
      const { data, error } = await publico.auth.verifyOtp({ token_hash: hashed, type: tipo as any });
      if (!error && data?.session) { sesion = data.session; via = tipo; break; }
      ultimoFallo = error?.message || 'sin sesión';
    }
    if (!sesion) return json({ error: 'canje', detalle: ultimoFallo }, 502);

    // ── 7 · Antes de entregar nada, comprobar que la sesión es de quien debe
    //        ser. Si el `sub` del token no es el `uid` de la ficha, algo ha
    //        salido mal arriba y lo último que se puede hacer es dárselo a
    //        alguien: se tira y se devuelve error.
    const mirada = miradaAlToken(sesion.access_token);
    if (!mirada || mirada.sub !== uid) {
      return json({ error: 'identidad_no_coincide' }, 502);
    }
    // Y que no traiga reclamaciones de autoridad. Aquí nunca se leen —el rol
    // sale de `employees`— pero una sesión que las lleve no sale de esta
    // función: sería sembrar el problema de julio de 2026 para el día en que
    // alguien, en otro sitio, decida leer el token.
    if (mirada.sin_reclamaciones_de_autoridad !== true) {
      return json({ error: 'token_con_reclamaciones' }, 502);
    }

    // ── 8 · La respuesta. Lleva los dos tokens porque el navegador los
    //        necesita para establecer la sesión; no lleva el PIN, ni el
    //        enlace, ni el token de un solo uso con el que se canjeó.
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
        coincide_con_la_ficha: true,
        access_token: sesion.access_token,
        refresh_token: sesion.refresh_token,
        token_type: sesion.token_type || 'bearer',
        expires_in: sesion.expires_in,
        expires_at: sesion.expires_at,
        rol_del_token: mirada.role,
        sin_reclamaciones_de_autoridad: true,
        user_metadata: mirada.user_metadata
      },
      ms: Date.now() - t0
    });
  } catch (e) {
    return json({ error: 'inesperado', detalle: String((e as Error)?.message || e).slice(0, 200) }, 500);
  }
});
