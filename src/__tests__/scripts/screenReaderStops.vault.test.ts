/**
 * Scenario: the screen-reader walk is counted on both platforms from the
 * accessibility tree each one exposes, an Android `uiautomator` dump and the
 * XCUITest hierarchy, so the two counts can sit side by side.
 *
 * Expected behaviour: on a screen holding one control with no name, one stop
 * named only by a separator, and a back button walked after the content below
 * it, the walk flags exactly those three on either platform, and counts every
 * other stop clean.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '../../../scripts/measure-screen-reader-stops.py');

type Stop = { name: string; actionable: boolean; flags: string[] };
type Result = { platform: string; counts: Record<string, number>; stops: Stop[] };

function measure(tree: string, ...args: string[]): Result {
  const out = execFileSync('python3', ['-I', SCRIPT, '--json', ...args, '-'], {
    input: tree,
    encoding: 'utf8',
  });
  return (JSON.parse(out) as Result[])[0];
}

function flagged(result: Result) {
  return result.stops
    .filter((s) => s.flags.length > 0)
    .map((s) => ({ name: s.name, flags: s.flags }));
}

const ANDROID_DENSITY = 480;
const ANDROID_PX_PER_DP = ANDROID_DENSITY / 160;
const ANDROID_ARGS = ['--density', String(ANDROID_DENSITY), '--package', 'com.example.orchard'];

/** One node in `uiautomator dump` form; bounds are given in dp and written in px. */
function androidNode(
  attrs: { text?: string; desc?: string; clickable?: boolean; pkg?: string; bounds: number[] },
  children = ''
) {
  const [x1, y1, x2, y2] = attrs.bounds.map((v) => v * ANDROID_PX_PER_DP);
  return `<node index="0" text="${attrs.text ?? ''}" resource-id="" class="android.view.View" package="${attrs.pkg ?? 'com.example.orchard'}" content-desc="${attrs.desc ?? ''}" checkable="false" checked="false" clickable="${attrs.clickable ? 'true' : 'false'}" enabled="true" focusable="${attrs.clickable ? 'true' : 'false'}" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[${x1},${y1}][${x2},${y2}]">${children}</node>`;
}

const ANDROID_TREE = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">${androidNode(
  { pkg: 'com.android.systemui', bounds: [0, 0, 400, 24] },
  androidNode({ pkg: 'com.android.systemui', text: '9', bounds: [8, 4, 20, 20] })
)}${androidNode(
  { bounds: [0, 0, 400, 800] },
  [
    androidNode({ text: 'Pear harvest', bounds: [16, 120, 384, 160] }),
    androidNode({ desc: 'Open the orchard map', clickable: true, bounds: [16, 180, 384, 240] }),
    androidNode({ clickable: true, bounds: [16, 260, 384, 320] }),
    androidNode({ text: '·', bounds: [16, 340, 384, 360] }),
    androidNode(
      { clickable: true, bounds: [16, 380, 384, 440] },
      androidNode({ text: 'Prune the rows', bounds: [24, 390, 300, 430] })
    ),
    androidNode({ desc: 'Navigate up', clickable: true, bounds: [0, 40, 56, 96] }),
  ].join('')
)}</hierarchy>`;

/** One element in the XCUITest hierarchy the Maestro driver serves. */
function iosElement(
  attrs: { label?: string; type?: number; frame: number[] },
  children: object[] = []
) {
  const [X, Y, Width, Height] = attrs.frame;
  return {
    label: attrs.label ?? '',
    identifier: '',
    elementType: attrs.type ?? 1,
    enabled: true,
    selected: false,
    hasFocus: false,
    frame: { X, Y, Width, Height },
    children,
  };
}

const OTHER = 1;
const BUTTON = 9;
const STATIC_TEXT = 48;
const STATUS_BAR = 25;
const SCROLL_BAR = 47;

const IOS_TREE = JSON.stringify({
  depth: 6,
  axElement: iosElement({ type: 2, label: 'Orchard', frame: [0, 0, 400, 800] }, [
    iosElement({ type: 4, frame: [0, 0, 400, 800] }, [
      iosElement({ type: STATUS_BAR, frame: [0, 0, 400, 44] }, [
        iosElement({ type: STATIC_TEXT, label: '09:41', frame: [20, 10, 50, 24] }),
      ]),
      iosElement({ type: STATIC_TEXT, label: 'Pear harvest', frame: [16, 120, 368, 40] }),
      iosElement({ type: BUTTON, label: 'Open the orchard map', frame: [16, 180, 368, 60] }),
      iosElement({ type: BUTTON, frame: [16, 260, 368, 60] }),
      iosElement({ type: STATIC_TEXT, label: '·', frame: [16, 340, 368, 20] }),
      iosElement({ type: BUTTON, label: 'Prune the rows', frame: [16, 380, 368, 60] }, [
        iosElement({ type: STATIC_TEXT, label: 'Prune the rows', frame: [24, 390, 276, 40] }),
      ]),
      iosElement({
        type: SCROLL_BAR,
        label: 'Horizontal scroll bar, 1 page',
        frame: [0, 700, 400, 4],
      }),
      iosElement({ type: OTHER, label: 'Vertical scroll bar, 2 pages', frame: [394, 100, 4, 600] }),
      iosElement({ type: BUTTON, label: 'Back', frame: [0, 50, 56, 50] }),
    ]),
  ]),
});

describe('screen-reader stops', () => {
  it('flags the unnamed control, the separator and the late back button on Android, leaving the system bars out', () => {
    const result = measure(ANDROID_TREE, ...ANDROID_ARGS);

    expect(result.platform).toBe('android');
    expect(flagged(result)).toEqual([
      { name: '', flags: ['unnamed'] },
      { name: '·', flags: ['glyph'] },
      { name: 'Navigate up', flags: ['order'] },
    ]);
    expect(result.counts).toEqual({
      stops: 6,
      unnamed: 1,
      glyph: 1,
      order: 1,
      spacing: 0,
      floor: 0,
      offscreen: 0,
    });
  });

  it('names an Android control from the text inside it', () => {
    const result = measure(ANDROID_TREE, ...ANDROID_ARGS);

    expect(result.stops.map((s) => s.name)).toContain('Prune the rows');
  });

  it('flags the same three on iOS and leaves the application, status bar and scroll bars out', () => {
    const result = measure(IOS_TREE);

    expect(result.platform).toBe('ios');
    expect(flagged(result)).toEqual([
      { name: '', flags: ['unnamed'] },
      { name: '·', flags: ['glyph'] },
      { name: 'Back', flags: ['order'] },
    ]);
    expect(result.stops.map((s) => s.name)).toEqual([
      'Pear harvest',
      'Open the orchard map',
      '',
      '·',
      'Prune the rows',
      'Back',
    ]);
  });

  it('reads a Maestro hierarchy taken on Android the way it reads the dump, without the status bar', () => {
    const node = (
      attrs: { text?: string; desc?: string; clickable?: boolean; id?: string; bounds: number[] },
      children: object[] = []
    ) => {
      const [x1, y1, x2, y2] = attrs.bounds.map((v) => v * ANDROID_PX_PER_DP);
      return {
        attributes: {
          text: attrs.text ?? '',
          accessibilityText: attrs.desc ?? '',
          'resource-id': attrs.id ?? '',
          clickable: attrs.clickable ? 'true' : 'false',
          bounds: `[${x1},${y1}][${x2},${y2}]`,
          class: 'android.view.View',
        },
        children,
      };
    };
    const tree = JSON.stringify({
      attributes: {},
      children: [
        node({ id: 'android:id/content', bounds: [0, 0, 400, 800] }, [
          node({ text: 'Pear harvest', bounds: [16, 120, 384, 160] }),
          node({ clickable: true, bounds: [16, 260, 384, 320] }),
          node({ text: '·', bounds: [16, 340, 384, 360] }),
          node({ desc: 'Navigate up', clickable: true, bounds: [0, 40, 56, 96] }),
        ]),
        node({ id: 'com.android.systemui:id/status_bar', bounds: [0, 0, 400, 24] }, [
          node({ desc: 'Wifi signal full.', bounds: [360, 4, 376, 20] }),
        ]),
      ],
    });

    const result = measure(tree, ...ANDROID_ARGS);

    expect(result.platform).toBe('android');
    expect(flagged(result)).toEqual([
      { name: '', flags: ['unnamed'] },
      { name: '·', flags: ['glyph'] },
      { name: 'Navigate up', flags: ['order'] },
    ]);
  });

  it('walks a tab bar after content scrolled below the screen without flagging it', () => {
    const tree = JSON.stringify({
      axElement: iosElement({ type: 4, frame: [0, 0, 400, 800] }, [
        iosElement({ type: STATIC_TEXT, label: 'Orchard log', frame: [16, 100, 368, 40] }),
        iosElement({ type: STATIC_TEXT, label: "Last year's yield", frame: [16, 1200, 368, 40] }),
        iosElement({ type: BUTTON, label: 'Cider press', frame: [16, 770, 368, 52] }),
        iosElement({ type: BUTTON, label: 'Groves', frame: [0, 700, 200, 60] }),
        iosElement({ type: BUTTON, label: 'Sheds', frame: [200, 700, 200, 60] }),
      ]),
    });

    expect(flagged(measure(tree))).toEqual([{ name: "Last year's yield", flags: ['offscreen'] }]);
  });

  it('holds iOS to 44 pt and Android to 48 dp', () => {
    const ios = JSON.stringify({
      axElement: iosElement({ type: 4, frame: [0, 0, 400, 800] }, [
        iosElement({ type: BUTTON, label: 'Water', frame: [16, 100, 120, 44] }),
        iosElement({ type: BUTTON, label: 'Graft', frame: [16, 200, 120, 43] }),
      ]),
    });
    const android = `<hierarchy>${androidNode(
      { bounds: [0, 0, 400, 800] },
      [
        androidNode({ desc: 'Water', clickable: true, bounds: [16, 100, 136, 148] }),
        androidNode({ desc: 'Graft', clickable: true, bounds: [16, 200, 136, 244] }),
      ].join('')
    )}</hierarchy>`;

    expect(flagged(measure(ios))).toEqual([{ name: 'Graft', flags: ['floor'] }]);
    expect(flagged(measure(android, ...ANDROID_ARGS))).toEqual([
      { name: 'Graft', flags: ['floor'] },
    ]);
  });

  it('flags an undersized target only when its 24-unit circle meets a neighbour', () => {
    const tree = JSON.stringify({
      axElement: iosElement({ type: 4, frame: [0, 0, 400, 800] }, [
        iosElement({ type: BUTTON, label: 'Ripe', frame: [16, 100, 16, 16] }),
        iosElement({ type: BUTTON, label: 'Bruised', frame: [36, 100, 16, 16] }),
        iosElement({ type: BUTTON, label: 'Windfall', frame: [200, 300, 16, 16] }),
      ]),
    });

    const result = measure(tree);
    const spaced = result.stops.filter((s) => s.flags.includes('spacing')).map((s) => s.name);

    expect(spaced).toEqual(['Ripe', 'Bruised']);
  });
});
