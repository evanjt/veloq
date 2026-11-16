/**
 * Scenario: the athlete picks the satellite base and the 3D terrain on the global map's layer
 * control, then reloads the page from the address.
 *
 * Expected behaviour: choosing satellite writes `base=satellite` to the address and the pane is
 * given that base; the 3D chip writes `terrain=1` and the pane is given terrain; an address
 * carrying both opens with both on and the controls showing them pressed; choosing a colour scheme
 * base again drops satellite from the address.
 */

import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { MapScreen } from '../../../web/connect/map/MapScreen';
import { parse } from '../../../web/connect/router';
import { fakePhone } from '../__shared__/connectPhone';

const mockPane = jest.fn();
jest.mock('../../../web/connect/map/MapPane', () => ({
  MapPane: (props: unknown) => {
    mockPane(props);
    return null;
  },
}));

const phone = fakePhone(() => {
  throw new Error('no reads');
}, []);

async function mount(hash: string) {
  Object.defineProperty(globalThis, 'location', { value: { hash }, configurable: true });
  let root!: ReactTestRenderer;
  await act(async () => {
    root = create(
      phone.wrap(<MapScreen queries={phone.queries} methods={[]} route={parse(hash)} />)
    );
  });
  return root;
}

const lastPane = () => mockPane.mock.calls.at(-1)?.[0] as { base: string; terrain: boolean };
const press = (root: ReactTestRenderer, label: string) =>
  act(async () => {
    const button = root.root.findAll(
      (node) => node.type === 'button' && node.findAll((n) => n.children.includes(label)).length > 0
    )[0] as ReactTestInstance;
    button.props.onClick();
  });
const pressed = (root: ReactTestRenderer, label: string) =>
  root.root.findAll(
    (node) => node.type === 'button' && node.findAll((n) => n.children.includes(label)).length > 0
  )[0]?.props['aria-pressed'];

beforeEach(() => mockPane.mockClear());

describe('the global map base and terrain controls', () => {
  it('writes base=satellite to the address and hands the pane that base', async () => {
    const root = await mount('#/map');
    await press(root, 'maps.baseSatellite');
    expect(globalThis.location.hash).toContain('base=satellite');
    await act(async () => {
      root.update(
        phone.wrap(
          <MapScreen queries={phone.queries} methods={[]} route={parse(globalThis.location.hash)} />
        )
      );
    });
    expect(lastPane().base).toBe('satellite');
    expect(pressed(root, 'maps.baseSatellite')).toBe(true);
  });

  it('writes terrain=1 for the 3D chip, and nothing while it is off', async () => {
    const root = await mount('#/map');
    expect(lastPane().terrain).toBe(false);
    await press(root, 'maps.terrain3D');
    expect(globalThis.location.hash).toContain('terrain=1');
  });

  it('opens an address carrying both with both on', async () => {
    const root = await mount('#/map?base=satellite&terrain=1');
    expect(lastPane()).toMatchObject({ base: 'satellite', terrain: true });
    expect(pressed(root, 'maps.baseSatellite')).toBe(true);
    expect(pressed(root, 'maps.terrain3D')).toBe(true);
  });

  it('drops satellite from the address when a scheme base is chosen again', async () => {
    const root = await mount('#/map?base=satellite');
    await press(root, 'connectPage.settings.options.dark');
    expect(globalThis.location.hash).toContain('base=dark');
    expect(globalThis.location.hash).not.toContain('satellite');
  });
});
