'use strict';

// Content-addressable on-disk cache for Haiku translation prompts.
// Key = SHA-256(prompt). Identical prompt -> cache hit, no Claude call.
// Sharded (git-style 2-char dirs), atomic writes, byte-based LRU at 100 MB.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const VERSION = 'v1';                       // bump to invalidate every entry
const MAX_BYTES = 100 * 1024 * 1024;        // hard cap: 100 MB
const TARGET_BYTES = Math.floor(MAX_BYTES * 0.9); // evict down to 90% (no thrash)
const CHECK_EVERY = 20;                      // run eviction once per N writes

let dirCache = null;
let sinceCheck = 0;

function cacheDir() {
  if (dirCache) return dirCache;
  let base;
  try { base = require('electron').app.getPath('userData'); }
  catch (_) { base = path.join(os.tmpdir(), 'subtitle-studio'); }
  dirCache = path.join(base, 'translation-cache');
  try { fs.mkdirSync(dirCache, { recursive: true }); } catch (_) {}
  return dirCache;
}

function keyHash(prompt) {
  return crypto.createHash('sha256').update(VERSION + '\n' + prompt).digest('hex');
}
function entryPath(hash) {
  return path.join(cacheDir(), hash.slice(0, 2), hash + '.json');
}
function readdir(p) {
  try { return fs.readdirSync(p); } catch (_) { return []; }
}

// Look up a prompt. Returns the stored value, or null on miss. Touches mtime (LRU).
function get(prompt) {
  try {
    const fp = entryPath(keyHash(prompt));
    const e = JSON.parse(fs.readFileSync(fp, 'utf-8'));
    try { const now = new Date(); fs.utimesSync(fp, now, now); } catch (_) {}
    return e.value;
  } catch (_) { return null; }
}

// Store a prompt -> value. Best-effort: any failure is swallowed.
function set(prompt, value) {
  try {
    const hash = keyHash(prompt);
    const fp = entryPath(hash);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    const body = JSON.stringify({ key: hash, prompt, value }, null, 0);
    const tmp = `${fp}.${process.pid}.${hash.slice(0, 6)}.tmp`;
    fs.writeFileSync(tmp, body, 'utf-8');     // atomic: write temp then rename
    fs.renameSync(tmp, fp);
    enforceLimit(false);
  } catch (_) {}
}

// Scan the cache and evict least-recently-used entries until under TARGET_BYTES.
function enforceLimit(force) {
  if (!force && ++sinceCheck < CHECK_EVERY) return;
  sinceCheck = 0;
  const files = [];
  let total = 0;
  const root = cacheDir();
  for (const shard of readdir(root)) {
    const sdir = path.join(root, shard);
    let st; try { st = fs.statSync(sdir); } catch (_) { continue; }
    if (!st.isDirectory()) continue;
    for (const name of readdir(sdir)) {
      if (!name.endsWith('.json')) continue;
      const fp = path.join(sdir, name);
      try { const s = fs.statSync(fp); files.push({ fp, size: s.size, mtime: s.mtimeMs }); total += s.size; }
      catch (_) {}
    }
  }
  if (total <= MAX_BYTES) return;
  files.sort((a, b) => a.mtime - b.mtime);    // oldest first
  for (const f of files) {
    if (total <= TARGET_BYTES) break;
    try { fs.unlinkSync(f.fp); total -= f.size; } catch (_) {}
  }
}

// Inspection helper: total size + entry count (for diagnostics / easy search).
function stats() {
  let total = 0, count = 0;
  const root = cacheDir();
  for (const shard of readdir(root)) {
    for (const name of readdir(path.join(root, shard))) {
      if (!name.endsWith('.json')) continue;
      try { total += fs.statSync(path.join(root, shard, name)).size; count += 1; } catch (_) {}
    }
  }
  return { dir: root, bytes: total, entries: count, limit: MAX_BYTES };
}

module.exports = { get, set, stats, cacheDir };
