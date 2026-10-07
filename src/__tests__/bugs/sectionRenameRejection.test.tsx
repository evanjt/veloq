import { Alert } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';

import { useSectionActions } from '@/features/routes/hooks/useSectionActions';
import { SectionRenameError } from '@/features/routes/lib/sectionRenameFailure';
import type { FrequentSection } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));
jest.mock('@/shared/native/engine', () => ({ getEngine: () => null }));
jest.mock('@/features/routes/hooks/useSectionRescan', () => ({
  useSectionRescan: () => ({ rescan: jest.fn(), isScanning: false }),
}));

const mockRenameSection = jest.fn<Promise<void>, [string, string]>();
jest.mock('@/features/routes/hooks/useCustomSections', () => ({
  useCustomSections: () => ({ removeSection: jest.fn(), renameSection: mockRenameSection }),
}));

const section: FrequentSection = {
  id: 's1',
  sectionType: 'custom',
  sportTypes: ['Ride'],
  name: 'Old climb',
  polyline: [],
  distanceMeters: 1200,
  activityIds: ['a1'],
  visitCount: 3,
  createdAt: '2026-01-01T00:00:00Z',
};
const noExclusions: string[] = [];

function mount() {
  return renderHook(() =>
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
}

describe('a refused section rename', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  it.each(['Already used', 'x'.repeat(256)])(
    'restores the previous name and alerts when the engine rejects %s',
    async (name) => {
      mockRenameSection.mockRejectedValueOnce(new Error('Section name rejected'));
      const hook = mount();

      act(() => hook.result.current.setEditName(name));
      await act(async () => {
        hook.result.current.handleSaveName();
      });

      expect(mockRenameSection).toHaveBeenCalledWith('s1', name);
      expect(hook.result.current.customName).toBe('Old climb');
      expect(Alert.alert).toHaveBeenCalledTimes(1);
    }
  );

  it('tells the athlete the name is taken rather than to try again', async () => {
    mockRenameSection.mockRejectedValueOnce(new SectionRenameError('taken', 'nameTaken'));
    const hook = mount();

    act(() => hook.result.current.setEditName('Taken'));
    await act(async () => {
      hook.result.current.handleSaveName();
    });

    expect(Alert.alert).toHaveBeenCalledWith('sections.renameFailedTitle', 'sections.nameTaken');
  });
});
