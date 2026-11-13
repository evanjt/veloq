/**
 * Scenario: a long passage on a screen that cannot spare the room, clamped to
 * three lines with a press that opens the rest.
 *
 * Expected behaviour: past three lines it shows three and "Show more", and the
 * press shows the whole passage and "Show less", with the state exposed. A
 * passage that fits carries no button. A screen reader reads the whole passage
 * whether it is clamped or not.
 */
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { initialiseI18n } from '@/i18n';
import { EXPANDABLE_TEXT_LINES, ExpandableText } from '@/shared/ui/ExpandableText';

// `ExpandableText` reaches the app barrel for `useTheme`, and the barrel pulls
// the IAP binding in behind it.
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

const PASSAGE =
  'Left the harbour before dawn, rowed out past the breakwater, turned at the ' +
  'lighthouse and came back along the reef with the tide running against us.';

beforeAll(async () => {
  await initialiseI18n();
});

function layoutWith(lineCount: number) {
  return {
    nativeEvent: {
      lines: Array.from({ length: lineCount }, (_, i) => ({
        text: `line ${i}`,
        x: 0,
        y: i * 20,
        width: 300,
        height: 20,
        ascender: 16,
        descender: 4,
        capHeight: 12,
        xHeight: 8,
      })),
    },
  };
}

async function renderMeasured(lineCount: number) {
  const view = await render(<ExpandableText text={PASSAGE} testID="note" />);
  await fireEvent(
    view.getByTestId('note-measure', { includeHiddenElements: true }),
    'textLayout',
    layoutWith(lineCount)
  );
  return view;
}

it('clamps a passage past three lines and opens it on a press', async () => {
  const { getByTestId, getByText, queryByText } = await renderMeasured(EXPANDABLE_TEXT_LINES + 2);

  expect(getByTestId('note-text').props.numberOfLines).toBe(EXPANDABLE_TEXT_LINES);
  const more = getByTestId('note-toggle');
  expect(getByText('Show more')).toBeTruthy();
  expect(more.props.accessibilityRole).toBe('button');
  expect(more.props.accessibilityState).toEqual({ expanded: false });

  await fireEvent.press(more);

  expect(getByTestId('note-text').props.numberOfLines).toBeUndefined();
  expect(getByText('Show less')).toBeTruthy();
  expect(queryByText('Show more')).toBeNull();
  expect(getByTestId('note-toggle').props.accessibilityState).toEqual({ expanded: true });

  await fireEvent.press(getByTestId('note-toggle'));

  expect(getByTestId('note-text').props.numberOfLines).toBe(EXPANDABLE_TEXT_LINES);
  expect(getByTestId('note-toggle').props.accessibilityState).toEqual({ expanded: false });
});

it('draws no button for a passage that fits', async () => {
  const { getByTestId, queryByTestId } = await renderMeasured(EXPANDABLE_TEXT_LINES);

  expect(queryByTestId('note-toggle')).toBeNull();
  expect(getByTestId('note-text').props.children).toBe(PASSAGE);
});

it('draws no button before the passage is measured', async () => {
  const { queryByTestId } = await render(<ExpandableText text={PASSAGE} testID="note" />);

  expect(queryByTestId('note-toggle')).toBeNull();
});

it('gives a screen reader the whole passage while clamped', async () => {
  const { getByTestId } = await renderMeasured(EXPANDABLE_TEXT_LINES + 4);

  expect(getByTestId('note-text').props.numberOfLines).toBe(EXPANDABLE_TEXT_LINES);
  expect(getByTestId('note-text').props.accessibilityLabel).toBe(PASSAGE);
});

it('keeps the measuring copy away from a screen reader', async () => {
  const { getByTestId } = await renderMeasured(EXPANDABLE_TEXT_LINES + 1);
  const measure = getByTestId('note-measure', { includeHiddenElements: true });

  expect(measure.props.accessibilityElementsHidden).toBe(true);
  expect(measure.props.importantForAccessibility).toBe('no-hide-descendants');
});
