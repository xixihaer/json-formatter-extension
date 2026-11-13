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
  // 新版 V8（Node 20+/新 Chrome）部分错误信息完全不含位置，用自研扫描器兜底
  const pos = scanJsonError(text);
  if (pos !== null) {
    const { line, col } = positionToLineCol(text, pos);
    return { message, line, col };
  }
  return { message, line: null, col: null };
}

// 手写 JSON 扫描器：返回第一个语法错误的 0-based 位置；合法返回 null。
// 只为定位错误位置服务，不做完整校验语义（如重复键）。
const NUM_RE = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

export function scanJsonError(text) {
  let i = 0;
  const n = text.length;
  const ws = () => { while (i < n && /\s/.test(text[i])) i++; };
  const lit = (word) => {
    if (text.startsWith(word, i)) { i += word.length; return true; }
    return false;
  };

  function parseString() {
    i++; // 开引号
    while (i < n) {
      const c = text[i];
      if (c === '"') { i++; return true; }
      if (c === '\\') {
        const esc = text[i + 1];
        if (esc === 'u') {
          if (!/^[0-9a-fA-F]{4}/.test(text.slice(i + 2, i + 6))) return false;
          i += 6;
        } else if ('"\\/bfnrt'.includes(esc)) {
          if (esc === undefined) return false;
          i += 2;
        } else {
          return false; // 非法转义，位置停在反斜杠处
        }
        continue;
      }
      if (c === '\n' || c === '\r') return false; // 字符串内裸控制字符
      i++;
    }
    return false; // 未闭合，i 停在末尾
  }

  function value(depth) {
    if (depth > 512) return false;
    ws();
    if (i >= n) return false;
    const c = text[i];
    if (c === '{') return objectValue(depth);
    if (c === '[') return arrayValue(depth);
    if (c === '"') return parseString();
    if (c === 't') return lit('true');
    if (c === 'f') return lit('false');
    if (c === 'n') return lit('null');
    if (c === '-' || (c >= '0' && c <= '9')) {
      NUM_RE.lastIndex = i;
      const m = NUM_RE.exec(text);
      if (m && m[0].length > 0) { i += m[0].length; return true; }
    }
    return false;
  }

  function objectValue(depth) {
    i++; // {
    ws();
    if (text[i] === '}') { i++; return true; }
    for (;;) {
      ws();
      if (text[i] !== '"') return false;
      if (!parseString()) return false;
      ws();
      if (text[i] !== ':') return false;
      i++;
      if (!value(depth + 1)) return false;
      ws();
      if (text[i] === ',') { i++; continue; }
      if (text[i] === '}') { i++; return true; }
      return false;
    }
  }

  function arrayValue(depth) {
    i++; // [
    ws();
    if (text[i] === ']') { i++; return true; }
    for (;;) {
      if (!value(depth + 1)) return false;
      ws();
      if (text[i] === ',') { i++; continue; }
      if (text[i] === ']') { i++; return true; }
      return false;
    }
  }

  if (!value(0)) return Math.min(i, n);
  ws();
  if (i === n) return null; // 全部消费且合法
  return i; // 尾部多余内容，如 '{} x'
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
