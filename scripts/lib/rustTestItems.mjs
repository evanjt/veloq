// Rust source with the items a `#[cfg(test)]` attribute applies to cut out.
// A test-only import sits among the production items in some files, so the
// attribute cannot be read as "the rest of the file is tests".

const ATTRIBUTE = /#\[cfg\(test\)\]/g;
const SEMICOLON_ITEM = /^(?:pub(?:\([^)]*\))?\s+)?(?:use|const|static|type|extern\s+crate)\b/;

// The index just past the item or statement starting at `from`: the first `;`
// outside every bracket, or the `}` that closes its body.
const itemEnd = (source, from) => {
  const head = source.slice(from).replace(/^(?:\s|#\[[^\]]*\])*/, '');
  const start = source.length - head.length;
  const endsAtSemicolon = SEMICOLON_ITEM.test(head);
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === '/' && next === '/') {
      const nl = source.indexOf('\n', i);
      i = nl === -1 ? source.length : nl;
    } else if (ch === '/' && next === '*') {
      const close = source.indexOf('*/', i + 2);
      i = close === -1 ? source.length : close + 1;
    } else if (
      ch === 'r' &&
      !/\w/.test(source[i - 1] ?? '') &&
      /^r#*"/.test(source.slice(i, i + 20))
    ) {
      const hashes = /^r(#*)"/.exec(source.slice(i, i + 20))[1];
      const close = source.indexOf(`"${hashes}`, i + hashes.length + 2);
      i = close === -1 ? source.length : close + hashes.length;
    } else if (ch === '"') {
      i++;
      while (i < source.length && source[i] !== '"') i += source[i] === '\\' ? 2 : 1;
    } else if (ch === "'") {
      const literal = /^'(?:\\.[^']*|[^\\'])'/.exec(source.slice(i, i + 12));
      if (literal) i += literal[0].length - 1;
    } else if (ch === '{' || ch === '(' || ch === '[') {
      depth++;
    } else if (ch === '}' || ch === ')' || ch === ']') {
      depth--;
      if (depth === 0 && ch === '}' && !endsAtSemicolon) return i + 1;
    } else if (ch === ';' && depth === 0) {
      return i + 1;
    }
  }
  return source.length;
};

export const withoutTestItems = (source) => {
  let out = '';
  let from = 0;
  ATTRIBUTE.lastIndex = 0;
  let match;
  while ((match = ATTRIBUTE.exec(source)) !== null) {
    if (match.index < from) continue;
    out += source.slice(from, match.index);
    from = itemEnd(source, match.index + match[0].length);
    ATTRIBUTE.lastIndex = from;
  }
  return out + source.slice(from);
};
