/**
 * Scenario: the selected attempt's row is one accessible button, so the
 * reference star and the exclude and include marks drawn inside it are never
 * a screen-reader stop of their own on iOS.
 *
 * Expected behaviour: the row offers each of them as a named action wired to
 * the same handler, offers exclude or include by the attempt's state, and its
 * name says which attempt it is, not just the activity's name.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { PerformanceTooltip } from '@/features/routes/components/section/PerformanceTooltip';
import { formatShortDateWithYear } from '@/shared/format/format';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({
  useMetricSystem: () => true,
  useTheme: () => ({ isDark: false }),
}));

const POINT = {
  id: 'p1',
  activityId: 'a1',
  speed: 4,
  bestSpeed: 5,
  bestTime: 160,
  date: new Date('2026-01-01T00:00:00Z'),
  activityName: 'Harbour loop',
  direction: 'same' as const,
  sectionTime: 200,
  isBest: false,
  x: 0,
};

const handlers = {
  onSetAsReference: jest.fn(),
  onExcludeActivity: jest.fn(),
  onIncludeActivity: jest.fn(),
  onClearSelection: jest.fn(),
};

beforeEach(() => jest.clearAllMocks());

async function renderTooltip(point: typeof POINT & { isExcluded?: boolean }) {
  await render(
    <PerformanceTooltip
      selectedPoint={point}
      isDark={false}
      basis="speed"
      activityColor="#000000"
      {...handlers}
    />
  );
  return screen.getByRole('button', { name: /^Harbour loop/ });
}

async function renderTooltipFor(point: typeof POINT, recordsSettled: boolean) {
  await render(
    <PerformanceTooltip
      selectedPoint={point}
      isDark={false}
      basis="speed"
      activityColor="#000000"
      recordsSettled={recordsSettled}
      {...handlers}
    />
  );
  return screen.getByRole('button', { name: /Harbour loop/ });
}

function actionNames(element: Awaited<ReturnType<typeof renderTooltip>>): string[] {
  return (element.props.accessibilityActions ?? []).map((a: { name: string }) => a.name);
}

async function act(element: Awaited<ReturnType<typeof renderTooltip>>, actionName: string) {
  await fireEvent(element, 'accessibilityAction', { nativeEvent: { actionName } });
}

describe('the selected attempt row for a screen reader', () => {
  it('offers set as reference and exclude on an included attempt', async () => {
    const row = await renderTooltip(POINT);

    expect(actionNames(row)).toEqual(['setReference', 'exclude']);
    expect(row.props.accessibilityActions).toEqual([
      { name: 'setReference', label: 'sections.setAsReference' },
      { name: 'exclude', label: 'sections.excludeActivity' },
    ]);
  });

  it('sets the attempt as the reference', async () => {
    const row = await renderTooltip(POINT);

    await act(row, 'setReference');

    expect(handlers.onSetAsReference).toHaveBeenCalledWith('a1');
    expect(handlers.onExcludeActivity).not.toHaveBeenCalled();
  });

  it('excludes the attempt and clears the selection, as the drawn mark does', async () => {
    const row = await renderTooltip(POINT);

    await act(row, 'exclude');

    expect(handlers.onExcludeActivity).toHaveBeenCalledWith('a1');
    expect(handlers.onClearSelection).toHaveBeenCalledTimes(1);
    expect(handlers.onSetAsReference).not.toHaveBeenCalled();
  });

  it('offers include, and no reference, on an excluded attempt', async () => {
    const row = await renderTooltip({ ...POINT, isExcluded: true });

    expect(actionNames(row)).toEqual(['include']);

    await act(row, 'include');

    expect(handlers.onIncludeActivity).toHaveBeenCalledWith('a1');
    expect(handlers.onClearSelection).toHaveBeenCalledTimes(1);
  });

  it('names the attempt by its date, section time and difference to the best', async () => {
    const row = await renderTooltip(POINT);
    const label: string = row.props.accessibilityLabel;

    expect(label).toContain('Harbour loop');
    expect(label).toContain('3:20');
    expect(label).toContain('40 s');
    expect(label).toContain(formatShortDateWithYear(POINT.date));
    expect(label).not.toContain("'");
  });

  it('names the record only once every time stream is read, as the drawn mark does', async () => {
    const settled = await renderTooltipFor({ ...POINT, isBest: true }, true);
    expect(settled.props.accessibilityLabel).toMatch(/^sections\.legendPr, Harbour loop/);
    await screen.unmount();

    const pending = await renderTooltipFor({ ...POINT, isBest: true }, false);
    expect(pending.props.accessibilityLabel).not.toContain('sections.legendPr');
  });

  it('offers no action without handlers', async () => {
    await render(
      <PerformanceTooltip
        selectedPoint={POINT}
        isDark={false}
        basis="speed"
        activityColor="#000000"
        onClearSelection={() => {}}
      />
    );

    const row = screen.getByRole('button', { name: /^Harbour loop/ });
    expect(row.props.accessibilityActions).toBeUndefined();
  });
});

describe('the selected attempt row exclude mark', () => {
  it('draws the exclusion glyph the lap list and the action row use', async () => {
    await renderTooltip(POINT);

    const exclude = screen.getByLabelText('sections.excludeActivity');
    const names = exclude
      .findAll((n: { props: { name?: string } }) => typeof n.props.name === 'string')
      .map((n: { props: { name?: string } }) => n.props.name);

    expect(names[0]).toBe('eye-off-outline');
  });
});
