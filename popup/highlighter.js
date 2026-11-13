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
