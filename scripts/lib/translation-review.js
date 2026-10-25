// One locale's translation review sheet, as markdown: the values it accepts as
// identical to en-US with each reason, and every value it has changed or added
// since a revision. A person reads it; nothing here judges a translation.

/** Every string leaf of a bundle under its dotted key. */
function leaves(bundle, prefix = '', out = new Map()) {
  for (const [key, value] of Object.entries(bundle ?? {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out.set(path, value);
    else if (value && typeof value === 'object') leaves(value, path, out);
  }
  return out;
}

function cell(value) {
  return (value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

function row(values) {
  return `| ${values.map(cell).join(' | ')} |`;
}

function isBundle(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** `override` laid over `base` key by key, down to the leaves. */
function mergeBundles(base, override) {
  const result = { ...base };
  for (const [key, value] of Object.entries(override ?? {})) {
    const previous = result[key];
    result[key] = isBundle(value) && isBundle(previous) ? mergeBundles(previous, value) : value;
  }
  return result;
}

/**
 * The bundle a reader gets for the first name in `chain`: each later name
 * fills the keys the earlier ones lack, as the app's fallback chain does.
 * `load` returns the bundle for a name.
 */
function resolvedBundle(chain, load) {
  return chain.reduceRight((result, name) => mergeBundles(result, load(name)), {});
}

/**
 * The sheet for `locale`. `reference` is the en-US bundle and `current` the
 * locale's bundle now, both resolved through their fallback chains. `before` is
 * its bundle at `since` (empty when the locale did not exist then), and
 * `accepted` the locale's accepted keys with reasons.
 */
function reviewSheet({ locale, since, reference, current, before, accepted }) {
  const en = leaves(reference);
  const now = leaves(current);
  const then = leaves(before);

  const acceptedKeys = Object.keys(accepted ?? {}).sort();
  const drifted = acceptedKeys.filter((key) => now.get(key) !== en.get(key));

  const changedKeys = [...now.keys()]
    .filter((key) => then.has(key) && now.get(key) !== then.get(key))
    .sort();
  const newKeys = [...now.keys()].filter((key) => !then.has(key)).sort();

  const lines = [
    `# Translation review: ${locale}`,
    '',
    `${acceptedKeys.length} accepted identical values, ` +
      `${changedKeys.length} changed translations and ${newKeys.length} new translations ` +
      `since ${since}.`,
    '',
    'For each accepted value: is the English right in this language, and is the reason true?',
  ];

  const table = (title, header, rows) => {
    lines.push('', `## ${title}`, '');
    if (rows.length === 0) {
      lines.push('None.');
      return;
    }
    lines.push(row(header), `|${'---|'.repeat(header.length)}`);
    for (const values of rows) lines.push(row(values));
  };

  table(
    'Accepted identical values',
    ['Key', locale, 'en-US', 'Reason'],
    acceptedKeys.map((key) => [key, now.get(key), en.get(key), accepted[key]])
  );
  if (drifted.length > 0) {
    lines.push('', `These accepted keys are no longer identical to en-US: ${drifted.join(', ')}.`);
  }
  table(
    'Changed translations',
    ['Key', 'Before', 'After', 'en-US'],
    changedKeys.map((key) => [key, then.get(key), now.get(key), en.get(key)])
  );
  table(
    'New translations',
    ['Key', locale, 'en-US'],
    newKeys.map((key) => [key, now.get(key), en.get(key)])
  );

  return `${lines.join('\n')}\n`;
}

module.exports = { leaves, resolvedBundle, reviewSheet };
