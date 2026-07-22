// planning.js — interactive demos for the Planning & Prompt Engineering page

// ── Tab switching ─────────────────────────────────────────────────────────────
document.querySelectorAll('.lesson-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.lesson-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.lesson-section').forEach(s => s.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('lesson-' + tab.dataset.lesson).classList.add('active');
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function loadingDots() {
  return '<div class="loading-dots"><span></span><span></span><span></span></div>';
}

async function callPlan(task, mode) {
  const model = document.getElementById('model-select').value;
  const effort = document.getElementById('effort-select').value || null;
  const res = await fetch('/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task, mode, model, effort }),
  });
  if (!res.ok) {
    let msg = `Server error ${res.status}`;
    try { const e = await res.json(); if (e && e.error) msg = e.error; } catch (_) {}
    throw new Error(msg);
  }
  return res.json();
}

// ── Lesson 1: Prompt Engineering ─────────────────────────────────────────────
const peInput  = document.getElementById('pe-input');
const peRunBtn = document.getElementById('pe-run-btn');
const peZero   = document.getElementById('pe-zero');
const peFew    = document.getElementById('pe-few');
const peCot    = document.getElementById('pe-cot');

peRunBtn.addEventListener('click', async () => {
  const question = peInput.value.trim();
  if (!question) return;

  peRunBtn.disabled = true;

  // Show loading state in all three columns
  for (const el of [peZero, peFew, peCot]) {
    el.className = 'comp-body';
    el.innerHTML = loadingDots();
  }

  // Fire all three requests in parallel
  const [zeroRes, fewRes, cotRes] = await Promise.allSettled([
    callPlan(question, 'zero_shot'),
    callPlan(question, 'few_shot'),
    callPlan(question, 'cot'),
  ]);

  const render = (el, result) => {
    if (result.status === 'fulfilled') {
      el.className = 'comp-body';
      el.textContent = result.value.content;
    } else {
      el.className = 'comp-body';
      el.innerHTML = `<span style="color:#f87171">Error: ${escapeHtml(result.reason.message)}</span>`;
    }
  };

  render(peZero, zeroRes);
  render(peFew,  fewRes);
  render(peCot,  cotRes);

  peRunBtn.disabled = false;
});

// ── Lesson 2: Task Decomposition ─────────────────────────────────────────────
const dcInput  = document.getElementById('dc-input');
const dcRunBtn = document.getElementById('dc-run-btn');
const dcResult = document.getElementById('dc-result');

dcRunBtn.addEventListener('click', async () => {
  const task = dcInput.value.trim();
  if (!task) return;

  dcRunBtn.disabled = true;
  dcResult.classList.remove('hidden');
  dcResult.innerHTML = `<div style="padding:16px">${loadingDots()}</div>`;

  try {
    const data = await callPlan(task, 'decompose');
    renderDecompose(data);
  } catch (err) {
    dcResult.innerHTML = `<div style="padding:16px;color:#f87171">Error: ${escapeHtml(err.message)}</div>`;
  }

  dcRunBtn.disabled = false;
});

function renderDecompose(data) {
  const steps = data.steps || [];

  // Extract the REASONING block
  const reasonMatch = data.content.match(/REASONING[:\s]+([\s\S]+)/i);
  const reasoning   = reasonMatch ? reasonMatch[1].trim() : '';

  let stepsHtml = '';
  steps.forEach((step, i) => {
    stepsHtml += `
      <div class="decompose-step">
        <div class="step-num">${i + 1}</div>
        <div class="step-text">${escapeHtml(step)}</div>
      </div>`;
  });

  // Fallback: raw content if parsing produced nothing
  if (!stepsHtml) {
    stepsHtml = `<div style="padding:12px;white-space:pre-wrap;font-size:13px;line-height:1.6">${escapeHtml(data.content)}</div>`;
  }

  dcResult.innerHTML = `
    <div class="decompose-steps">${stepsHtml}</div>
    ${reasoning ? `<div class="decompose-reasoning"><strong>Reasoning:</strong> ${escapeHtml(reasoning)}</div>` : ''}`;
}

// ── Lesson 3: ReAct Loop ──────────────────────────────────────────────────────
const reactInput  = document.getElementById('react-input');
const reactRunBtn = document.getElementById('react-run-btn');
const reactResult = document.getElementById('react-result');

const REACT_ICONS  = { think: '💭', act: '⚡', observe: '👁', answer: '✅' };
const REACT_LABELS = { think: 'Thought', act: 'Action', observe: 'Observation', answer: 'Final Answer' };

reactRunBtn.addEventListener('click', async () => {
  const task = reactInput.value.trim();
  if (!task) return;

  reactRunBtn.disabled = true;
  reactResult.classList.remove('hidden');
  reactResult.innerHTML = loadingDots();

  try {
    const data = await callPlan(task, 'react');
    renderReact(data.steps || []);
  } catch (err) {
    reactResult.innerHTML = `<span style="color:#f87171">Error: ${escapeHtml(err.message)}</span>`;
  }

  reactRunBtn.disabled = false;
});

function renderReact(steps) {
  if (!steps.length) {
    reactResult.innerHTML = '<span style="color:var(--text-muted)">No steps returned — try rephrasing the question.</span>';
    return;
  }

  reactResult.innerHTML = steps.map(step => `
    <div class="react-step ${escapeHtml(step.type)}">
      <div class="react-step-icon">${REACT_ICONS[step.type] || '•'}</div>
      <div style="flex:1">
        <div class="react-step-type">${escapeHtml(REACT_LABELS[step.type] || step.type)}</div>
        <div class="react-step-content">${escapeHtml(step.content)}</div>
      </div>
    </div>`).join('');
}

// ── Provider API-key warning: fetch /config and warn if the selected
// provider's key isn't set in .env ────────────────────────────────────────
(function () {
  const modelSelectEl = document.getElementById('model-select');
  const keyWarningEl  = document.getElementById('key-warning');
  if (!modelSelectEl || !keyWarningEl) return;

  function updateKeyWarning(keyStatus) {
    const opt = modelSelectEl.selectedOptions[0];
    const provider = opt && opt.closest('optgroup') ? opt.closest('optgroup').label.toLowerCase() : null;
    const missing = provider && keyStatus && keyStatus[provider] === false;
    keyWarningEl.style.display = missing ? 'inline-block' : 'none';
  }

  fetch('/config')
    .then((r) => r.json())
    .then((cfg) => {
      updateKeyWarning(cfg.keys);
      modelSelectEl.addEventListener('change', () => updateKeyWarning(cfg.keys));
    })
    .catch(() => { /* /config unreachable — silently skip the warning banner */ });
})();

// ── Effort picker: only Anthropic Sonnet 5 / Opus 4.8 accept output_config.effort;
// grey it out for anything else so it can't be sent and 400. ─────────────────
(function () {
  const modelSelectEl = document.getElementById('model-select');
  const effortSelectEl = document.getElementById('effort-select');
  const effortLabelEl = document.getElementById('effort-label');
  if (!modelSelectEl || !effortSelectEl) return;
  const EFFORT_MODELS = ['claude-sonnet-5', 'claude-opus-4-8'];
  function sync() {
    const ok = EFFORT_MODELS.includes(modelSelectEl.value);
    effortSelectEl.disabled = !ok;
    if (effortLabelEl) effortLabelEl.style.opacity = ok ? '1' : '0.4';
  }
  modelSelectEl.addEventListener('change', sync);
  sync();
})();
