const fs = require('fs');
const path = require('path');

const { encodeAndroidString } = require('./nativeStrings');

/**
 * The previews the launcher's widget picker draws, written from the sample library.
 *
 * A launcher draws a widget in its picker from the layout its provider info names as
 * `previewLayout`, inflated as authored with nothing bound. A widget's own layout leaves its
 * texts for the renderer to fill, so drawn as authored it is an empty card. Each preview here is
 * that layout with the sample's words written in and the views the sample leaves out hidden, as
 * the renderer draws it at the size the info places by default. A chart or a body the renderer
 * paints as a bitmap has no static form and is hidden, except the route, whose normalised points
 * are a path a vector drawable carries as it is.
 *
 * The sample is `widget/fixtures/demo.json`, the snapshot the engine composes from the demo
 * library, which the iOS gallery draws too. Its words become string resources, so the escaping
 * is the one every other generated string goes through.
 */

const SAMPLE = path.join('widget', 'fixtures', 'demo.json');
const STRINGS_FILE = 'widget_preview_strings.xml';
const ROUTE_DRAWABLE = 'widget_preview_route';

const TREND_ARROW = { up: '▲', down: '▼' };

/** The colour resource the renderer gives a trend arrow, by the verdict and never the direction. */
function trendColor(verdict) {
  if (verdict === 'improved') return '@color/widget_trend_up';
  if (verdict === 'declined') return '@color/widget_trend_down';
  return '@color/widget_trend_flat';
}

const ZONE_TEXT = {
  highRisk: '@color/widget_form_high_risk_text',
  optimal: '@color/widget_form_optimal_text',
  greyZone: '@color/widget_form_grey_zone_text',
  fresh: '@color/widget_form_fresh_text',
  transition: '@color/widget_form_transition_text',
};

function summaryColor(colorKey, zone) {
  if (colorKey === 'blue') return '@color/widget_blue';
  if (colorKey === 'fatigue') return '@color/widget_fatigue';
  if (colorKey === 'formZone') return ZONE_TEXT[zone] ?? '@color/widget_text_primary';
  return '@color/widget_text_primary';
}

const TONE = {
  negative: '@color/widget_tone_negative',
  caution: '@color/widget_tone_caution',
  positive: '@color/widget_tone_positive',
  record: '@color/widget_tone_record',
  info: '@color/widget_tone_info',
  opportunity: '@color/widget_tone_opportunity',
};

/**
 * What one preview binds: `text` by view id, `attrs` by view id for anything else a view takes,
 * and `gone` for the views the sample leaves out. A text that is absent hides its view, as the
 * renderer's own line binding does.
 */
function binding() {
  const b = { text: {}, attrs: {}, gone: new Set() };
  b.set = (id, name, value) => {
    b.attrs[id] = { ...b.attrs[id], [name]: value };
  };
  b.line = (id, text) => {
    if (!text) {
      b.gone.add(id);
      return;
    }
    b.text[id] = text;
    b.set(id, 'visibility', 'visible');
  };
  return b;
}

/** The age row: a sample library carries the words that say so in place of an age. */
function ageRow(b, sample, id) {
  b.line(id, sample.display?.demoLabel);
  b.gone.add('widget_refresh');
}

/** The Summary widget at four by two: the card's hero, its line, and up to four supporting cells. */
function summary(sample) {
  const b = binding();
  const card = sample.summaryCard;
  const zone = sample.metrics?.form?.zone;
  const hero = card.hero;
  const heroColor = summaryColor(hero.colorKey, zone);
  b.line('sum_label', hero.label);
  b.line('sum_value', hero.value);
  b.set('sum_value', 'textColor', heroColor);
  b.line('sum_trend', TREND_ARROW[hero.trendDir] ?? '–');
  b.set('sum_trend', 'textColor', trendColor(hero.verdict));
  b.line('sum_line', hero.id === 'form' ? sample.display?.formZone : null);
  b.set('sum_line', 'textColor', heroColor);
  b.gone.add('sum_sparkline');
  b.gone.add('sum_chart_caption');
  ageRow(b, sample, 'med_updated');
  for (let i = 0; i < 4; i++) {
    const entry = card.entries[i];
    if (!entry) {
      b.gone.add(`sum_cell${i}`);
      if (i > 0) b.gone.add(`sum_div${i}`);
      continue;
    }
    b.line(`sum_cell${i}_label`, entry.label);
    b.line(`sum_cell${i}_value`, entry.value);
    b.set(`sum_cell${i}_value`, 'textColor', summaryColor(entry.colorKey, zone));
    b.line(`sum_cell${i}_trend`, TREND_ARROW[entry.trendDir] ?? '–');
    b.set(`sum_cell${i}_trend`, 'textColor', trendColor(entry.verdict));
  }
  return b;
}

/** The Last activity widget wide: the route, the name, the comparison and the section records. */
function activity(sample) {
  const b = binding();
  const latest = sample.latest;
  const headline = latest.headline;
  b.line('act_name', latest.name);
  if (latest.tintHex) b.set('act_name', 'textColor', latest.tintHex);
  if (latest.isPr && latest.name) b.set('act_pr', 'visibility', 'visible');
  b.line('act_label', headline?.label);
  b.line('act_hero', headline?.hero);
  b.line('act_detail', headline?.detail);
  b.gone.add('act_dots');
  b.line(
    'act_sub',
    headline ? null : [latest.distanceLabel, latest.durationLabel].filter(Boolean).join(' · ')
  );
  b.line('act_prs', latest.sectionPrsText);
  b.gone.add('act_load');
  b.gone.add('act_form');
  b.line('act_date', headline ? null : latest.dateLabel);
  b.line('act_demo', sample.display?.demoLabel);
  if ((latest.routePreview?.points?.length ?? 0) >= 2) {
    b.set('act_preview', 'src', `@drawable/${ROUTE_DRAWABLE}`);
  } else {
    b.gone.add('act_preview');
  }
  return b;
}

/** The Insights widget at four by two: the first two insights, each with its tone. */
function insights(sample) {
  const b = binding();
  b.gone.add('ins_message');
  for (let i = 0; i < 4; i++) {
    const insight = i < 2 ? sample.insights?.[i] : null;
    if (!insight) {
      b.gone.add(`ins_row${i}`);
      continue;
    }
    b.set(`ins_row${i}`, 'visibility', 'visible');
    b.set(`ins_dot${i}`, 'tint', TONE[insight.tone] ?? '@color/widget_tone_neutral');
    b.line(`ins_title${i}`, insight.title);
    b.line(`ins_subtitle${i}`, insight.subtitle);
  }
  b.gone.add('ins_more');
  ageRow(b, sample, 'ins_updated');
  return b;
}

/**
 * The Strength widget at four by two. The body is a bitmap with no static form, so the window's
 * most trained muscles stand in its place, as the large size lists them.
 */
function strength(sample) {
  const b = binding();
  const window = sample.strength.windows.last30;
  b.gone.add('str_bodies');
  b.gone.add('str_message');
  b.line('str_label', window.label);
  b.set('str_label', 'visibility', 'visible');
  for (let i = 0; i < 4; i++) {
    const muscle = i < 2 ? window.top?.[i] : null;
    if (!muscle) {
      b.gone.add(`str_row${i}`);
      continue;
    }
    b.set(`str_row${i}`, 'visibility', 'visible');
    b.line(`str_name${i}`, muscle.name);
    b.line(`str_detail${i}`, [muscle.setsText, muscle.volumeText].filter(Boolean).join(' · '));
  }
  ageRow(b, sample, 'str_updated');
  return b;
}

/** Each preview: the layout it is written from, the name it is written to, and its binding. */
const PREVIEWS = [
  { layout: 'widget_medium', preview: 'widget_preview_summary', bind: summary },
  { layout: 'widget_activity_medium', preview: 'widget_preview_activity', bind: activity },
  { layout: 'widget_insights', preview: 'widget_preview_insights', bind: insights },
  { layout: 'widget_strength', preview: 'widget_preview_strength', bind: strength },
];

/** A layout file's root element, without the declaration, the comments before it or the namespace. */
function rootElement(xml) {
  const start = xml.search(/<[A-Za-z]/);
  return xml
    .slice(start)
    .replace(/\s+xmlns:android="[^"]*"/, '')
    .trimEnd();
}

/** The layout with every `<include>` replaced by the layout it names, so every id can be bound. */
function inlineIncludes(xml, layoutDir, file) {
  return xml.replace(/<include\b([^>]*?)\/>/g, (whole, attrs) => {
    const name = /^\s*layout="@layout\/([\w]+)"\s*$/.exec(attrs)?.[1];
    if (!name)
      throw new Error(`widget previews: ${file} has an include beyond its layout: ${whole}`);
    const inner = fs.readFileSync(path.join(layoutDir, `${name}.xml`), 'utf8');
    return inlineIncludes(rootElement(inner), layoutDir, `${name}.xml`);
  });
}

/** Sets attributes on the element carrying `id`, replacing any it already has. */
function setAttributes(xml, id, attrs, file) {
  const tag = new RegExp(`<[A-Za-z][\\w.]*\\b[^>]*?android:id="@\\+id/${id}"[^>]*?>`);
  const match = tag.exec(xml);
  if (!match) throw new Error(`widget previews: ${file} has no view @+id/${id}`);
  let element = match[0];
  const indent = /\n([ \t]*)android:id=/.exec(element)?.[1] ?? ' ';
  for (const [name, value] of Object.entries(attrs)) {
    const existing = new RegExp(`android:${name}="[^"]*"`);
    const attribute = `android:${name}="${value}"`;
    element = existing.test(element)
      ? element.replace(existing, attribute)
      : element.replace(
          /\s*(\/?)>$/,
          (_, close) => `\n${indent}${attribute}${close ? ' />' : '>'}`
        );
  }
  return xml.slice(0, match.index) + element + xml.slice(match.index + match[0].length);
}

/** A vector drawable of the sample route, letterboxed as `RoutePreviewBitmap` draws it. */
function routeDrawable(preview, color) {
  const aspect = preview.aspect > 0 ? preview.aspect : 1;
  const height = 100;
  const width = height * aspect;
  const stroke = Math.min(width, height) * 0.05;
  const at = (v) => Number(v.toFixed(2));
  const data = preview.points
    .map(
      ([x, y], i) => `${i === 0 ? 'M' : 'L'}${at(stroke + x * width)},${at(stroke + y * height)}`
    )
    .join(' ');
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated at prebuild from ${SAMPLE}. Do not edit. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
  android:width="${at(width + stroke * 2)}dp"
  android:height="${at(height + stroke * 2)}dp"
  android:viewportWidth="${at(width + stroke * 2)}"
  android:viewportHeight="${at(height + stroke * 2)}">
  <path
    android:pathData="${data}"
    android:strokeColor="${color}"
    android:strokeWidth="${at(stroke)}"
    android:strokeLineCap="round"
    android:strokeLineJoin="round" />
</vector>
`;
}

/**
 * Writes every preview layout, its string resources and the route drawable into `resDir`, which
 * already holds the widget layouts. A tree with no sample has nothing to write them from, and the
 * provider infos then name layouts that do not exist, which the build refuses.
 */
function writeWidgetPreviews(projectRoot, resDir) {
  const samplePath = path.join(projectRoot, SAMPLE);
  if (!fs.existsSync(samplePath)) return;
  const sample = JSON.parse(fs.readFileSync(samplePath, 'utf8'));
  const layoutDir = path.join(resDir, 'layout');
  const strings = [];

  for (const { layout, preview, bind } of PREVIEWS) {
    const file = `${layout}.xml`;
    const source = fs.readFileSync(path.join(layoutDir, file), 'utf8');
    let xml = inlineIncludes(source, layoutDir, file);
    const b = bind(sample);
    for (const [id, text] of Object.entries(b.text)) {
      const name = `${preview}_${id}`;
      strings.push(
        `  <string name="${name}" translatable="false">${encodeAndroidString(text)}</string>`
      );
      xml = setAttributes(xml, id, { text: `@string/${name}` }, file);
    }
    for (const [id, attrs] of Object.entries(b.attrs)) {
      if (!b.gone.has(id)) xml = setAttributes(xml, id, attrs, file);
    }
    for (const id of b.gone) xml = setAttributes(xml, id, { visibility: 'gone' }, file);
    const body = rootElement(xml).replace(
      /^<([A-Za-z][\w.]*)/,
      '<$1 xmlns:android="http://schemas.android.com/apk/res/android"'
    );
    fs.writeFileSync(
      path.join(layoutDir, `${preview}.xml`),
      `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated at prebuild from ${file} and ${SAMPLE}: the picker's preview. Do not edit. -->
${body}
`
    );
  }

  const values = path.join(resDir, 'values');
  fs.mkdirSync(values, { recursive: true });
  fs.writeFileSync(
    path.join(values, STRINGS_FILE),
    `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated at prebuild from ${SAMPLE}: the words of the picker's previews. Do not edit. -->
<resources>
${strings.join('\n')}
</resources>
`
  );

  const route = sample.latest?.routePreview;
  if ((route?.points?.length ?? 0) >= 2) {
    const drawables = path.join(resDir, 'drawable');
    fs.mkdirSync(drawables, { recursive: true });
    fs.writeFileSync(
      path.join(drawables, `${ROUTE_DRAWABLE}.xml`),
      routeDrawable(route, sample.latest.tintHex || '@color/widget_text_primary')
    );
  }
}

module.exports = { writeWidgetPreviews, PREVIEWS };
