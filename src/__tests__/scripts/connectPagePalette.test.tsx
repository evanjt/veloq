/**
 * Scenario: a keyboard user on the connect page jumps by name from anywhere,
 * and asks which keys are wired.
 *
 * Expected behaviour: typing a section's name and pressing Enter navigates to
 * that section's address; pages and actions are found by name; the shortcuts
 * dialog lists exactly the keys registered, so it follows what is wired.
 */

import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { CommandPalette } from '../../../web/connect/shell/CommandPalette';
import { KeysPane } from '../../../web/connect/shell/KeysPane';
import { chordStep, chordTarget, isPaletteKey, rank } from '../../../web/connect/palette';
import { listShortcuts, registerShortcut } from '../../../web/connect/shortcuts';
import { fakePhone } from '../__shared__/connectPhone';

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en-GB' } }),
}));

jest.mock('../../../web/connect/ui/Dialog', () => ({
  Dialog: (props: { open: boolean; children?: React.ReactNode }) =>
    props.open ? <div>{props.children}</div> : null,
}));

const SECTIONS = {
  groups: [{ groupId: 'g1', customName: 'Lake loop', distanceMeters: 1, activityCount: 2 }],
  sections: [{ id: 's9', name: 'Gorge climb', distanceMeters: 1000, visitCount: 3 }],
};

const phone = () =>
  fakePhone((method: string, params: object) => {
    if (method === 'routes.screen') {
      const ask = params as { groupSearch: string; sectionSearch: string };
      const has = (name: string, search: string) => name.toLowerCase().includes(search);
      return {
        groups: SECTIONS.groups.filter((group) => has(group.customName, ask.groupSearch)),
        sections: SECTIONS.sections.filter((section) => has(section.name, ask.sectionSearch)),
      };
    }
    if (method === 'feed.page') return { cards: [], more: false, matchedCount: 0 };
    if (method === 'strength.picker') return { rows: [], equipment: [], muscles: [] };
    if (method === 'strength.workouts') return { workouts: [] };
    if (method === 'recordings.list') return { recordings: [] };
    throw new Error(`unexpected read ${method}`);
  });

async function settle() {
  for (let at = 0; at < 6; at += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

const input = (root: ReactTestRenderer) => root.root.findByType('input');

describe('the command palette', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('navigates to a section typed by name on Enter', async () => {
    const navigate = jest.fn();
    const session = phone();
    let root!: ReactTestRenderer;
    await act(async () => {
      root = create(
        session.wrap(<CommandPalette open onClose={() => {}} navigate={navigate} actions={[]} />)
      );
    });
    await act(async () => {
      input(root).props.onChange({ currentTarget: { value: 'gorge' } });
    });
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    await settle();
    await act(async () => {
      input(root).props.onKeyDown({ key: 'Enter', preventDefault: () => {} });
    });
    expect(navigate).toHaveBeenCalledWith({ screen: 'section', id: 's9', query: [] });
    expect(session.callsOf('routes.screen')[0]?.params).toMatchObject({ sectionSearch: 'gorge' });
    root.unmount();
  });

  it('runs an action found by name', async () => {
    const run = jest.fn();
    const session = phone();
    let root!: ReactTestRenderer;
    await act(async () => {
      root = create(
        session.wrap(
          <CommandPalette
            open
            onClose={() => {}}
            navigate={() => {}}
            actions={[{ id: 'sidebar', label: 'Collapse sidebar', run }]}
          />
        )
      );
    });
    await act(async () => {
      input(root).props.onChange({ currentTarget: { value: 'collapse side' } });
    });
    await act(async () => {
      input(root).props.onKeyDown({ key: 'Enter', preventDefault: () => {} });
    });
    expect(run).toHaveBeenCalledTimes(1);
    root.unmount();
  });
});

describe('the palette groups', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const headings = (root: ReactTestRenderer) =>
    root.root
      .findAll((node) => node.type === 'li' && node.props.role === 'presentation')
      .map((node) => node.props['data-group']);

  it('lists the pages and the actions when nothing is typed', async () => {
    let root!: ReactTestRenderer;
    await act(async () => {
      root = create(
        phone().wrap(
          <CommandPalette
            open
            onClose={() => {}}
            navigate={() => {}}
            actions={[{ id: 'theme', label: 'Toggle theme', run: () => {} }]}
          />
        )
      );
    });
    expect(headings(root)).toEqual(['page', 'action']);
    root.unmount();
  });

  it('shows five routes of seven and a row that opens the list with the text', async () => {
    const navigate = jest.fn();
    const many = fakePhone((method: string) => {
      if (method === 'routes.screen') {
        return {
          groups: Array.from({ length: 7 }, (_, at) => ({
            groupId: `g${at}`,
            customName: `Lake loop ${at}`,
            distanceMeters: 1,
            activityCount: 2,
          })),
          sections: [],
        };
      }
      if (method === 'feed.page') return { cards: [], more: false, matchedCount: 0 };
      if (method === 'strength.picker') return { rows: [], equipment: [], muscles: [] };
      if (method === 'strength.workouts') return { workouts: [] };
      return { recordings: [] };
    });
    let root!: ReactTestRenderer;
    await act(async () => {
      root = create(
        many.wrap(<CommandPalette open onClose={() => {}} navigate={navigate} actions={[]} />)
      );
    });
    await act(async () => {
      input(root).props.onChange({ currentTarget: { value: 'lake loop' } });
    });
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    await settle();
    expect(headings(root)).toEqual(['route']);
    const options = root.root.findAll((node) => node.type === 'li' && node.props.role === 'option');
    expect(options).toHaveLength(6);
    await act(async () => {
      options[5]?.props.onClick();
    });
    expect(navigate).toHaveBeenCalledWith({
      screen: 'routes',
      id: null,
      query: [['q', 'lake loop']],
    });
    root.unmount();
  });
});

describe('ranking', () => {
  const items = [{ label: 'Activities' }, { label: 'Fitness' }, { label: 'Fit file import' }];

  it('keeps only entries the query matches in order, prefix first', () => {
    expect(rank(items, 'fit').map((item) => item.label)).toEqual(['Fitness', 'Fit file import']);
    expect(rank(items, 'atvs').map((item) => item.label)).toEqual(['Activities']);
    expect(rank(items, 'zzz')).toEqual([]);
  });

  it('keeps the order given for an empty query', () => {
    expect(rank(items, '  ')).toEqual(items);
  });
});

describe('palette keys', () => {
  it('opens on Ctrl+K or Cmd+K, even from a text field', () => {
    expect(isPaletteKey({ key: 'k', ctrlKey: true, target: { tagName: 'INPUT' } })).toBe(true);
    expect(isPaletteKey({ key: 'K', metaKey: true })).toBe(true);
    expect(isPaletteKey({ key: 'k' })).toBe(false);
  });

  it('jumps to a page on g then a letter', () => {
    expect(chordTarget('f')).toBe('feed');
    expect(chordTarget('s')).toBe('sections');
    expect(chordTarget('q')).toBeNull();
  });
});

describe('the shortcuts dialog', () => {
  it('lists every key registered and drops one when it is unregistered', async () => {
    const off = registerShortcut({
      keys: ['x', 'y'],
      label: 'connectPage.keys.test' as never,
      group: 'page',
    });
    let root!: ReactTestRenderer;
    await act(async () => {
      root = create(<KeysPane open onClose={() => {}} />);
    });
    const text = () => JSON.stringify(root.toJSON());
    expect(
      listShortcuts().some((entry) => entry.label === ('connectPage.keys.test' as never))
    ).toBe(true);
    expect(text()).toContain('connectPage.keys.test');
    await act(async () => off());
    expect(text()).not.toContain('connectPage.keys.test');
    root.unmount();
  });
});

describe('the g chord', () => {
  it('goes to a page on g then its letter, within one press', () => {
    const first = chordStep({ key: 'g' }, false);
    expect(first).toEqual({ armed: true, page: null });
    expect(chordStep({ key: 's' }, first.armed)).toEqual({ armed: false, page: 'sections' });
    expect(chordStep({ key: 's' }, false).page).toBeNull();
  });

  it('is never armed by typing a g in a text field', () => {
    expect(chordStep({ key: 'g', target: { tagName: 'INPUT' } }, false).armed).toBe(false);
    expect(chordStep({ key: 's', target: { tagName: 'INPUT' } }, true).page).toBeNull();
  });
});
