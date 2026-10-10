// How the MapLibre renderer source is rewritten before it is inlined into the
// map pages. Every change here keeps the source's meaning: both rewrites only
// add a backslash escape, and JavaScript reads the escape back as the
// character it replaced.

/**
 * The renderer source, safe to inline in a `<script>` and pure ASCII.
 *
 * A `</script` anywhere in the source would close the tag it is inlined into,
 * so its slash is escaped, keeping the tag name's case. Done once here rather
 * than per page build, which would rescan a megabyte every time a map opens.
 *
 * Hermes stores a string holding any character above U+007F as UTF-16, so one
 * such character doubles the renderer and every page string concatenated from
 * it. Each UTF-16 code unit above U+007F is written as a `\uXXXX` escape, and a
 * surrogate pair as two. The renderer carries them only inside its own string
 * literals, where the escape reads back as the same character.
 */
function forInlining(source) {
  return source
    .replace(/<\/(script)/gi, '<\\/$1')
    .replace(/[^\x00-\x7f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

module.exports = { forInlining };
