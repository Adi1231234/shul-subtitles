'use strict';

// Queue-row rendering. Globals consumed by app.js: base, rightHtml, rowHtml.
const base = (p) => p.split(/[\\/]/).pop();

const SVG = {
  film: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9.5h18M8 5v4.5M16 5v4.5" stroke-linecap="round"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12.5l4 4 10-10" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 8v5" stroke-linecap="round"/><circle cx="12" cy="16.5" r="1" fill="currentColor" stroke="none"/><path d="M10.3 4l-7 12A2 2 0 0 0 5 19h14a2 2 0 0 0 1.7-3l-7-12a2 2 0 0 0-3.4 0z" stroke-linejoin="round"/></svg>',
  stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="2.5"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>',
};

function rightHtml(it) {
  if (it.status === 'active') return `<button class="iconbtn stop" data-stop="${it.id}" title="עצור">${SVG.stop}</button>`;
  let h = '';
  if (it.status === 'paused') h += `<button class="iconbtn play" data-resume="${it.id}" title="המשך">${SVG.play}</button>`;
  if (it.status === 'error') h += `<button class="btn" data-resume="${it.id}">נסה שוב</button>`;
  if (it.status === 'done') h += it.outputs.map((o, k) => `<button class="btn" data-open="${it.id}:${k}">${o.endsWith('.srt') ? 'פתח כתוביות' : 'פתח וידאו'}</button>`).join('');
  return h + `<button class="remove" data-rm="${it.id}" title="הסר">✕</button>`;
}

function rowHtml(it) {
  const ico = it.status === 'done' ? SVG.check : it.status === 'error' ? SVG.alert : SVG.film;
  const sub = it.sub || (it.status === 'paused' ? 'הופסק' : 'מוכן לעיבוד');
  return `<li class="qrow ${it.status}" id="row-${it.id}"><div class="qrow-main">
    <span class="qrow-ico">${ico}</span>
    <div class="qrow-body"><span class="qrow-name">${base(it.path)}</span><span class="qrow-sub">${sub}</span></div>
    <div class="qrow-right">${rightHtml(it)}</div></div>
    <div class="qrow-bar"><div class="qrow-fill" style="width:${it.shown}%"></div></div></li>`;
}
