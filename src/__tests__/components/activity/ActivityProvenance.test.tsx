/**
 * Scenario: a ride's details say where its data was filled from.
 *
 * Expected behaviour: a ride filled from a Garmin file on this phone shows the
 * line with its accessible name equal to its text, and tapping it opens the
 * Garmin connector. An ordinary intervals.icu ride shows nothing.
 */

import React from 'react';
import { configure, fireEvent, render, screen } from '@testing-library/react-native';
import { ActivityProvenance } from 'veloqrs';

import { ActivityProvenanceLine } from '@/features/activity/components/ActivityProvenance';
import { useDebugStore } from '@/features/settings/stores/DebugStore';

const mockNavigateTo = jest.fn();

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app/navigation', () => ({
  navigateTo: (...args: unknown[]) => mockNavigateTo(...args),
}));

configure({ defaultIncludeHiddenElements: true });

describe('ActivityProvenanceLine', () => {
  beforeEach(() => {
    mockNavigateTo.mockClear();
    useDebugStore.setState({
      experimentalEnabled: true,
      experimentalFeatures: { garminUpdate: true },
    });
  });

  it("shows nothing for a Garmin-filled ride while Garmin's experimental switch is off", () => {
    useDebugStore.setState({ experimentalEnabled: false });
    render(<ActivityProvenanceLine provenance={ActivityProvenance.GarminOnPhone} />);

    expect(screen.queryByTestId('activity-provenance')).toBeNull();
  });

  it('says a Garmin file filled the ride, labelled with the same words, and opens the connector', () => {
    render(<ActivityProvenanceLine provenance={ActivityProvenance.GarminOnPhone} />);

    expect(screen.getByText('activity.provenance.garminOnPhone')).toBeTruthy();
    const line = screen.getByLabelText('activity.provenance.garminOnPhone');
    fireEvent.press(line);
    expect(mockNavigateTo).toHaveBeenCalledWith('/garmin-connector');
  });

  it("shows nothing for a ride that is intervals.icu's own copy", () => {
    render(<ActivityProvenanceLine provenance={ActivityProvenance.Intervals} />);

    expect(screen.queryByTestId('activity-provenance')).toBeNull();
    expect(screen.queryByText(/activity\.provenance\./)).toBeNull();
  });

  it('shows nothing before the detail read has answered', () => {
    render(<ActivityProvenanceLine provenance={null} />);

    expect(screen.queryByTestId('activity-provenance')).toBeNull();
  });
});
