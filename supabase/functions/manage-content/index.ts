// Meseo — manage-content (escrituras de contenido gestionadas, jul 2026)
// Las tablas de contenido (custom_dishes) pasan a SOLO-LECTURA para la anon key
// pública: cualquiera podía inyectar/alterar platos (¡y sus alérgenos!). Las
// escrituras legítimas del supervisor se enrutan por aquí, verificando el PIN
// de supervisor server-side antes de tocar la tabla con service-role.
//
// Acciones:
//   • dish-upsert { supPin, dish }   → alta/edición de un plato personalizado
//   • dish-delete { supPin, dishId } → baja de un plato personalizado
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPA_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPA_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey'
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

const rest = (path: string, init: RequestInit = {}) =>
  fetch(`${SUPA_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      'apikey': SUPA_SERVICE_KEY,
      'Authorization': `Bearer ${SUPA_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  });

// Verifica el PIN de supervisor server-side reutilizando la RPC existente
// (SECURITY DEFINER, lee supervisor_pin_secret). Nunca se confía en el cliente.
async function verifySupervisor(pin: string): Promise<boolean> {
  if (!pin) return false;
  try {
    const res = await fetch(`${SUPA_URL}/rest/v1/rpc/verify_supervisor_pin`, {
      method: 'POST',
      headers: { 'apikey': SUPA_SERVICE_KEY, 'Authorization': `Bearer ${SUPA_SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin_input: String(pin) })
    });
    if (!res.ok) return false;
    return (await res.json()) === true;
  } catch { return false; }
}

const asStr = (v: unknown, max = 4000) => (v == null ? '' : String(v)).slice(0, max);

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action;
    const okSup = await verifySupervisor(String(body.supPin || ''));
    if (!okSup) return json({ error: 'auth' }, 401);

    if (action === 'dish-upsert') {
      const d = body.dish || {};
      const dish_id = parseInt(d.id, 10);
      if (!Number.isInteger(dish_id)) return json({ error: 'bad_request' }, 400);
      let allergens = '[]';
      try { allergens = JSON.stringify(Array.isArray(d.allergens) ? d.allergens.map((a: unknown) => asStr(a, 60)) : []); } catch { allergens = '[]'; }
      const row = {
        dish_id,
        name: asStr(d.name, 200),
        cat: asStr(d.cat, 80),
        allergens,
        ingredients: asStr(d.ingredients, 4000),
        history: asStr(d.history, 8000),
        notes: d.notes == null ? null : asStr(d.notes, 4000),
        updated_at: new Date().toISOString()
      };
      const up = await rest('custom_dishes', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(row)
      });
      if (!up.ok) return json({ error: 'save_failed' }, 500);
      return json({ ok: true });
    }

    if (action === 'dish-delete') {
      const dishId = parseInt(body.dishId, 10);
      if (!Number.isInteger(dishId)) return json({ error: 'bad_request' }, 400);
      const del = await rest(`custom_dishes?dish_id=eq.${dishId}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      if (!del.ok) return json({ error: 'delete_failed' }, 500);
      return json({ ok: true });
    }

    return json({ error: 'unknown_action' }, 400);
  } catch (e) {
    return json({ error: String(e) }, 400);
  }
});
