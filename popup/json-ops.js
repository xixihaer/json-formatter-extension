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
