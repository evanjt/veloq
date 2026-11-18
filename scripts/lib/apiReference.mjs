// The link's API reference page, rendered from web/connect/schema.json.
//
// The overview is written here by hand. Everything per method is read off the schema: its name,
// its doc string (the `doc` of its row in the engine's method table), whether it writes, and the
// fields of its params and its reply. A method with no doc string stops the render, so a row added
// to the table cannot reach the page undocumented.

const SITE_NAME = 'Veloq';

/** @param {string} text */
export function escapeHtml(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** @param {string} name */
const typeId = (name) => `type-${name}`;

/**
 * @typedef {{ $ref?: string, type?: string, enum?: unknown[], const?: unknown, anyOf?: Node[],
 *   items?: Node, properties?: Record<string, Node>, required?: string[], description?: string,
 *   additionalProperties?: boolean | Node }} Node
 */

/**
 * A field's type as inline HTML, naming a record or enum by a link to its entry.
 * @param {Node} node
 * @returns {string}
 */
function typeHtml(node) {
  if (node.$ref) {
    const name = node.$ref.slice('#/$defs/'.length);
    return `<a href="#${typeId(name)}">${escapeHtml(name)}</a>`;
  }
  if (node.anyOf) return node.anyOf.map(typeHtml).join(' | ');
  if (node.enum)
    return node.enum.map((v) => `<code>${escapeHtml(JSON.stringify(v))}</code>`).join(' | ');
  if (node.const !== undefined) return `<code>${escapeHtml(JSON.stringify(node.const))}</code>`;
  if (node.type === 'array') return `${node.items ? typeHtml(node.items) : 'unknown'}[]`;
  if (node.type === 'object') {
    const values = node.additionalProperties;
    if (values && typeof values === 'object') return `object of ${typeHtml(values)}`;
    return 'object';
  }
  return escapeHtml(node.type ?? 'unknown');
}

/**
 * Every definition a node names, directly.
 * @param {Node} node
 * @param {Set<string>} into
 */
function collectRefs(node, into) {
  if (node.$ref) into.add(node.$ref.slice('#/$defs/'.length));
  for (const part of node.anyOf ?? []) collectRefs(part, into);
  if (node.items) collectRefs(node.items, into);
  if (node.additionalProperties && typeof node.additionalProperties === 'object') {
    collectRefs(node.additionalProperties, into);
  }
  for (const field of Object.values(node.properties ?? {})) collectRefs(field, into);
}

/** @param {string} text */
const paragraphs = (text) =>
  text
    .split(/\n\s*\n/)
    .map((p) => `<p>${escapeHtml(p.replace(/\s*\n\s*/g, ' ').trim())}</p>`)
    .join('');

/**
 * The fields of a record as a table, or the variants of an enum as a list.
 * @param {Node} node
 * @param {string} empty what to say for a record with no fields
 */
function shapeHtml(node, empty) {
  if (node.enum) {
    return `<p>One of ${node.enum.map((v) => `<code>${escapeHtml(JSON.stringify(v))}</code>`).join(', ')}.</p>`;
  }
  const fields = Object.entries(node.properties ?? {});
  if (fields.length === 0) {
    return node.type === 'object'
      ? `<p class="none">${escapeHtml(empty)}</p>`
      : `<p>${typeHtml(node)}</p>`;
  }
  const required = new Set(node.required ?? []);
  const rows = fields
    .map(([name, field]) => {
      const note = field.description ? escapeHtml(field.description.replace(/\s*\n\s*/g, ' ')) : '';
      return `<tr><td><code>${escapeHtml(name)}</code></td><td>${typeHtml(field)}</td><td>${required.has(name) ? 'yes' : 'no'}</td><td>${note}</td></tr>`;
    })
    .join('');
  return `<table><thead><tr><th>Field</th><th>Type</th><th>Always present</th><th>Meaning</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/**
 * The definitions reachable from the methods' params and results, in name order.
 * @param {{ methods: { params: Node, result: Node }[], $defs: Record<string, Node> }} schema
 */
function reachable(schema) {
  const seen = new Set();
  const queue = [];
  for (const method of schema.methods) {
    for (const side of [method.params, method.result]) {
      const direct = new Set();
      collectRefs(side, direct);
      queue.push(...direct);
    }
  }
  if (schema.farewells) {
    const direct = new Set();
    collectRefs(schema.farewells, direct);
    queue.push(...direct);
  }
  while (queue.length > 0) {
    const name = /** @type {string} */ (queue.pop());
    if (seen.has(name)) continue;
    seen.add(name);
    const node = schema.$defs[name];
    if (!node) throw new Error(`the schema names ${name} and does not define it`);
    const next = new Set();
    collectRefs(node, next);
    queue.push(...next);
  }
  return [...seen].sort();
}

/**
 * The target of a `$ref` as its definition.
 * @param {{ $defs: Record<string, Node> }} schema
 * @param {Node} node
 */
function resolve(schema, node) {
  if (!node.$ref) return node;
  const name = node.$ref.slice('#/$defs/'.length);
  const found = schema.$defs[name];
  if (!found) throw new Error(`the schema names ${name} and does not define it`);
  return found;
}

/** The name of the farewell type, from the `$ref` the schema gives it. */
const FAREWELL_NAME = (/** @type {{ farewells: Node }} */ schema) =>
  /** @type {string} */ (schema.farewells.$ref).slice('#/$defs/'.length);

/**
 * The farewell reasons: what the phone sends before it hangs up, named by the schema's `farewells`
 * type. Empty when the schema names none.
 * @param {{ farewells?: Node, $defs: Record<string, Node> }} schema
 */
function farewellHtml(schema) {
  if (!schema.farewells) return '';
  const reasons = resolve(schema, schema.farewells).enum ?? [];
  const names = reasons.map((reason) => `<li><code>${escapeHtml(String(reason))}</code></li>`);
  return `
<section id="farewells"><h2>Farewell reasons</h2>
  <p>Before it hangs up, the phone sends a farewell event, <code>{"event": "farewell", "reason": ...}</code>, so the page can say why the connection ended. The reason is one of:</p>
  <ul>${names.join('')}</ul>
  <p>They are the variants of <a href="#${typeId(FAREWELL_NAME(schema))}">${escapeHtml(FAREWELL_NAME(schema))}</a>, listed under <a href="#types-index">Records and enums</a>.</p>
</section>`;
}

/**
 * @param {number} protocol
 * @param {number} minProtocol
 */
function overviewHtml(protocol, minProtocol) {
  return `
<section id="overview">
  <h2>How the link works</h2>
  <p>The ${SITE_NAME} app on the phone holds the athlete's library. A browser page reads and edits it over a direct, encrypted connection between the browser and the phone. No server holds the library: a relay only introduces the two, and sees neither the requests nor the replies.</p>

  <h3 id="pairing">Pairing</h3>
  <ol>
    <li>The browser shows a QR code holding a room id, a one-time secret, its own certificate fingerprint and an expiry.</li>
    <li>The phone scans it and the browser connects.</li>
    <li>Each side proves it holds the secret with an HMAC over both certificates, the browser with <code>pair.prove</code> and the phone in its answer. A relay that swapped either certificate cannot make a proof that verifies.</li>
    <li>The browser polls <code>pair.status</code>, which answers <code>waiting</code>, <code>confirmed</code> or <code>declined</code>. The athlete confirms on the phone, and only then is the browser pinned by its certificate fingerprint.</li>
  </ol>
  <p>The secret is spent on its first use, whether the proof was good or bad, and an invitation lasts at most two minutes. Until a browser is pinned, the only methods the phone answers are the pairing methods; any other is answered with the error <code>not linked</code>. The pairing methods are not rows of the method table below.</p>

  <h3 id="requests">Requests and replies</h3>
  <p>A request is <code>{"id": n, "method": "...", "params": {...}}</code>. Its answer is <code>{"id": n, "result": ...}</code> or <code>{"id": n, "error": "..."}</code>. The id is a number from 1 to 2<sup>32</sup>&nbsp;&minus;&nbsp;1 and says which request a reply answers, because replies may come in any order.</p>
  <p>A browser withdraws a request it no longer wants with <code>{"method": "cancel", "params": {"id": n}}</code>. A cancel has no reply of its own: a request still queued is never run, and the reply of one already running is dropped.</p>
  <p>Every method below is either a read, which the phone answers from a pooled connection and which can write nothing, or a write, which the phone answers by the same function its own screen calls. A phone-only operation (credentials, sign-out, clearing the library, backup, restore, linked devices, pairing, experimental and debug switches) is not a method and is refused as <code>unknown method</code>. The deletes the table carries are recoverable on the phone: a section is retired and a saved workout is marked removed, and the phone lists and restores either.</p>

  <h3 id="framing">Framing</h3>
  <p>From protocol 3 a reply is sent as one or more binary frames of at most 16&nbsp;KiB each, header included, so it fits every browser's data channel limit. Every frame starts with a 10-byte header, all numbers big-endian:</p>
  <table>
    <thead><tr><th>Bytes</th><th>Field</th><th>Meaning</th></tr></thead>
    <tbody>
      <tr><td>0</td><td>version</td><td>The frame layout, 1.</td></tr>
      <tr><td>1</td><td>flags</td><td>Bit 0 (1): the reply bytes, joined, are a gzip stream of the reply text. Bit 1 (2): this is the last frame of its reply.</td></tr>
      <tr><td>2&ndash;5</td><td>id</td><td>The id of the request answered, or 0 for an event or for the reply to a request that did not parse.</td></tr>
      <tr><td>6&ndash;9</td><td>sequence</td><td>This frame's place in the reply, from 0.</td></tr>
    </tbody>
  </table>
  <p>A reply text longer than 4&nbsp;KiB is gzipped before it is cut. A page joins the frames of one id in sequence order up to the one flagged last, inflates the result when the gzip flag is set, and parses it as the JSON above. Before protocol 3 a reply is one text message holding that JSON.</p>

  <h3 id="versions">Versions</h3>
  <p>This reference describes protocol ${protocol}, and the phone still answers protocol ${minProtocol}. A page and a phone each name a range in <code>link.hello</code> and speak the highest version both hold, so an app one release behind the page keeps working. A method added within a version is additive. A method removed or reshaped, or any change to the frame layout or its encoding, raises the version. A request that names a version the phone does not speak is answered with the error <code>version</code>.</p>

  <h3 id="errors">Errors</h3>
  <table>
    <thead><tr><th>Error</th><th>When</th></tr></thead>
    <tbody>
      <tr><td><code>not linked</code></td><td>A method other than a pairing method from a browser that is not pinned.</td></tr>
      <tr><td><code>no pairing open</code></td><td>A pairing method when the phone has no pairing open.</td></tr>
      <tr><td><code>already proved</code></td><td><code>pair.prove</code> after the proof was accepted.</td></tr>
      <tr><td><code>refused: &hellip;</code></td><td>A pairing proof that did not verify, with the reason.</td></tr>
      <tr><td><code>phone locked</code></td><td>A write while the app is not in front of the athlete. The page tells the athlete to unlock the phone.</td></tr>
      <tr><td><code>unknown method: &hellip;</code></td><td>A method that is not in the table.</td></tr>
      <tr><td><code>bad params</code></td><td>Params that do not deserialise into the method's record.</td></tr>
      <tr><td><code>busy</code></td><td>A request while 16 are already outstanding. It is not run.</td></tr>
      <tr><td><code>bad id</code></td><td>An id that is zero or does not fit 32 bits.</td></tr>
      <tr><td><code>version</code></td><td>A request that names a protocol version the phone does not speak.</td></tr>
      <tr><td><code>engine not initialised</code></td><td>A request before the phone has opened its library.</td></tr>
    </tbody>
  </table>
  <p>A method may answer with its own error text when its read or write is refused, for example a setting key the link may not read.</p>

  <h3 id="types">Reading the method sections</h3>
  <p>Each method lists the fields of its params and of its reply, and links the records and enums they name to the entries under <a href="#types-index">Records and enums</a>. A field that is not always present is written <code>null</code> when it has no value. A byte or float run is <code>Base64</code>, one base64 string. A 64-bit integer is a JSON number, exact up to 2<sup>53</sup>. The same shapes, as one JSON Schema document, are <a href="https://veloq.fit/connect/schema.json">schema.json</a> beside the connect page's source.</p>
</section>`;
}

const STYLE = `
:root{--primary:#2f6699;--bg:#fafafa;--text:#1a1a1a;--muted:#666;--card:#fff;--border:#e0e0e0;--code:#f0f0f0;--write:#8a4b00}
@media (prefers-color-scheme:dark){:root{--primary:#6aa3d8;--bg:#121212;--text:#fff;--muted:#aaa;--card:#1e1e1e;--border:#333;--code:#2a2a2a;--write:#e8a85c}}
*{box-sizing:border-box}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Oxygen,Ubuntu,sans-serif;background:var(--bg);color:var(--text);line-height:1.6}
.container{max-width:960px;margin:0 auto;padding:0 24px 64px}
header{border-bottom:1px solid var(--border);padding:24px 0;margin-bottom:24px}
header a{color:var(--text);text-decoration:none;font-weight:700;font-size:24px}
h1{margin:0 0 8px}h2{margin-top:40px}h3{margin-top:28px}
a{color:var(--primary)}
code{background:var(--code);padding:1px 5px;border-radius:4px;font-size:.9em;word-break:break-word}
.method{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:8px 20px 16px;margin:16px 0}
.method h3{margin:12px 0 4px}.method h4{margin:16px 0 4px}
.method-write{color:var(--write);font-weight:600;font-size:.85em;margin-left:8px}
.method-read{color:var(--muted);font-size:.85em;margin-left:8px}
.table-wrap{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:.92em}
th,td{border:1px solid var(--border);padding:6px 10px;text-align:left;vertical-align:top}
th{background:var(--code)}
.none{color:var(--muted)}
.muted{color:var(--muted)}
nav.index{columns:3 220px;font-size:.9em}
nav.index a{display:block}
nav.index h3{break-after:avoid;margin:12px 0 4px}
`;

/**
 * The whole page.
 * @param {{ protocol: number, minProtocol: number,
 *   methods: { name: string, write: boolean, description?: string, params: Node, result: Node }[],
 *   farewells?: Node, $defs: Record<string, Node> }} schema
 * @returns {string}
 */
export function renderApiReference(schema) {
  const missing = schema.methods.filter((m) => !m.description || m.description.trim() === '');
  if (missing.length > 0) {
    throw new Error(
      `methods without a doc string in the engine's table: ${missing.map((m) => m.name).join(', ')}`
    );
  }

  const families = new Map();
  for (const method of schema.methods) {
    const family = method.name.split('.')[0];
    if (!families.has(family)) families.set(family, []);
    families.get(family).push(method);
  }
  const index = [...families.entries()]
    .map(
      ([family, methods]) =>
        `<h3>${escapeHtml(family)}</h3>${methods
          .map((m) => `<a href="#${escapeHtml(m.name)}"><code>${escapeHtml(m.name)}</code></a>`)
          .join('')}`
    )
    .join('');

  const sections = schema.methods
    .map((method) => {
      const params = resolve(schema, method.params);
      const result = resolve(schema, method.result);
      const flag = method.write
        ? '<span class="method-write">write</span>'
        : '<span class="method-read">read</span>';
      return `
<article class="method" id="${escapeHtml(method.name)}">
  <h3><code>${escapeHtml(method.name)}</code>${flag}</h3>
  <p>${escapeHtml(/** @type {string} */ (method.description).trim())}</p>
  <h4>Params: ${typeHtml(method.params)}</h4>
  <div class="table-wrap">${shapeHtml(params, 'Takes no fields: send an empty object.')}</div>
  <h4>Reply: ${typeHtml(method.result)}</h4>
  <div class="table-wrap">${shapeHtml(result, 'Has no fields.')}</div>
</article>`;
    })
    .join('');

  const types = reachable(schema)
    .map((name) => {
      const node = schema.$defs[name];
      return `
<article class="method" id="${typeId(name)}">
  <h3><code>${escapeHtml(name)}</code></h3>
  ${node.description ? paragraphs(node.description) : ''}
  <div class="table-wrap">${shapeHtml(node, 'Has no fields.')}</div>
</article>`;
    })
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Link API reference - ${SITE_NAME}</title>
<meta name="description" content="How a browser pairs with the ${SITE_NAME} app and every method it may ask, with its parameters and reply." />
<link rel="icon" type="image/png" href="../icon.png" />
<style>${STYLE}</style>
</head>
<body>
<header><div class="container"><a href="../">${SITE_NAME}</a> <span class="muted">/ <a href="../connect/">Connect</a></span></div></header>
<main class="container">
<h1>Link API reference</h1>
<p class="muted">Protocol ${schema.minProtocol} to ${schema.protocol}, ${schema.methods.length} methods. Generated from the engine's method table.</p>
${overviewHtml(schema.protocol, schema.minProtocol)}
<section id="methods-index"><h2>Methods</h2><nav class="index">${index}</nav></section>
<section id="methods">${sections}</section>
${farewellHtml(schema)}
<section id="types-index"><h2>Records and enums</h2>${types}</section>
</main>
</body>
</html>
`;
}
