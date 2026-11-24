import { fromThresholdDisplay, toThresholdDisplay } from '../thresholdEntry';

describe('threshold weight units', () => {
  it('shows a stored 72.5 kg as 159.8 lbs to an imperial athlete', () => {
    expect(toThresholdDisplay(true, 72.5, false)).toBeCloseTo(159.8, 1);
  });

  it('stores 160 lbs typed by an imperial athlete as about 72.57 kg', () => {
    expect(fromThresholdDisplay(true, 160, false)).toBeCloseTo(72.57, 2);
  });

  it('leaves a metric athlete and the non-weight fields unchanged', () => {
    expect(toThresholdDisplay(true, 72.5, true)).toBe(72.5);
    expect(fromThresholdDisplay(true, 72.5, true)).toBe(72.5);
    expect(toThresholdDisplay(false, 250, false)).toBe(250);
    expect(fromThresholdDisplay(false, 250, false)).toBe(250);
  });
});
