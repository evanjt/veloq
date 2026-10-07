import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { SectionActionRow } from '@/features/routes/components/section/SectionActionRow';
import { SectionTrimOverlay } from '@/features/routes/components/SectionTrimOverlay';
import type { FrequentSection } from '@/types';

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

jest.mock('react-native-gesture-handler', () => {
  const actual = jest.requireActual('react-native-gesture-handler');
  const chain = (): unknown => new Proxy(() => undefined, { get: () => chain, apply: chain });
  return {
    ...actual,
    Gesture: { Pan: chain },
    GestureDetector: ({ children }: { children: React.ReactNode }) => children,
  };
});

const section = (sectionType: 'custom' | 'auto'): FrequentSection =>
  ({ sectionType, isUserDefined: sectionType === 'custom' }) as unknown as FrequentSection;

function renderRow(sectionType: 'custom' | 'auto', over: Record<string, unknown> = {}) {
  const handlers = {
    startTrim: jest.fn(),
    handleDeleteSection: jest.fn(),
    handleToggleDisable: jest.fn(),
    handleRematchActivities: jest.fn(),
    handleAcceptSection: jest.fn(),
  };
  const utils = render(
    <SectionActionRow
      isDark={false}
      isSectionDisabled={false}
      isRematching={false}
      section={section(sectionType)}
      {...handlers}
      {...over}
    />
  );
  return { ...utils, handlers };
}

describe('SectionActionRow controls', () => {
  it('exposes the edit-bounds pill by role, label and testID', () => {
    const { getByRole, getByTestId, handlers } = renderRow('custom');
    const byRole = getByRole('button', { name: 'sections.editBounds' });
    expect(getByTestId('section-trim-button')).toBe(byRole);
    fireEvent.press(byRole);
    expect(handlers.startTrim).toHaveBeenCalledTimes(1);
  });

  it('labels delete on a custom section', () => {
    const { getByRole, handlers } = renderRow('custom');
    fireEvent.press(getByRole('button', { name: 'sections.deleteSection' }));
    expect(handlers.handleDeleteSection).toHaveBeenCalledTimes(1);
  });

  it('labels disable on an auto section and restore once disabled', () => {
    const first = renderRow('auto');
    fireEvent.press(first.getByRole('button', { name: 'sections.removeSection' }));
    expect(first.handlers.handleToggleDisable).toHaveBeenCalledTimes(1);
    first.unmount();

    const second = renderRow('auto', { isSectionDisabled: true });
    expect(second.getByRole('button', { name: 'sections.restoreSection' })).toBeTruthy();
  });

  it('labels rematch and refuses the press while rematching', () => {
    const idle = renderRow('auto');
    fireEvent.press(idle.getByRole('button', { name: 'sections.rematchActivities' }));
    expect(idle.handlers.handleRematchActivities).toHaveBeenCalledTimes(1);
    idle.unmount();

    const busy = renderRow('auto', { isRematching: true });
    fireEvent.press(busy.getByRole('button', { name: 'sections.rematchActivities' }));
    expect(busy.handlers.handleRematchActivities).not.toHaveBeenCalled();
  });

  it('omits rematch when no handler is given', () => {
    const { queryByRole } = renderRow('auto', { handleRematchActivities: undefined });
    expect(queryByRole('button', { name: 'sections.rematchActivities' })).toBeNull();
  });
});

describe('SectionTrimOverlay reset control', () => {
  const props = {
    pointCount: 100,
    startIndex: 10,
    endIndex: 60,
    trimmedDistance: 500,
    originalDistance: 1000,
    isSaving: false,
    canReset: true,
    isExpandMode: false,
    onStartChange: jest.fn(),
    onEndChange: jest.fn(),
    onConfirm: jest.fn(),
    onCancel: jest.fn(),
    onReset: jest.fn(),
    onToggleExpand: jest.fn(),
  };

  it('finds reset by role and name and fires it', () => {
    const onReset = jest.fn();
    const { getByRole } = render(<SectionTrimOverlay {...props} onReset={onReset} />);
    fireEvent.press(getByRole('button', { name: 'sections.resetBounds' }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('hides reset when there is nothing to reset', () => {
    const { queryByRole } = render(<SectionTrimOverlay {...props} canReset={false} />);
    expect(queryByRole('button', { name: 'sections.resetBounds' })).toBeNull();
  });
});
