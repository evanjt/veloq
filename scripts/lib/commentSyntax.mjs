// Which comment syntax a tracked file is read in, for the guards that judge
// comments.
//
// The comment guards read every tracked text source, not a list of trees. A
// list is what let an audit id sit in a Kotlin module, a Swift extension and
// the crate's manifest while the guard reported the tree clean: each was a
// tree nobody had thought to add. So the listing is the whole index, and what
// narrows it is the syntax: a file whose comments this cannot read in its own
// syntax is left out, rather than a directory.

/** Slash comments: the TypeScript, JavaScript, Rust and the native sources. */
const SLASH = /\.(tsx?|[cm]?js|rs|kts?|swift|java|gradle|[ch]|mm?|cpp|hpp)$/;

/** Hash comments: the shell, the YAML and TOML, and Ruby's build files. */
const HASH = /\.(sh|ya?ml|toml|pro|podspec|rb)$/;

/** Hash-commented files known by their name rather than an extension. */
const HASH_NAMED = /(^|\/)(\.gitignore|\.prettierignore|\.gitmodules|\.npmrc|justfile|Fastfile|Gemfile|Appfile|Matchfile|Podfile)$/;

/**
 * A generated directory or a `.generated.` file, not any path holding the word.
 * The generated bindings carry the crate's own docstrings, so a hit there is
 * the Rust comment reported twice and fixed once.
 */
const GENERATED = /(^|\/)generated\/|\.generated\./;

/** XML comments: the Android manifests and resources, plists and entitlements. */
const XML = /\.(xml|plist|entitlements)$/;

/** 'slash', 'hash', 'xml', or null for a file no comment guard reads. */
export function commentSyntaxOf(file) {
  if (GENERATED.test(file)) return null;
  if (SLASH.test(file)) return 'slash';
  if (XML.test(file)) return 'xml';
  // The hooks git runs carry no extension, so a file directly under `.husky`
  // is a shell script by where it sits.
  if (HASH.test(file) || HASH_NAMED.test(file) || /^\.husky\/[^/.]+$/.test(file)) return 'hash';
  return null;
}

// A quote opens a string only when its partner follows on the line, so a Rust
// lifetime or an apostrophe in code does not hide a comment after it.
function stringEnd(line, start, quote) {
  for (let i = start + 1; i < line.length; i++) {
    if (line[i] === '\\') i++;
    else if (line[i] === quote) return i;
  }
  return -1;
}

/**
 * Where a comment opens on one line, outside a string literal: the index just
 * past its marker, or -1. A marker that opens the line always counts, because
 * a block comment's continuation line starts with `*`.
 */
function markerEnd(line, syntax) {
  const lead = line.match(syntax === 'slash' ? /^\s*(\/\/+!?|\/\*+|\*)/ : /^\s*#+/);
  if (lead) return lead[0].length;
  const quotes = syntax === 'slash' ? '\'"`' : '\'"';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quotes.includes(c)) {
      const end = stringEnd(line, i, c);
      if (end !== -1) i = end;
    } else if (syntax === 'slash' && c === '/' && (line[i + 1] === '/' || line[i + 1] === '*')) {
      return i + 2;
    } else if (syntax === 'hash' && c === '#' && /\s/.test(line[i - 1] ?? '')) {
      return i + 1;
    }
  }
  return -1;
}

/**
 * Every comment in a file as `{ line, text }`, `line` 1-based and `text` the
 * comment after its marker. A comment trailing code is read, and so is an XML
 * `<!-- -->` span on each line it covers.
 */
export function commentsOf(text, syntax) {
  const comments = [];
  let inXml = false;
  text.split('\n').forEach((line, i) => {
    if (syntax === 'xml') {
      let rest = line;
      const found = [];
      while (rest.length > 0) {
        if (inXml) {
          const close = rest.indexOf('-->');
          found.push(close === -1 ? rest : rest.slice(0, close));
          if (close === -1) break;
          rest = rest.slice(close + 3);
          inXml = false;
        } else {
          const open = rest.indexOf('<!--');
          if (open === -1) break;
          rest = rest.slice(open + 4);
          inXml = true;
        }
      }
      if (found.length > 0) comments.push({ line: i + 1, text: found.join(' ') });
      return;
    }
    const at = markerEnd(line, syntax);
    if (at !== -1) comments.push({ line: i + 1, text: line.slice(at) });
  });
  return comments;
}
