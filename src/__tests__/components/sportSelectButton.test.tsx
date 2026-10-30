/**
 * Scenario: a section or route taken in several sports, and one taken in a single sport.
 *
 * Expected behaviour: several sports draw one dropdown labelled with the sport on
 * screen and its count, whose menu lists every offered sport in the order given.
 * Choosing one hands it to the caller. A single sport is stated as text with no menu.
 */
import React from 'react';
import { Platform } from 'react-native';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';

import { Icon } from '@/shared/ui/Icon';
import { getActivityIcon } from '@/shared/activity/activityUtils';
import { SportSelectButton } from '@/features/routes/components/SportSelectButton';

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({
    t: (key: string, arg?: { count: number }) =>
      key === 'sections.traversalsCount' && arg ? `${arg.count} traversals` : key,
  }),
}));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('expo-haptics', () => ({
  ...jest.requireActual('expo-haptics'),
  performAndroidHapticsAsync: jest.fn(() => Promise.resolve()),
}));

const THREE = [
  { type: 'Ride', count: 6 },
  { type: 'Run', count: 3 },
  { type: 'Hike', count: 2 },
];

beforeEach(() => {
  jest.useFakeTimers();
  jest.replaceProperty(Platform, 'OS', 'android');
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('SportSelectButton', () => {
  it('labels one dropdown with the sport on screen and lists every sport in order', async () => {
    await render(
      <PaperProvider>
        <SportSelectButton options={THREE} selectedType="Ride" onSelect={jest.fn()} />
      </PaperProvider>
    );

    expect(screen.getAllByTestId('section-sport')).toHaveLength(1);
    expect(screen.getByTestId('section-sport')).toHaveTextContent(
      'activityTypes.Ride · 6 traversals'
    );
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0);

    await act(async () => {
      await fireEvent.press(screen.getByTestId('section-sport'));
    });
    const rows = await screen.findAllByRole('menuitem');
    expect(rows.map((row) => row.props.accessibilityLabel)).toEqual([
      'activityTypes.Ride · 6 traversals',
      'activityTypes.Run · 3 traversals',
      'activityTypes.Hike · 2 traversals',
    ]);
  });

  it('draws the activity-type icon of each sport beside its name in the menu', async () => {
    await render(
      <PaperProvider>
        <SportSelectButton options={THREE} selectedType="Ride" onSelect={jest.fn()} />
      </PaperProvider>
    );

    await act(async () => {
      await fireEvent.press(screen.getByTestId('section-sport'));
    });
    const rows = await screen.findAllByRole('menuitem');
    const glyphs = rows.map((row) =>
      within(row)
        .UNSAFE_getAllByType(Icon)
        .map((icon) => icon.props.name)
    );
    expect(glyphs.map((names) => names[0])).toEqual([
      getActivityIcon('Ride'),
      getActivityIcon('Run'),
      getActivityIcon('Hike'),
    ]);
  });

  it('hands the chosen sport to the caller', async () => {
    const onSelect = jest.fn();
    await render(
      <PaperProvider>
        <SportSelectButton options={THREE} selectedType="Ride" onSelect={onSelect} />
      </PaperProvider>
    );

    await act(async () => {
      await fireEvent.press(screen.getByTestId('section-sport'));
    });
    const rows = await screen.findAllByRole('menuitem');
    await act(async () => {
      await fireEvent.press(rows[2]!);
    });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('Hike');
  });

  it('states a single sport as text with no menu', async () => {
    await render(
      <SportSelectButton
        options={[{ type: 'Run', count: 4 }]}
        selectedType="Run"
        onSelect={jest.fn()}
      />
    );

    expect(screen.getByTestId('section-sport')).toHaveTextContent(
      'activityTypes.Run · 4 traversals'
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('draws nothing when no sport is offered', async () => {
    await render(<SportSelectButton options={[]} selectedType={undefined} onSelect={jest.fn()} />);

    expect(screen.queryByTestId('section-sport')).toBeNull();
  });
});
