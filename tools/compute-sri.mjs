#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// compute-sri.mjs — add/refresh Subresource Integrity hashes
// ═══════════════════════════════════════════════════════════════
// The app loads three pinned third-party libraries from CDNs (maplibre,
// topojson, supabase) plus the maplibre CSS. SRI makes the browser refuse
// any of these if the CDN ever serves tampered bytes — protection against a
// CDN compromise / supply-chain attack.
//
// Why a script instead of hardcoded hashes: the hash must match the exact
// bytes of each pinned version, and it has to be recomputed whenever a CDN
// version is bumped. This fetches each URL, computes sha384, and injects
// integrity="sha384-…" (adding crossorigin if missing) directly into
// index.html. Run it from a machine with outbound network access:
//
//   node tools/compute-sri.mjs            # update index.html in place
//   node tools/compute-sri.mjs --check    # CI mode: exit 1 if any hash is
//                                          # missing or stale (no writes)
//
// It only touches tags whose src/href points at unpkg.com or jsdelivr.net.
// ═══════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = join(ROOT, 'index.html');
const CHECK = process.argv.includes('--check');

let html = readFileSync(FILE, 'utf8');

// Match <script …src="https://(unpkg|jsdelivr)…"…> and <link …href="…">.
const tagRe = /<(script|link)\b[^>]*\b(?:src|href)="(https:\/\/(?:unpkg\.com|cdn\.jsdelivr\.net)\/[^"]+)"[^>]*>/g;

const tags = [...html.matchAll(tagRe)];
if (tags.length === 0) { console.error('No CDN tags found — nothing to do.'); process.exit(CHECK ? 0 : 0); }

async function sri(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} → HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return 'sha384-' + createHash('sha384').update(buf).digest('base64');
}

let changed = 0, stale = [];
for (const m of tags) {
  const fullTag = m[0];
  const url = m[2];
  const existing = /\bintegrity="([^"]+)"/.exec(fullTag)?.[1] || null;
  let hash;
  try { hash = await sri(url); }
  catch (e) { console.error(`✗ ${e.message}`); process.exit(1); }

  if (existing === hash) { console.log(`✓ up-to-date  ${url}`); continue; }

  if (CHECK) { stale.push(url); console.log(`✗ ${existing ? 'stale' : 'missing'}    ${url}`); continue; }

  // Build the new tag: drop any old integrity, ensure crossorigin, add hash.
  let newTag = fullTag
    .replace(/\s+integrity="[^"]*"/g, '')
    .replace(/\s*\/?>$/, '');
  if (!/\bcrossorigin\b/.test(newTag)) newTag += ' crossorigin="anonymous"';
  newTag += ` integrity="${hash}"`;
  newTag += fullTag.trimEnd().endsWith('/>') ? '/>' : '>';
  html = html.replace(fullTag, newTag);
  changed++;
  console.log(`+ ${existing ? 'updated' : 'added'}    ${url}`);
}

if (CHECK) {
  if (stale.length) { console.error(`\n${stale.length} tag(s) missing/stale SRI. Run: node tools/compute-sri.mjs`); process.exit(1); }
  console.log('\nAll CDN tags have current SRI hashes.');
  process.exit(0);
}

if (changed) { writeFileSync(FILE, html); console.log(`\nWrote ${changed} integrity hash(es) to index.html`); }
else console.log('\nNothing to change.');
