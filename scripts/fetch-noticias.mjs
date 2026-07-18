#!/usr/bin/env node
// ═══ ROBOT DE NOTICIAS GASTRO (jul 2026) ═══
// Corre en GitHub Actions cada 6 h (.github/workflows/noticias.yml).
// Lee RSS públicos (Google News con búsquedas fijas), filtra, etiqueta,
// deduplica y escribe data/noticias.json — la app lo carga en perezoso en
// Aprender → Actualidad. Sin dependencias, sin claves, sin servidores.
//
// A PRUEBA DE FALLOS: si las fuentes devuelven poca cosa (<5 noticias),
// NO se escribe nada y la app conserva la edición anterior.

import { writeFileSync, readFileSync } from 'node:fs';

const FEEDS = [
  { q: 'gastronomía Canarias',        tags: ['CANARIAS'] },
  { q: 'gastronomía Tenerife',        tags: ['CANARIAS'] },
  { q: 'restaurantes Tenerife',       tags: ['CANARIAS'] },
  { q: '"Guía Michelin" España',      tags: ['MICHELIN'] },
  { q: '"Martín Berasategui"',        tags: ['CHEF'] },
  { q: 'vinos Canarias bodega',       tags: ['VINO', 'CANARIAS'] },
  { q: 'alta cocina España chef',     tags: ['ALTA COCINA'] },
];

// Titulares que no pintan nada en una app de formación de sala.
const BLOCKLIST = ['muere', 'muert', 'asesin', 'accident', 'incendi', 'crimen', 'agresi', 'apuñal', 'violen',
  // deporte (se cuela por «estrella»/«chef de la selección» en las búsquedas)
  'fútbol', 'futbol', 'scaloni', 'mundial', 'champions', 'la liga', 'partido', 'selección española', 'final contra'];

const MAX_ITEMS = 30;
const MIN_ITEMS = 5;          // por debajo de esto: conservar la edición anterior
const OUT = new URL('../data/noticias.json', import.meta.url).pathname;

function feedUrl(q){
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q + ' when:14d')}&hl=es&gl=ES&ceid=ES:es`;
}

function decode(s){
  return (s||'')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'")
    .replace(/<[^>]+>/g,'').trim();
}

function parseItems(xml){
  const out = [];
  const items = xml.split(/<item[\s>]/).slice(1);
  for(const chunk of items){
    const grab = tag => { const m = chunk.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)); return m ? decode(m[1]) : ''; };
    const title = grab('title');
    const link = grab('link');
    const pub = grab('pubDate');
    const source = grab('source');
    if(!title || !link) continue;
    out.push({ title, link, pub, source });
  }
  return out;
}

function tagFor(title, base){
  const t = title.toLowerCase();
  const tags = new Set(base);
  if(/michelin/.test(t)) tags.add('MICHELIN');
  if(/canari|tenerife|lanzarote|gran canaria|la palma|fuerteventura|el hierro|la gomera/.test(t)) tags.add('CANARIAS');
  if(/vino|bodega|enolog|vendimia|maridaje|sumiller/.test(t)) tags.add('VINO');
  if(/berasategui/.test(t)) tags.add('CHEF');
  if(!tags.size) tags.add('GASTRO');
  return [...tags].slice(0, 3);
}

function normTitle(title, source){
  let t = title;
  if(source && t.endsWith(' - ' + source)) t = t.slice(0, -(' - ' + source).length);
  return t.trim();
}

const seen = new Set();
const items = [];
for(const feed of FEEDS){
  try {
    const res = await fetch(feedUrl(feed.q), { headers: { 'User-Agent': 'MeseoNoticias/1.0 (+https://meseo.es)' } });
    if(!res.ok){ console.log(`[skip] ${feed.q}: HTTP ${res.status}`); continue; }
    const xml = await res.text();
    for(const it of parseItems(xml)){
      const t = normTitle(it.title, it.source);
      const key = t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
      if(seen.has(key)) continue;
      const lower = t.toLowerCase();
      if(BLOCKLIST.some(w => lower.includes(w))) continue;
      seen.add(key);
      const d = it.pub ? new Date(it.pub) : null;
      items.push({
        t,
        u: it.link,
        s: it.source || 'Google News',
        d: (d && !isNaN(d)) ? d.toISOString() : null,
        tags: tagFor(t, feed.tags)
      });
    }
    console.log(`[ok] ${feed.q}: ${items.length} acumuladas`);
  } catch(e){ console.log(`[skip] ${feed.q}: ${e.message}`); }
}

items.sort((a,b) => (b.d||'').localeCompare(a.d||''));
const top = items.slice(0, MAX_ITEMS);

if(top.length < MIN_ITEMS){
  console.log(`Solo ${top.length} noticias — se conserva la edición anterior sin escribir.`);
  process.exit(0);
}

let prev = null;
try { prev = JSON.parse(readFileSync(OUT, 'utf8')); } catch(e){}
const payload = { updated: new Date().toISOString(), items: top };
// No reescribir si el contenido es idéntico (evita commits vacíos de solo-fecha).
if(prev && JSON.stringify(prev.items) === JSON.stringify(payload.items)){
  console.log('Sin novedades — no se escribe.');
  process.exit(0);
}
writeFileSync(OUT, JSON.stringify(payload, null, 1) + '\n');
console.log(`Escritas ${top.length} noticias en data/noticias.json`);
