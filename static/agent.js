// agent.js — Stock analysis agent UI

const tickerInput = document.getElementById('ticker-input');
const runBtn      = document.getElementById('run-btn');

const emptyState   = document.getElementById('empty-state');
const loadingState = document.getElementById('loading-state');
const agentTrace   = document.getElementById('agent-trace');

// ── Chip clicks ───────────────────────────────────────────────────────────────
document.querySelectorAll('.chip').forEach(chip => {
  chip.addEventListener('click', () => {
    tickerInput.value = chip.dataset.ticker;
    tickerInput.focus();
  });
});

// ── Enter key ─────────────────────────────────────────────────────────────────
tickerInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') runAgent();
  tickerInput.value = tickerInput.value.toUpperCase();
});

runBtn.addEventListener('click', runAgent);

// ── Main agent function ───────────────────────────────────────────────────────
function showError(msg) {
  loadingState.classList.add('hidden');
  emptyState.classList.remove('hidden');
  emptyState.querySelector('.empty-title').textContent = '⚠️ ' + msg;
  runBtn.disabled = false;
}

async function runAgent() {
  const ticker = tickerInput.value.trim().toUpperCase();
  const risk_tolerance = document.getElementById('risk-select').value;
  const model = document.getElementById('model-select').value;
  if (!ticker) { tickerInput.focus(); return; }

  // --- Show loading with live status ---
  emptyState.classList.add('hidden');
  agentTrace.classList.add('hidden');
  loadingState.classList.remove('hidden');
  renderStatus([]);
  runBtn.disabled = true;

  // Start the run in the background
  let jobId;
  try {
    const res = await fetch('/agent/start', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ticker, risk_tolerance, model }),
    });
    if (!res.ok) {
      let msg = `Couldn't start the agent (HTTP ${res.status}).`;
      try { const e = await res.json(); if (e && e.error) msg = e.error; } catch (_) {}
      throw new Error(msg);
    }
    jobId = (await res.json()).job_id;
  } catch (err) {
    showError(err.message);
    return;
  }

  // Poll for progress until done
  let status = { progress: [], done: false };
  while (!status.done) {
    await delay(700);
    try {
      const sres = await fetch(`/agent/status/${jobId}`);
      status = await sres.json();
    } catch (e) { continue; }  // transient network — keep polling
    renderStatus(status.progress || []);
  }

  loadingState.classList.add('hidden');
  runBtn.disabled = false;

  if (status.error) { showError(status.error); return; }
  const data = status.result;

  // Clear previous run
  ['plan-list','exec-list','synthesis-content','verify-content','usage-footer'].forEach(id => {
    document.getElementById(id).innerHTML = '';
  });
  document.getElementById('plan-count').textContent = '';

  agentTrace.classList.remove('hidden');

  // Progressive reveal of the final result
  await renderPlan(data.plan, data.steps);
  await delay(200);
  await renderExecution(data.steps);
  await delay(200);
  renderSynthesis(data.synthesis);
  await delay(200);
  renderVerification(data.verification);
  renderUsage(data.usage, data.ticker);
}

// ── Live build status (while the agent runs) ──────────────────────────────────
function renderStatus(progress) {
  const has = (p) => progress.some(p);
  const planDone = has(e => e.phase === 'plan' && e.status === 'done');
  const planEv   = progress.find(e => e.phase === 'plan' && e.status === 'done');
  const tasks    = planEv ? planEv.tasks : [];
  const total    = planEv ? planEv.total : 5;

  const execDone = {}, execRunning = {}, execTool = {}, execTask = {};
  for (const e of progress) {
    if (e.phase !== 'exec') continue;
    if (e.status === 'done')    { execDone[e.step] = true; execTool[e.step] = e.tool_used; execTask[e.step] = e.task; }
    if (e.status === 'running') { execRunning[e.step] = true; execTask[e.step] = e.task; }
  }
  const synthRunning  = has(e => e.phase === 'synthesize' && e.status === 'running');
  const synthDone     = has(e => e.phase === 'synthesize' && e.status === 'done');
  const verifyRunning = has(e => e.phase === 'verify' && e.status === 'running');
  const verifyDone    = has(e => e.phase === 'verify' && e.status === 'done');

  const icon = (done, running) => done ? '✅' : running ? '<span class="bs-spin"></span>' : '⬜';
  const row = (done, running, label, sub, indent) =>
    `<div class="bs-row${indent ? ' indent' : ''}${running ? ' running' : ''}">
       <span class="bs-icon">${icon(done, running)}</span>
       <span class="bs-label">${label}</span>
       <span class="bs-sub">${sub}</span>
     </div>`;

  let html = '<div class="build-status"><div class="bs-title">🤖 Building the analysis…</div>';
  html += row(planDone, !planDone, 'Plan', planDone ? `${tasks.length} sub-tasks` : 'decomposing the task…', false);

  const nSteps = planDone ? tasks.length : total;
  for (let i = 1; i <= nSteps; i++) {
    const done = !!execDone[i];
    const running = !!execRunning[i] && !done;
    const label = escHtml(execTask[i] || tasks[i - 1] || `Step ${i}`);
    const tool = execTool[i];
    const sub = tool ? `🔧 ${escHtml(tool)}` : (done ? '💭 LLM only' : (running ? 'running…' : ''));
    html += row(done, running, `Step ${i}`, `${label}${sub ? ' · ' + sub : ''}`, true);
  }

  html += row(synthDone, synthRunning, 'Synthesize', synthDone ? 'summary written' : (synthRunning ? 'merging findings…' : ''), false);
  html += row(verifyDone, verifyRunning, 'Verify', verifyDone ? 'self-review complete' : (verifyRunning ? 'self-reviewing…' : ''), false);
  html += '</div>';
  loadingState.innerHTML = html;
}

// ── Phase 1: Plan ─────────────────────────────────────────────────────────────
async function renderPlan(plan, steps) {
  const list = document.getElementById('plan-list');
  document.getElementById('plan-count').textContent = `${plan.length} steps`;

  for (let i = 0; i < plan.length; i++) {
    const step = steps[i] || {};
    const hint = step.tool_used || 'none';

    let badgeClass = 'llm';
    let badgeText  = '💭 LLM';
    if (hint === 'get_datetime') { badgeClass = 'datetime';   badgeText = '🔧 datetime'; }
    if (hint === 'calculate')    { badgeClass = 'calculator'; badgeText = '🔧 calculate'; }
    if (hint === 'web_search')   { badgeClass = 'web-search'; badgeText = '🌐 web search'; }

    const item = document.createElement('div');
    item.className = 'plan-task';
    item.style.animationDelay = `${i * 60}ms`;
    item.innerHTML = `
      <div class="plan-num">${i + 1}</div>
      <div class="plan-task-text">${escHtml(plan[i])}</div>
      <span class="tool-badge ${badgeClass}">${badgeText}</span>
    `;
    list.appendChild(item);
    await delay(80);
  }
}

// ── Phase 2: Execute ──────────────────────────────────────────────────────────
async function renderExecution(steps) {
  const list = document.getElementById('exec-list');

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const hasTool = !!s.tool_used;

    let toolSection = '';
    if (hasTool) {
      let toolIcon = '🧮';
      if (s.tool_used === 'get_datetime') toolIcon = '🕒';
      if (s.tool_used === 'web_search') toolIcon = '🌐';
      toolSection = `
        <div class="exec-tool-call">
          <span class="exec-tool-name">${toolIcon} ${escHtml(s.tool_used)}</span>
          <span class="exec-tool-arrow">→</span>
          <span class="exec-tool-output">${escHtml(s.tool_result || '')}</span>
        </div>`;
    }

    const card = document.createElement('div');
    card.className = 'exec-step';
    card.innerHTML = `
      <div class="exec-step-header">
        <span class="exec-status">✅</span>
        <span class="exec-step-num">STEP ${i + 1}</span>
        <span class="exec-step-name">${escHtml(s.task)}</span>
        <span class="exec-tool-tag ${hasTool ? 'has-tool' : 'no-tool'}">
          ${hasTool ? '🔧 Tool used' : '💭 LLM only'}
        </span>
      </div>
      <div class="exec-step-body">
        ${toolSection}
        <div class="exec-result">${escHtml(s.result)}</div>
      </div>
    `;
    list.appendChild(card);
    await delay(150);
  }
}

// ── Phase 3: Synthesis ────────────────────────────────────────────────────────
function renderSynthesis(text) {
  const container = document.getElementById('synthesis-content');

  // Split into sections by **Header**
  const sectionTexts = text.split(/(?=\*\*[^*]+\*\*)/);

  for (const raw of sectionTexts) {
    if (!raw.trim()) continue;

    const headerMatch = raw.match(/^\*\*([^*]+)\*\*/);
    const label  = headerMatch ? headerMatch[1] : null;
    const body   = headerMatch ? raw.slice(headerMatch[0].length).trim() : raw.trim();

    if (!label) continue;

    const isRec = label.toLowerCase().includes('recommendation');
    const div = document.createElement('div');
    div.className = 'synth-section';

    if (isRec) {
      const verdict = body.match(/\b(BUY|HOLD|SELL)\b/i);
      const recClass = verdict ? verdict[1].toLowerCase() : 'hold';
      div.innerHTML = `
        <div class="synth-label">${escHtml(label)}</div>
        <div class="recommendation-box">
          <div class="rec-verdict ${recClass}">${verdict ? verdict[1] : ''}</div>
          <div class="rec-rationale">${escHtml(body.replace(/\b(BUY|HOLD|SELL)\b\s*[—–-]?\s*/i, ''))}</div>
        </div>`;
    } else {
      // Render bullet points if lines start with -
      const lines = body.split('\n').map(l => l.trim()).filter(Boolean);
      const hasBullets = lines.some(l => l.startsWith('-') || l.startsWith('•'));
      let bodyHtml;
      if (hasBullets) {
        const items = lines
          .filter(l => l.startsWith('-') || l.startsWith('•'))
          .map(l => `<li>${escHtml(l.replace(/^[-•]\s*/, ''))}</li>`)
          .join('');
        bodyHtml = `<ul>${items}</ul>`;
      } else {
        bodyHtml = escHtml(body);
      }
      div.innerHTML = `
        <div class="synth-label">${escHtml(label)}</div>
        <div class="synth-body">${bodyHtml}</div>`;
    }

    container.appendChild(div);
  }
}

// ── Phase 4: Verification ─────────────────────────────────────────────────────
function renderVerification(v) {
  const container = document.getElementById('verify-content');
  const confidence = Math.round((v.confidence || 0) * 100);
  const comp = (v.completeness || 'medium').toLowerCase();
  const passed = v.passed !== false;

  container.innerHTML = `
    <div class="verify-metrics">
      <div class="verify-metric">
        <span class="metric-label">Completeness</span>
        <span class="metric-value ${comp}">${comp.toUpperCase()}</span>
      </div>
      <div class="verify-metric">
        <span class="metric-label">Confidence</span>
        <span class="metric-value pct">${confidence}%</span>
        <div class="confidence-bar-wrap">
          <div class="confidence-bar" style="width:${confidence}%"></div>
        </div>
      </div>
      <div class="verify-metric">
        <span class="metric-label">QA Check</span>
        <span class="metric-value ${passed ? 'pass' : 'fail'}">${passed ? '✓ PASSED' : '✗ FAILED'}</span>
      </div>
    </div>
    ${renderCaveats(v.caveats || [])}
  `;
}

function renderCaveats(caveats) {
  if (!caveats.length) return '';
  const items = caveats.map(c => `<div class="caveat-item">${escHtml(c)}</div>`).join('');
  return `<div class="verify-caveats">
    <div class="verify-caveats-label">Caveats</div>
    ${items}
  </div>`;
}

// ── Usage footer ──────────────────────────────────────────────────────────────
function renderUsage(usage, ticker) {
  const total = (usage.prompt_tokens || 0) + (usage.completion_tokens || 0);
  document.getElementById('usage-footer').textContent =
    `${ticker} analysis — ${usage.prompt_tokens} prompt + ${usage.completion_tokens} completion = ${total} tokens`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Provider API-key warning: fetch /config and warn if the selected
// provider's key isn't set in .env ────────────────────────────────────────
const modelSelectEl = document.getElementById('model-select');
const keyWarningEl  = document.getElementById('key-warning');

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
