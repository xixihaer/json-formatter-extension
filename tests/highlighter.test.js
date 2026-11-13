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
