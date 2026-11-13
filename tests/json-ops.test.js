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
