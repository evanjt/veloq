import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { SectionActionRow } from '@/features/routes/components/section/SectionActionRow';
import { SectionTrimOverlay } from '@/features/routes/components/SectionTrimOverlay';
import type { FrequentSection } from '@/types';
import { colors } from '@/theme';

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

async function renderRow(sectionType: 'custom' | 'auto', over: Record<string, unknown> = {}) {
  const handlers = {
    startTrim: jest.fn(),
    handleDeleteSection: jest.fn(),
    handleToggleDisable: jest.fn(),
    handleRematchActivities: jest.fn(),
    handleAcceptSection: jest.fn(),
  };
  const utils = await render(
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
  it('exposes the edit-bounds pill by role, label and testID', async () => {
    const { getByRole, getByTestId, handlers } = await renderRow('custom');
    const byRole = getByRole('button', { name: 'sections.editBounds' });
    expect(getByTestId('section-trim-button')).toBe(byRole);
    await fireEvent.press(byRole);
    expect(handlers.startTrim).toHaveBeenCalledTimes(1);
  });

  it('labels delete on a custom section', async () => {
    const { getByRole, handlers } = await renderRow('custom');
    await fireEvent.press(getByRole('button', { name: 'sections.deleteSection' }));
    expect(handlers.handleDeleteSection).toHaveBeenCalledTimes(1);
  });

  it('labels disable on an auto section and restore once disabled', async () => {
    const first = await renderRow('auto');
    await fireEvent.press(first.getByRole('button', { name: 'sections.removeSection' }));
    expect(first.handlers.handleToggleDisable).toHaveBeenCalledTimes(1);
    await first.unmount();

    const second = await renderRow('auto', { isSectionDisabled: true });
    expect(second.getByRole('button', { name: 'sections.restoreSection' })).toBeTruthy();
  });

  it('labels rematch and refuses the press while rematching', async () => {
    const idle = await renderRow('auto');
    await fireEvent.press(idle.getByRole('button', { name: 'sections.rematchActivities' }));
    expect(idle.handlers.handleRematchActivities).toHaveBeenCalledTimes(1);
    await idle.unmount();

    const busy = await renderRow('auto', { isRematching: true });
    await fireEvent.press(busy.getByRole('button', { name: 'sections.rematchActivities' }));
    expect(busy.handlers.handleRematchActivities).not.toHaveBeenCalled();
  });

  it('omits rematch when no handler is given', async () => {
    const { queryByRole } = await renderRow('auto', { handleRematchActivities: undefined });
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

  it('finds reset by role and name and fires it', async () => {
    const onReset = jest.fn();
    const { getByRole } = await render(<SectionTrimOverlay {...props} onReset={onReset} />);
    await fireEvent.press(getByRole('button', { name: 'sections.resetBounds' }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('hides reset when there is nothing to reset', async () => {
    const { queryByRole } = await render(<SectionTrimOverlay {...props} canReset={false} />);
    expect(queryByRole('button', { name: 'sections.resetBounds' })).toBeNull();
  });

  it('disables reset while an edit is pending', async () => {
    const onReset = jest.fn();
    const { getByRole } = await render(
      <SectionTrimOverlay {...props} isSaving onReset={onReset} />
    );
    const reset = getByRole('button', { name: 'sections.resetBounds' });

    expect(reset).toBeDisabled();
    await fireEvent.press(reset);
    expect(onReset).not.toHaveBeenCalled();
  });
});

/**
 * Scenario: a step button at the end of its range refuses the press, but its
 * chevron kept the primary colour, so it looked as live as its neighbour.
 *
 * Expected behaviour: a refused step reads disabled and draws its chevron in
 * the disabled colour; a live one keeps the primary.
 */
describe('SectionTrimOverlay step buttons', () => {
  const props = {
    pointCount: 100,
    startIndex: 0,
    endIndex: 99,
    trimmedDistance: 1000,
    originalDistance: 1000,
    isSaving: false,
    canReset: false,
    isExpandMode: false,
    onStartChange: jest.fn(),
    onEndChange: jest.fn(),
    onConfirm: jest.fn(),
    onCancel: jest.fn(),
    onReset: jest.fn(),
    onToggleExpand: jest.fn(),
  };

  function chevronColour(button: {
    findAll: (p: (n: { props: { name?: string } }) => boolean) => { props: { color?: string } }[];
  }) {
    return button.findAll(
      (node) => typeof node.props.name === 'string' && node.props.name.startsWith('chevron-')
    )[0].props.color;
  }

  it('greys the steps that cannot move and keeps the ones that can', async () => {
    const { getByRole } = await render(<SectionTrimOverlay {...props} />);
    const startEarlier = getByRole('button', { name: 'sections.trimStartEarlier' });
    const endLater = getByRole('button', { name: 'sections.trimEndLater' });
    const startLater = getByRole('button', { name: 'sections.trimStartLater' });

    for (const refused of [startEarlier, endLater]) {
      expect(refused).toBeDisabled();
      expect(chevronColour(refused)).toBe(colors.textDisabled);
    }
    expect(startLater).not.toBeDisabled();
    expect(chevronColour(startLater)).toBe(colors.primary);
  });
});
