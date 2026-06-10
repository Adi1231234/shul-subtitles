'use strict';

// Translation-prompt editor dialog. Uses globals from app.js: $.

let defaultPrompt = '';
const promptModal = $('prompt-modal');

function openPrompt() {
  window.api.getPrompt().then(({ current, default: def }) => {
    defaultPrompt = def;
    $('prompt-text').value = current;
    promptModal.classList.remove('hidden');
    $('prompt-text').focus();
  });
}
function closePrompt() { promptModal.classList.add('hidden'); }

$('settings-btn').addEventListener('click', openPrompt);
$('prompt-close').addEventListener('click', closePrompt);
$('prompt-reset').addEventListener('click', () => { $('prompt-text').value = defaultPrompt; });
$('prompt-save').addEventListener('click', () => {
  window.api.setPrompt($('prompt-text').value).then(closePrompt);
});
promptModal.addEventListener('click', (e) => { if (e.target === promptModal) closePrompt(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePrompt(); });
