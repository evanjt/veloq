/**
 * Scenario: merging two sections navigates to the survivor with
 * `router.replace('/section/<id>')` (`app/section/[id].tsx:606`). The route
 * pattern does not change, so the screen is not remounted: the same
 * `useSectionActions` instance is handed a different `id` and a different
 * section. Its name sync only wrote `customName` when the new section had a
 * name, so a survivor the detector never named kept the name of the section
 * the athlete came from, and the header drew the wrong title.
 *
 * Expected behaviour: the name follows the section it is on, including when
 * that section has no name of its own.
 */

import React, { useEffect } from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';

import { useSectionActions } from '@/features/routes/hooks/useSectionActions';
import type { FrequentSection } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn() } }));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({ getExcludedActivityIds: () => [] }),
}));

jest.mock('@/features/routes/hooks/useCustomSections', () => ({
  useCustomSections: () => ({ removeSection: jest.fn(), renameSection: jest.fn() }),
}));

jest.mock('@/features/routes/hooks/useSectionRescan', () => ({
  useSectionRescan: () => ({ rescan: jest.fn(), isScanning: false }),
}));

jest.mock('@/features/routes/lib/sectionDisplayNames', () => ({
  getAllSectionDisplayNames: () => ({}),
}));

function sectionOf(id: string, name?: string): FrequentSection {
  return {
    id,
    sectionType: 'auto',
    sportType: 'Ride',
    polyline: [],
    distanceMeters: 1200,
    activityIds: ['a1'],
    visitCount: 3,
    createdAt: '2026-01-01T00:00:00Z',
    ...(name ? { name } : {}),
  };
}

/** Every committed name, so a frame drawn with the previous one is visible. */
const committed: (string | null)[] = [];

function Probe({ section }: { section: FrequentSection }) {
  const { customName } = useSectionActions({
    id: section.id,
    isCustomId: false,
    section,
    isSectionDisabled: false,
    onSectionRefresh: jest.fn(),
    sectionRefreshKey: 0,
  });
  useEffect(() => {
    committed.push(customName);
  });
  return <Text testID="name">{customName ?? 'none'}</Text>;
}

describe('the name on a section the athlete was moved to', () => {
  beforeEach(() => {
    committed.length = 0;
  });

  it('clears when the survivor of a merge has no name of its own', () => {
    const tree = render(<Probe section={sectionOf('s_a', 'The Wall')} />);
    expect(tree.getByTestId('name').props.children).toBe('The Wall');

    tree.rerender(<Probe section={sectionOf('s_b')} />);

    expect(tree.getByTestId('name').props.children).toBe('none');
  });

  it('follows the survivor when it has a name of its own', () => {
    const tree = render(<Probe section={sectionOf('s_a', 'The Wall')} />);

    tree.rerender(<Probe section={sectionOf('s_b', 'River Loop')} />);

    expect(tree.getByTestId('name').props.children).toBe('River Loop');
  });

  it('never commits a frame carrying the previous section name', () => {
    const tree = render(<Probe section={sectionOf('s_a', 'The Wall')} />);

    // The hook's other state settles on its own schedule, so only what is
    // committed from the move onwards says anything about the name.
    committed.length = 0;
    tree.rerender(<Probe section={sectionOf('s_b', 'River Loop')} />);

    expect(committed.length).toBeGreaterThan(0);
    expect(committed).not.toContain('The Wall');
  });

  it('shows no name at all for a first section that was never named', () => {
    const tree = render(<Probe section={sectionOf('s_a')} />);

    expect(tree.getByTestId('name').props.children).toBe('none');
  });
});
