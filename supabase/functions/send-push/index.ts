// TXOKO Formación — send-push v3 (fuente versionada; desplegar en Supabase)
// v3 añade el passthrough de los extras visuales de la notificación hacia el
// service worker: image (foto grande, p. ej. fotos del chat), renotify (las
// menciones vuelven a sonar aunque el tag 'chat' ya esté coalescido) y data
// (deep link, p. ej. {tab:'chat'}). El SW ya los consume desde v7.96; hasta
// que esta versión se despliegue, la v2 sigue funcionando (el SW infiere el
// deep link del tag).
//
// SECRETO: la clave VAPID privada NO vive en este repo. Antes de desplegar:
//   supabase secrets set VAPID_PRIVATE_KEY=<clave>
// (la versión desplegada actualmente la lleva inline; al redesplegar desde
// este archivo hay que definir el secreto o inyectar la clave en el deploy).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import webpush from 'npm:web-push@3.6.7';

const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY') || 'BCuDF-0fItqmOGTU1u00Cizxbe7MHXf6FxLasMLKSX3unwXPpt5Qyo2P3og9x3v7Bd35wz08bYd-7z8QUk9QNik';
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') || '';

webpush.setVapidDetails('mailto:duvandq@gmail.com', VAPID_PUBLIC, VAPID_PRIVATE);

const SUPA_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPA_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

async function sendToSub(sub: { endpoint: string; keys_p256dh: string; keys_auth: string }, payload: string) {
  const pushSub = {
    endpoint: sub.endpoint,
    keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth }
  };
  try {
    await webpush.sendNotification(pushSub, payload, { TTL: 86400 });
    return { success: true };
  } catch (e: any) {
    if (e.statusCode === 410 || e.statusCode === 404) {
      // Subscription expired — clean up
      await fetch(`${SUPA_URL}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(sub.endpoint)}`, {
        method: 'DELETE',
        headers: { 'apikey': SUPA_SERVICE_KEY, 'Authorization': `Bearer ${SUPA_SERVICE_KEY}` }
      });
      return { success: false, reason: 'expired' };
    }
    return { success: false, reason: String(e) };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey'
      }
    });
  }

  try {
    const { target, title, body, tag, image, renotify, data } = await req.json();

    let url = `${SUPA_URL}/rest/v1/push_subscriptions?select=*`;
    if (target && target !== 'all') {
      url += `&employee_name=eq.${encodeURIComponent(target)}`;
    }

    const subsRes = await fetch(url, {
      headers: { 'apikey': SUPA_SERVICE_KEY, 'Authorization': `Bearer ${SUPA_SERVICE_KEY}` }
    });
    const subs = await subsRes.json();

    if (!Array.isArray(subs) || !subs.length) {
      return new Response(JSON.stringify({ sent: 0, message: 'No subscriptions found' }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const payload = JSON.stringify({
      title: title || 'TXOKO Formación',
      body: body || '',
      tag: tag || 'txoko',
      // Solo imágenes https (el bucket público de chat-images lo es)
      image: (typeof image === 'string' && image.startsWith('https://')) ? image : undefined,
      renotify: !!renotify,
      data: (data && typeof data === 'object') ? data : {}
    });

    const results = await Promise.allSettled(
      subs.map((s: any) => sendToSub(s, payload))
    );

    const sent = results.filter((r: any) => r.status === 'fulfilled' && r.value?.success).length;

    return new Response(JSON.stringify({ sent, total: subs.length }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
});
