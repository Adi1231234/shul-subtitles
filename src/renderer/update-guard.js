'use strict';

// Blocking update screen. Visible by default; hides only when the check says
// there is nothing to do ("idle"). On "downloaded" the app restarts to install.
(function () {
  const guard = document.getElementById('update-guard');
  const msg = document.getElementById('ug-msg');
  const bar = document.getElementById('ug-bar');
  const fill = document.getElementById('ug-fill');

  function setBar(pct) {
    bar.classList.remove('hidden');
    fill.style.width = Math.max(0, Math.min(100, pct)).toFixed(0) + '%';
  }

  window.api.onUpdateStatus((s) => {
    switch (s.state) {
      case 'checking':
        msg.textContent = 'בודק עדכונים…'; bar.classList.add('hidden'); break;
      case 'available':
        msg.textContent = `נמצא עדכון${s.version ? ' ' + s.version : ''} · מתחיל הורדה…`; setBar(0); break;
      case 'downloading':
        msg.textContent = `מוריד עדכון… ${Math.round(s.percent || 0)}%`; setBar(s.percent || 0); break;
      case 'downloaded':
        msg.textContent = 'מתקין ומפעיל מחדש…'; setBar(100); break;
      default:
        guard.classList.add('hidden'); break;   // idle -> unblock the app
    }
  });

  window.api.checkUpdates();   // renderer is subscribed; start the check
})();
