/**
 * Scenario: the engine hands over one correlation per direction and wellness variable, each a
 * mover, inconclusive, too few attempts or undefined.
 * Expected behaviour: the card draws the figures the engine gave and nothing it did not. A state
 * without a coefficient shows no digit that could be read as one.
 */

import React from 'react';
import { fireEvent, render, within } from '@testing-library/react-native';
import { SectionCorrelationCard } from '@/features/routes/components/section/SectionCorrelationCard';
import type { FfiCorrelation, FfiSectionCorrelation } from 'veloqrs';

jest.mock('veloqrs', () =>
  require('../../__shared__/veloqrsStub').withOverrides({
    FfiCorrelation_Tags: {
      TooFew: 'TooFew',
      Undefined: 'Undefined',
      Inconclusive: 'Inconclusive',
      Mover: 'Mover',
    },
  })
);

jest.mock('react-native-iap', () => ({
  useIAP: () => ({}),
  ErrorCode: {},
}));

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}|${JSON.stringify(params)}` : key,
  }),
}));

/** Every string the row renders, in order. */
function rowText(node: Parameters<typeof within>[0]): string {
  return JSON.stringify(
    within(node)
      .queryAllByText(/.*/)
      .map((n) => n.props.children)
  );
}

function row(direction: string, variable: string, result: unknown): FfiSectionCorrelation {
  return { direction, variable, result: result as FfiCorrelation };
}

const mover = (r: number, n: number, low: number, high: number) => ({
  tag: 'Mover',
  inner: { r, n, low, high },
});
const inconclusive = (r: number, n: number, low: number, high: number) => ({
  tag: 'Inconclusive',
  inner: { r, n, low, high },
});
const tooFew = (n: number) => ({ tag: 'TooFew', inner: { n } });
const undef = (n: number) => ({ tag: 'Undefined', inner: { n } });

describe('SectionCorrelationCard', () => {
  it('renders nothing for an empty list', () => {
    const { queryByTestId } = render(
      <SectionCorrelationCard correlations={[]} floor={10} isDark={false} />
    );
    expect(queryByTestId('section-correlation-card')).toBeNull();
  });

  it('draws a mover as a strength word, a direction and n, with no raw figure', () => {
    const { getByTestId } = render(
      <SectionCorrelationCard
        correlations={[row('same', 'hrv', mover(0.4321, 31, 0.1234, 0.6789))]}
        floor={10}
        isDark={false}
      />
    );
    const text = rowText(getByTestId('section-correlation-row-same-hrv'));
    expect(text).toContain('31');
    expect(text).toContain('sections.correlationStrengthModerate');
    expect(text).toContain('sections.correlationFasterWhenHigher');
    expect(text).not.toContain('sections.correlationNoClearLink');
    expect(text).not.toContain('0.43');
  });

  it('shows r and the interval only after the raw switch is on', () => {
    const { getByTestId, queryByTestId } = render(
      <SectionCorrelationCard
        correlations={[row('same', 'hrv', mover(0.4321, 31, 0.1234, 0.6789))]}
        floor={10}
        isDark={false}
      />
    );
    expect(queryByTestId('section-correlation-raw-same-hrv')).toBeNull();
    fireEvent(getByTestId('section-correlation-raw-switch'), 'valueChange', true);
    const raw = JSON.stringify(getByTestId('section-correlation-raw-same-hrv').props.children);
    expect(raw).toContain('0.43');
    expect(raw).toContain('0.12');
    expect(raw).toContain('0.68');
    fireEvent(getByTestId('section-correlation-raw-switch'), 'valueChange', false);
    expect(queryByTestId('section-correlation-raw-same-hrv')).toBeNull();
  });

  it('reads a negative mover as faster when lower', () => {
    const { getByTestId } = render(
      <SectionCorrelationCard
        correlations={[row('same', 'resting_hr', mover(-0.65, 40, -0.8, -0.4))]}
        floor={10}
        isDark={false}
      />
    );
    const text = rowText(getByTestId('section-correlation-row-same-resting_hr'));
    expect(text).toContain('sections.correlationFasterWhenLower');
    expect(text).toContain('sections.correlationStrengthStrong');
  });

  it('draws an inconclusive row as no clear link with no direction', () => {
    const { getByTestId } = render(
      <SectionCorrelationCard
        correlations={[row('same', 'weight', inconclusive(-0.05, 22, -0.45, 0.37))]}
        floor={10}
        isDark={false}
      />
    );
    const text = rowText(getByTestId('section-correlation-row-same-weight'));
    expect(text).toContain('22');
    expect(text).not.toContain('-0.05');
    expect(text).not.toContain('sections.correlationFasterWhen');
    expect(text).toContain('sections.correlationNoClearLink');
  });

  it('draws too few as not enough data with n and no coefficient', () => {
    const { getByTestId, getAllByText } = render(
      <SectionCorrelationCard
        correlations={[
          row('same', 'hrv', tooFew(7)),
          row('same', 'weight', mover(0.5, 30, 0.2, 0.7)),
        ]}
        floor={10}
        isDark={false}
      />
    );
    const text = rowText(getByTestId('section-correlation-row-same-hrv'));
    expect(text).toContain('sections.correlationNotEnoughData');
    expect(text).toContain('7');
    expect(text).not.toMatch(/\d\.\d/);
    expect(getAllByText(/correlationNotEnoughData/).length).toBeGreaterThan(0);
  });

  it('draws undefined with no coefficient', () => {
    const { getByTestId } = render(
      <SectionCorrelationCard
        correlations={[
          row('same', 'weight', undef(15)),
          row('same', 'hrv', mover(0.5, 30, 0.2, 0.7)),
        ]}
        floor={10}
        isDark={false}
      />
    );
    const text = rowText(getByTestId('section-correlation-row-same-weight'));
    expect(text).toContain('sections.correlationNotEnoughData');
    expect(text).not.toMatch(/\d\.\d/);
  });

  it('collapses a direction of only too-few and undefined rows to one line with the largest n', () => {
    const { queryByTestId, getByTestId } = render(
      <SectionCorrelationCard
        correlations={[
          row('same', 'hrv', tooFew(3)),
          row('same', 'weight', tooFew(8)),
          row('same', 'ctl', undef(5)),
        ]}
        floor={10}
        isDark={false}
      />
    );
    expect(queryByTestId('section-correlation-row-same-hrv')).toBeNull();
    expect(queryByTestId('section-correlation-row-same-weight')).toBeNull();
    const text = JSON.stringify(getByTestId('section-correlation-collapsed-same').props.children);
    expect(text).toContain('8');
    expect(text).toMatch(/\\"n\\":8\b/);
    expect(text).not.toMatch(/\\"n\\":3\b/);
  });

  it('states the floor the engine applied, not one of its own', () => {
    const { getByTestId } = render(
      <SectionCorrelationCard
        correlations={[
          row('same', 'hrv', tooFew(7)),
          row('same', 'weight', mover(0.5, 30, 0.2, 0.7)),
          row('reverse', 'hrv', tooFew(11)),
        ]}
        floor={14}
        isDark={false}
      />
    );
    const tooFewRow = rowText(getByTestId('section-correlation-row-same-hrv'));
    expect(tooFewRow).toMatch(/\\"floor\\":14\b/);
    const collapsed = JSON.stringify(
      getByTestId('section-correlation-collapsed-reverse').props.children
    );
    expect(collapsed).toMatch(/\\"n\\":11\b/);
    expect(collapsed).toMatch(/\\"floor\\":14\b/);
  });

  it('keeps the engine order within a direction', () => {
    const { getAllByTestId } = render(
      <SectionCorrelationCard
        correlations={[
          row('same', 'weight', inconclusive(0.01, 20, -0.4, 0.4)),
          row('same', 'hrv', mover(0.6, 20, 0.2, 0.8)),
        ]}
        floor={10}
        isDark={false}
      />
    );
    const ids = getAllByTestId(/^section-correlation-row-same-/).map((n) => n.props.testID);
    expect(ids).toEqual([
      'section-correlation-row-same-weight',
      'section-correlation-row-same-hrv',
    ]);
  });
});
