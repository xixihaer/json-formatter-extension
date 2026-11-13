# JSON 格式化弹窗插件 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chrome/Edge (MV3) 弹窗插件：粘贴 JSON → 格式化/压缩/校验，语法高亮 + 错误行列定位，零依赖零构建。

**Architecture:** `action.default_popup` 弹窗，无 background、无 content script。纯函数逻辑拆到 `popup/highlighter.js`（tokenizer 高亮）和 `popup/json-ops.js`（解析/格式化/错误定位），`popup.js` 只做 DOM 接线。纯函数用 Node 内置 `node --test` 单测；浏览器行为用 Playwright E2E 验证。

**Tech Stack:** 原生 HTML/CSS/JS（ES Module）、Manifest V3、`chrome.storage.sync`、`node --test`、零 npm 依赖。

**与设计文档的两处有意偏差（均已论证）：**
1. 新增 `popup/json-ops.js`（设计文档只列了 highlighter.js）：解析/格式化/错误定位是独立职责，单独成文件才能被 Node 直接单测。
2. 快捷键：压缩改为 `Ctrl/Cmd+Shift+Enter`（设计文档写的 Ctrl+M 在 macOS 与系统最小化冲突）；复制改为「结果视图 Ctrl/Cmd+C 复制全部」（Ctrl+Shift+C 是 Chrome DevTools 保留键）。

---

## 文件结构（全部新建）

```
json-formatter/            # 仓库根 = ~/json-formatter-extension
├── manifest.json          # MV3 清单
├── package.json           # 仅 test/icons 两个 script，零依赖
├── popup/
│   ├── popup.html         # 弹窗结构（无内联脚本，符合 MV3 CSP）
│   ├── popup.css          # 深/浅色自适应
│   ├── popup.js           # DOM 接线：视图切换/动作/快捷键/偏好记忆
│   ├── highlighter.js     # JSON tokenizer + 高亮（纯函数）
│   └── json-ops.js        # parse/format/minify/错误定位/节点统计（纯函数）
├── icons/icon{16,48,128}.png
├── scripts/make-icons.mjs # 无依赖 PNG 生成器（node:zlib）
├── tests/
│   ├── highlighter.test.js
│   └── json-ops.test.js
└── README.md
```

---

### Task 1: 项目骨架

**Files:**
- Create: `package.json`
- Create: `manifest.json`

- [ ] **Step 1: 确认 Node ≥ 18**

Run: `node --version`
Expected: `v18.x` 或更高（`node --test` 需要）

- [ ] **Step 2: 写 package.json**

```json
{
  "name": "json-formatter-extension",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test tests/",
    "icons": "node scripts/make-icons.mjs"
  }
}
```

- [ ] **Step 3: 写 manifest.json**

```json
{
  "manifest_version": 3,
  "name": "JSON Formatter",
  "version": "1.0.0",
  "description": "粘贴 JSON 一键格式化、压缩、校验，语法高亮与错误定位。",
  "action": {
    "default_title": "JSON 格式化",
    "default_popup": "popup/popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },
  "permissions": ["storage"]
}
```

- [ ] **Step 4: 验证 manifest 合法 JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('manifest OK')"`
Expected: `manifest OK`

- [ ] **Step 5: Commit**

```bash
git add package.json manifest.json
git commit -m "chore: MV3 清单与 npm scripts 骨架"
```

---

### Task 2: highlighter.js（TDD）

**Files:**
- Create: `popup/highlighter.js`
- Test: `tests/highlighter.test.js`

- [ ] **Step 1: 写失败测试**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { highlightJSON, escapeHtml } from '../popup/highlighter.js';

// 高亮输出中的 " 会被转义为 &quot;，此辅助函数还原后与原文对比
const unescapeHtml = (h) =>
  h.replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');

test('对象键与字符串值分类不同', () => {
  const html = highlightJSON('{"name":"tom"}');
  assert.match(html, /<span class="tok-key">&quot;name&quot;<\/span>/);
  assert.match(html, /<span class="tok-string">&quot;tom&quot;<\/span>/);
});

test('数字与字面量高亮', () => {
  const html = highlightJSON('[1, -2.5, 3e2, true, false, null]');
  assert.match(html, /<span class="tok-number">1<\/span>/);
  assert.match(html, /<span class="tok-number">-2\.5<\/span>/);
  assert.match(html, /<span class="tok-number">3e2<\/span>/);
  assert.match(html, /<span class="tok-literal">true<\/span>/);
  assert.match(html, /<span class="tok-literal">false<\/span>/);
  assert.match(html, /<span class="tok-literal">null<\/span>/);
});

test('去掉标签并还原转义后与原文逐字符一致', () => {
  const src = '{"a":[{"b":1},"x y",true,null,-1.5e-3]}';
  const html = highlightJSON(src);
  assert.equal(unescapeHtml(html.replace(/<\/?span[^>]*>/g, '')), src);
});

test('HTML 注入被转义', () => {
  const input = JSON.stringify({ evil: '<script>&"' });
  const html = highlightJSON(input);
  assert.ok(!html.includes('<script'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&amp;'));
  assert.ok(html.includes('&quot;'));
});

test('带转义引号的字符串完整匹配', () => {
  const html = highlightJSON('{"path":"a\\"b"}');
  assert.match(html, /<span class="tok-string">&quot;a\\&quot;b&quot;<\/span>/);
});

test('Unicode 保持原样', () => {
  const input = JSON.stringify({ 名字: '张三' });
  const html = highlightJSON(input);
  assert.equal(unescapeHtml(html.replace(/<\/?span[^>]*>/g, '')), input);
});

test('escapeHtml 转义四个保留字符', () => {
  assert.equal(escapeHtml('<>&"'), '&lt;&gt;&amp;&quot;');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test`
Expected: FAIL，`Cannot find module '.../popup/highlighter.js'`

- [ ] **Step 3: 最小实现**

```js
// JSON 语法高亮：输入字符串，输出转义安全的 HTML。纯函数，可在 Node 单测。

const TOKEN_RE = /("(?:[^"\\]|\\.)*")|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

export function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isKey(src, from) {
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (c === ':') return true;
    if (!/\s/.test(c)) return false;
  }
  return false;
}

export function highlightJSON(src) {
  TOKEN_RE.lastIndex = 0;
  let out = '';
  let last = 0;
  let m;
  while ((m = TOKEN_RE.exec(src)) !== null) {
    out += escapeHtml(src.slice(last, m.index));
    const [, str, literal, num] = m;
    if (str !== undefined) {
      const cls = isKey(src, TOKEN_RE.lastIndex) ? 'key' : 'string';
      out += `<span class="tok-${cls}">${escapeHtml(str)}</span>`;
    } else if (literal !== undefined) {
      out += `<span class="tok-literal">${literal}</span>`;
    } else {
      out += `<span class="tok-number">${num}</span>`;
    }
    last = TOKEN_RE.lastIndex;
  }
  out += escapeHtml(src.slice(last));
  return out;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm test`
Expected: 全部 PASS（7 个测试）

- [ ] **Step 5: Commit**

```bash
git add popup/highlighter.js tests/highlighter.test.js
git commit -m "feat: JSON tokenizer 语法高亮器（含转义安全与注入测试）"
```

---

### Task 3: json-ops.js（TDD）

**Files:**
- Create: `popup/json-ops.js`
- Test: `tests/json-ops.test.js`

- [ ] **Step 1: 写失败测试**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatJson, minifyJson, positionToLineCol, describeJsonError, countNodes,
} from '../popup/json-ops.js';

test('formatJson 支持 2/4 空格与 Tab', () => {
  const src = '{"a":1}';
  assert.equal(formatJson(src, '2'), '{\n  "a": 1\n}');
  assert.equal(formatJson(src, '4'), '{\n    "a": 1\n}');
  assert.equal(formatJson(src, 'tab'), '{\n\t"a": 1\n}');
});

test('formatJson 非法 JSON 抛 SyntaxError', () => {
  assert.throws(() => formatJson('{', 2), SyntaxError);
});

test('minifyJson 去掉所有空白', () => {
  assert.equal(minifyJson('{\n  "a" : 1,\n  "b" : [1, 2]\n}'), '{"a":1,"b":[1,2]}');
});

test('positionToLineCol 换算行列并钳制越界', () => {
  const text = 'ab\ncd\nef';
  assert.deepEqual(positionToLineCol(text, 0), { line: 1, col: 1 });
  assert.deepEqual(positionToLineCol(text, 2), { line: 1, col: 3 });
  assert.deepEqual(positionToLineCol(text, 3), { line: 2, col: 1 });
  assert.deepEqual(positionToLineCol(text, 100), { line: 3, col: 3 });
});

test('describeJsonError 识别新版 V8 的 line/column 形式', () => {
  const err = new SyntaxError(
    "Expected ',' or '}' after property value in JSON at position 5 (line 2 column 1)",
  );
  const info = describeJsonError('{}\n x', err);
  assert.equal(info.line, 2);
  assert.equal(info.col, 1);
});

test('describeJsonError 识别旧版 position 形式并换算行列', () => {
  const err = new SyntaxError('Unexpected token } in JSON at position 3');
  const info = describeJsonError('{}\n}', err);
  assert.equal(info.line, 2);
  assert.equal(info.col, 1);
});

test('describeJsonError 无位置信息时兜底原始信息', () => {
  const err = new SyntaxError('Unexpected end of JSON input');
  const info = describeJsonError('{', err);
  assert.equal(info.line, null);
  assert.equal(info.col, null);
  assert.equal(info.message, 'Unexpected end of JSON input');
});

test('countNodes 统计嵌套节点数', () => {
  assert.equal(countNodes(1), 1);
  assert.equal(countNodes({ a: 1, b: 2 }), 3);
  assert.equal(countNodes({ a: [1, 2], b: { c: true } }), 6);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test`
Expected: FAIL，`Cannot find module '.../popup/json-ops.js'`（highlighter 测试仍 PASS）

- [ ] **Step 3: 最小实现**

```js
// JSON 解析 / 格式化 / 错误定位 / 统计的纯函数封装。无 DOM、无 chrome API。

export function formatJson(text, indent = 2) {
  const unit = indent === 'tab' ? '\t' : Number(indent) || 2;
  return JSON.stringify(JSON.parse(text), null, unit);
}

export function minifyJson(text) {
  return JSON.stringify(JSON.parse(text));
}

export function positionToLineCol(text, pos) {
  const clamped = Math.max(0, Math.min(pos, text.length));
  const lines = text.slice(0, clamped).split('\n');
  return { line: lines.length, col: lines[lines.length - 1].length + 1 };
}

export function describeJsonError(text, err) {
  const message = err && err.message ? err.message : String(err);
  let m = message.match(/line (\d+) column (\d+)/i);
  if (m) return { message, line: Number(m[1]), col: Number(m[2]) };
  m = message.match(/position (\d+)/i);
  if (m) {
    const { line, col } = positionToLineCol(text, Number(m[1]));
    return { message, line, col };
  }
  return { message, line: null, col: null };
}

export function countNodes(value, depth = 0) {
  if (depth > 64) return 1;
  if (Array.isArray(value)) {
    return value.reduce((sum, v) => sum + countNodes(v, depth + 1), 1);
  }
  if (value !== null && typeof value === 'object') {
    return Object.values(value).reduce((sum, v) => sum + countNodes(v, depth + 1), 1);
  }
  return 1;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm test`
Expected: 全部 PASS（15 个测试）

- [ ] **Step 5: Commit**

```bash
git add popup/json-ops.js tests/json-ops.test.js
git commit -m "feat: JSON 格式化/压缩/错误行列定位/节点统计纯函数"
```

---

### Task 4: popup.html + popup.css

**Files:**
- Create: `popup/popup.html`
- Create: `popup/popup.css`

- [ ] **Step 1: 写 popup.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>JSON 格式化</title>
  <link rel="stylesheet" href="popup.css" />
</head>
<body>
  <header class="toolbar">
    <span class="brand">{&nbsp;}&nbsp;JSON 格式化</span>
    <span class="actions">
      <button id="btn-format" title="格式化 (Ctrl+Enter)">格式化</button>
      <button id="btn-minify" title="压缩 (Ctrl+Shift+Enter)">压缩</button>
      <button id="btn-copy" title="复制结果">复制</button>
      <button id="btn-clear" title="清空">清空</button>
      <select id="sel-indent" title="缩进">
        <option value="2">2 空格</option>
        <option value="4">4 空格</option>
        <option value="tab">Tab</option>
      </select>
    </span>
  </header>

  <main class="stage">
    <textarea id="input" spellcheck="false" wrap="off"
      placeholder="粘贴 JSON，点击「格式化」或按 Ctrl+Enter"></textarea>
    <pre id="output" hidden><code id="output-code"></code></pre>
  </main>

  <footer id="status" class="status">就绪</footer>

  <script type="module" src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 2: 写 popup.css**

```css
:root {
  color-scheme: light dark;
  --bg: #ffffff;
  --fg: #1f2328;
  --muted: #6e7781;
  --border: #d0d7de;
  --accent: #0969da;
  --accent-fg: #ffffff;
  --err-bg: #fff1f0;
  --err-fg: #cf222e;
  --tok-key: #0550ae;
  --tok-string: #0a3069;
  --tok-number: #116329;
  --tok-literal: #8250df;
  --tok-punct: #57606a;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #1c2128;
    --fg: #e6edf3;
    --muted: #8b949e;
    --border: #444c56;
    --accent: #4493f8;
    --accent-fg: #0d1117;
    --err-bg: #3d1d20;
    --err-fg: #ff8182;
    --tok-key: #6cb6ff;
    --tok-string: #a5d6ff;
    --tok-number: #7ee787;
    --tok-literal: #d2a8ff;
    --tok-punct: #adbac7;
  }
}

* { box-sizing: border-box; }
[hidden] { display: none !important; }

body {
  margin: 0;
  width: 420px;
  height: 560px;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  color: var(--fg);
  font: 13px/1.5 system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
}
.brand { font-weight: 600; font-family: ui-monospace, monospace; }
.actions { display: flex; gap: 6px; align-items: center; }

button, select {
  font: inherit;
  color: var(--fg);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 3px 10px;
  cursor: pointer;
}
button:hover { border-color: var(--accent); color: var(--accent); }
button:active { transform: translateY(1px); }
#btn-format { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); }
#btn-format:hover { opacity: 0.9; color: var(--accent-fg); }

.stage { position: relative; flex: 1; min-height: 0; }

textarea, #output {
  position: absolute;
  inset: 0;
  margin: 0;
  padding: 10px 12px;
  border: 0;
  resize: none;
  outline: none;
  background: var(--bg);
  color: var(--fg);
  font: 12px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  white-space: pre;
  overflow: auto;
  tab-size: 4;
}
textarea { width: 100%; height: 100%; }

#output { color: var(--tok-punct); }
.tok-key { color: var(--tok-key); }
.tok-string { color: var(--tok-string); }
.tok-number { color: var(--tok-number); }
.tok-literal { color: var(--tok-literal); }

.status {
  padding: 5px 12px;
  border-top: 1px solid var(--border);
  color: var(--muted);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.status.error { background: var(--err-bg); color: var(--err-fg); }
```

- [ ] **Step 3: Commit**

```bash
git add popup/popup.html popup/popup.css
git commit -m "feat: 弹窗结构与深浅色样式"
```

---

### Task 5: popup.js 接线

**Files:**
- Create: `popup/popup.js`

浏览器侧代码，逻辑已由 Task 2/3 单测覆盖；本任务产出在 Task 7 E2E 验证。

- [ ] **Step 1: 写 popup.js**

```js
// 弹窗主逻辑：视图切换、格式化/压缩/复制/清空、快捷键、偏好记忆。
// 注意：textarea 永远不被覆盖（只隐藏），出错的原文始终保留。

import { highlightJSON, escapeHtml } from './highlighter.js';
import { formatJson, minifyJson, describeJsonError, countNodes } from './json-ops.js';

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
    const out =
      action === 'format' ? formatJson(text, els.indent.value) : minifyJson(text);
    state.resultText = out;
    if (out.length > HIGHLIGHT_LIMIT) {
      showResult(escapeHtml(out));
      setStatus(`${statsLine(JSON.parse(out), out)} · 超过 512KB，跳过高亮`);
    } else {
      showResult(highlightJSON(out));
      setStatus(statsLine(JSON.parse(out), out));
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
function loadPref() {
  const api = globalThis.chrome?.storage?.sync;
  if (!api) return;
  api.get(['indent'], ({ indent } = {}) => {
    if (indent) els.indent.value = indent;
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

// 结果视图无选区时，Ctrl/Cmd+C 复制全部结果
els.output.addEventListener('copy', (e) => {
  const sel = window.getSelection();
  if (sel && String(sel)) return;
  e.preventDefault();
  e.clipboardData.setData('text/plain', state.resultText || els.input.value);
  setStatus('已复制');
});

loadPref();
els.input.focus();
```

- [ ] **Step 2: 语法自检**

Run: `node --check popup/popup.js && node --check popup/highlighter.js && node --check popup/json-ops.js`
Expected: 无输出（语法通过）

- [ ] **Step 3: 全量单测回归**

Run: `npm test`
Expected: 全部 PASS

- [ ] **Step 4: Commit**

```bash
git add popup/popup.js
git commit -m "feat: 弹窗交互——格式化/压缩/复制/清空/缩进记忆/快捷键"
```

---

### Task 6: 图标生成 + README

**Files:**
- Create: `scripts/make-icons.mjs`
- Create: `icons/icon16.png`、`icons/icon48.png`、`icons/icon128.png`（脚本产物）
- Create: `README.md`

- [ ] **Step 1: 写 scripts/make-icons.mjs（无依赖 PNG 编码器，靛蓝底 + 白色花括号 + 琥珀圆点）**

```js
// 生成 icons/icon{16,48,128}.png —— 仅用 node:zlib，无第三方依赖。
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ---------- PNG 编码 ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, pixels) {
  const stride = size * 4 + 1; // 每行行首 filter 字节 0
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0;
    Buffer.from(pixels.buffer, y * size * 4, size * 4).copy(raw, y * stride + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 位深
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- 像素绘制 ---------- */
function drawIcon(size) {
  const px = new Uint8Array(size * size * 4);
  const set = (x, y, [r, g, b, a = 255]) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
  };
  const s = size / 128; // 以 128 为基准等比缩放
  const bg = [79, 70, 229];    // 靛蓝 #4F46E5
  const fg = [255, 255, 255];  // 白色花括号
  const dot = [251, 191, 36];  // 琥珀 #FBBF24

  // 圆角方形背景（简易抗锯齿）
  const r = 26 * s;
  const m = 8 * s;
  const edge = 1.5 * s;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = Math.min(x - m, size - 1 - m - x);
      const dy = Math.min(y - m, size - 1 - m - y);
      if (dx < 0 || dy < 0) continue;
      const d = Math.hypot(Math.max(0, r - dx), Math.max(0, r - dy));
      let alpha = 0;
      if (d <= r - edge) alpha = 255;
      else if (d <= r + edge) alpha = 140;
      if (alpha > 0) set(x, y, [bg[0], bg[1], bg[2], alpha]);
    }
  }

  const t = Math.max(2, Math.round(9 * s)); // 笔画粗细
  const stem = (xBase) => {
    // 竖干
    for (let i = 0; i < t; i++) {
      for (let j = 0; j < 64 * s + t; j++) set(xBase + i, 32 * s + j, fg);
    }
  };
  // 左花括号 {
  stem(36 * s);
  for (let i = 0; i < t; i++) {
    for (let j = 0; j < 24 * s; j++) {
      set(36 * s + j, 32 * s + i, fg);        // 上臂（向右）
      set(36 * s + j, 96 * s - t + i, fg);    // 下臂（向右）
    }
  }
  // 右花括号 }
  stem(92 * s - t);
  for (let i = 0; i < t; i++) {
    for (let j = 0; j < 24 * s; j++) {
      set(68 * s + j, 32 * s + i, fg);        // 上臂（向左）
      set(68 * s + j, 96 * s - t + i, fg);    // 下臂（向左）
    }
  }
  // 中心圆点
  const cx = 64 * s, cy = 64 * s, cr = 7 * s;
  for (let y = Math.floor(cy - cr); y <= Math.ceil(cy + cr); y++) {
    for (let x = Math.floor(cx - cr); x <= Math.ceil(cx + cr); x++) {
      if (Math.hypot(x - cx, y - cy) <= cr) set(x, y, dot);
    }
  }
  return px;
}

/* ---------- 输出 ---------- */
mkdirSync(join(root, 'icons'), { recursive: true });
for (const size of [16, 48, 128]) {
  const png = encodePng(size, drawIcon(size));
  const file = join(root, 'icons', `icon${size}.png`);
  writeFileSync(file, png);
  console.log(`wrote ${file} (${png.length} bytes)`);
}
```

- [ ] **Step 2: 生成并校验**

Run: `node scripts/make-icons.mjs && file icons/*.png`
Expected: 三行 `wrote ...` + `icons/icon16.png: PNG image data, 16 x 16, 8-bit/color RGBA, non-interlaced`（48/128 同理）

- [ ] **Step 3: 目视检查 128 图标**

用 Read 工具打开 `icons/icon128.png`，确认识别出「{ }」造型、靛蓝底、琥珀点。

- [ ] **Step 4: 写 README.md**

```markdown
# JSON Formatter（浏览器扩展）

Chrome / Edge（Manifest V3）弹窗插件：点击图标 → 粘贴 JSON → 一键格式化 / 压缩 / 校验。

## 功能

- 格式化（美化缩进）与压缩（最小化）
- 语法高亮：key / 字符串 / 数字 / true/false/null 分色
- 错误定位：`第 X 行 第 Y 列：错误信息`
- 缩进切换：2 空格 / 4 空格 / Tab（自动记忆）
- 一键复制 / 清空
- 大 JSON（>512KB）自动跳过高亮防卡顿
- 深 / 浅色跟随系统

## 快捷键

| 按键 | 动作 |
|---|---|
| Ctrl/Cmd+Enter | 格式化 |
| Ctrl/Cmd+Shift+Enter | 压缩 |
| Ctrl/Cmd+C（结果视图、无选区时） | 复制全部结果 |
| Esc（结果视图） | 返回编辑 |

## 安装（开发者模式加载）

1. 打开 `chrome://extensions`（Edge 为 `edge://extensions`）
2. 右上角打开「开发者模式」
3. 点「加载已解压的扩展程序」，选择本目录
4. 工具栏出现 { } 图标即可使用

## 开发

- 跑测试：`npm test`（Node ≥ 18，零依赖，`node --test`）
- 重新生成图标：`npm run icons`

## 目录

- `popup/highlighter.js` — JSON tokenizer 高亮（纯函数）
- `popup/json-ops.js` — 格式化/压缩/错误定位/统计（纯函数）
- `popup/popup.js` — DOM 接线与交互
- `tests/` — 单元测试
```

- [ ] **Step 5: Commit**

```bash
git add scripts/make-icons.mjs icons/ README.md
git commit -m "feat: 无依赖图标生成器与 README"
```

---

### Task 7: E2E 验证（Playwright）

**Files:** 无新增（发现问题则修复对应文件）

popup 是 ES Module，`file://` 下会被 CORS 拦截，需起本地 HTTP 服务；`popup.js` 中 `chrome.storage` 已做存在性守卫，网页环境可直接跑。

- [ ] **Step 1: 起静态服务（后台）**

Run: `python3 -m http.server 8137`（run_in_background，cwd = 仓库根）

- [ ] **Step 2: Playwright 打开弹窗页面**

用 ToolSearch 加载 `mcp__plugin_ecc_playwright__browser_navigate`、`browser_evaluate`、`browser_take_screenshot`、`browser_close`，导航到 `http://localhost:8137/popup/popup.html`。

- [ ] **Step 3: 验证格式化流程**

`browser_evaluate` 注入:

```js
async () => {
  const input = document.getElementById('input');
  const btn = document.getElementById('btn-format');
  input.value = '{"name":"tom","tags":[1,2],"ok":true,"none":null}';
  btn.click();
  await new Promise(r => setTimeout(r, 100));
  return {
    outputHidden: document.getElementById('output').hidden,
    hasKey: document.querySelector('.tok-key')?.textContent,
    hasNumber: document.querySelector('.tok-number')?.textContent,
    hasLiteral: document.querySelector('.tok-literal')?.textContent,
    status: document.getElementById('status').textContent,
  };
}
```

Expected: `outputHidden:false`，`hasKey:'"name"'`，`hasNumber:'1'`，`hasLiteral:'true'`，status 含「节点」。

- [ ] **Step 4: 验证错误定位**

同样方式输入 `{"a":1\n,"b":}`（含换行的坏 JSON）点格式化。
Expected: `output.hidden === true`（回到编辑态），status 文本匹配 `/行.*列/`。

- [ ] **Step 5: 验证压缩与缩进切换**

输入多行 JSON → 点「压缩」→ 输出无换行；把缩进 select 设为 `'4'` 并派发 `change` → 输出变 4 空格缩进。

- [ ] **Step 6: 截图留档**

`browser_take_screenshot`（格式化结果视图 + 错误状态各一张），关闭浏览器、停掉 HTTP 服务。

- [ ] **Step 7: 修复发现的问题并回归 `npm test`，Commit（如有修复）**

```bash
git add -A && git commit -m "fix: E2E 发现的问题修复"
```

---

### Task 8: 收尾与独立评审

- [ ] **Step 1: 全量回归**

Run: `npm test`
Expected: 15 个测试全部 PASS

- [ ] **Step 2: 独立代码评审（不在本上下文自审）**

派发 `oh-my-claudecode:code-reviewer`（或 `ecc:typescript-reviewer`）子代理评审全部源码；HIGH 问题必须修复并回归测试，LOW 问题记录到 README 的「已知限制」或直接修复。

- [ ] **Step 3: 真实浏览器验收提示用户**

输出加载步骤（chrome://extensions → 开发者模式 → 加载已解压），请用户实际点一遍：正常 JSON / 错误 JSON / 压缩 / 复制 / 缩进记忆 / 深色模式。

- [ ] **Step 4: 最终提交**

```bash
git add -A && git commit -m "chore: 评审修复与收尾"（如有变更）
```
