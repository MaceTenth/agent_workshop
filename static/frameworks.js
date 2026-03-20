// frameworks.js — TOC navigation + example selectors

const tocEl   = document.getElementById('fw-toc');
const mainEl  = document.getElementById('fw-main');
const screens = document.querySelectorAll('.lesson-section');

function showTOC() {
  tocEl.style.display  = '';
  mainEl.style.display = 'none';
  history.pushState(null, '', location.pathname);
}

function showScreen(id) {
  tocEl.style.display  = 'none';
  mainEl.style.display = '';
  screens.forEach(s => s.classList.remove('active'));
  const target = document.getElementById('lesson-' + id);
  if (target) target.classList.add('active');
  history.pushState(null, '', location.pathname + '#' + id);
}

// TOC card clicks
document.querySelectorAll('.fw-toc-card').forEach(card => {
  card.addEventListener('click', () => showScreen(card.dataset.screen));
});

// Back-to-TOC buttons
document.querySelectorAll('.fw-back-btn').forEach(btn => {
  btn.addEventListener('click', showTOC);
});

// Browser back / forward support
window.addEventListener('popstate', () => {
  const h = location.hash.slice(1);
  if (!h) showTOC();
  else     showScreen(h);
});

// Initial state — respect URL hash on load
const initialHash = location.hash.slice(1);
if (initialHash && document.getElementById('lesson-' + initialHash)) {
  showScreen(initialHash);
} else {
  showTOC();
}

// ── Example selector (LangChain + CrewAI sub-tabs) ────────────────────────────
document.querySelectorAll('.example-selector').forEach(selector => {
  selector.querySelectorAll('.ex-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selector.querySelectorAll('.ex-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const parentSection = selector.closest('.lesson-section');
      parentSection.querySelectorAll('.code-compare').forEach(p => p.classList.remove('active'));
      const target = parentSection.querySelector('#ex-' + btn.dataset.ex);
      if (target) target.classList.add('active');
    });
  });
});
