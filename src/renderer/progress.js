'use strict';

// Live progress rendering. Relies on globals from app.js: state, $, item,
// updateRow, updateSummary, ensureAnim, nowMs.

function fmtEta(sec) {
  if (!isFinite(sec) || sec < 0) return '';
  sec = Math.round(sec);
  if (sec < 60) return 'עוד פחות מדקה';
  const m = Math.floor(sec / 60), s = sec % 60;
  return `עוד ~${m}:${String(s).padStart(2, '0')}`;
}

// Real progress: advance at the measured rate (%/s), monotonic, with a live ETA.
let raf = null;
function animate() {
  let live = false;
  const t = nowMs();
  for (const it of state.items) {
    if (it.status !== 'active') continue;
    live = true;
    const row = $(`row-${it.id}`);
    if (!row) continue;
    let proj = it.upP || 0;
    if (it.rate > 0 && it.upT != null) {
      proj = it.upP + it.rate * (t - it.upT) / 1000;
      const cap = it.upP + (it.lastDelta > 0 ? it.lastDelta * 1.3 : 100); // don't outrun next checkpoint
      proj = Math.min(proj, cap);
    }
    proj = Math.min(proj, 99.5);
    if (proj > it.shown) it.shown = proj;
    const fill = row.querySelector('.qrow-fill');
    if (fill) fill.style.width = it.shown.toFixed(1) + '%';
    const sub = row.querySelector('.qrow-sub');
    if (sub) {
      const eta = it.rate > 0 && it.shown < 99 ? ' · ' + fmtEta((100 - it.shown) / it.rate) : '';
      sub.textContent = `${it.stage || 'מעבד'} · ${Math.round(it.shown)}%${eta}`;
    }
  }
  raf = live ? requestAnimationFrame(animate) : null;
}
function ensureAnim() { if (!raf) raf = requestAnimationFrame(animate); }

window.api.onProgress((m) => {
  const it = item(m.id); if (!it) return;
  if (m.stopped) { it.status = 'paused'; it.sub = 'הופסק'; updateRow(it.id); updateSummary(); return; }
  if (!m.done) {
    const t = nowMs();
    if (it.status !== 'active') { it.status = 'active'; it.shown = 0; it.stage = ''; updateRow(it.id); }
    if (m.stage !== it.stage) {            // new stage -> restart rate measurement
      it.stage = m.stage; it.upP = m.percent; it.upT = t; it.rate = 0;
    } else if (m.percent > it.upP) {       // measured rate, smoothed (EMA)
      it.lastDelta = m.percent - it.upP;
      const inst = it.lastDelta / Math.max(0.05, (t - it.upT) / 1000);
      it.rate = it.rate > 0 ? it.rate * 0.5 + inst * 0.5 : inst;
      it.upP = m.percent; it.upT = t;
    }
    ensureAnim(); return;
  }
  if (m.ok) { it.status = 'done'; it.sub = 'הושלם'; it.target = it.shown = 100; it.outputs = m.outputs || []; }
  else { it.status = 'error'; it.sub = `נכשל · ${m.error || 'שגיאה'}`; it.target = it.shown = 100; }
  updateRow(it.id); updateSummary();
});
