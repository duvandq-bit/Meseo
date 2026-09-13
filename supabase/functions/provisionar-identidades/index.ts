// Meseo — provisionar-identidades (operación de UNA SOLA VEZ, sep 2026)
//
// QUÉ HACE
//   Crea la identidad de Auth de los empleados que todavía no la tienen y la
//   vincula a su ficha. Nada más. Es el paso previo a que RLS pueda distinguir
//   a una persona de otra.
//
// EL CONTRATO ES DELIBERADAMENTE POBRE
//   Sólo acepta `pin` y, opcionalmente, `ejecutar`. NO acepta a quién
//   provisionar, ni restaurante, ni rol, ni correo, ni identidad. Todo eso lo
//   saca el servidor de `employees`. Con un contrato así no se puede convertir
//   en un «crea un usuario de Auth a la carta»: no hay dónde apuntarlo.
//
// POR DEFECTO NO ESCRIBE NADA
//   Sin `ejecutar: true` hace un SIMULACRO: recorre lo mismo, informa de lo que
//   haría y no crea ni vincula nada. Es al revés de lo habitual a propósito —
//   una llamada suelta o repetida por error no puede dar de alta a nadie.
//
// LA AUTORIDAD, EN EL ORDEN CORRECTO
//   Primero `verify_supervisor_pin`, que es quien lleva el limitador por IP, y
//   sólo después `sup_pin_scope`. Al revés, lo segundo sería un oráculo para
//   adivinar PINes sin coste. Es el mismo orden que ya usa `employee_set_role`,
//   y por el mismo motivo.
//
//   El ámbito del PIN manda: el del propietario ('*') alcanza a todos los
//   restaurantes; el de un restaurante, sólo al suyo.
//
// TEMPORAL
//   En cuanto termine el provisioning, esta función se borra. No tiene sentido
//   dejar abierta para siempre una puerta que sirve para un día.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPA_URL    = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey'
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

// El correo técnico. `.invalid` es un dominio RESERVADO (RFC 2606) que no
// existe ni puede existir: nunca se le puede escribir a nadie por accidente.
// NO es el correo de recuperación — ése vive en `employee_recovery`, es real y
// verificado, y los dos sistemas no se tocan jamás.
const correoDe = (nombre: string, venue: string) =>
  `${nombre.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
           .replace(/[^a-z0-9]+/g,'.').replace(/^\.|\.$/g,'')}@${venue}.meseo.invalid`;

// Nada de lo que salga de aquí puede llevar secretos. Se recorta y se limpia.
const limpiar = (e: unknown) =>
  String((e as Error)?.message ?? e ?? '')
    .replace(/eyJ[A-Za-z0-9_\-.]+/g, '«token»')      // por si un JWT se cuela
    .replace(/[0-9a-f]{32,}/gi, '«hash»')
    .slice(0, 180);

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST')    return json({ error: 'metodo' }, 405);
  if (!SUPA_URL || !SERVICE_KEY) return json({ error: 'config' }, 500);

  let body: any = {};
  try { body = await req.json(); } catch(_) { return json({ error: 'json' }, 400); }

  // ── El cuerpo, con lista blanca ESTRICTA ────────────────────────────────
  // No basta con ignorar lo que sobra: si alguien manda `employee`, `venue`,
  // `role` o `auth_user_id`, lo manda porque espera que sirva para algo. Que
  // falle a la cara es mejor que un silencio que parece obediencia — y deja
  // rastro de que alguien lo intentó.
  const PERMITIDOS = new Set(['pin', 'ejecutar']);
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'cuerpo_invalido' }, 400);
  }
  const sobrantes = Object.keys(body).filter(k => !PERMITIDOS.has(k));
  if (sobrantes.length) {
    // Se devuelven los NOMBRES, nunca los valores.
    return json({ error: 'campos_no_permitidos', campos: sobrantes.slice(0, 20),
                  permitidos: ['pin', 'ejecutar'] }, 400);
  }
  if (typeof body.pin !== 'string' || !body.pin) return json({ error: 'sin_pin' }, 400);
  if ('ejecutar' in body && typeof body.ejecutar !== 'boolean') {
    return json({ error: 'ejecutar_no_booleano' }, 400);
  }

  const pin      = body.pin;
  const ejecutar = body.ejecutar === true;

  const admin = createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    // ── 1 · La autoridad, con su limitador ────────────────────────────────
    // La IP sale de `cf-connecting-ip`, que pone Cloudflare y sobrescribe lo
    // que mande el cliente. NUNCA del cuerpo. Y va por la función privilegiada,
    // que `anon` no puede ejecutar: así el limitador cuenta los fallos de una
    // persona juntos, y no repartidos entre las IPs rotatorias de AWS.
    const ipReal = req.headers.get('cf-connecting-ip');
    const { data: pinOk, error: eVer } = await admin.rpc('verify_supervisor_pin_srv',
      { pin_input: pin, p_venue: null, p_ip: ipReal });
    if (eVer)      return json({ error: 'verificacion', detalle: limpiar(eVer) }, 502);
    if (pinOk !== true) return json({ error: 'denegado' }, 401);   // o bloqueado por el limitador

    // ── 2 · Y su alcance. Sólo DESPUÉS de pasar el limitador ──────────────
    const { data: ambito, error: eAmb } = await admin.rpc('sup_pin_scope', { p_pin: pin });
    if (eAmb || !ambito) return json({ error: 'sin_ambito' }, 403);

    // ── 3 · A quién alcanza. La lista la hace el SERVIDOR ─────────────────
    let consulta = admin.from('employees').select('name,venue,role,auth_user_id,pin').order('name');
    if (ambito !== '*') consulta = consulta.eq('venue', ambito);
    const { data: fichas, error: eLista } = await consulta;
    if (eLista) return json({ error: 'lista', detalle: limpiar(eLista) }, 502);

    const filas: any[] = [];
    let creadas = 0, yaEstaban = 0, carrerasPerdidas = 0, conError = 0, simuladas = 0;

    for (const e of (fichas || [])) {
      const correo = correoDe(e.name, e.venue);
      const base = { employee: e.name, venue: e.venue, role: e.role,
                     email_tecnico: correo, sin_pin: e.pin === null };

      // ── Idempotente: si ya tiene identidad, no se toca nada ────────────
      if (e.auth_user_id) {
        yaEstaban++;
        filas.push({ ...base, resultado: 'already_linked', auth_user_id: e.auth_user_id });
        continue;
      }

      if (!ejecutar) {
        simuladas++;
        filas.push({ ...base, resultado: 'simulado_crearia', auth_user_id: null });
        continue;
      }

      // ── Crear la identidad. Vacía de reclamaciones, y confirmada ───────
      const { data: creado, error: eNuevo } = await admin.auth.admin.createUser({
        email: correo,
        email_confirm: true,   // la crea el servidor: no se envía ningún correo
        user_metadata: {},     // sin rol ni nada: el rol vive en employees.role
        app_metadata: {}
      });
      if (eNuevo || !creado?.user) {
        conError++;
        filas.push({ ...base, resultado: 'pending_error', auth_user_id: null,
                     error: limpiar(eNuevo) || 'no se pudo crear la identidad' });
        continue;
      }
      const uid = creado.user.id;

      // ── Vincular, ATÓMICO. Sólo si la ficha sigue libre ────────────────
      const { data: vinculadas, error: eLink } = await admin.from('employees')
        .update({ auth_user_id: uid })
        .eq('name', e.name).eq('venue', e.venue)
        .is('auth_user_id', null)
        .select('auth_user_id');

      if (eLink) {
        // NO se borra la cuenta. Un fallo que no es «perdí la carrera» hay que
        // mirarlo con calma, y borrar a ciegas taparía la causa.
        conError++;
        filas.push({ ...base, resultado: 'pending_error', auth_user_id: uid,
                     error: 'la vinculación falló y la identidad NO se ha borrado: ' + limpiar(eLink) });
        continue;
      }

      if (!vinculadas || vinculadas.length === 0) {
        // Cero filas y sin error = otra ejecución llegó antes. ES el único
        // caso en el que se borra algo, y sólo la cuenta recién creada aquí.
        const { data: rel } = await admin.from('employees')
          .select('auth_user_id').eq('name', e.name).eq('venue', e.venue).limit(1);
        const ganador = rel?.[0]?.auth_user_id ?? null;
        if (ganador && ganador !== uid) {
          const { error: eBorrar } = await admin.auth.admin.deleteUser(uid);
          carrerasPerdidas++;
          filas.push({ ...base, resultado: 'race_lost', auth_user_id: ganador,
                       ...(eBorrar ? { error: 'no se pudo retirar la identidad sobrante: ' + limpiar(eBorrar) } : {}) });
        } else {
          conError++;
          filas.push({ ...base, resultado: 'pending_error', auth_user_id: uid,
                       error: 'la ficha no quedó vinculada y no se encontró ganador; la identidad NO se ha borrado' });
        }
        continue;
      }

      creadas++;
      filas.push({ ...base, resultado: 'created_linked', auth_user_id: uid });
    }

    return json({
      ok: true,
      modo: ejecutar ? 'ejecutado' : 'SIMULACRO (no se ha creado ni vinculado nada)',
      ambito: ambito === '*' ? 'todos los restaurantes' : ambito,
      resumen: {
        fichas_revisadas: filas.length,
        created_linked: creadas,
        already_linked: yaEstaban,
        race_lost: carrerasPerdidas,
        pending_error: conError,
        ...(ejecutar ? {} : { simulado_crearia: simuladas })
      },
      empleados: filas
    });
  } catch (e) {
    return json({ error: 'inesperado', detalle: limpiar(e) }, 500);
  }
});
