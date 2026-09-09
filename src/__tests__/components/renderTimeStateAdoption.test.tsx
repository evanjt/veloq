/**
 * Scenario: state that only mirrors a prop was written in an effect, so the
 * screen committed one frame from the old value before settling.
 *
 * Expected behaviour: the value is taken while rendering, so the first commit
 * after the prop changes already carries it. Each test records what was
 * committed rather than only what the tree settles on, because the settled
 * value was never the bug.
 */

import React, { useEffect } from 'react';
import { Text, View } from 'react-native';
import { act, render } from '@testing-library/react-native';

import { CollapsibleSection } from '@/shared/ui/CollapsibleSection';
import { useSectionCreation } from '@/features/maps/hooks/useSectionCreation';
import type { LatLng } from '@/shared/geo/polyline';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

// `CollapsibleSection` reaches the app barrel for `useTheme`, and the barrel
// pulls the IAP binding in behind it.
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

// The section's header pressable is always mounted, so an effect inside it
// runs once per commit of the section. A render React discards before
// committing runs no effect, which is the whole difference being measured
// here: the effect form committed twice, once without the children.
const mockHeaderCommits = jest.fn();
jest.mock('@/shared/ui/AnimatedPressable', () => {
  const { useEffect } = require('react');
  const { View } = require('react-native');
  return {
    AnimatedPressable: ({ children }: { children: React.ReactNode }) => {
      useEffect(() => {
        mockHeaderCommits();
      });
      return <View>{children}</View>;
    },
  };
});

describe('a collapsible section opening for the first time', () => {
  it('mounts its children on the commit that expands it', () => {
    function Host({ expanded }: { expanded: boolean }) {
      return (
        <CollapsibleSection title="Records" expanded={expanded} onToggle={jest.fn()}>
          <Text testID="child">content</Text>
        </CollapsibleSection>
      );
    }

    const tree = render(<Host expanded={false} />);
    expect(tree.queryByTestId('child')).toBeNull();

    mockHeaderCommits.mockClear();
    tree.rerender(<Host expanded />);

    expect(tree.getByTestId('child')).toBeTruthy();
    expect(mockHeaderCommits).toHaveBeenCalledTimes(1);
  });

  it('keeps the children mounted once it has been collapsed again', () => {
    function Host({ expanded }: { expanded: boolean }) {
      return (
        <CollapsibleSection title="Records" expanded={expanded} onToggle={jest.fn()}>
          <Text testID="child">content</Text>
        </CollapsibleSection>
      );
    }

    const tree = render(<Host expanded />);
    tree.rerender(<Host expanded={false} />);
    expect(tree.getByTestId('child')).toBeTruthy();
  });
});

describe('entering section creation mode', () => {
  const coords: LatLng[] = [
    { latitude: -33.86, longitude: 151.2 },
    { latitude: -33.87, longitude: 151.21 },
    { latitude: -33.88, longitude: 151.22 },
  ];

  function creationProbe() {
    const commits: (number | null)[] = [];
    let tap: ((lng: number, lat: number) => boolean) | undefined;
    function Probe({ creationMode }: { creationMode: boolean }) {
      const creation = useSectionCreation({
        creationMode,
        externalCreationState: undefined,
        validCoordinates: coords,
      });
      tap = creation.handleCreationTap;
      useEffect(() => {
        commits.push(creation.startIndex);
      });
      return <View />;
    }
    return { commits, Probe, tapAt: (i: number) => tap?.(coords[i].longitude, coords[i].latitude) };
  }

  it('never commits a frame holding the previous run picks', () => {
    const { commits, Probe, tapAt } = creationProbe();
    const tree = render(<Probe creationMode />);

    act(() => {
      tapAt(1);
    });
    expect(commits[commits.length - 1]).toBe(1);

    tree.rerender(<Probe creationMode={false} />);
    commits.length = 0;
    tree.rerender(<Probe creationMode />);

    expect(commits.length).toBeGreaterThan(0);
    expect(commits).not.toContain(1);
  });
});
