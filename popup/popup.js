// 弹窗主逻辑：视图切换、格式化/压缩/复制/清空、快捷键、偏好记忆。
// 注意：textarea 永远不被覆盖（只隐藏），出错的原文始终保留。

import { highlightJSON, escapeHtml } from './highlighter.js';
import {
  indentUnit, describeJsonError, countNodes,
} from './json-ops.js';

const HIGHLIGHT_LIMIT = 512 * 1024; // 512KB 以上跳过高亮，避免大 JSON 卡顿

const $ = (id) => document.getElementById(id);
const els = {
  input: $('input'),
  output: $('output'),
  outputCode: $('output-code'),
  status: $('status'),
  format: $('btn-format'),
  minify: $('btn-minify'),
  copy: $('btn-copy'),
  clear: $('btn-clear'),
  indent: $('sel-indent'),
};

const state = {
  resultText: '',   // 最近一次成功结果（复制用）
  lastAction: null, // 'format' | 'minify'（缩进切换后重跑用）
};

function setStatus(text, isError = false) {
  els.status.textContent = text;
  els.status.classList.toggle('error', isError);
}

function showEditor() {
  els.output.hidden = true;
  els.input.hidden = false;
  els.input.focus();
}

function showResult(html) {
  els.input.hidden = true;
  els.output.hidden = false;
  els.outputCode.innerHTML = html;
}

function statsLine(parsed, text) {
  return `${text.length} 字符 · ${countNodes(parsed)} 节点`;
}

function run(action) {
  const text = els.input.value;
  if (!text.trim()) {
    showEditor();
    setStatus('请先粘贴 JSON', true);
    return;
  }
  state.lastAction = action;
  try {
    const obj = JSON.parse(text); // 只解析一次，结果复用（统计/高亮/输出）
    const out =
      action === 'format'
        ? JSON.stringify(obj, null, indentUnit(els.indent.value))
        : JSON.stringify(obj);
    state.resultText = out;
    if (out.length > HIGHLIGHT_LIMIT) {
      showResult(escapeHtml(out));
      setStatus(`${statsLine(obj, out)} · 超过 512KB，跳过高亮`);
    } else {
      showResult(highlightJSON(out));
      setStatus(statsLine(obj, out));
    }
  } catch (err) {
    state.resultText = '';
    showEditor();
    const info = describeJsonError(text, err);
    setStatus(
      info.line ? `第 ${info.line} 行 第 ${info.col} 列：${info.message}` : info.message,
      true,
    );
  }
}

async function copy() {
  const text = state.resultText || els.input.value;
  if (!text) {
    setStatus('没有可复制的内容', true);
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    setStatus(`已复制 ${text.length} 字符`);
  } catch {
    setStatus('复制失败，请在结果视图按 Ctrl+C 复制', true);
  }
}

function clearAll() {
  els.input.value = '';
  state.resultText = '';
  state.lastAction = null;
  showEditor();
  setStatus('已清空');
}

/* ---------- 偏好记忆（chrome.storage 可用时才启用，便于普通网页中调试） ---------- */
const VALID_INDENTS = ['2', '4', 'tab'];

function loadPref() {
  const api = globalThis.chrome?.storage?.sync;
  if (!api) return;
  api.get(['indent'], ({ indent } = {}) => {
    if (VALID_INDENTS.includes(indent)) els.indent.value = indent;
  });
}

function savePref() {
  const api = globalThis.chrome?.storage?.sync;
  if (api) api.set({ indent: els.indent.value });
}

/* ---------- 事件绑定 ---------- */
els.format.addEventListener('click', () => run('format'));
els.minify.addEventListener('click', () => run('minify'));
els.copy.addEventListener('click', copy);
els.clear.addEventListener('click', clearAll);

els.indent.addEventListener('change', () => {
  savePref();
  if (state.lastAction && state.resultText) run(state.lastAction);
});

document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key === 'Enter') {
    e.preventDefault();
    run(e.shiftKey ? 'minify' : 'format');
  } else if (e.key === 'Escape' && !els.output.hidden) {
    showEditor();
  }
});

// 结果视图可见且无选区时，Ctrl/Cmd+C 复制全部结果。
// copy 事件按规范派发到焦点元素，必须挂 document 级才能稳定捕获。
document.addEventListener('copy', (e) => {
  if (els.output.hidden) return; // 编辑态不拦截，保留原生复制
  const sel = window.getSelection();
  if (sel && String(sel)) return; // 有选区时走默认选区复制
  e.preventDefault();
  e.clipboardData.setData('text/plain', state.resultText || els.input.value);
  setStatus('已复制');
});

loadPref();
els.input.focus();
