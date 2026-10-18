/**
 * Scenario: a job with a known total reports its count many times a second.
 * Expected behaviour: the row reads as one progress bar with its range and
 * position, and a screen reader hears the start, each quarter and the end,
 * never every tick in between.
 */

import React from 'react';
import { AccessibilityInfo, StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { ProgressBar, ProgressRow, progressMilestone } from '@/shared/ui/ProgressRow';
import { colors, darkColors } from '@/theme';
import { contrastRatio } from '../__shared__/contrast';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysWithValues());

let mockIsDark = false;
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: mockIsDark }) }));

afterEach(() => {
  mockIsDark = false;
});

describe('progressMilestone', () => {
  it('has no milestone while the total is unknown', () => {
    expect(progressMilestone(0, 0)).toBeNull();
    expect(progressMilestone(5, -1)).toBeNull();
  });

  it('rounds down to the last quarter reached', () => {
    expect(progressMilestone(0, 480)).toBe(0);
    expect(progressMilestone(119, 480)).toBe(0);
    expect(progressMilestone(120, 480)).toBe(25);
    expect(progressMilestone(359, 480)).toBe(50);
    expect(progressMilestone(360, 480)).toBe(75);
    expect(progressMilestone(480, 480)).toBe(100);
  });

  it('holds a count past its total at the end', () => {
    expect(progressMilestone(500, 480)).toBe(100);
  });
});

describe('ProgressRow', () => {
  let announce: jest.SpyInstance;

  beforeEach(() => {
    announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation();
  });

  afterEach(() => announce.mockRestore());

  it('exposes a progressbar with its range and position', async () => {
    await render(<ProgressRow label="Writing tiles" done={120} total={490} barTestID="bar" />);

    const bar = screen.getByRole('progressbar');
    expect(bar.props.testID).toBe('bar');
    expect(bar.props.accessibilityValue).toEqual({ min: 0, max: 490, now: 120 });
    expect(bar.props.accessibilityLabel).toBe('Writing tiles');
  });

  it('clamps a count past its total', async () => {
    await render(<ProgressRow label="Writing tiles" done={500} total={490} />);

    expect(screen.getByRole('progressbar').props.accessibilityValue).toEqual({
      min: 0,
      max: 490,
      now: 490,
    });
  });

  it('draws the label and no bar while the total is unknown', async () => {
    await render(<ProgressRow label="Writing tiles" done={0} total={0} />);

    expect(screen.getByText('Writing tiles')).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(announce).not.toHaveBeenCalled();
  });

  it('announces the start, each quarter and the end, and nothing between', async () => {
    const view = await render(<ProgressRow label="Writing tiles" done={0} total={8} />);
    for (let done = 1; done <= 8; done += 1) {
      await view.rerender(<ProgressRow label="Writing tiles" done={done} total={8} />);
    }

    expect(announce.mock.calls.map(([message]) => message)).toEqual(
      [0, 25, 50, 75, 100].map(
        (percent) => `common.progressAnnouncement:{"label":"Writing tiles","percent":${percent}}`
      )
    );
  });

  it('announces nothing when asked to stay quiet', async () => {
    const view = await render(
      <ProgressRow label="Writing tiles" done={0} total={8} announce={false} />
    );
    await view.rerender(<ProgressRow label="Writing tiles" done={8} total={8} announce={false} />);

    expect(announce).not.toHaveBeenCalled();
  });

  it('draws the counts and a trailing action', async () => {
    const { Text } = jest.requireActual('react-native');
    await render(
      <ProgressRow
        label="Writing tiles"
        done={3}
        total={40}
        counts="3/40"
        countsTestID="counts"
        action={<Text testID="row-action">Stop</Text>}
      />
    );

    expect(screen.getByTestId('counts')).toHaveTextContent('3/40');
    expect(screen.getByTestId('row-action')).toBeTruthy();
  });
});

/**
 * Scenario: the bar drew the light fill and a pale track in the dark theme,
 * and the row's dark label was hard white rather than the dark text role.
 *
 * Expected behaviour: in each theme the bar is a hairline track on the track
 * role with a fill on the control-on role, both holding 3:1 as marks on every
 * surface, and the label and counts read that theme's text roles.
 */
describe.each([
  ['light', false, colors],
  ['dark', true, darkColors],
] as const)('the progress bar in the %s theme', (_name, isDark, palette) => {
  // The grounds a bar is drawn on. A field's input ground carries no bar.
  const surfaces = ['surfacePage', 'surface', 'surfaceRaised'] as const;

  beforeEach(() => {
    mockIsDark = isDark;
  });

  it('draws a hairline track on the track role under a full-height control-on fill', async () => {
    await render(
      <ProgressBar done={1} total={4} trackTestID="track" fillTestID="fill" testID="bar" />
    );

    const bar = StyleSheet.flatten(screen.getByTestId('bar').props.style);
    const track = StyleSheet.flatten(screen.getByTestId('track').props.style);
    const fill = StyleSheet.flatten(screen.getByTestId('fill').props.style);
    expect(track.backgroundColor).toBe(palette.track);
    expect(fill.backgroundColor).toBe(palette.controlOn);
    expect(fill.width).toBe('25%');
    expect(track.height).toBeLessThan(bar.height);
    expect(fill.height).toBe(bar.height);
  });

  it('holds 3:1 for the track and the fill on every ground a bar sits on', () => {
    for (const surface of surfaces) {
      expect(contrastRatio(palette.track, palette[surface])).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(palette.controlOn, palette[surface])).toBeGreaterThanOrEqual(3);
    }
  });

  it('writes the label and counts in the text roles', async () => {
    await render(
      <ProgressRow label="Writing tiles" done={3} total={40} counts="3/40" countsTestID="counts" />
    );

    const label = StyleSheet.flatten(screen.getByText('Writing tiles').props.style);
    const counts = StyleSheet.flatten(screen.getByTestId('counts').props.style);
    expect(label.color).toBe(palette.textPrimary);
    expect(counts.color).toBe(palette.textSecondary);
  });
});
