/**
 * Scenario: a choice of one from a short list is a small secondary button that
 * reads the current value and opens the list on the anchored popup.
 *
 * Expected behaviour: the button is spoken as its name and the value, a press
 * opens a list with exactly the current option checked and every row at the
 * tap target, and a choice calls `onChange` once, fires the selection haptic
 * and closes the list. Choosing the current option again closes the list and
 * changes nothing. A press the moment the button appears still opens it.
 */

import React, { useState } from 'react';
import { Platform, StyleSheet } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { PaperProvider } from 'react-native-paper';

import { SelectButton, selectLabel } from '@/shared/ui';
import { MIN_TAP_TARGET } from '@/theme';

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

jest.mock('expo-haptics', () => ({
  ...jest.requireActual('expo-haptics'),
  performAndroidHapticsAsync: jest.fn(() => Promise.resolve()),
}));

type Tide = 'neap' | 'spring' | 'king' | 'slack';

const TIDES: readonly { value: Tide; label: string }[] = [
  { value: 'neap', label: 'Neap' },
  { value: 'spring', label: 'Spring' },
  { value: 'king', label: 'King' },
  { value: 'slack', label: 'Slack' },
];

const flat = (node: { props: { style?: unknown } }) =>
  StyleSheet.flatten(node.props.style as never) as Record<string, unknown>;

function Harness({ onChange }: { onChange: (value: Tide) => void }) {
  const [tide, setTide] = useState<Tide>('spring');
  return (
    <PaperProvider>
      <SelectButton
        testID="tide-select"
        accessibilityLabel="Tide"
        value={tide}
        options={TIDES}
        onChange={(next) => {
          onChange(next);
          setTide(next);
        }}
      />
    </PaperProvider>
  );
}

/** Presses the button and waits for the rows. */
async function openList() {
  await act(async () => {
    await fireEvent.press(screen.getByTestId('tide-select'));
  });
  await screen.findAllByRole('menuitem');
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.replaceProperty(Platform, 'OS', 'android');
  jest.clearAllMocks();
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('selectLabel', () => {
  it('names the control and its current value', () => {
    expect(selectLabel('Time range', '1 year')).toBe('Time range: 1 year');
  });
});

describe('SelectButton', () => {
  it('reads the current value and is spoken as the name and the value', async () => {
    await render(<Harness onChange={jest.fn()} />);

    const button = screen.getByTestId('tide-select');
    expect(button).toHaveTextContent('Spring');
    expect(button.props.accessibilityLabel).toBe('Tide: Spring');
    expect(button.props.accessibilityState).toMatchObject({ expanded: false });
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0);
  });

  it('opens a list with the current option checked and every row at the tap target', async () => {
    await render(<Harness onChange={jest.fn()} />);

    await openList();

    {
      const rows = screen.getAllByRole('menuitem');
      expect(rows).toHaveLength(TIDES.length);
      const checked = rows.filter((row) => row.props.accessibilityState?.checked);
      expect(checked).toHaveLength(1);
      expect(checked[0].props.accessibilityLabel).toBe('Spring');
      for (const row of rows) {
        expect(flat(row).minHeight).toBeGreaterThanOrEqual(MIN_TAP_TARGET.android);
      }
    }
    expect(screen.getByTestId('tide-select').props.accessibilityState).toMatchObject({
      expanded: true,
    });
  });

  it('calls onChange once with the choice, fires the selection haptic and closes', async () => {
    const onChange = jest.fn();
    await render(<Harness onChange={onChange} />);

    await openList();
    await act(async () => {
      await fireEvent.press(screen.getByLabelText('King'));
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('king');
    expect(Haptics.performAndroidHapticsAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.performAndroidHapticsAsync).toHaveBeenCalledWith(
      Haptics.AndroidHaptics.Segment_Tick
    );
    await waitFor(() => expect(screen.queryAllByRole('menuitem')).toHaveLength(0));
    expect(screen.getByTestId('tide-select')).toHaveTextContent('King');
  });

  it('closes on the current option and changes nothing', async () => {
    const onChange = jest.fn();
    await render(<Harness onChange={onChange} />);

    await openList();
    await act(async () => {
      await fireEvent.press(screen.getByLabelText('Spring'));
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(Haptics.performAndroidHapticsAsync).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryAllByRole('menuitem')).toHaveLength(0));
  });

  it('opens on a press straight after it appears', async () => {
    await render(<Harness onChange={jest.fn()} />);

    await act(async () => {
      await fireEvent.press(screen.getByTestId('tide-select'));
    });
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });

    expect(screen.getAllByRole('menuitem')).toHaveLength(TIDES.length);
  });

  it('reads the unmatched label when the value is none of the options', async () => {
    await render(
      <PaperProvider>
        <SelectButton
          testID="tide-select"
          accessibilityLabel="Tide"
          value={null}
          unmatchedLabel="Mixed"
          options={TIDES}
          onChange={jest.fn()}
        />
      </PaperProvider>
    );

    expect(screen.getByTestId('tide-select')).toHaveTextContent('Mixed');
    await openList();
    const checked = screen
      .getAllByRole('menuitem')
      .filter((row) => row.props.accessibilityState?.checked);
    expect(checked).toHaveLength(0);
  });
});
