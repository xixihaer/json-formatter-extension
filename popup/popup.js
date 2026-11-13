// 弹窗主逻辑：视图切换、格式化/压缩/复制/清空、快捷键、偏好记忆。
// 注意：textarea 永远不被覆盖（只隐藏），出错的原文始终保留。

import { highlightJSON, escapeHtml } from './highlighter.js';
import {
  indentUnit, describeJsonError, countNodes, unwrapEscapedJson,
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
  escape: $('sel-escape'),
};

const state = {
  resultText: '',   // 最近一次成功结果（复制用）
  lastAction: null, // 'format' | 'minify'（缩进切换后重跑用）
  composing: false, // 中文输入法合成中，避免重渲染打断候选
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

/* ---------- 结果视图就地编辑 ---------- */
// 当前生效文本：结果视图可见时以编辑后的内容为准，并同步回编辑区
function currentText() {
  if (!els.output.hidden) {
    const t = els.outputCode.textContent;
    els.input.value = t;
    return t;
  }
  return els.input.value;
}

// 光标在纯文本中的偏移（基于 Range 文本长度，无需遍历 DOM）
function caretTextOffset(root) {
  const sel = typeof window.getSelection === 'function' && window.getSelection();
  if (!sel || typeof sel.getRangeAt !== 'function' || sel.rangeCount === 0) return -1;
  const r = sel.getRangeAt(0);
  if (typeof document.createRange !== 'function') return -1;
  const pre = document.createRange();
  pre.selectNodeContents(root);
  pre.setEnd(r.startContainer, r.startOffset);
  const off = pre.toString().length;
  if (typeof pre.detach === 'function') pre.detach();
  return off;
}

// 在纯文本偏移处恢复光标
function setTextCaret(root, offset) {
  if (typeof document.createTreeWalker !== 'function') return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  let total = 0;
  while ((node = walker.nextNode()) !== null) {
    if (offset <= total + node.data.length) {
      const range = document.createRange();
      range.setStart(node, offset - total);
      range.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
    total += node.data.length;
  }
  // 偏移越界：光标置于末尾
  const range = document.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

// 编辑后重新高亮并保持光标位置
function rehighlight() {
  const text = els.outputCode.textContent;
  state.resultText = text;
  const html = text.length > HIGHLIGHT_LIMIT ? escapeHtml(text) : highlightJSON(text);
  const caret = caretTextOffset(els.outputCode);
  els.outputCode.innerHTML = html;
  if (caret >= 0) setTextCaret(els.outputCode, caret);
}

function handleResultInput() {
  state.resultText = els.outputCode.textContent; // 立即同步，复制不落旧值
  if (state.composing) return; // IME 合成中只同步文本，不重渲染
  setStatus('已编辑 · Ctrl+Enter 重新格式化');
  rehighlight();
}

function run(action) {
  let text = currentText();
  if (!text.trim()) {
    showEditor();
    setStatus('请先粘贴 JSON', true);
    return;
  }
  // 自动转义：解包「字符串化的 JSON」（外层引号 + 内部转义），
  // 解包成功后同步编辑区，使错误定位/再次编辑基于真实报文。
  let unwrapped = false;
  if (els.escape.value === 'auto') {
    const source = unwrapEscapedJson(text);
    if (source !== text) {
      text = source;
      els.input.value = source;
      unwrapped = true;
    }
  }
  state.lastAction = action;
  try {
    const obj = JSON.parse(text); // 只解析一次，结果复用（统计/高亮/输出）
    const out =
      action === 'format'
        ? JSON.stringify(obj, null, indentUnit(els.indent.value))
        : JSON.stringify(obj);
    state.resultText = out;
    const note = unwrapped ? ' · 已自动去除转义' : '';
    if (out.length > HIGHLIGHT_LIMIT) {
      showResult(escapeHtml(out));
      setStatus(`${statsLine(obj, out)} · 超过 512KB，跳过高亮${note} · 可编辑`);
    } else {
      showResult(highlightJSON(out));
      setStatus(`${statsLine(obj, out)}${note} · 可编辑`);
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
  els.outputCode.innerHTML = '';
  state.resultText = '';
  state.lastAction = null;
  showEditor();
  setStatus('已清空');
}

/* ---------- 偏好记忆（chrome.storage 可用时才启用，便于普通网页中调试） ---------- */
const VALID_INDENTS = ['2', '4', 'tab'];
const VALID_ESCAPES = ['auto', 'keep'];

function loadPref() {
  const api = globalThis.chrome?.storage?.sync;
  if (!api) return;
  api.get(['indent', 'escape'], (prefs = {}) => {
    if (VALID_INDENTS.includes(prefs.indent)) els.indent.value = prefs.indent;
    if (VALID_ESCAPES.includes(prefs.escape)) els.escape.value = prefs.escape;
  });
}

function savePref() {
  const api = globalThis.chrome?.storage?.sync;
  if (api) api.set({ indent: els.indent.value, escape: els.escape.value });
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

// 转义模式只影响下一次解析的输入预处理，不自动重跑（当前内容已是处理后的）
els.escape.addEventListener('change', savePref);

/* ---------- 结果视图就地编辑事件 ---------- */
els.outputCode.addEventListener('input', handleResultInput);
els.outputCode.addEventListener('compositionstart', () => {
  state.composing = true;
});
els.outputCode.addEventListener('compositionend', () => {
  state.composing = false;
  handleResultInput();
});

// 结果视图内 Enter 插入真实换行（而非 contenteditable 的 <div>/<br>）
els.outputCode.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
    e.preventDefault();
    if (typeof document.execCommand === 'function') {
      document.execCommand('insertText', false, '\n');
    }
  }
});

// 粘贴纯文本，避免富文本混入破坏 JSON
els.outputCode.addEventListener('paste', (e) => {
  e.preventDefault();
  const text = (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
  if (text && typeof document.execCommand === 'function') {
    document.execCommand('insertText', false, text);
  }
});

document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key === 'Enter') {
    e.preventDefault();
    run(e.shiftKey ? 'minify' : 'format');
  } else if (e.key === 'Escape' && !els.output.hidden) {
    els.input.value = els.outputCode.textContent; // 携带编辑内容回编辑器
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
