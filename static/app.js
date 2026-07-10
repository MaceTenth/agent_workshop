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
let sessionCost  = 0;
let sessionCalls = 0;

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

function addSessionCost(cost) {
  sessionCalls += 1;
  sessionCost += (typeof cost === 'number' ? cost : 0);
  sessionCostEl.textContent = `$${sessionCost.toFixed(5)} · ${sessionCalls} call${sessionCalls !== 1 ? 's' : ''}`;
}
const banner          = document.getElementById('mode-banner');
const modeText    = document.getElementById('mode-text');
const stepBadge   = document.getElementById('step-badge');
const ctxPct      = document.getElementById('ctx-pct');
const ctxFill     = document.getElementById('ctx-bar-fill');
const ctxTokens   = document.getElementById('ctx-tokens');
let emptyState    = document.getElementById('empty-state');
const modelSelect = document.getElementById('model-select');

const CTX_LIMIT = 128000; // context meter scale (Claude supports up to 1M)

// Conversation history kept in JS — sent only when memory toggle is ON
let history   = [];
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

  // Agent mode takes priority — capabilities compose instead of being exclusive
  if (agentToggle.checked) {
    stepBadge.textContent = 'AGENT MODE';
    stepBadge.className    = 'step-badge tools';
    banner.className       = 'tools';
    const caps = [];
    if (tools)     caps.push('<code>tools</code>');
    if (webSearch) caps.push('<code>web_search</code>');
    if (rag)       caps.push('RAG');
    if (mem)       caps.push('memory');
    modeText.innerHTML = caps.length
      ? `<strong>Agent mode:</strong> the model can use ${caps.join(' + ')} together in a single agentic loop.`
      : '<strong>Agent mode:</strong> switch on capabilities above and the model will compose them in one loop.';
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
  // Tools and Web Search are mutually exclusive
  if (!agentToggle.checked && on && webSearchToggle.checked) {
    webSearchToggle.checked = false;
    webSearchStatus.textContent = 'OFF';
    webSearchStatus.className   = 'cap-status off';
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
      <span class="call-label">API Call #${currentCall}</span>
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
    const payload = { message: text, history: historySnap, tools_enabled: toolsOn, web_search_enabled: webSearchOn, rag_enabled: ragOn, agent_mode: agentOn, model: modelSelect.value };
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

    if (!res.ok) throw new Error(`Server error ${res.status}`);
    const data = await res.json();
    clearInterval(elapsedTimer);
    addSessionCost(data.cost_usd);

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
            <div class="web-search-preview" id="ws-preview-${currentCall}">${escapeHtml(preview)}${hasFull ? '…' : ''}</div>
            ${hasFull ? `<button class="web-search-toggle" onclick="toggleWebSearch(${currentCall})">&#9660; Show full context</button><div class="web-search-full" id="ws-full-${currentCall}" style="display:none">${escapeHtml(data.search_context)}</div>` : ''}
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

    document.querySelector(`#ai-bubble-${currentCall} .bubble-content`).innerHTML = marked.parse(data.response);

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
        `<pre class="peek-json">${escapeHtml(JSON.stringify(data.request_preview, null, 2))}</pre>`;
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

  } catch (err) {
    document.querySelector(`#ai-bubble-${currentCall} .bubble-content`).innerHTML =
      `<span style="color:#f87171">Error: ${escapeHtml(err.message)}</span>`;
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

// Initial render — show the stateless starter chips on load
renderChips();
