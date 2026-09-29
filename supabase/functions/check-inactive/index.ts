// Meseo — check-inactive (aviso semanal de inactividad)
//
// QUIÉN LA LLAMA
//   Sólo el cron `check-inactive-employees` de pg_cron (lunes 10:00 UTC). No
//   hay ninguna llamada desde la app.
//
// S3-A (sep 2026): DEJA DE SER PÚBLICA
//   Antes cualquiera podía invocarla sin credencial: disparaba avisos push a
//   todas las personas inactivas de todos los restaurantes, insertaba
//   notificaciones y devolvía sus NOMBRES a quien llamara.
//
//   Ahora exige `Authorization: Bearer <service key>`. El cron la lee de Vault
//   (ver supabase/check_inactive_cron_autenticado.sql); la clave no vive ni en
//   el repositorio ni en la app. Cualquier otra llamada recibe 401 y no se
//   toca nada.
//
//   La respuesta ya no lleva nombres: sólo conteos.
//
// EL RESTAURANTE
//   Cada aviso lleva el restaurante de la ficha: la notificación dentro de la
//   app ya no cae en el de por defecto, y `send-push` lo recibe explícito.
//   LÍMITE CONOCIDO: la versión actual de `send-push` ignora `venue` cuando el
//   destinatario es una persona (filtra sólo por nombre). Hoy no hay cruce
//   posible —el nombre es la clave de `employees` y no hay suscripciones con
//   restaurante distinto del de su ficha—, pero hasta que `send-push` lo
//   respete no es una garantía de servidor.
//
// S3-C-01: la llamada a send-push lleva `Authorization: Bearer <service key>`
//   (la misma variable de entorno). Hoy send-push la ignora; es el paso previo
//   para que pueda exigir credencial sin romper este aviso semanal.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPA_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPA_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const MOTIVATIONAL_ES = [
  '¡No pierdas tu racha! Entra y practica hoy.',
  '¡El equipo te necesita! Repasa los platos.',
  'Tu ranking te espera. ¡Vuelve a entrenar!',
  '¿Recuerdas los alérgenos? ¡Pon a prueba tu memoria!',
  '¡Sube de nivel! Solo necesitas 5 minutos.',
  'Los mejores practican cada día. ¡Tú también puedes!',
  '¡Hay nuevos retos esperando por ti!'
];

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

// Comparación en tiempo constante: el tiempo de respuesta no dice cuántos
// caracteres de la credencial se acertaron.
function igual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0;
}

function autorizado(req: Request): boolean {
  if (!SUPA_SERVICE_KEY) return false;       // sin clave configurada no entra nadie
  const h = req.headers.get('authorization') || '';
  return igual(h, `Bearer ${SUPA_SERVICE_KEY}`);
}

const svc = { 'apikey': SUPA_SERVICE_KEY, 'Authorization': `Bearer ${SUPA_SERVICE_KEY}` };

Deno.serve(async (req: Request) => {
  // Servidor a servidor: sin CORS. Lo primero es la credencial; antes de ella
  // no se lee ni se escribe nada.
  if (req.method !== 'POST') return json({ ok: false, error: 'metodo' }, 405);
  if (!autorizado(req)) return json({ ok: false, error: 'auth' }, 401);

  try {
    // Personas inactivas desde hace 3 días o más (o sin actividad registrada)
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const empRes = await fetch(
      `${SUPA_URL}/rest/v1/employees?select=name,venue,last_active_at&or=(last_active_at.lt.${threeDaysAgo},last_active_at.is.null)`,
      { headers: svc }
    );
    const inactiveEmps = await empRes.json();

    if (!Array.isArray(inactiveEmps) || !inactiveEmps.length) {
      return json({ ok: true, inactivos: 0, con_suscripcion: 0, notificados: 0 });
    }

    // Sus suscripciones push
    const names = inactiveEmps.map((e: any) => e.name);
    const subsRes = await fetch(
      `${SUPA_URL}/rest/v1/push_subscriptions?select=employee_name&employee_name=in.(${names.map((n: string) => `"${n}"`).join(',')})`,
      { headers: svc }
    );
    const subs = await subsRes.json();

    if (!Array.isArray(subs) || !subs.length) {
      return json({ ok: true, inactivos: names.length, con_suscripcion: 0, notificados: 0 });
    }

    const SEND_PUSH_URL = `${SUPA_URL}/functions/v1/send-push`;
    let notificados = 0;

    // Un aviso por persona, aunque tenga varios dispositivos
    const empSet = new Set(subs.map((s: any) => s.employee_name));

    for (const empName of empSet) {
      const msg = MOTIVATIONAL_ES[Math.floor(Math.random() * MOTIVATIONAL_ES.length)];
      const emp = inactiveEmps.find((e: any) => e.name === empName);
      const venue = emp?.venue;
      const lastActive = emp?.last_active_at ? new Date(emp.last_active_at) : null;
      const daysInactive = lastActive ? Math.floor((Date.now() - lastActive.getTime()) / 86400000) : '?';

      // S3-C-01: se identifica ante send-push con la misma service key del
      // entorno que ya usa para leer y escribir. Sólo en esta llamada de
      // servidor a servidor; nunca en una respuesta ni en un registro.
      await fetch(SEND_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPA_SERVICE_KEY}` },
        body: JSON.stringify({
          target: empName,
          venue,
          title: `⚠️ ¡${daysInactive} días sin entrenar!`,
          body: msg,
          tag: 'inactivity'
        })
      });

      // La notificación dentro de la app, en el restaurante de la ficha
      await fetch(`${SUPA_URL}/rest/v1/notifications`, {
        method: 'POST',
        headers: { ...svc, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          target: empName,
          venue,
          message: `⚠️ Llevas ${daysInactive} días sin entrenar. ${msg}`,
          type: 'warning',
          read: false
        })
      });

      notificados++;
    }

    return json({ ok: true, inactivos: names.length, con_suscripcion: empSet.size, notificados });
  } catch (e) {
    // El detalle, al registro del servidor; a quien llama, nada interno.
    console.error('[check-inactive]', String((e as Error)?.message || e));
    return json({ ok: false, error: 'interno' }, 500);
  }
});
