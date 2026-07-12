// Tokenizer playground.
//  • OpenAI tokenization → gpt-tokenizer BPE lib, fully in-browser (4 encodings).
//  • Open models (DeepSeek, Qwen, Llama, Mistral, GLM) → their real HuggingFace
//    tokenizers, loaded on demand via @huggingface/transformers (Transformers.js).
//  • Claude → backend /count_tokens (Anthropic exposes only the count).

import { encode as encO200,  decode as decO200  } from 'https://esm.sh/gpt-tokenizer/encoding/o200k_base';
import { encode as encCl100, decode as decCl100 } from 'https://esm.sh/gpt-tokenizer/encoding/cl100k_base';
import { encode as encP50,   decode as decP50   } from 'https://esm.sh/gpt-tokenizer/encoding/p50k_base';
import { encode as encR50,   decode as decR50   } from 'https://esm.sh/gpt-tokenizer/encoding/r50k_base';

const ENC = {
  o200k_base:  { encode: encO200,  decode: decO200  },
  cl100k_base: { encode: encCl100, decode: decCl100 },
  p50k_base:   { encode: encP50,   decode: decP50   },
  r50k_base:   { encode: encR50,   decode: decR50   },
};

// Selectable models. `enc` = client BPE encoding; `hf` = HuggingFace repo loaded
// via Transformers.js; `api` = Claude model id passed to /count_tokens.
const MODELS = [
  { id: 'gpt-4o',        label: 'GPT-4o',              provider: 'OpenAI',      enc: 'o200k_base'  },
  { id: 'gpt-4.1',       label: 'GPT-4.1',             provider: 'OpenAI',      enc: 'o200k_base'  },
  { id: 'gpt-4o-mini',   label: 'GPT-4o mini',         provider: 'OpenAI',      enc: 'o200k_base'  },
  { id: 'o3',            label: 'o3 / o1 (reasoning)', provider: 'OpenAI',      enc: 'o200k_base'  },
  { id: 'gpt-4-turbo',   label: 'GPT-4 Turbo',         provider: 'OpenAI',      enc: 'cl100k_base' },
  { id: 'gpt-4',         label: 'GPT-4',               provider: 'OpenAI',      enc: 'cl100k_base' },
  { id: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo',       provider: 'OpenAI',      enc: 'cl100k_base' },
  { id: 'codex',         label: 'Codex · davinci-002', provider: 'OpenAI',      enc: 'p50k_base'   },
  { id: 'gpt-2',         label: 'GPT-2 · GPT-3',       provider: 'OpenAI',      enc: 'r50k_base'   },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5',   provider: 'Anthropic',   api: 'claude-sonnet-5' },
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8',   provider: 'Anthropic',   api: 'claude-opus-4-8' },
  { id: 'claude-haiku-4-5',label: 'Claude Haiku 4.5',  provider: 'Anthropic',   api: 'claude-haiku-4-5' },
  { id: 'deepseek-v3', label: 'DeepSeek-V3',    provider: 'Open models', hf: 'deepseek-ai/DeepSeek-V3' },
  { id: 'qwen2.5',     label: 'Qwen2.5',        provider: 'Open models', hf: 'Qwen/Qwen2.5-7B-Instruct' },
  { id: 'qwen3',       label: 'Qwen3',          provider: 'Open models', hf: 'Qwen/Qwen3-8B' },
  { id: 'llama-3.1',   label: 'Llama 3.1',      provider: 'Open models', hf: 'NousResearch/Meta-Llama-3.1-8B' },
  { id: 'mistral-0.3', label: 'Mistral v0.3',   provider: 'Open models', hf: 'unsloth/mistral-7b-instruct-v0.3' },
  { id: 'glm-4',       label: 'GLM-4',          provider: 'Open models', hf: 'THUDM/glm-4-9b-chat-hf' },
];
const MODEL_BY_ID = Object.fromEntries(MODELS.map((m) => [m.id, m]));

// Distinct tokenizers for the comparison table.
const TOKENIZERS = [
  { key: 'o200k',  kind: 'gpt',    enc: 'o200k_base',  name: 'o200k_base',       models: 'GPT-4o, 4.1, o1/o3' },
  { key: 'cl100k', kind: 'gpt',    enc: 'cl100k_base', name: 'cl100k_base',      models: 'GPT-4, 3.5-Turbo' },
  { key: 'p50k',   kind: 'gpt',    enc: 'p50k_base',   name: 'p50k_base',        models: 'Codex, davinci-002' },
  { key: 'r50k',   kind: 'gpt',    enc: 'r50k_base',   name: 'r50k_base (gpt2)', models: 'GPT-3 davinci, GPT-2' },
  { key: 'cl-new', kind: 'claude', api: 'claude-sonnet-5',  name: 'Claude 4.x',   models: 'Sonnet 5, Opus 4.8/4.7' },
  { key: 'cl-hk',  kind: 'claude', api: 'claude-haiku-4-5', name: 'Claude Haiku', models: 'Haiku 4.5' },
  { key: 'ds',     kind: 'hf', hf: 'deepseek-ai/DeepSeek-V3',            name: 'DeepSeek',    models: 'DeepSeek-V3 / R1' },
  { key: 'qw25',   kind: 'hf', hf: 'Qwen/Qwen2.5-7B-Instruct',          name: 'Qwen 2.5',    models: 'Qwen2.5 family' },
  { key: 'qw3',    kind: 'hf', hf: 'Qwen/Qwen3-8B',                     name: 'Qwen 3',      models: 'Qwen3 family' },
  { key: 'llama',  kind: 'hf', hf: 'NousResearch/Meta-Llama-3.1-8B',    name: 'Llama 3',     models: 'Llama 3 / 3.1' },
  { key: 'mistral',kind: 'hf', hf: 'unsloth/mistral-7b-instruct-v0.3',  name: 'Mistral',     models: 'Mistral v0.3' },
  { key: 'glm',    kind: 'hf', hf: 'THUDM/glm-4-9b-chat-hf',            name: 'GLM-4',       models: 'GLM-4 family' },
];

// Diverse example snippets.
const EXAMPLES = {
  Prose: "The tokenizer doesn't see words the way you do. It sees statistical fragments learned from billions of documents — sometimes a whole word, sometimes a single letter, occasionally a chunk shared across languages.",
  Code: "def fibonacci(n: int) -> list[int]:\n    seq = [0, 1]\n    while len(seq) < n:\n        seq.append(seq[-1] + seq[-2])\n    return seq[:n]\n\nprint(fibonacci(10))",
  Math: "Let f(x) = ∫₀^∞ e^(-x²) dx = √π / 2.\nSolve: 3x² − 12x + 9 = 0  ⇒  x ∈ {1, 3}.\nΣ_{n=1}^{100} n = 5050,  π ≈ 3.14159265358979.",
  JSON: '{\n  "user": {"id": 42, "name": "Ada", "active": true},\n  "roles": ["admin", "editor"],\n  "score": 98.6,\n  "meta": null\n}',
  Chinese: "大语言模型把文本切成词元（token）。中文通常按字或词切分，同一句话在不同模型下的词元数差别很大。",
  Multilingual: "English · العربية · Русский · 日本語 · 한국어 · Ελληνικά · हिन्दी · עברית · Português",
  Emoji: "Ship it 🚀🔥 — 100% 👍. Family: 👨‍👩‍👧‍👦. Flags: 🇺🇸🇯🇵🇧🇷. Skin tones: 👋🏽👋🏿. Mixed: café ☕ + 🥐 = 😋",
  Numbers: "Order #100493-A, SKU 0xFF3A9C, $1,234,567.89 on 2026-07-11T14:03:59Z. Phone +1 (415) 555-0142. UUID a1b2c3d4-e5f6.",
  Whitespace: "function\tindent() {\n\t\treturn [\n\t\t\t'tabs',\n            'and',\n            'spaces',\n\t\t];\n}",
};

const $ = (id) => document.getElementById(id);
const input   = $('tok-input');
const vizEl    = $('tok-viz');
const modelSel = $('tok-model');
const cmpBody  = $('cmp-body');
const cmpNote  = $('cmp-note');

let curView = 'text';
let hasClaudeKey = false;

const PALETTE = ['#f4a7a7', '#f7cf9c', '#cdeea0', '#a4e6ea', '#bcb6f2',
                 '#f2b4e0', '#a8eecb', '#eddc9c', '#a9c8f2', '#e6b0f2'];

// ── HuggingFace tokenizers via Transformers.js (loaded once, on demand) ───────
const HF = {};            // repo -> { status:'loading'|'ready'|'error', tok }
let _transformers = null;
function loadTransformers() {
  if (!_transformers) {
    _transformers = import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.5/dist/transformers.min.js')
      .then((m) => { m.env.allowLocalModels = false; return m.AutoTokenizer; });
  }
  return _transformers;
}
function loadHF(repo) {
  if (HF[repo]) return HF[repo].promise;
  const entry = HF[repo] = { status: 'loading', tok: null };
  entry.promise = loadTransformers()
    .then((AutoTokenizer) => AutoTokenizer.from_pretrained(repo))
    .then((tok) => { entry.status = 'ready'; entry.tok = tok; scheduleRerender(); return tok; })
    .catch((err) => { entry.status = 'error'; console.warn('HF load failed:', repo, err); scheduleRerender(); });
  return entry.promise;
}
function hfEncode(tok, text) {
  if (!text) return [];
  try { return tok.encode(text, { add_special_tokens: false }); }
  catch { try { return tok.encode(text); } catch { return []; } }
}
let rerenderTimer = null;
function scheduleRerender() { clearTimeout(rerenderTimer); rerenderTimer = setTimeout(render, 30); }

// ── Rendering helpers ────────────────────────────────────────────────────────
function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function renderPiece(s) {
  return escapeHtml(s)
    .replace(/\n/g, '<span class="nl">⏎</span>\n')
    .replace(/\t/g, '<span class="nl">⇥</span>\t');
}
function setStats(chars, nTok) {
  $('stat-chars').textContent = chars.toLocaleString();
  if (nTok === 'pending') { $('stat-tokens').textContent = '…'; $('stat-ratio').textContent = '—'; }
  else {
    $('stat-tokens').textContent = (nTok ?? 0).toLocaleString();
    $('stat-ratio').textContent  = nTok ? (chars / nTok).toFixed(2) : '—';
  }
}
function safeDecode(decode, id) {
  try { return decode([id]); } catch { return '�'; }
}
function renderTokens(ids, decode) {
  if (!ids.length) { vizEl.innerHTML = '<span class="tok-empty">Tokens appear here…</span>'; return; }
  vizEl.innerHTML = ids.map((id, i) => {
    const piece = safeDecode(decode, id);
    if (curView === 'ids') return `<span class="tok id-view" title="${escapeHtml(piece)}">${id}</span>`;
    return `<span class="tok" style="background:${PALETTE[i % PALETTE.length]}" title="id ${id}">${renderPiece(piece)}</span>`;
  }).join('');
}
function vizMessage(msg) { vizEl.innerHTML = `<span class="tok-empty">${msg}</span>`; }

// ── Main render (selected model → stats + visualization) ─────────────────────
let selSeq = 0;

function render() {
  const text = input.value;
  const chars = [...text].length;
  const model = MODEL_BY_ID[modelSel.value];
  $('tok-viz-model').textContent = `(${model.label})`;

  if (model.enc) {
    const { encode, decode } = ENC[model.enc];
    const ids = text ? encode(text) : [];
    setStats(chars, ids.length);
    renderTokens(ids, decode);
  } else if (model.hf) {
    const entry = HF[model.hf];
    if (!entry || entry.status === 'loading') {
      loadHF(model.hf);
      setStats(chars, 'pending');
      vizMessage(`Loading the <strong>${model.label}</strong> tokenizer… (first use downloads its vocabulary from HuggingFace)`);
    } else if (entry.status === 'error') {
      setStats(chars, null);
      vizMessage(`Couldn't load the ${model.label} tokenizer (offline or blocked).`);
    } else {
      const ids = hfEncode(entry.tok, text);
      setStats(chars, ids.length);
      renderTokens(ids, (a) => entry.tok.decode(a));
    }
  } else { // Claude — count only
    const seq = ++selSeq;
    vizMessage("Claude doesn't expose token pieces — only a count (shown above &amp; in the table). Pick a GPT or open model to see the segments.");
    if (!text.trim()) setStats(chars, 0);
    else if (!hasClaudeKey) setStats(chars, null);
    else {
      setStats(chars, 'pending');
      countClaude(text, model.api)
        .then((n) => { if (seq === selSeq) setStats(chars, n); })
        .catch(() => { if (seq === selSeq) setStats(chars, null); });
    }
  }
  renderComparison(text);
}

// ── Comparison table (every tokenizer) ───────────────────────────────────────
let cmpSeq = 0;

function renderComparison(text) {
  const counts = {};
  const pending = {};

  for (const t of TOKENIZERS) {
    if (t.kind === 'gpt') { counts[t.key] = text ? ENC[t.enc].encode(text).length : 0; continue; }
    if (t.kind === 'hf') {
      const e = HF[t.hf];
      if (!text.trim()) counts[t.key] = 0;
      else if (!e) { loadHF(t.hf); pending[t.key] = true; }
      else if (e.status === 'ready') counts[t.key] = hfEncode(e.tok, text).length;
      else if (e.status === 'error') counts[t.key] = null;
      else pending[t.key] = true;
    }
  }

  const seq = ++cmpSeq;
  const claudeRows = TOKENIZERS.filter((t) => t.kind === 'claude');
  if (!text.trim()) claudeRows.forEach((t) => (counts[t.key] = 0));
  else if (!hasClaudeKey) claudeRows.forEach((t) => (counts[t.key] = null));
  else {
    claudeRows.forEach((t) => { pending[t.key] = true; });
    claudeRows.forEach((t) => {
      countClaude(text, t.api).then((n) => finish(t.key, n)).catch(() => finish(t.key, null));
    });
  }
  function finish(key, n) {
    if (seq !== cmpSeq) return;
    counts[key] = n; delete pending[key]; paint();
  }

  function paint() {
    const known = Object.values(counts).filter((v) => typeof v === 'number');
    const max = Math.max(1, ...known);
    const base = counts['o200k'];
    cmpBody.innerHTML = TOKENIZERS.map((t) => {
      const c = counts[t.key];
      const badge = { gpt: 'GPT', claude: 'Claude', hf: 'Open' }[t.kind];
      const barColor = { gpt: 'var(--green)', claude: 'var(--purple)', hf: 'var(--teal)' }[t.kind];
      let cell, barPct = 0;
      if (pending[t.key]) cell = '<span class="cmp-pending">…</span>';
      else if (c == null) cell = '—';
      else {
        barPct = (c / max) * 100;
        let delta = '';
        if (typeof base === 'number' && base > 0 && t.key !== 'o200k') {
          const d = Math.round(((c - base) / base) * 100);
          delta = ` <span class="cmp-enc">${d >= 0 ? '+' : ''}${d}%</span>`;
        }
        cell = `${c.toLocaleString()}${delta}`;
      }
      return `<tr>
        <td class="cmp-enc">${t.name}<span class="cmp-badge ${t.kind}">${badge}</span></td>
        <td class="cmp-models">${t.models}</td>
        <td class="tok-count">${cell}</td>
        <td><div class="cmp-bar-track"><div class="cmp-bar-fill" style="width:${barPct}%;background:${barColor}"></div></div></td>
      </tr>`;
    }).join('');
  }
  paint();

  cmpNote.innerHTML = (hasClaudeKey
    ? 'Deltas are vs GPT-4o (o200k). Claude counts come from the <code>count_tokens</code> API (count only, no pieces). '
    : '⚠️ Add <code>ANTHROPIC_API_KEY</code> to your <code>.env</code> to include Claude. ')
    + 'Open-model tokenizers load from HuggingFace on first use.';
}

function countClaude(text, model) {
  return fetch('/count_tokens', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, model }),
  }).then((r) => { if (!r.ok) throw new Error(); return r.json(); }).then((j) => j.input_tokens);
}

// ── Build model dropdown + example chips ─────────────────────────────────────
(function buildModelSelect() {
  const groups = {};
  for (const m of MODELS) (groups[m.provider] ||= []).push(m);
  modelSel.innerHTML = Object.entries(groups).map(([prov, ms]) =>
    `<optgroup label="${prov}">` +
    ms.map((m) => `<option value="${m.id}">${m.label}</option>`).join('') + '</optgroup>'
  ).join('');
})();

(function buildExamples() {
  $('tok-examples').innerHTML = Object.keys(EXAMPLES)
    .map((k) => `<button class="ex-chip" data-ex="${k}">${k}</button>`).join('');
  $('tok-examples').addEventListener('click', (e) => {
    const btn = e.target.closest('.ex-chip');
    if (!btn) return;
    input.value = EXAMPLES[btn.dataset.ex];
    render();
    input.focus();
  });
})();

// ── Wire controls ────────────────────────────────────────────────────────────
let renderTimer = null;
input.addEventListener('input', () => { clearTimeout(renderTimer); renderTimer = setTimeout(render, 200); });
modelSel.addEventListener('change', render);
for (const btn of document.querySelectorAll('.view-btn')) {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.view-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    curView = btn.dataset.view;
    render();
  });
}

// ── Init ─────────────────────────────────────────────────────────────────────
fetch('/config')
  .then((r) => r.json())
  .then((cfg) => { hasClaudeKey = !!(cfg.keys && cfg.keys.anthropic); })
  .catch(() => {})
  .finally(() => {
    if (!input.value) input.value = EXAMPLES.Prose;
    render();
    // Warm the open-model tokenizers in the background so the table fills in.
    setTimeout(() => TOKENIZERS.filter((t) => t.kind === 'hf').forEach((t) => loadHF(t.hf)), 400);
  });
