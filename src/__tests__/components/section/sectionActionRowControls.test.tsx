import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { SectionActionRow } from '@/features/routes/components/section/SectionActionRow';
import {
  SectionTrimOverlay,
  SectionTrimToolBar,
} from '@/features/routes/components/SectionTrimOverlay';
import type { FrequentSection } from '@/types';
import type { ReactTestInstance } from 'react-test-renderer';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, opacity } from '@/theme';

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

jest.mock('@/shared/app', () => ({
  ...jest.requireActual('@/shared/app'),
  useMetricSystem: () => true,
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
    handleAcceptSection: jest.fn(),
  };
  const utils = await render(
    <SectionActionRow isDark={false} section={section(sectionType)} {...handlers} {...over} />
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
});

/**
 * Scenario: one pin stood for Pinned and for Accepted.
 *
 * Expected behaviour: Pinned, Accepted and Accept each draw a glyph of their own.
 */
describe('SectionActionRow glyphs', () => {
  type Node = { props: { name?: string } };
  type Found = { findAll: (p: (n: Node) => boolean) => Node[] };

  function glyph(element: Found): string | undefined {
    return element.findAll((n) => typeof n.props.name === 'string')[0]?.props.name;
  }

  it('draws Pinned, Accepted and Accept with different glyphs', async () => {
    const pinned = await renderRow('auto', { pinnedVersion: 2 });
    const pin = glyph(pinned.getByTestId('section-pinned-version'));
    await pinned.unmount();

    const accepted = await renderRow('auto', {
      section: { sectionType: 'auto', isUserDefined: true } as unknown as FrequentSection,
    });
    const acceptedGlyph = glyph(accepted.getByTestId('section-accepted'));
    await accepted.unmount();

    const offer = await renderRow('auto');
    const acceptGlyph = glyph(offer.getByRole('button', { name: 'sections.acceptSection' }));

    expect(new Set([pin, acceptedGlyph, acceptGlyph]).size).toBe(3);
    expect(acceptedGlyph).not.toMatch(/^pin/);
    expect(acceptGlyph).not.toMatch(/^pin/);
  });

  it('draws the partly excluded chip with the exclusion glyph', async () => {
    const { getByTestId } = await renderRow('auto', { partlyExcluded: true });
    expect(glyph(getByTestId('section-partly-excluded'))).toBe('eye-off-outline');
  });
});

describe('section trim reset control', () => {
  const props = {
    pointCount: 100,
    startIndex: 10,
    endIndex: 60,
    trimmedDistance: 500,
    isSaving: false,
    canReset: true,
    isExpandMode: false,
    onConfirm: jest.fn(),
    onCancel: jest.fn(),
    onReset: jest.fn(),
  };

  it('finds reset in the tool bar by role and name and fires it', async () => {
    const onReset = jest.fn();
    const { getByRole } = await render(<SectionTrimToolBar {...props} onReset={onReset} />);
    await fireEvent.press(getByRole('button', { name: 'common.reset' }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('hides reset when there is nothing to reset', async () => {
    const { queryByRole } = await render(<SectionTrimToolBar {...props} canReset={false} />);
    expect(queryByRole('button', { name: 'common.reset' })).toBeNull();
  });

  it('disables reset while an edit is pending', async () => {
    const onReset = jest.fn();
    const { getByRole } = await render(
      <SectionTrimToolBar {...props} isSaving onReset={onReset} />
    );
    const reset = getByRole('button', { name: 'common.reset' });

    expect(reset).toBeDisabled();
    await fireEvent.press(reset);
    expect(onReset).not.toHaveBeenCalled();
  });
});

/**
 * Scenario: editing a section's bounds is work done on the map, like creating one.
 * Expected behaviour: the edit runs in the shared map tool bar, headed with the kept length, and
 * the panel under the map keeps only the handles, the steps and the expand toggle.
 */
describe('section trim in the map tool bar', () => {
  const panelProps = {
    pointCount: 100,
    startIndex: 10,
    endIndex: 60,
    isSaving: false,
    isExpandMode: false,
    onStartChange: jest.fn(),
    onEndChange: jest.fn(),
    onToggleExpand: jest.fn(),
  };

  it('heads the bar with the tool and the kept length, and saves from Save', async () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    const { getByTestId, getByText, getByRole } = await render(
      <SectionTrimToolBar
        pointCount={100}
        startIndex={10}
        endIndex={60}
        trimmedDistance={7600}
        isSaving={false}
        canReset={false}
        isExpandMode={false}
        onConfirm={onConfirm}
        onCancel={onCancel}
        onReset={jest.fn()}
      />
    );
    expect(getByTestId('map-tool-bar')).toBeTruthy();
    expect(getByText('sections.editBounds · 7.6 km')).toBeTruthy();
    expect(getByText('sections.trimPrecisionHint')).toBeTruthy();
    await fireEvent.press(getByRole('button', { name: 'common.save' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await fireEvent.press(getByTestId('section-trim-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('leaves the panel without its own length, Cancel, Save or Reset', async () => {
    const { getByTestId, queryByTestId, queryByRole, queryByText } = await render(
      <SectionTrimOverlay {...panelProps} />
    );
    expect(getByTestId('section-trim-overlay')).toBeTruthy();
    expect(getByTestId('section-expand-toggle')).toBeTruthy();
    expect(queryByTestId('section-trim-confirm')).toBeNull();
    expect(queryByTestId('section-trim-cancel')).toBeNull();
    expect(queryByRole('button', { name: 'sections.resetBounds' })).toBeNull();
    expect(queryByText('500 m')).toBeNull();
  });
});

/**
 * Scenario: a step button at the end of its range refuses the press, but its
 * chevron kept the primary colour, so it looked as live as its neighbour.
 *
 * Expected behaviour: a refused step reads disabled and draws at the disabled
 * opacity; a live one draws at full strength, its chevron in the secondary
 * icon ink.
 */
describe('SectionTrimOverlay step buttons', () => {
  const props = {
    pointCount: 100,
    startIndex: 0,
    endIndex: 99,
    isSaving: false,
    isExpandMode: false,
    onStartChange: jest.fn(),
    onEndChange: jest.fn(),
    onToggleExpand: jest.fn(),
  };

  function chevronColour(button: ReactTestInstance) {
    return button.findAllByType(MaterialCommunityIcons)[0].props.color;
  }

  function drawnOpacity(button: ReactTestInstance) {
    return Object.assign({}, ...[button.props.style].flat(Infinity).filter(Boolean)).opacity;
  }

  it('greys the steps that cannot move and keeps the ones that can', async () => {
    const { getByRole } = await render(<SectionTrimOverlay {...props} />);
    const startEarlier = getByRole('button', { name: 'sections.trimStartEarlier' });
    const endLater = getByRole('button', { name: 'sections.trimEndLater' });
    const startLater = getByRole('button', { name: 'sections.trimStartLater' });

    for (const refused of [startEarlier, endLater]) {
      expect(refused).toBeDisabled();
      expect(drawnOpacity(refused)).toBe(opacity.disabled);
    }
    expect(startLater).not.toBeDisabled();
    expect(drawnOpacity(startLater)).toBe(1);
    expect(chevronColour(startLater)).toBe(colors.iconSecondary);
  });
});

/**
 * Scenario: on a short section the handles may close to fewer points than a
 * section can hold, and Save then failed in a dialog after the tap.
 *
 * Expected behaviour: Save is disabled while the kept range is under the
 * minimum, with the reason beside it; at the minimum it is live again.
 */
describe('section trim minimum kept range', () => {
  const props = {
    pointCount: 60,
    startIndex: 10,
    endIndex: 13,
    trimmedDistance: 40,
    isSaving: false,
    canReset: false,
    isExpandMode: false,
    onConfirm: jest.fn(),
    onCancel: jest.fn(),
    onReset: jest.fn(),
  };

  it('disables Save and names the reason when four points are kept', async () => {
    const onConfirm = jest.fn();
    const { getByTestId, getByText } = await render(
      <SectionTrimToolBar {...props} onConfirm={onConfirm} />
    );
    const save = getByTestId('section-trim-confirm');

    expect(save).toBeDisabled();
    expect(getByText('sections.trimTooShort')).toBeTruthy();
    await fireEvent.press(save);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('enables Save with no reason when five points are kept', async () => {
    const onConfirm = jest.fn();
    const { getByTestId, queryByText } = await render(
      <SectionTrimToolBar {...props} endIndex={14} onConfirm={onConfirm} />
    );
    const save = getByTestId('section-trim-confirm');

    expect(save).not.toBeDisabled();
    expect(queryByText('sections.trimTooShort')).toBeNull();
    await fireEvent.press(save);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('holds the same minimum in expand mode', async () => {
    const { getByTestId, getByText } = await render(
      <SectionTrimToolBar
        {...props}
        isExpandMode
        sectionStartInWindow={5}
        sectionEndInWindow={40}
      />
    );

    expect(getByTestId('section-trim-confirm')).toBeDisabled();
    expect(getByText('sections.trimTooShort')).toBeTruthy();
  });
});
