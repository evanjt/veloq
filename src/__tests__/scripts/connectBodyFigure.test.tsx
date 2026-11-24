/**
 * Scenario: the strength page draws the athlete's body from the drawing the phone uses.
 *
 * Expected behaviour: the figure's shapes are the shared fills' shapes for the athlete's sex and
 * side; a muscle's engine shade picks its step by attribute, with no inline opacity; untrained
 * muscles carry no shade; the outline is drawn; the legend lists the engine's step ceilings.
 */

import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { bodyFront } from 'react-native-body-highlighter/dist/assets/bodyFront';
import { bodyFemaleBack } from 'react-native-body-highlighter/dist/assets/bodyFemaleBack';

import { BodyFigure, shadeLegend } from '../../../web/connect/BodyFigure';
import { bodyFills } from '../../features/strength/lib/bodyFills';
import { BODY_PARTS } from '../../features/strength/lib/bodyPaths.generated';

const names = (slug: string) => slug;

function render(props: Partial<React.ComponentProps<typeof BodyFigure>> = {}): ReactTestRenderer {
  let root!: ReactTestRenderer;
  act(() => {
    root = create(
      <BodyFigure
        volumes={[]}
        shadeCeilings={[]}
        sex="M"
        names={names}
        chosen={null}
        onChoose={() => undefined}
        {...props}
      />
    );
  });
  return root;
}

const shapes = (root: ReactTestRenderer, side: string) =>
  root.root
    .findAll((node) => node.type === 'svg' && node.props['data-side'] === side)[0]!
    .findAll((node) => node.type === 'path' && node.props.className === 'body-figure-shape');

describe('the generated body paths', () => {
  it('are the drawing library’s own shapes, in its paint order', () => {
    expect(BODY_PARTS.male.front).toEqual(bodyFront);
    expect(BODY_PARTS.female.back).toEqual(bodyFemaleBack);
  });
});

describe('the body figure', () => {
  it('draws the shared fills’ shapes for the athlete’s sex, front and back', () => {
    const male = render({ sex: 'M' });
    const female = render({ sex: 'F' });
    const ds = (root: ReactTestRenderer, side: string) =>
      shapes(root, side).map((node) => node.props.d);
    expect(ds(male, 'front')).toEqual(bodyFills([], 'male', 'front', []).map((f) => f.d));
    expect(ds(female, 'back')).toEqual(bodyFills([], 'female', 'back', []).map((f) => f.d));
    expect(ds(male, 'front')).not.toEqual(ds(female, 'front'));
  });

  it('shades by the engine’s step with an attribute and no inline opacity', () => {
    const volumes = [1, 2, 3, 4, 5].map((shade, at) => ({
      slug: ['chest', 'biceps', 'quadriceps', 'abs', 'deltoids'][at]!,
      shade,
    }));
    const root = render({ volumes, shadeCeilings: [4, 8, 12, 16, 20] });
    const shaded = shapes(root, 'front').filter((node) => node.props['data-shade'] !== undefined);
    expect(new Set(shaded.map((node) => node.props['data-shade']))).toEqual(
      new Set([1, 2, 3, 4, 5])
    );
    for (const node of shaded) {
      expect(node.props.style?.fillOpacity).toBeUndefined();
      expect(node.props.style?.opacity).toBeUndefined();
    }
    const chest = shaded.find((node) => node.props['data-muscle'] === 'chest')!;
    expect(chest.props['data-shade']).toBe(1);
  });

  it('leaves an untrained muscle without a shade', () => {
    const root = render({
      volumes: [{ slug: 'chest', shade: 3 }],
      shadeCeilings: [1.2, 2.4, 3.6, 4.8, 6],
    });
    const biceps = shapes(root, 'front').filter((node) => node.props['data-muscle'] === 'biceps');
    expect(biceps.length).toBeGreaterThan(0);
    for (const node of biceps) expect(node.props['data-shade']).toBeUndefined();
  });

  it('draws the outline of each view', () => {
    const root = render();
    expect(root.root.findAll((n) => n.props.className === 'body-figure-outline')).toHaveLength(2);
  });
});

describe('the legend', () => {
  it('lists untrained, then each step with the most sets it covers', () => {
    expect(shadeLegend([2, 4, 6, 8, 10]).map((step) => step.label)).toEqual([
      '0',
      '2',
      '4',
      '6',
      '8',
      '10',
    ]);
    expect(shadeLegend([2, 4, 6, 8, 10]).map((step) => step.shade)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('keeps every step when nothing was trained', () => {
    expect(shadeLegend([0, 0, 0, 0, 0])).toHaveLength(6);
  });
});
