/**
 * Scenario: a connect page opened in a browser whose system is dark is turned
 * light from the command palette, and the choice is still there on the next visit.
 *
 * Expected behaviour: the palette's theme action writes the choice the browser
 * keeps and sets it on the page root; the next mount reads it back; a map reads
 * the same choice rather than the operating system's.
 */

import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import {
  THEME_KEY,
  flipTheme,
  isDarkScheme,
  isThemeChoice,
  readTheme,
  schemeIsDark,
  systemPrefersDark,
  useTheme,
  type ThemeChoice,
} from '../../../web/connect/appearance';
import { CommandPalette } from '../../../web/connect/shell/CommandPalette';
import { fakePhone } from '../__shared__/connectPhone';

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en-GB' } }),
}));

jest.mock('../../../web/connect/ui/Dialog', () => ({
  Dialog: (props: { open: boolean; children?: React.ReactNode }) =>
    props.open ? <div>{props.children}</div> : null,
}));

let systemDark = false;
let stored: Map<string, string>;
let pageRoot: { dataset: Record<string, string | undefined> };

function installBrowser() {
  stored = new Map();
  pageRoot = { dataset: {} };
  Object.assign(globalThis, {
    localStorage: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => void stored.set(key, value),
    },
    document: { documentElement: pageRoot },
    matchMedia: () => ({ matches: systemDark }),
  });
}

function removeBrowser() {
  const globals = globalThis as Record<string, unknown>;
  delete globals.localStorage;
  delete globals.document;
  delete globals.matchMedia;
}

/** The page's theme as the connect shell wires it: the choice, and the palette action that flips it. */
function ThemeHarness({ onTheme }: { onTheme: (choice: ThemeChoice) => void }) {
  const [theme, choose] = useTheme();
  onTheme(theme);
  return (
    <CommandPalette
      open
      onClose={() => {}}
      navigate={() => {}}
      actions={[
        {
          id: 'theme',
          label: 'Toggle theme',
          run: () => choose(flipTheme(theme, systemPrefersDark())),
        },
      ]}
    />
  );
}

async function mount(onTheme: (choice: ThemeChoice) => void = () => {}) {
  const session = fakePhone(() => ({ cards: [], more: false, groups: [], sections: [] }));
  let root!: ReactTestRenderer;
  await act(async () => {
    root = create(session.wrap(<ThemeHarness onTheme={onTheme} />));
  });
  return root;
}

async function runToggle(root: ReactTestRenderer) {
  const input = root.root.findByType('input');
  await act(async () => {
    input.props.onChange({ currentTarget: { value: 'toggle theme' } });
  });
  await act(async () => {
    root.root.findByType('input').props.onKeyDown({ key: 'Enter', preventDefault: () => {} });
  });
}

describe('the palette theme action', () => {
  beforeEach(() => {
    systemDark = true;
    installBrowser();
  });
  afterEach(() => removeBrowser());

  it('sets the stored choice and the page root carries it, both ways', async () => {
    const root = await mount();
    await runToggle(root);
    expect(stored.get(THEME_KEY)).toBe('light');
    expect(pageRoot.dataset.theme).toBe('light');

    await runToggle(root);
    expect(stored.get(THEME_KEY)).toBe('dark');
    expect(pageRoot.dataset.theme).toBe('dark');
    root.unmount();
  });

  it('keeps the choice for the next visit', async () => {
    stored.set(THEME_KEY, 'light');
    const seen: ThemeChoice[] = [];
    const root = await mount((choice) => seen.push(choice));
    expect(seen.at(-1)).toBe('light');
    expect(pageRoot.dataset.theme).toBe('light');
    root.unmount();
  });
});

describe('the theme choice', () => {
  beforeEach(() => installBrowser());
  afterEach(() => removeBrowser());

  it('flips the scheme the page shows, not the stored word', () => {
    expect(flipTheme('system', true)).toBe('light');
    expect(flipTheme('system', false)).toBe('dark');
    expect(flipTheme('light', true)).toBe('dark');
    expect(flipTheme('dark', false)).toBe('light');
  });

  it('reads an unknown or missing stored value as the system choice', () => {
    expect(readTheme()).toBe('system');
    stored.set(THEME_KEY, 'sepia');
    expect(readTheme()).toBe('system');
    stored.set(THEME_KEY, 'dark');
    expect(readTheme()).toBe('dark');
    expect(isThemeChoice('light')).toBe(true);
    expect(isThemeChoice(null)).toBe(false);
  });

  it('reads as the system choice when the browser refuses storage', () => {
    Object.assign(globalThis, {
      localStorage: {
        getItem: () => {
          throw new Error('blocked');
        },
      },
    });
    expect(readTheme()).toBe('system');
  });

  it('draws dark from the stored choice before the operating system', () => {
    systemDark = true;
    expect(schemeIsDark('system', true)).toBe(true);
    expect(schemeIsDark('light', true)).toBe(false);
    expect(schemeIsDark('dark', false)).toBe(true);
    stored.set(THEME_KEY, 'light');
    expect(isDarkScheme()).toBe(false);
    stored.set(THEME_KEY, 'system');
    expect(isDarkScheme()).toBe(true);
  });
});
