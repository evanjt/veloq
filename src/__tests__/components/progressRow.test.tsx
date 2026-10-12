/**
 * Scenario: a job with a known total reports its count many times a second.
 * Expected behaviour: the row reads as one progress bar with its range and
 * position, and a screen reader hears the start, each quarter and the end,
 * never every tick in between.
 */

import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { ProgressRow, progressMilestone } from '@/shared/ui/ProgressRow';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysWithValues());
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

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
