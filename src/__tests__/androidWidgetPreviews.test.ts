/**
 * Scenario: an athlete opens the launcher's widget picker. The picker draws each widget from the
 * preview layout its provider info names, inflated as authored with nothing bound, so a preview
 * that is the widget's own layout shows an empty card or the widget's name alone.
 *
 * Expected behaviour: every widget that draws the snapshot names a preview layout written from
 * the sample library, every text it shows carries words, and the words are the sample's.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

import { DOMParser } from '@xmldom/xmldom';

const androidPlugin = require('@/../src/plugins/with-android-widget.js');
const { decodeAndroidString } = require('@/../src/plugins/nativeStrings.js');

const projectRoot = path.join(__dirname, '../..');
const PKG = 'com.example.widgets';
const ANDROID_NS = 'http://schemas.android.com/apk/res/android';

/** The Quick-Record button draws the same glyph and word with or without a snapshot. */
const DRAWS_NO_SNAPSHOT = new Set(['widget_record_info.xml']);

let res: string;
let root: string;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'widget-previews-'));
  androidPlugin.writeWidgetSources(projectRoot, root, PKG);
  res = path.join(root, 'app', 'src', 'main', 'res');
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function parse(file: string): Element {
  return new DOMParser().parseFromString(fs.readFileSync(file, 'utf8'), 'text/xml')
    .documentElement as unknown as Element;
}

function attr(el: Element, name: string): string | null {
  return el.getAttributeNS(ANDROID_NS, name) || null;
}

/** The default-locale string resources, by name. */
function strings(): Map<string, string> {
  const out = new Map<string, string>();
  const dir = path.join(res, 'values');
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.xml'))) {
    const nodes = parse(path.join(dir, file)).getElementsByTagName('string');
    for (let i = 0; i < nodes.length; i++) {
      out.set(nodes[i].getAttribute('name') ?? '', decodeAndroidString(nodes[i].textContent ?? ''));
    }
  }
  return out;
}

/** Every string the sample library carries. */
function sampleWords(): Set<string> {
  const words = new Set<string>();
  const walk = (value: unknown): void => {
    if (typeof value === 'string' && value.trim()) words.add(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  walk(JSON.parse(fs.readFileSync(path.join(projectRoot, 'widget/fixtures/demo.json'), 'utf8')));
  return words;
}

type Text = { id: string; text: string | null };

/**
 * The text views a layout shows as authored, includes followed, with each one's words resolved.
 * A view under a gone parent is not shown, and a one-dp rule is a divider rather than a text.
 */
function shownTexts(layout: string, names: Map<string, string>): Text[] {
  const out: Text[] = [];
  const visit = (el: Element): void => {
    if (attr(el, 'visibility') === 'gone') return;
    if (el.tagName === 'include') {
      const name = (el.getAttribute('layout') ?? '').replace('@layout/', '');
      visit(parse(path.join(res, 'layout', `${name}.xml`)));
      return;
    }
    const rule = attr(el, 'layout_width') === '1dp' || attr(el, 'layout_height') === '1dp';
    const id = attr(el, 'id');
    if (el.tagName === 'TextView' && id && !rule) {
      const raw = attr(el, 'text');
      const text = raw?.startsWith('@string/') ? (names.get(raw.slice(8)) ?? null) : raw;
      out.push({ id, text });
    }
    for (let i = 0; i < el.childNodes.length; i++) {
      const child = el.childNodes[i];
      if (child.nodeType === 1) visit(child as unknown as Element);
    }
  };
  visit(parse(path.join(res, 'layout', `${layout}.xml`)));
  return out;
}

const infos = (): string[] =>
  fs.readdirSync(path.join(res, 'xml')).filter((name) => name.endsWith('_info.xml'));

/** The layout an info names as its preview, without the `@layout/` prefix. */
function previewOf(info: string): string {
  return (attr(parse(path.join(res, 'xml', info)), 'previewLayout') ?? '').replace('@layout/', '');
}

describe('the widget previews in the Android picker', () => {
  it('names a preview layout that exists for every widget', () => {
    expect(infos().length).toBeGreaterThan(0);
    const missing = infos().filter(
      (info) => !fs.existsSync(path.join(res, 'layout', `${previewOf(info)}.xml`))
    );
    expect(missing).toEqual([]);
  });

  it('draws words in every text a preview shows', () => {
    const names = strings();
    const empty = infos().flatMap((info) =>
      shownTexts(previewOf(info), names)
        .filter((t) => !t.text?.trim())
        .map((t) => `${info}: ${t.id}`)
    );
    expect(empty).toEqual([]);
  });

  it('draws the sample library in every widget that draws the snapshot', () => {
    const names = strings();
    const words = sampleWords();
    const unfilled = infos()
      .filter((info) => !DRAWS_NO_SNAPSHOT.has(info))
      .filter(
        (info) =>
          shownTexts(previewOf(info), names).filter((t) => words.has(t.text ?? '')).length < 3
      );
    expect(unfilled).toEqual([]);
  });
});
