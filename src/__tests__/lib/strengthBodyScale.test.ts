/**
 * Scenario: the front and back figures sit either side of a fixed centre
 * column inside a row whose width is the screen's.
 *
 * Expected behaviour: the figures never draw wider than their share of the row,
 * so they never cover the column between them; on a wide screen they keep the
 * scale the caller asked for, and on a row too narrow to hold both beside the
 * column at a legible size the column moves under them.
 */
import { BODY_INTRINSIC_W, bodyPairLayout } from '@/features/strength/lib/bodyScale';

function rowWidth(scale: number, gap: number): number {
  return 2 * BODY_INTRINSIC_W * scale + gap;
}

describe('bodyPairLayout', () => {
  it('fits both figures beside the centre column on a 360 dp screen', () => {
    const layout = bodyPairLayout(344, 120, 0.65);
    expect(layout.stackCenter).toBe(false);
    expect(rowWidth(layout.scale, 120)).toBeLessThanOrEqual(344);
  });

  it('fits both figures beside the centre column on a 320 dp screen', () => {
    const layout = bodyPairLayout(304, 120, 0.65);
    expect(layout.stackCenter).toBe(false);
    expect(rowWidth(layout.scale, 120)).toBeLessThanOrEqual(304);
  });

  it('keeps the requested scale where the row has room for it', () => {
    expect(bodyPairLayout(412, 120, 0.65)).toEqual({ scale: 0.65, stackCenter: false });
    expect(bodyPairLayout(380, 120, 0.65)).toEqual({ scale: 0.65, stackCenter: false });
  });

  it('moves the centre column under the figures when beside it they would shrink below a legible size', () => {
    const layout = bodyPairLayout(240, 120, 0.65);
    expect(layout.stackCenter).toBe(true);
    expect(rowWidth(layout.scale, 0)).toBeLessThanOrEqual(240);
    expect(layout.scale).toBeGreaterThan(bodyPairLayout(304, 120, 0.65).scale);
  });

  it('never stacks a pair that has no centre column', () => {
    expect(bodyPairLayout(200, 0, 0.6)).toEqual({ scale: 0.5, stackCenter: false });
  });

  it('draws nothing rather than a negative scale before the row has a width', () => {
    expect(bodyPairLayout(0, 120, 0.65).scale).toBe(0);
  });
});
