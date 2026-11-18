/**
 * Scenario: the routes page and the sections page each draw their own list
 * beside the map, with its own sort, search and chips and its own selected row.
 *
 * Expected behaviour: one engine read carries both lists' queries; the page
 * draws the list it is on from the reply and not the other; the address keeps
 * both lists' states and both selections.
 */

import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { RoutesPage } from '../../../web/connect/pages/RoutesPage';
import { parse, write, type Route } from '../../../web/connect/router';
import { fromRoute, opening, queryFor, toRoute } from '../../../web/connect/routesList';
import { fakePhone } from '../__shared__/connectPhone';

const LIST = {
  groups: [
    {
      groupId: 'g1',
      customName: 'Lake loop',
      distanceMeters: 5000,
      activityCount: 4,
      bestTime: 600,
      sportTypes: ['Ride'],
    },
    {
      groupId: 'g2',
      customName: 'Hill loop',
      distanceMeters: 9000,
      activityCount: 2,
      bestTime: null,
      sportTypes: ['Run'],
    },
  ],
  filteredGroupCount: 2,
  hasMoreGroups: false,
  sections: [{ id: 's1', name: 'Col', distanceMeters: 1000, visitCount: 3, sportTypes: ['Ride'] }],
  filteredSectionCount: 1,
  hasMoreSections: false,
};

function fakeSession() {
  return fakePhone(async (method: string) => {
    if (method === 'routes.screen') return LIST;
    throw new Error(`unexpected read ${method}`);
  });
}

async function settle() {
  for (let at = 0; at < 4; at += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

const rowsIn = (root: ReactTestRenderer, pane: string) =>
  root.root
    .findAll((node) => node.type === 'div' && node.props.id === pane)
    .flatMap((div) =>
      div.findAll((node) => node.type === 'tr' && node.props['data-row'] !== undefined)
    )
    .map((row) => row.props['data-row']);

const ADDRESS = '#/routes?rsort=name&q=loop&ssort=distance&sq=col&chips=custom';
// The same two lists with the sections page in focus, so the sections' text is the page's `q`.
const SECTIONS_ADDRESS = '#/sections?rsort=name&rq=loop&ssort=distance&q=col&chips=custom';

describe('the routes and sections pages', () => {
  it('draws the list of the page it is on from one read carrying both queries', async () => {
    const session = fakeSession();
    let root!: ReactTestRenderer;
    await act(async () => {
      root = create(session.wrap(<RoutesPage route={parse(ADDRESS)} />));
    });
    await settle();
    expect(rowsIn(root, 'routes-list')).toEqual(['g1', 'g2']);
    expect(rowsIn(root, 'sections-list')).toEqual([]);
    const reads = session.callsOf('routes.screen');
    expect(reads).toHaveLength(1);
    expect(reads[0]?.params).toMatchObject({
      groupSort: 'name',
      groupSearch: 'loop',
      sectionSort: 'distance',
      sectionSearch: 'col',
      sectionFilters: { hideAuto: true, hideDisabled: true },
    });
    root.unmount();

    let sectionsRoot!: ReactTestRenderer;
    await act(async () => {
      sectionsRoot = create(session.wrap(<RoutesPage route={parse(SECTIONS_ADDRESS)} />));
    });
    await settle();
    expect(rowsIn(sectionsRoot, 'sections-list')).toEqual(['s1']);
    expect(rowsIn(sectionsRoot, 'routes-list')).toEqual([]);
    sectionsRoot.unmount();
  });
});

describe('the routes list best time column', () => {
  const cellTexts = (root: ReactTestRenderer) =>
    root.root.findAll((node) => node.type === 'td').map((cell) => cell.children.join(''));

  it('is hidden at first and draws each route best time once shown', async () => {
    const session = fakeSession();
    let root!: ReactTestRenderer;
    await act(async () => {
      root = create(session.wrap(<RoutesPage route={parse('#/routes')} />));
    });
    await settle();
    expect(cellTexts(root)).not.toContain('10 min');

    act(() =>
      root.root
        .findAll((node) => node.type === 'button' && node.props['aria-expanded'] !== undefined)[0]
        .props.onClick()
    );
    const box = root.root
      .findAll((node) => node.type === 'label')
      .find(
        (label) => label.findAll((n) => n.children.includes('connectPage.routes.bestTime')).length
      )!
      .findByType('input');
    act(() => box.props.onChange());

    expect(cellTexts(root)).toContain('10 min');
    root.unmount();
  });
});

describe('the address with both lists', () => {
  it('round-trips each list state and each selection', () => {
    const route: Route = parse(`${ADDRESS}&section=s1`.replace('#/routes', '#/route/g2'));
    const page = fromRoute(route);
    expect(page?.routes).toMatchObject({ sort: 'name', search: 'loop', selected: 'g2' });
    expect(page?.sections).toMatchObject({
      sort: 'distance',
      search: 'col',
      chips: ['custom'],
      selected: 's1',
    });
    expect(parse(write(toRoute(page!)))).toEqual(route);
  });

  it('leaves the other list at its opening state', () => {
    const page = fromRoute(parse('#/sections?q=col'))!;
    expect(page.routes).toEqual(opening('routes'));
    expect(queryFor(page)).toMatchObject({
      groupSort: 'activities',
      groupSearch: '',
      sectionSearch: 'col',
    });
  });
});
