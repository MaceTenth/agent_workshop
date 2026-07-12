const chatEl      = document.getElementById('chat');
const inputEl     = document.getElementById('message-input');
const sendBtn     = document.getElementById('send-btn');
const memToggle   = document.getElementById('memory-toggle');
const memStatus   = document.getElementById('memory-status');
const toolsToggle     = document.getElementById('tools-toggle');
const toolsStatus     = document.getElementById('tools-status');
const webSearchToggle = document.getElementById('websearch-toggle');
const webSearchStatus = document.getElementById('websearch-status');
const ragToggle       = document.getElementById('rag-toggle');
const ragStatus       = document.getElementById('rag-status');
const agentToggle     = document.getElementById('agent-toggle');
const agentStatus     = document.getElementById('agent-status');
const sessionCostEl   = document.getElementById('session-cost');
const chipsEl         = document.getElementById('prompt-chips');

// Running session totals (shown in the header)
let sessionCost   = 0;
let sessionCalls  = 0;
let sessionTokens = 0;

// Starter prompts shown as clickable chips, chosen by the active mode
const EXAMPLE_PROMPTS = {
  agent:      ["What is Karen Lopez's salary ÷ 12?", "Who earns the most, and what's their monthly pay?"],
  rag:        ["Who is the highest-paid engineer?", "List everyone in the HR department."],
  websearch:  ["What's the latest Claude model?", "Who is the current CEO of Anthropic?"],
  tools:      ["What is 137 × 24?", "What's the date and time right now?"],
  memory:     ["My name is Alex.", "What's my name?"],
  stateless:  ["Explain what an LLM is in one sentence.", "Write a haiku about databases."],
};

function currentMode() {
  if (agentToggle.checked)     return 'agent';
  if (ragToggle.checked)       return 'rag';
  if (webSearchToggle.checked) return 'websearch';
  if (toolsToggle.checked)     return 'tools';
  if (memToggle.checked)       return 'memory';
  return 'stateless';
}

function renderChips() {
  const prompts = EXAMPLE_PROMPTS[currentMode()] || [];
  chipsEl.innerHTML = '';
  for (const p of prompts) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = p;
    b.addEventListener('click', () => {
      inputEl.value = p;
      inputEl.focus();
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
    });
    chipsEl.appendChild(b);
  }
}

function fmtTokens(n) {
  return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
}

function addSessionCost(cost, tokens) {
  sessionCalls  += 1;
  sessionCost   += (typeof cost === 'number' ? cost : 0);
  sessionTokens += (typeof tokens === 'number' ? tokens : 0);
  sessionCostEl.textContent =
    `${fmtTokens(sessionTokens)} tok · $${sessionCost.toFixed(5)} · ${sessionCalls} call${sessionCalls !== 1 ? 's' : ''}`;
}

// A small "Copy" button that copies getText() to the clipboard
function makeCopyBtn(getText, label) {
  const b = document.createElement('button');
  b.className = 'copy-btn';
  b.textContent = label;
  b.addEventListener('click', (e) => {
    e.preventDefault();
    navigator.clipboard.writeText(getText()).then(() => {
      b.textContent = 'Copied!';
      setTimeout(() => { b.textContent = label; }, 1200);
    });
  });
  return b;
}

// Clear the conversation without a full page refresh
const clearBtn = document.getElementById('clear-btn');
const EMPTY_STATE_HTML =
  '<div id="empty-state"><div class="big-icon">💬</div>' +
  '<p>Send a message to make a stateless LLM call.<br/>Toggle Memory in the sidebar to see the difference.</p></div>';

clearBtn.addEventListener('click', () => {
  history = [];
  conversationLog = [];
  callCount = 0;
  chatEl.innerHTML = EMPTY_STATE_HTML;
  emptyState = document.getElementById('empty-state');
  resetCtxMeter();
  inputEl.focus();
});

// Escape HTML, then turn URLs into clickable links (for web-search context)
function linkify(str) {
  return escapeHtml(str).replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noopener" style="color:var(--accent-light,#a78bfa)">$1</a>'
  );
}

// Minimal JSON syntax highlighter for the peek panel. Run the regex on the
// RAW JSON (real quotes) and escape each matched token — escaping first would
// turn " into &quot; and the string/key matcher would never fire.
function highlightJson(obj) {
  const json = JSON.stringify(obj, null, 2);
  return json.replace(
    /("(\\.|[^"\\])*"(\s*:)?|\b(true|false|null)\b|-?\d+\.?\d*)/g,
    (m) => {
      let cls = 'tok-num';
      if (/^"/.test(m)) cls = /:$/.test(m) ? 'tok-key' : 'tok-str';
      else if (/true|false|null/.test(m)) cls = 'tok-bool';
      return `<span class="${cls}">${escapeHtml(m)}</span>`;
    }
  );
}

// ── Persist model + toggle selections across refreshes ──────────────
const STATE_KEY = 'agentWorkshopState';
function saveState() {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify({
      model: modelSelect.value, effort: effortSelect.value,
      memory: memToggle.checked, tools: toolsToggle.checked,
      web: webSearchToggle.checked, rag: ragToggle.checked, agent: agentToggle.checked,
    }));
  } catch (e) { /* localStorage unavailable — ignore */ }
}
function restoreState() {
  let s;
  try { s = JSON.parse(localStorage.getItem(STATE_KEY)); } catch (e) { return; }
  if (!s) return;
  if (s.model) modelSelect.value = s.model;
  if (s.effort) effortSelect.value = s.effort;
  syncEffort();
  const map = [
    [agentToggle, agentStatus, s.agent, 'ON — capabilities compose', 'OFF'],
    [memToggle, memStatus, s.memory, 'ON — stateful', 'OFF — stateless'],
    [toolsToggle, toolsStatus, s.tools, 'ON', 'OFF'],
    [webSearchToggle, webSearchStatus, s.web, 'ON', 'OFF'],
    [ragToggle, ragStatus, s.rag, 'ON', 'OFF'],
  ];
  for (const [tog, stat, val, onTxt, offTxt] of map) {
    tog.checked = !!val;
    stat.textContent = val ? onTxt : offTxt;
    stat.className = 'cap-status ' + (val ? 'on' : 'off');
  }
  updateUI();
}

// ── Export the conversation as Markdown ─────────────────────────────
const exportBtn = document.getElementById('export-btn');
exportBtn.addEventListener('click', () => {
  if (!conversationLog.length) return;
  let md = '# Agent Workshop conversation\n\n';
  for (const m of conversationLog) {
    md += `**${m.role === 'user' ? 'You' : 'AI'}:** ${m.content}\n\n`;
  }
  const blob = new Blob([md], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'agent-workshop-conversation.md';
  a.click();
  URL.revokeObjectURL(a.href);
});
const banner          = document.getElementById('mode-banner');
const modeText    = document.getElementById('mode-text');
const stepBadge   = document.getElementById('step-badge');
const ctxPct      = document.getElementById('ctx-pct');
const ctxFill     = document.getElementById('ctx-bar-fill');
const ctxTokens   = document.getElementById('ctx-tokens');
let emptyState    = document.getElementById('empty-state');
const modelSelect = document.getElementById('model-select');
const effortSelect = document.getElementById('effort-select');

// Only these Anthropic models accept output_config.effort — grey out the picker
// for anything else (Haiku 4.5 / OpenAI) so it can't be sent and 400.
const EFFORT_MODELS = ['claude-sonnet-5', 'claude-opus-4-8'];
function syncEffort() {
  const ok = EFFORT_MODELS.includes(modelSelect.value);
  effortSelect.disabled = !ok;
  const lbl = document.getElementById('effort-label');
  if (lbl) lbl.style.opacity = ok ? '1' : '0.4';
}

const CTX_LIMIT = 128000; // context meter scale (Claude supports up to 1M)

// Conversation history kept in JS — sent only when memory toggle is ON
let history   = [];
// Full transcript for the whole session (Export) — unlike `history`, this is
// NEVER reset when the Memory toggle changes, only when the user hits Clear.
let conversationLog = [];
let callCount = 0;

// ── Context meter helper ───────────────────────────
function updateCtxMeter(promptTokens) {
  const pct = Math.min(100, (promptTokens / CTX_LIMIT) * 100);
  ctxPct.textContent  = pct.toFixed(1) + '%';
  ctxFill.style.width = pct + '%';
  ctxFill.style.background = pct > 80 ? '#f87171' : pct > 50 ? 'var(--orange)' : 'var(--green)';
  ctxPct.style.color        = pct > 80 ? '#f87171' : pct > 50 ? 'var(--orange)' : 'var(--green)';
  ctxTokens.textContent = `${promptTokens.toLocaleString()} / 128k prompt tokens`;
}

function resetCtxMeter() {
  ctxPct.textContent  = '0%';
  ctxPct.style.color  = 'var(--green)';
  ctxFill.style.width = '0%';
  ctxFill.style.background = 'var(--green)';
  ctxTokens.textContent = '0 / 128k tokens';
}

// ── Shared badge + banner updater ──────────────────
function updateUI() {
  const mem       = memToggle.checked;
  const tools     = toolsToggle.checked;
  const webSearch = webSearchToggle.checked;
  const rag       = ragToggle.checked;

  renderChips();
  saveState();

  // Agent mode takes priority — capabilities compose instead of being exclusive
  if (agentToggle.checked) {
    const badgeCaps = [];
    if (tools)     badgeCaps.push('TOOLS');
    if (webSearch) badgeCaps.push('WEB');
    if (rag)       badgeCaps.push('RAG');
    if (mem)       badgeCaps.push('MEMORY');
    stepBadge.textContent = badgeCaps.length ? 'AGENT · ' + badgeCaps.join(' + ') : 'AGENT MODE';
    stepBadge.className    = 'step-badge tools';
    // The badge already lists the composed capabilities, so hide the banner
    // text in agent mode (the Clear button in the same bar stays).
    banner.className       = 'tools agent-collapsed';
    modeText.innerHTML     = '';
    return;
  }

  // Step badge
  if (rag) {
    stepBadge.textContent = rag && mem ? 'STEP 5 — MEMORY + RAG' : 'STEP 5 — RAG';
    stepBadge.className   = 'step-badge rag';
  } else if (webSearch) {
    stepBadge.textContent = webSearch && mem ? 'STEP 4 — MEMORY + WEB SEARCH' : 'STEP 4 — WEB SEARCH';
    stepBadge.className   = 'step-badge websearch';
  } else if (tools && mem) {
    stepBadge.textContent = 'STEP 3 — MEMORY + TOOLS';
    stepBadge.className   = 'step-badge tools';
  } else if (tools) {
    stepBadge.textContent = 'STEP 3 — TOOLS';
    stepBadge.className   = 'step-badge tools';
  } else if (mem) {
    stepBadge.textContent = 'STEP 2 — MEMORY';
    stepBadge.className   = 'step-badge stateful';
  } else {
    stepBadge.textContent = 'STEP 1 — STATELESS LLM';
    stepBadge.className   = 'step-badge stateless';
  }

  // Banner
  if (rag) {
    banner.className   = 'rag';
    modeText.innerHTML = '<strong>RAG on:</strong> Relevant employee records are retrieved by keyword and injected as context before your message.';
  } else if (webSearch) {
    banner.className   = 'websearch';
    modeText.innerHTML = '<strong>Web Search on:</strong> Claude\'s built-in <code>web_search</code> tool fetches live results, then feeds them into our LLM.';
  } else if (tools && mem) {
    banner.className   = 'tools';
    modeText.innerHTML = '<strong>Memory + Tools:</strong> Full history sent; model can also call tools.';
  } else if (tools) {
    banner.className   = 'tools';
    modeText.innerHTML = '<strong>Tools on:</strong> The model can call <code>get_datetime</code> and <code>calculate</code>.';
  } else if (mem) {
    banner.className   = 'stateful';
    modeText.innerHTML = '<strong>Memory on:</strong> Full conversation history is sent with every request.';
  } else {
    banner.className   = 'stateless';
    modeText.innerHTML = '<strong>Stateless mode:</strong> Each message is an independent API call — no history is sent.';
  }
}

// ── Memory toggle ──────────────────────────────────
memToggle.addEventListener('change', () => {
  const on = memToggle.checked;
  memStatus.textContent = on ? 'ON — stateful' : 'OFF — stateless';
  memStatus.className   = 'cap-status ' + (on ? 'on' : 'off');
  history = [];
  resetCtxMeter();
  updateUI();
});

// ── Tools toggle ───────────────────────────────────
toolsToggle.addEventListener('change', () => {
  const on = toolsToggle.checked;
  toolsStatus.textContent = on ? 'ON' : 'OFF';
  toolsStatus.className   = 'cap-status ' + (on ? 'on' : 'off');
  // Tools is mutually exclusive with Web Search and RAG (outside agent mode)
  if (!agentToggle.checked && on && webSearchToggle.checked) {
    webSearchToggle.checked = false;
    webSearchStatus.textContent = 'OFF';
    webSearchStatus.className   = 'cap-status off';
  }
  if (!agentToggle.checked && on && ragToggle.checked) {
    ragToggle.checked = false;
    ragStatus.textContent = 'OFF';
    ragStatus.className   = 'cap-status off';
  }
  updateUI();
});

// ── Web Search toggle ─────────────────────────────
webSearchToggle.addEventListener('change', () => {
  const on = webSearchToggle.checked;
  webSearchStatus.textContent = on ? 'ON' : 'OFF';
  webSearchStatus.className   = 'cap-status ' + (on ? 'on' : 'off');
  // Tools and Web Search are mutually exclusive
  if (!agentToggle.checked && on && toolsToggle.checked) {
    toolsToggle.checked = false;
    toolsStatus.textContent = 'OFF';
    toolsStatus.className   = 'cap-status off';
  }
  // Web Search and RAG are mutually exclusive
  if (!agentToggle.checked && on && ragToggle.checked) {
    ragToggle.checked = false;
    ragStatus.textContent = 'OFF';
    ragStatus.className   = 'cap-status off';
  }
  updateUI();
});

// ── RAG toggle ────────────────────────────────────
ragToggle.addEventListener('change', () => {
  const on = ragToggle.checked;
  ragStatus.textContent = on ? 'ON' : 'OFF';
  ragStatus.className   = 'cap-status ' + (on ? 'on' : 'off');
  // RAG is mutually exclusive with Tools and Web Search
  if (!agentToggle.checked && on && toolsToggle.checked) {
    toolsToggle.checked = false;
    toolsStatus.textContent = 'OFF';
    toolsStatus.className   = 'cap-status off';
  }
  if (!agentToggle.checked && on && webSearchToggle.checked) {
    webSearchToggle.checked = false;
    webSearchStatus.textContent = 'OFF';
    webSearchStatus.className   = 'cap-status off';
  }
  updateUI();
});

// ── Agent mode toggle (master switch) ──────────────
function syncCapStatuses() {
  toolsStatus.textContent = toolsToggle.checked ? 'ON' : 'OFF';
  toolsStatus.className    = 'cap-status ' + (toolsToggle.checked ? 'on' : 'off');
  webSearchStatus.textContent = webSearchToggle.checked ? 'ON' : 'OFF';
  webSearchStatus.className    = 'cap-status ' + (webSearchToggle.checked ? 'on' : 'off');
  ragStatus.textContent = ragToggle.checked ? 'ON' : 'OFF';
  ragStatus.className    = 'cap-status ' + (ragToggle.checked ? 'on' : 'off');
}

// When leaving agent mode, collapse back to one exclusive capability
// (priority: RAG > Web Search > Tools) so the isolated modes stay valid.
function enforceExclusive() {
  let kept = false;
  for (const t of [ragToggle, webSearchToggle, toolsToggle]) {
    if (t.checked) {
      if (kept) t.checked = false;
      else kept = true;
    }
  }
  syncCapStatuses();
}

agentToggle.addEventListener('change', () => {
  const on = agentToggle.checked;
  agentStatus.textContent = on ? 'ON — capabilities compose' : 'OFF';
  agentStatus.className    = 'cap-status ' + (on ? 'on' : 'off');
  if (!on) enforceExclusive();
  updateUI();
});

// ── Auto-resize textarea ───────────────────────────
inputEl.addEventListener('input', () => {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
});

inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

sendBtn.addEventListener('click', sendMessage);

// ── Send ───────────────────────────────────────────
async function sendMessage() {
  const text = inputEl.value.trim();
  if (!text || sendBtn.disabled) return;

  if (emptyState) { emptyState.remove(); emptyState = null; }

  callCount++;
  const currentCall = callCount;
  const memoryOn    = memToggle.checked;
  const historySnap = memoryOn ? [...history] : [];

  sendBtn.disabled = true;
  inputEl.disabled = true;
  inputEl.value    = '';
  inputEl.style.height = 'auto';

  const toolsOn     = toolsToggle.checked;
  const webSearchOn = webSearchToggle.checked;
  const ragOn       = ragToggle.checked;
  const agentOn     = agentToggle.checked;
  const tagClass = agentOn ? 'tools'
    : ragOn ? 'rag'
    : webSearchOn ? 'websearch'
    : toolsOn ? 'tools'
    : memoryOn ? 'stateful' : 'stateless';
  // historySnap has both user+assistant messages; +1 for the current user message
  const totalMsgs = historySnap.length + 1;
  const agentCaps = [
    toolsOn && 'Tools', webSearchOn && 'Web', ragOn && 'RAG', memoryOn && `${totalMsgs} msgs`,
  ].filter(Boolean).join(' + ');
  const tagLabel = agentOn
    ? (agentCaps ? `Agent · ${agentCaps}` : 'Agent')
    : ragOn
    ? (memoryOn ? `RAG + ${totalMsgs} msgs` : 'RAG')
    : webSearchOn
    ? 'Web Search'
    : toolsOn
      ? (memoryOn ? `Tools + ${totalMsgs} msgs` : 'Tools')
      : (memoryOn ? `${totalMsgs} msg${totalMsgs !== 1 ? 's' : ''} in context` : 'No history sent');

  const card = document.createElement('div');
  card.className = 'exchange';
  card.innerHTML = `
    <div class="exchange-header">
      <span class="call-label">API Call #${currentCall} <span class="call-time">${new Date().toLocaleTimeString()}</span></span>
      <div class="exchange-meta">
        <span class="ctx-tag ${tagClass}">${escapeHtml(tagLabel)}</span>
        <span class="tok-tag" id="tok-${currentCall}"></span>
        <span class="tok-tag" id="meta-${currentCall}"></span>
      </div>
    </div>
    <div class="bubble user">
      <span class="bubble-role">You</span>
      <span class="bubble-content">${escapeHtml(text)}</span>
    </div>
    <div class="bubble ai" id="ai-bubble-${currentCall}">
      <span class="bubble-role">AI</span>
      <span class="bubble-content">
        <div class="thinking"><span></span><span></span><span></span></div>
        <span class="elapsed-timer" id="elapsed-${currentCall}"></span>
      </span>
    </div>`;
  chatEl.appendChild(card);
  chatEl.scrollTop = chatEl.scrollHeight;

  // Live elapsed-time ticker so slow calls (agent, web search) don't look frozen
  const startT = performance.now();
  const elapsedEl = document.getElementById(`elapsed-${currentCall}`);
  const elapsedTimer = setInterval(() => {
    if (elapsedEl) elapsedEl.textContent = ' ' + ((performance.now() - startT) / 1000).toFixed(1) + 's…';
  }, 100);

  try {
    const payload = { message: text, history: historySnap, tools_enabled: toolsOn, web_search_enabled: webSearchOn, rag_enabled: ragOn, agent_mode: agentOn, model: modelSelect.value, effort: effortSelect.value || null };
    console.group(`%c📤 API Call #${currentCall} — REQUEST`, 'color:#a78bfa;font-weight:bold');
    console.log('%cUser message:', 'color:#93c5fd', text);
    console.log('%cHistory sent (%d messages):', 'color:#93c5fd', historySnap.length, historySnap);
    console.log('%cMode:', 'color:#93c5fd', ragOn ? 'RAG' : webSearchOn ? 'Web Search' : toolsOn ? 'Tools' : memoryOn ? 'Memory' : 'Stateless');
    console.groupEnd();

    const res = await fetch('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      let msg = `Request failed (${res.status}). Please try again.`;
      try { const e = await res.json(); if (e && e.error) msg = e.error; } catch (_) {}
      throw new Error(msg);
    }
    const data = await res.json();
    clearInterval(elapsedTimer);
    addSessionCost(data.cost_usd, data.usage && data.usage.total_tokens);

    // Inject tool call bubbles before the AI response
    if (data.tool_calls && data.tool_calls.length > 0) {
      const aiEl = document.getElementById(`ai-bubble-${currentCall}`);
      for (const tc of data.tool_calls) {
        const argsStr = Object.keys(tc.args).length
          ? Object.entries(tc.args).map(([k,v]) => `${k}: ${v}`).join(', ')
          : '';
        const toolEl = document.createElement('div');
        toolEl.className = 'bubble tool';
        toolEl.innerHTML = `
          <span class="bubble-role">TOOL</span>
          <span class="bubble-content">
            <div class="tool-call-info">
              <div class="tool-call-expr">${escapeHtml(tc.name)}(${escapeHtml(argsStr)})</div>
              <div class="tool-call-result">${escapeHtml(tc.result)}</div>
            </div>
          </span>`;
        card.insertBefore(toolEl, aiEl);
      }
    }

    // Inject web search context bubble
    if (data.search_context && webSearchOn) {
      const aiEl    = document.getElementById(`ai-bubble-${currentCall}`);
      const preview = data.search_context.slice(0, 400);
      const hasFull = data.search_context.length > 400;
      const webEl   = document.createElement('div');
      webEl.className = 'bubble web';
      webEl.innerHTML = `
        <span class="bubble-role">WEB</span>
        <span class="bubble-content">
          <div class="web-search-info">
            <div class="web-search-preview" id="ws-preview-${currentCall}">${linkify(preview)}${hasFull ? '…' : ''}</div>
            ${hasFull ? `<button class="web-search-toggle" onclick="toggleWebSearch(${currentCall})">&#9660; Show full context</button><div class="web-search-full" id="ws-full-${currentCall}" style="display:none">${linkify(data.search_context)}</div>` : ''}
          </div>
        </span>`;
      card.insertBefore(webEl, aiEl);
    }

    // Inject RAG context bubble
    if (data.rag_context && ragOn) {
      const aiEl  = document.getElementById(`ai-bubble-${currentCall}`);
      const ragEl = document.createElement('div');
      ragEl.className = 'bubble rag';
      ragEl.innerHTML = `
        <span class="bubble-role">RAG</span>
        <span class="bubble-content">
          <div class="rag-docs-info">
            <div class="rag-docs-content">${escapeHtml(data.rag_context)}</div>
          </div>
        </span>`;
      card.insertBefore(ragEl, aiEl);
    }

    const answer = (data.response && data.response.trim())
      ? data.response
      : '_(No text returned — the model may have declined this request.)_';
    document.querySelector(`#ai-bubble-${currentCall} .bubble-content`).innerHTML = marked.parse(answer);
    document.getElementById(`ai-bubble-${currentCall}`).appendChild(makeCopyBtn(() => data.response, 'Copy'));

    // Show token usage on the card header
    if (data.usage) {
      const tok = document.getElementById(`tok-${currentCall}`);
      if (tok) tok.textContent = `${data.usage.prompt_tokens.toLocaleString()} prompt tok`;
      if (memoryOn || toolsOn || webSearchOn || agentOn) updateCtxMeter(data.usage.prompt_tokens);
    }

    // Cost + latency + model badge
    const meta = document.getElementById(`meta-${currentCall}`);
    if (meta) {
      const bits = [];
      if (data.model) bits.push(data.model.replace('claude-', ''));
      if (typeof data.cost_usd === 'number') bits.push('$' + data.cost_usd.toFixed(5));
      if (typeof data.latency_ms === 'number') bits.push((data.latency_ms / 1000).toFixed(1) + 's');
      meta.textContent = bits.join(' · ');
    }

    // Peek under the hood — the actual request payload sent to Claude
    if (data.request_preview) {
      const det = document.createElement('details');
      det.className = 'peek';
      det.innerHTML =
        `<summary>🔍 Peek under the hood — request sent to Claude</summary>` +
        `<pre class="peek-json">${highlightJson(data.request_preview)}</pre>`;
      const pk = makeCopyBtn(() => JSON.stringify(data.request_preview, null, 2), 'Copy JSON');
      pk.classList.add('peek-copy');
      det.appendChild(pk);
      card.appendChild(det);
    }

    console.group(`%c📥 API Call #${currentCall} — RESPONSE`, 'color:#34d399;font-weight:bold');
    console.log('%cModel response:', 'color:#6ee7b7', data.response);
    if (data.usage) {
      const pct = ((data.usage.prompt_tokens / CTX_LIMIT) * 100).toFixed(1);
      console.log('%cToken usage:', 'color:#6ee7b7',
        `prompt=${data.usage.prompt_tokens.toLocaleString()}`,
        `| completion=${data.usage.completion_tokens.toLocaleString()}`,
        `| total=${data.usage.total_tokens.toLocaleString()}`,
        `| ctx window used=${pct}% of ${CTX_LIMIT.toLocaleString()}`);
      console.log('%cContext window breakdown:', 'color:#6ee7b7',
        `history (${historySnap.length} msgs) + current user msg = ${totalMsgs} msgs sent → ${data.usage.prompt_tokens} prompt tokens`);
    }
    console.groupEnd();

    // Always accumulate history so toggling memory mid-conversation works
    history.push({ role: 'user',      content: text });
    history.push({ role: 'assistant', content: data.response });
    // Export log is never cleared by the memory toggle — only by Clear.
    conversationLog.push({ role: 'user',      content: text });
    conversationLog.push({ role: 'assistant', content: data.response });

  } catch (err) {
    const content = document.querySelector(`#ai-bubble-${currentCall} .bubble-content`);
    content.innerHTML = `<span style="color:#f87171">⚠ ${escapeHtml(err.message)}</span> `;
    const retry = document.createElement('button');
    retry.className = 'retry-btn';
    retry.textContent = '↻ Retry';
    retry.addEventListener('click', () => { inputEl.value = text; sendMessage(); });
    content.appendChild(retry);
  } finally {
    clearInterval(elapsedTimer);
    sendBtn.disabled = false;
    inputEl.disabled = false;
    inputEl.focus();
    chatEl.scrollTop = chatEl.scrollHeight;
  }
}

function toggleWebSearch(call) {
  const preview = document.getElementById(`ws-preview-${call}`);
  const full    = document.getElementById(`ws-full-${call}`);
  const btn     = preview.closest('.web-search-info').querySelector('.web-search-toggle');
  const isHidden = full.style.display === 'none';
  full.style.display    = isHidden ? 'block' : 'none';
  preview.style.display = isHidden ? 'none'  : 'block';
  btn.textContent = isHidden ? '&#9650; Hide context' : '&#9660; Show full context';
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Save the model choice too, and restore everything on load
modelSelect.addEventListener('change', () => { syncEffort(); saveState(); });
effortSelect.addEventListener('change', saveState);
restoreState();
syncEffort();
updateUI();

// ── Provider API-key warning: fetch /config and grey out / warn about any
// provider that has no key configured in .env ───────────────────────────────
const keyWarningEl = document.getElementById('key-warning');

function updateKeyWarning(keyStatus) {
  const opt = modelSelect.selectedOptions[0];
  const provider = opt && opt.closest('optgroup') ? opt.closest('optgroup').label.toLowerCase() : null;
  const missing = provider && keyStatus && keyStatus[provider] === false;
  keyWarningEl.style.display = missing ? 'inline-block' : 'none';
  keyWarningEl.title = missing
    ? `No API key configured for ${opt.closest('optgroup').label}. Add it to your .env file to use this model.`
    : '';
}

fetch('/config')
  .then((r) => r.json())
  .then((cfg) => {
    for (const opt of modelSelect.options) {
      const provider = opt.closest('optgroup') ? opt.closest('optgroup').label.toLowerCase() : null;
      if (provider && cfg.keys && cfg.keys[provider] === false) {
        opt.textContent += ' (no API key)';
      }
    }
    updateKeyWarning(cfg.keys);
    modelSelect.addEventListener('change', () => updateKeyWarning(cfg.keys));
  })
  .catch(() => { /* /config unreachable — silently skip the warning banner */ });
