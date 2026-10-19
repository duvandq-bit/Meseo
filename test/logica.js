// Funciones puras del test de alérgenos y de la calculadora de coste.
// Sin DOM ni red: las usa app.js en el navegador y tests/smoke.mjs en Node.

import { TEMAS } from './banco.js';

// Baraja (Fisher-Yates) con un generador inyectable para poder probarla.
export function barajar(arr, rnd = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Elige `n` preguntas repartidas por igual entre los temas (con n=10 y cinco
// temas, dos de cada) y las devuelve barajadas. Si n no es múltiplo del número
// de temas, el resto se reparte entre temas al azar, como mucho una más cada uno.
export function elegirPreguntas(banco, n = 10, rnd = Math.random) {
  const porTema = {};
  for (const t of TEMAS) porTema[t] = barajar(banco.filter(p => p.tema === t), rnd);
  const base = Math.floor(n / TEMAS.length);
  const extra = barajar(TEMAS, rnd).slice(0, n - base * TEMAS.length);
  const out = [];
  for (const t of TEMAS) {
    const k = base + (extra.includes(t) ? 1 : 0);
    out.push(...porTema[t].slice(0, k));
  }
  return barajar(out, rnd);
}

// Prepara una pregunta para mostrarla: opciones barajadas y el índice de la
// correcta en el nuevo orden.
export function prepararPregunta(p, lang, rnd = Math.random) {
  const orden = barajar([0, 1, 2, 3].slice(0, p.o.es.length), rnd);
  return {
    id: p.id, tema: p.tema,
    q: p.q[lang], x: p.x[lang],
    o: orden.map(i => p.o[lang][i]),
    c: orden.indexOf(p.c),
  };
}

// detalle: [{ id, tema, ok }] de una persona. Devuelve { aciertos, total }.
export function corregir(detalle) {
  return { aciertos: detalle.filter(d => d.ok).length, total: detalle.length };
}

// Nota sobre 10 con un decimal.
export function nota(aciertos, total) {
  if (!total) return 0;
  return Math.round((aciertos / total) * 100) / 10;
}

// respuestas: [{ detalle:[{id,tema,ok}] }]. Devuelve por tema
// { aciertos, total, nota } (nota sobre 10, null si no hay datos).
export function notaPorTema(respuestas) {
  const acc = {};
  for (const t of TEMAS) acc[t] = { aciertos: 0, total: 0, nota: null };
  for (const r of respuestas) {
    for (const d of (Array.isArray(r.detalle) ? r.detalle : [])) {
      if (!acc[d.tema]) continue;
      acc[d.tema].total++;
      if (d.ok) acc[d.tema].aciertos++;
    }
  }
  for (const t of TEMAS) if (acc[t].total) acc[t].nota = nota(acc[t].aciertos, acc[t].total);
  return acc;
}

// Las preguntas que más falla el equipo: por número de fallos y, a igualdad,
// por porcentaje de fallo. Solo las que alguien ha fallado.
export function masFalladas(respuestas, k = 3) {
  const m = {};
  for (const r of respuestas) {
    for (const d of (Array.isArray(r.detalle) ? r.detalle : [])) {
      const e = m[d.id] || (m[d.id] = { id: d.id, fallos: 0, veces: 0 });
      e.veces++;
      if (!d.ok) e.fallos++;
    }
  }
  return Object.values(m)
    .filter(e => e.fallos > 0)
    .sort((a, b) => (b.fallos - a.fallos) || (b.fallos / b.veces - a.fallos / a.veces) || a.id.localeCompare(b.id))
    .slice(0, k);
}

export function notaMedia(respuestas) {
  if (!respuestas.length) return null;
  const s = respuestas.reduce((t, r) => t + nota(r.aciertos, r.total), 0);
  return Math.round((s / respuestas.length) * 10) / 10;
}

// ─── Calculadora «Lo que te cuesta un camarero sin formar» ───────────────
// Valores por defecto (fuentes en app.js, bajo la calculadora, y en el PR):
//  costeMes   2.035 €: 1.320,04 € de salario base (convenio de hostelería de
//             Santa Cruz de Tenerife, tabla 3D 2026-2027, camarero grupo 4) por
//             14 pagas entre 12 meses, más un 32,15 % de cotización de empresa
//             (23,60 CC + 0,75 MEI + 5,50 desempleo indefinido + 0,20 FOGASA +
//             0,60 FP + 1,50 AT/EP del CNAE 56). Sin plus de transporte ni antigüedad.
//  nuevos     4 al año: supuesto de 6 camareros con la rotación del 63,7 % que
//             cita el informe de RR. HH. de Pascual Profesional (dato de Randstad).
//  ticket     54 € por mesa: 27 € por persona a la carta (TheFork, 2025) por 2.
//  El resto son supuestos editables.
export const SEMANAS_MES = 52 / 12;

export const CALC_DEFECTO = {
  costeMes: 2035,
  nuevos: 4,
  semanas: 8,
  rendimiento: 60,
  ticket: 54,
  mesas: 6,
  servicios: 5,
  perdida: 5,
};

function num(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

// curva  = nuevos × costeMes × (semanas ÷ 4,33) × (1 − rendimiento)
// ventas = nuevos × semanas × servicios × mesas × ticket × pérdida
export function calcularCoste(v) {
  const c = {
    costeMes: num(v.costeMes, 0, 20000),
    nuevos: num(v.nuevos, 0, 200),
    semanas: num(v.semanas, 0, 52),
    rendimiento: num(v.rendimiento, 0, 100),
    ticket: num(v.ticket, 0, 5000),
    mesas: num(v.mesas, 0, 100),
    servicios: num(v.servicios, 0, 14),
    perdida: num(v.perdida, 0, 100),
  };
  const meses = c.semanas / SEMANAS_MES;
  const curva = c.nuevos * c.costeMes * meses * (1 - c.rendimiento / 100);
  const ventas = c.nuevos * c.semanas * c.servicios * c.mesas * c.ticket * (c.perdida / 100);
  return {
    curva: Math.round(curva),
    ventas: Math.round(ventas),
    total: Math.round(curva) + Math.round(ventas),
    valores: c,
  };
}
