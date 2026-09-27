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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey' }
    });
  }

  try {
    // Find employees inactive for 3+ days who have push subscriptions
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

    // Get all employees with last_active_at older than 3 days (or null)
    const empRes = await fetch(
      `${SUPA_URL}/rest/v1/employees?select=name,last_active_at&or=(last_active_at.lt.${threeDaysAgo},last_active_at.is.null)`,
      { headers: { 'apikey': SUPA_SERVICE_KEY, 'Authorization': `Bearer ${SUPA_SERVICE_KEY}` } }
    );
    const inactiveEmps = await empRes.json();

    if (!Array.isArray(inactiveEmps) || !inactiveEmps.length) {
      return new Response(JSON.stringify({ message: 'No inactive employees', notified: 0 }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // Get subscriptions for inactive employees
    const names = inactiveEmps.map((e: any) => e.name);
    const subsRes = await fetch(
      `${SUPA_URL}/rest/v1/push_subscriptions?select=*&employee_name=in.(${names.map((n: string) => `"${n}"`).join(',')})`,
      { headers: { 'apikey': SUPA_SERVICE_KEY, 'Authorization': `Bearer ${SUPA_SERVICE_KEY}` } }
    );
    const subs = await subsRes.json();

    if (!Array.isArray(subs) || !subs.length) {
      return new Response(JSON.stringify({ message: 'No push subscriptions for inactive employees', inactive: names, notified: 0 }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // Send push to each inactive employee
    const SEND_PUSH_URL = `${SUPA_URL}/functions/v1/send-push`;
    const notified: string[] = [];

    // Group subs by employee to avoid duplicates
    const empSet = new Set(subs.map((s: any) => s.employee_name));

    for (const empName of empSet) {
      const msg = MOTIVATIONAL_ES[Math.floor(Math.random() * MOTIVATIONAL_ES.length)];

      // Calculate days inactive
      const emp = inactiveEmps.find((e: any) => e.name === empName);
      const lastActive = emp?.last_active_at ? new Date(emp.last_active_at) : null;
      const daysInactive = lastActive ? Math.floor((Date.now() - lastActive.getTime()) / 86400000) : '?';

      await fetch(SEND_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target: empName,
          title: `⚠️ ¡${daysInactive} días sin entrenar!`,
          body: msg,
          tag: 'inactivity'
        })
      });

      // Also create an in-app notification
      await fetch(`${SUPA_URL}/rest/v1/notifications`, {
        method: 'POST',
        headers: {
          'apikey': SUPA_SERVICE_KEY,
          'Authorization': `Bearer ${SUPA_SERVICE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          target: empName,
          message: `⚠️ Llevas ${daysInactive} días sin entrenar. ${msg}`,
          type: 'warning',
          read: false
        })
      });

      notified.push(empName);
    }

    return new Response(JSON.stringify({
      message: `Inactivity check complete`,
      inactive: names,
      notified,
      total_notified: notified.length
    }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
});
