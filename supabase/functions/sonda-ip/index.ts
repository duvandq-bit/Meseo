// Meseo — sonda-ip (DIAGNÓSTICO TEMPORAL, sep 2026)
//
// Resuelve exactamente dos incógnitas y nada más:
//   A · qué cabecera trae la IP real del navegador hasta dentro de la función
//   B · con qué rol llega la petición a Postgres cuando la hace esta función
//
// TODO va a los REGISTROS DEL SERVIDOR. Al navegador sólo le vuelve «ok».
//
// Lista blanca de cabeceras: se leen los VALORES de unas pocas relacionadas
// con la IP, y de las demás sólo los NOMBRES. Así se descubre si hay alguna
// otra cabecera con la IP sin arriesgarse a volcar credenciales por error —
// una lista negra se olvida siempre de algo.
//
// No toca la base de datos. No cambia ninguna protección. Se borra en cuanto
// se lean los registros.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPA_URL    = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey'
};
const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } });

// Las únicas cabeceras cuyo VALOR se registra. Todas son de infraestructura y
// ninguna lleva credenciales.
const CABECERAS_DE_IP = [
  'cf-connecting-ip', 'x-real-ip', 'x-forwarded-for', 'true-client-ip',
  'x-client-ip', 'fly-client-ip', 'x-envoy-external-address', 'forwarded',
  'cf-ipcountry', 'cf-ray'
];

// Jamás se registra el nombre de éstas, ni siquiera para descubrir cabeceras.
const NUNCA = /authorization|apikey|api-key|cookie|token|secret|x-sb|sb-/i;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST')    return json({ error: 'metodo' }, 405);

  // Un nonce para que un escaneo cualquiera no genere ruido en los registros.
  // No es un secreto: sólo evita invocaciones accidentales.
  let cuerpo: any = {};
  try { cuerpo = await req.json(); } catch(_) {}
  if (cuerpo?.sonda !== 'meseo-2-5b') return json({ error: 'sonda' }, 400);
  // El resto del cuerpo NO se mira ni se registra.

  const valores: Record<string, string | null> = {};
  for (const h of CABECERAS_DE_IP) valores[h] = req.headers.get(h);

  const otrosNombres = [...req.headers.keys()]
    .filter(k => !NUNCA.test(k) && !CABECERAS_DE_IP.includes(k))
    .sort();

  console.log('SONDA·A cabeceras de IP →', JSON.stringify(valores));
  console.log('SONDA·A otros nombres  →', JSON.stringify(otrosNombres));

  try {
    const admin = createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await admin.rpc('_sonda_identidad');
    console.log('SONDA·B identidad en Postgres →', JSON.stringify(error ? { error: error.message } : data));
  } catch (e) {
    console.log('SONDA·B fallo →', String((e as Error)?.message || e).slice(0, 160));
  }

  // Al navegador, nada.
  return json({ ok: true, nota: 'los datos están en los registros del servidor' });
});
