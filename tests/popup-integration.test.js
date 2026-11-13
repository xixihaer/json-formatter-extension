// popup.js 集成测试：注入最小 DOM stub，真实加载弹窗模块并驱动交互。
// 说明：Playwright MCP 桥接不可用，以此作为浏览器行为的等价自动化覆盖。
import test from 'node:test';
import assert from 'node:assert/strict';

class FakeElement {
  constructor(id) {
    this.id = id;
    this.hidden = false;
    this.value = '';
    this.focused = false;
    this.listeners = {};
    this._html = '';
    this.text = '';
    this._classes = new Set();
    this.classList = {
      toggle: (c, on) => (on ? this._classes.add(c) : this._classes.delete(c)),
      has: (c) => this._classes.has(c),
    };
  }
  set innerHTML(v) { this._html = v; }
  get innerHTML() { return this._html; }
  set textContent(v) { this.text = v; }
  get textContent() { return this.text; }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  dispatch(type, event = {}) { (this.listeners[type] || []).forEach((fn) => fn(event)); }
  focus() { this.focused = true; }
}

const registry = {};
const $fake = (id) => (registry[id] ??= new FakeElement(id));

const docListeners = {};
globalThis.document = {
  getElementById: $fake,
  addEventListener: (t, fn) => (docListeners[t] ??= []).push(fn),
};
const docKeydown = (event) => (docListeners.keydown || []).forEach((fn) => fn(event));
const docDispatch = (type, event = {}) =>
  (docListeners[type] || []).forEach((fn) => fn(event));
globalThis.window = { getSelection: () => ({ toString: () => '' }) };

// popup.js 顶层立即绑定事件，先备好 stub 再动态 import
await import('../popup/popup.js');

const els = {
  input: $fake('input'),
  output: $fake('output'),
  outputCode: $fake('output-code'),
  status: $fake('status'),
  format: $fake('btn-format'),
  minify: $fake('btn-minify'),
  clear: $fake('btn-clear'),
  indent: $fake('sel-indent'),
  escape: $fake('sel-escape'),
};

// 高亮输出去掉 span 并还原转义后，应与纯文本一致
const stripHtml = (h) =>
  h.replace(/<\/?span[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

test('格式化：切换结果视图并渲染高亮 token', () => {
  els.input.value = '{"name":"tom","tags":[1,2],"ok":true}';
  els.format.dispatch('click');
  assert.equal(els.output.hidden, false, '结果视图应显示');
  assert.equal(els.input.hidden, true, '编辑视图应隐藏');
  assert.match(els.outputCode.innerHTML, /tok-key/);
  assert.match(els.outputCode.innerHTML, /tok-number/);
  assert.match(els.outputCode.innerHTML, /tok-literal/);
  assert.match(els.status.text, /节点/);
});

test('错误 JSON：回到编辑态并显示行列号', () => {
  els.input.value = '{"a":1\n,"b":}';
  els.format.dispatch('click');
  assert.equal(els.output.hidden, true, '应回到编辑态');
  assert.equal(els.input.hidden, false);
  assert.match(els.status.text, /第 \d+ 行 第 \d+ 列/);
  assert.equal(els.status.classList.has('error'), true);
});

test('压缩：输出不含换行', () => {
  els.input.value = '{\n  "a" : 1,\n  "b" : [ 1, 2 ]\n}';
  els.minify.dispatch('click');
  assert.equal(els.output.hidden, false);
  assert.ok(!els.outputCode.innerHTML.includes('\n'), '压缩结果不应有换行');
  assert.equal(stripHtml(els.outputCode.innerHTML), '{"a":1,"b":[1,2]}');
});

test('缩进切换后自动重跑上次格式化', () => {
  els.input.value = '{"a":1}';
  els.format.dispatch('click');
  els.indent.value = '4';
  els.indent.dispatch('change');
  assert.ok(
    stripHtml(els.outputCode.innerHTML).startsWith('{\n    "a": 1'),
    '应为 4 空格缩进',
  );
});

test('清空：重置一切', () => {
  els.input.value = '{"x":1}';
  els.format.dispatch('click');
  els.clear.dispatch('click');
  assert.equal(els.input.value, '');
  assert.equal(els.output.hidden, true);
  assert.equal(els.status.text, '已清空');
});

test('Ctrl+Enter 触发格式化，Escape 返回编辑', () => {
  els.input.value = '{"k":1}';
  docKeydown({ ctrlKey: true, metaKey: false, key: 'Enter', shiftKey: false, preventDefault() {} });
  assert.equal(els.output.hidden, false, 'Ctrl+Enter 应格式化');
  docKeydown({ key: 'Escape', ctrlKey: false, metaKey: false });
  assert.equal(els.output.hidden, true, 'Escape 应回编辑态');
  assert.equal(els.input.hidden, false);
});

test('Ctrl+Shift+Enter 触发压缩', () => {
  els.input.value = '{ "a" : 1 }';
  docKeydown({ ctrlKey: true, metaKey: false, key: 'Enter', shiftKey: true, preventDefault() {} });
  assert.equal(els.output.hidden, false);
  assert.equal(stripHtml(els.outputCode.innerHTML), '{"a":1}');
});

test('空输入提示错误且不切视图', () => {
  els.input.value = '   ';
  els.format.dispatch('click');
  assert.equal(els.output.hidden, true);
  assert.equal(els.status.text, '请先粘贴 JSON');
});

test('结果视图无选区 Ctrl+C 复制全部结果，编辑态不拦截', () => {
  els.indent.value = '2'; // 前序测试可能改成 4，这里重置
  els.input.value = '{"c":1}';
  els.format.dispatch('click');
  let copied = null;
  const ev = { preventDefault() {}, clipboardData: { setData: (t, v) => (copied = v) } };
  docDispatch('copy', ev);
  assert.equal(copied, '{\n  "c": 1\n}', '结果视图应复制全部结果');
  // 回编辑态后不应拦截原生复制
  docKeydown({ key: 'Escape', ctrlKey: false, metaKey: false });
  copied = null;
  docDispatch('copy', ev);
  assert.equal(copied, null, '编辑态不拦截 copy 事件');
});

test('超过 512KB 跳过高亮降级纯文本', () => {
  els.input.value = '{"data":"' + 'x'.repeat(600 * 1024) + '"}';
  els.format.dispatch('click');
  assert.equal(els.output.hidden, false, '仍应显示结果');
  assert.ok(!els.outputCode.innerHTML.includes('<span'), '不应有高亮 span');
  assert.match(els.status.text, /跳过高亮/);
});

test('自动转义：解包字符串化 JSON 并同步编辑区', () => {
  els.indent.value = '2';
  els.escape.value = 'auto';
  els.input.value = '"{\\"baseInfo\\":{\\"servCode\\":\\"CAR-13\\"}}"';
  els.format.dispatch('click');
  assert.equal(els.input.value, '{"baseInfo":{"servCode":"CAR-13"}}', '编辑区应为解包后文本');
  assert.equal(els.output.hidden, false);
  assert.match(els.status.text, /已自动去除转义/);
  assert.ok(
    stripHtml(els.outputCode.innerHTML).startsWith('{\n  "baseInfo"'),
    '应格式化解包后的 JSON',
  );
});

test('保留转义：不解包，按字面量原样输出', () => {
  els.escape.value = 'keep';
  const escaped = '"{\\"a\\":1}"';
  els.input.value = escaped;
  els.format.dispatch('click');
  assert.equal(els.input.value, escaped, '编辑区保持原样');
  assert.equal(els.output.hidden, false);
  assert.equal(stripHtml(els.outputCode.innerHTML), escaped);
});
