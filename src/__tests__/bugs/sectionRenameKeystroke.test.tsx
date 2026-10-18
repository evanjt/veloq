/**
 * Scenario: the rename text lived in the hook the section screen root calls, so
 * every keystroke set state in the root and re-rendered the whole screen.
 *
 * Expected behaviour: typing a name re-renders only the header's name editor.
 * The component that owns the actions hook does not render again until the
 * name is saved, and the save hands the typed name to the hook.
 */

import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { SectionHeader } from '@/features/routes/components/section/SectionHeader';
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
jest.mock('@/features/routes/components/SectionMapView', () => ({
  SectionMapView: () => null,
}));
jest.mock('@/shared/app', () => ({
  ...jest.requireActual('@/shared/app'),
  useMetricSystem: () => true,
}));

const mockRenameSection = jest.fn<Promise<void>, [string, string]>();
jest.mock('@/features/routes/hooks/useCustomSections', () => ({
  useSectionCommands: () => ({ removeSection: jest.fn(), renameSection: mockRenameSection }),
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

const rootRendered = jest.fn();

function Root({ currentSection = section }: { currentSection?: FrequentSection }) {
  rootRendered();
  const actions = useSectionActions({
    id: currentSection.id,
    isCustomId: true,
    section: currentSection,
    isSectionDisabled: false,
    onSectionRefresh: jest.fn(),
    sectionRefreshKey: 0,
    preComputedExcludedActivityIds: noExclusions,
  });
  return (
    <SectionHeader
      section={currentSection}
      activityColor="#000000"
      iconName="bike"
      customName={actions.customName}
      onSaveName={actions.handleSaveName}
    />
  );
}

describe('renaming a section', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockRenameSection.mockResolvedValue(undefined);
  });

  it('does not render the screen root on a keystroke', async () => {
    await render(<Root />);
    await fireEvent.press(screen.getByTestId('section-rename-button'));
    const before = rootRendered.mock.calls.length;

    for (const text of ['N', 'Ne', 'New', 'New l', 'New lo', 'New loop']) {
      await fireEvent.changeText(screen.getByTestId('section-rename-input'), text);
    }

    expect(screen.getByTestId('section-rename-input').props.value).toBe('New loop');
    expect(rootRendered).toHaveBeenCalledTimes(before);
  });

  it('starts the input on the name on show', async () => {
    await render(<Root />);

    await fireEvent.press(screen.getByTestId('section-rename-button'));

    expect(screen.getByTestId('section-rename-input').props.value).toBe('Old climb');
  });

  it('saves the trimmed typed name, closes the input and shows the new name', async () => {
    await render(<Root />);
    await fireEvent.press(screen.getByTestId('section-rename-button'));
    await fireEvent.changeText(screen.getByTestId('section-rename-input'), '  New loop  ');

    await act(async () => {
      await fireEvent.press(screen.getByTestId('section-rename-save'));
    });

    expect(mockRenameSection).toHaveBeenCalledWith('s1', 'New loop');
    expect(screen.queryByTestId('section-rename-input')).toBeNull();
    expect(screen.getByText('New loop')).toBeTruthy();
  });

  it('clears a name and shows the numbered label returned by the engine', async () => {
    const tree = await render(<Root />);
    await fireEvent.press(screen.getByTestId('section-rename-button'));
    await fireEvent.changeText(screen.getByTestId('section-rename-input'), '   ');

    await act(async () => {
      await fireEvent.press(screen.getByTestId('section-rename-save'));
    });

    expect(mockRenameSection).toHaveBeenCalledWith('s1', '');
    await tree.rerender(<Root currentSection={{ ...section, name: 'Section 1' }} />);
    expect(screen.queryByTestId('section-rename-input')).toBeNull();
    expect(screen.getByText('Section 1')).toBeTruthy();
  });

  it('keeps the input open with the typed name and the reason when the name is taken', async () => {
    mockRenameSection.mockRejectedValueOnce(new SectionRenameError('taken', 'nameTaken'));
    await render(<Root />);
    await fireEvent.press(screen.getByTestId('section-rename-button'));
    await fireEvent.changeText(screen.getByTestId('section-rename-input'), 'Taken climb');

    await act(async () => {
      await fireEvent.press(screen.getByTestId('section-rename-save'));
    });

    expect(screen.getByTestId('section-rename-input').props.value).toBe('Taken climb');
    expect(screen.getByTestId('section-rename-input-error')).toHaveTextContent(
      'sections.nameTaken'
    );
    expect(Alert.alert).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByTestId('section-rename-input'), 'Free climb');
    expect(screen.queryByTestId('section-rename-input-error')).toBeNull();
  });

  it('keeps the input open with the typed name when the write fails', async () => {
    mockRenameSection.mockRejectedValueOnce(new Error('Storage unavailable'));
    await render(<Root />);
    await fireEvent.press(screen.getByTestId('section-rename-button'));
    await fireEvent.changeText(screen.getByTestId('section-rename-input'), 'New loop');

    await act(async () => {
      await fireEvent.press(screen.getByTestId('section-rename-save'));
    });

    expect(screen.getByTestId('section-rename-input').props.value).toBe('New loop');
    expect(Alert.alert).toHaveBeenCalledTimes(1);
  });

  it('keeps the old name when the edit is cancelled, and starts the next edit from it', async () => {
    await render(<Root />);
    await fireEvent.press(screen.getByTestId('section-rename-button'));
    await fireEvent.changeText(screen.getByTestId('section-rename-input'), 'Discarded');
    await fireEvent.press(screen.getByLabelText('common.cancel'));

    expect(mockRenameSection).not.toHaveBeenCalled();
    expect(screen.getByText('Old climb')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('section-rename-button'));
    expect(screen.getByTestId('section-rename-input').props.value).toBe('Old climb');
  });
});
