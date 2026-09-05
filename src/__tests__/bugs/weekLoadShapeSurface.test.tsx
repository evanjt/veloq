/**
 * Scenario: `get_week_load_shape` reached no delegate, so the engine could say
 * what shape a week had and no screen asked. The
 * reading separates weeks the total cannot: of 190 loaded weeks, those
 * carrying 200 to 400 points ran from 0.45 to 1.92.
 *
 * Expected behaviour: a surface asks for it and says what it means in words.
 * The number is meaningless to an athlete, so it never appears. Half of that
 * account's weeks fall under the four-day floor, so the absent case is the
 * common one and reads as ordinary rather than as an error or a zero.
 */

import { render, screen } from '@testing-library/react-native';

import { WeekShapeCard } from '@/features/fitness/components/WeekShapeCard';
import { describeWeekShape } from '@/features/fitness/lib/weekShape';

jest.mock('veloqrs', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../__shared__/veloqrsStub').withOverrides({})
);
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

describe('what the reading is called in words', () => {
  it('calls an even week even and a lopsided week lopsided', () => {
    expect(describeWeekShape(1.6)).toBe('even');
    expect(describeWeekShape(0.5)).toBe('lopsided');
  });

  it('has a middle, so a week is not forced into one of two extremes', () => {
    expect(describeWeekShape(1.0)).toBe('mixed');
  });

  it('uses no jargon anywhere in the vocabulary', () => {
    const words = [0.3, 0.5, 0.9, 1.0, 1.2, 1.6, 2.4].map(describeWeekShape);
    expect(words).not.toContain('monotony');
    expect(words.every((w) => /^[a-z]+$/.test(w))).toBe(true);
  });
});

describe('the week shape card', () => {
  const shape = { daily: [50, 0, 80, 40, 0, 120, 30], trainingDays: 5, evenness: 1.6 };

  it('renders the reading as a sentence for a week over the floor', () => {
    render(<WeekShapeCard shape={shape} />);

    expect(screen.getByTestId('week-shape-reading')).toBeTruthy();
  });

  it('never shows the number itself, which means nothing to an athlete', () => {
    render(<WeekShapeCard shape={shape} />);

    expect(screen.queryByText(/1\.6/)).toBeNull();
    expect(screen.queryByText(/1,6/)).toBeNull();
  });

  it('draws one bar per day of the window', () => {
    render(<WeekShapeCard shape={shape} />);

    expect(screen.getAllByTestId(/^week-shape-bar-/)).toHaveLength(7);
  });

  it('reads a week under the floor as ordinary, not as an error or a zero', () => {
    render(<WeekShapeCard shape={null} />);

    expect(screen.getByTestId('week-shape-quiet')).toBeTruthy();
    expect(screen.queryByTestId('week-shape-reading')).toBeNull();
    expect(screen.queryByText(/0/)).toBeNull();
  });

  it('shows the days that carried load, which the bars and the total agree on', () => {
    render(<WeekShapeCard shape={shape} />);

    const drawn = screen
      .getAllByTestId(/^week-shape-bar-/)
      .filter((b) => b.props.accessibilityValue?.now > 0);
    expect(drawn).toHaveLength(shape.trainingDays);
  });
});
