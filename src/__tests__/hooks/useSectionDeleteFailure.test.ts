/**
 * Scenario: deleting a section fails, and the thrown error's own text is English, from the engine
 * or from the command that wraps it.
 *
 * Expected behaviour: the alert reads the translated failure line, never the thrown message.
 */
import { act, renderHook } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { useSectionActions } from '@/features/routes/hooks/useSectionActions';
import type { FrequentSection } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useFocusEffect: () => {},
  router: { back: jest.fn() },
}));
const mockRemoveSection = jest.fn();
jest.mock('@/features/routes/hooks/useCustomSections', () => ({
  useSectionCommands: () => ({ removeSection: mockRemoveSection, renameSection: jest.fn() }),
}));
jest.mock('@/features/routes/hooks/useDetectionHold', () => ({ useDetectionHold: () => null }));
jest.mock('@/shared/native/engine', () => ({ getEngine: () => null }));

const section: FrequentSection = {
  id: 'custom-kiln',
  sectionType: 'custom',
  sportTypes: ['Ride'],
  name: 'Kiln lane',
  polyline: [],
  distanceMeters: 800,
  activityIds: ['a1'],
  visitCount: 2,
  createdAt: '2026-01-01T00:00:00Z',
};

const noExclusions: string[] = [];

async function deleteAndConfirm() {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const { result } = await renderHook(() =>
    useSectionActions({
      id: section.id,
      isCustomId: true,
      section,
      isSectionDisabled: false,
      onSectionRefresh: jest.fn(),
      sectionRefreshKey: 0,
      preComputedExcludedActivityIds: noExclusions,
    })
  );
  await act(() => result.current.handleDeleteSection());
  const buttons = alert.mock.calls[0][2] as { style?: string; onPress?: () => Promise<void> }[];
  const destructive = buttons.find((button) => button.style === 'destructive');
  await act(async () => {
    await destructive?.onPress?.();
  });
  return alert.mock.calls.slice(1);
}

describe('a section delete that fails', () => {
  afterEach(() => jest.restoreAllMocks());

  it('alerts the translated failure line rather than the thrown English', async () => {
    mockRemoveSection.mockRejectedValueOnce(new Error('Failed to delete section custom-kiln'));

    const alerts = await deleteAndConfirm();

    expect(alerts).toEqual([
      [
        'sections.deleteFailedTitle',
        'sections.deleteFailed',
        undefined,
        expect.objectContaining({ cancelable: true }),
      ],
    ]);
  });

  it('alerts the same line when the throw is not an Error', async () => {
    mockRemoveSection.mockRejectedValueOnce('engine closed');

    const alerts = await deleteAndConfirm();

    expect(alerts).toEqual([
      [
        'sections.deleteFailedTitle',
        'sections.deleteFailed',
        undefined,
        expect.objectContaining({ cancelable: true }),
      ],
    ]);
  });
});
