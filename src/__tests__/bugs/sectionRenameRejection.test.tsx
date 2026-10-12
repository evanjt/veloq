import { Alert, type AlertButton } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';

import { useSectionActions } from '@/features/routes/hooks/useSectionActions';
import * as haptics from '@/shared/ui/haptics';
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

jest.mock('@/shared/ui/haptics', () => ({
  selection: jest.fn(),
  light: jest.fn(),
  medium: jest.fn(),
  success: jest.fn(),
}));

const mockRemoveSection = jest.fn();
const mockRenameSection = jest.fn<Promise<void>, [string, string]>();
jest.mock('@/features/routes/hooks/useCustomSections', () => ({
  useSectionCommands: () => ({
    removeSection: mockRemoveSection,
    renameSection: mockRenameSection,
  }),
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
      const hook = await mount();

      await act(async () => {
        hook.result.current.handleSaveName(name);
      });

      expect(mockRenameSection).toHaveBeenCalledWith('s1', name);
      expect(hook.result.current.customName).toBe('Old climb');
      expect(Alert.alert).toHaveBeenCalledTimes(1);
    }
  );

  it('tells the athlete the name is taken rather than to try again', async () => {
    mockRenameSection.mockRejectedValueOnce(new SectionRenameError('taken', 'nameTaken'));
    const hook = await mount();

    await act(async () => {
      hook.result.current.handleSaveName('Taken');
    });

    expect(Alert.alert).toHaveBeenCalledWith(
      'sections.renameFailedTitle',
      'sections.nameTaken',
      undefined,
      expect.objectContaining({ cancelable: true })
    );
  });

  it('restores the old name when clearing it is refused', async () => {
    mockRenameSection.mockRejectedValueOnce(new Error('Section name rejected'));
    const hook = await mount();

    await act(async () => {
      hook.result.current.handleSaveName('   ');
    });

    expect(mockRenameSection).toHaveBeenCalledWith('s1', '');
    expect(hook.result.current.customName).toBe('Old climb');
    expect(Alert.alert).toHaveBeenCalledTimes(1);
  });
});

describe('section haptics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  it.each(['', '   '])('clears a name when the input is %j', async (name) => {
    mockRenameSection.mockResolvedValueOnce(undefined);
    const hook = await mount();
    await act(async () => {
      hook.result.current.handleSaveName(name);
    });
    expect(mockRenameSection).toHaveBeenCalledWith('s1', '');
    expect(hook.result.current.customName).toBeNull();
    expect(haptics.success).toHaveBeenCalledTimes(1);
  });

  it('fires one success when a name passes its checks', async () => {
    mockRenameSection.mockResolvedValueOnce(undefined);
    const hook = await mount();
    await act(async () => {
      hook.result.current.handleSaveName('New climb');
    });
    expect(mockRenameSection).toHaveBeenCalledWith('s1', 'New climb');
    expect(haptics.success).toHaveBeenCalledTimes(1);
  });

  async function confirmButtons(): Promise<AlertButton[]> {
    const hook = await mount();
    await act(() => hook.result.current.handleDeleteSection());
    return (Alert.alert as jest.Mock).mock.calls[0][2] as AlertButton[];
  }

  it('fires nothing when the delete confirm is cancelled', async () => {
    const cancel = (await confirmButtons()).find((b) => b.style === 'cancel');
    cancel?.onPress?.();
    expect(haptics.medium).not.toHaveBeenCalled();
    expect(mockRemoveSection).not.toHaveBeenCalled();
  });

  it('fires one medium impact when the delete is accepted', async () => {
    mockRemoveSection.mockResolvedValueOnce(undefined);
    const destructive = (await confirmButtons()).find((b) => b.style === 'destructive');
    await act(async () => {
      await destructive?.onPress?.();
    });
    expect(haptics.medium).toHaveBeenCalledTimes(1);
    expect(mockRemoveSection).toHaveBeenCalledWith('s1');
  });
});
