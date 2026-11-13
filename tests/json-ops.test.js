import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatJson, minifyJson, positionToLineCol, describeJsonError, countNodes,
  scanJsonError,
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

test('describeJsonError 无位置信息时用扫描器兜底定位', () => {
  const err = new SyntaxError('Unexpected end of JSON input');
  const info = describeJsonError('{', err);
  assert.equal(info.line, 1);
  assert.equal(info.col, 2);
  assert.equal(info.message, 'Unexpected end of JSON input');
});

test('scanJsonError 定位第一个语法错误的位置', () => {
  assert.equal(scanJsonError('{"a":1}'), null, '合法 JSON 返回 null');
  assert.equal(scanJsonError('{"a":1\n,"b":}'), 12, '值位置缺值');
  assert.equal(scanJsonError('{"a" 1}'), 5, '缺冒号');
  assert.equal(scanJsonError('[1,]'), 3, '尾逗号');
  assert.equal(scanJsonError('[01]'), 2, '非法前导零');
  assert.equal(scanJsonError('{"a":"unclosed'), 14, '未闭合字符串指向末尾');
});

test('describeJsonError 新版 V8 无位置信息时用扫描器定位', () => {
  // Node 22 / 新 Chrome: Unexpected token '}', "..." is not valid JSON（无位置）
  const err = new SyntaxError('Unexpected token \'}\', "{"a":1\\n,"b":}" is not valid JSON');
  const info = describeJsonError('{"a":1\n,"b":}', err);
  assert.equal(info.line, 2);
  assert.equal(info.col, 6);
});

test('countNodes 统计嵌套节点数', () => {
  assert.equal(countNodes(1), 1);
  assert.equal(countNodes({ a: 1, b: 2 }), 3);
  assert.equal(countNodes({ a: [1, 2], b: { c: true } }), 6);
});
