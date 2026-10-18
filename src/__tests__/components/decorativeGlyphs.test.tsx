/**
 * Scenario: an icon glyph or a text separator drawn outside a control is a
 * stop of its own for a screen reader, which reads a private-use codepoint or
 * a lone dot, at the top of every screen that shows a banner.
 *
 * Expected behaviour: a glyph is hidden from screen readers unless it is given
 * a label, and then it is an image with that name; a separator is hidden and
 * still drawn; the summary card's supporting row is its metric buttons and
 * nothing between them.
 */

import React from 'react';
import { act, render, screen, within } from '@testing-library/react-native';

import { SummaryCard } from '@/features/home/components/SummaryCard';
import { Icon } from '@/shared/ui/Icon';
import { NoticeBanner } from '@/shared/ui/NoticeBanner';
import { TextSeparator } from '@/shared/ui/TextSeparator';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@/i18n', () => ({
  i18n: { t: (key: string) => key },
  getCurrentLanguage: () => 'en-GB',
}));
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn(() => null) }));
jest.mock('@/shared/app/useAthlete', () => ({ useAthlete: () => ({ data: undefined }) }));
jest.mock('@/features/stats', () => ({ usePaceCurve: () => ({ data: undefined }) }));
jest.mock('@/shared/app/useMetricSystem', () => ({ useMetricSystem: () => true }));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const hidden = { includeHiddenElements: true } as const;

describe('the shared icon', () => {
  it('is hidden from screen readers and still drawn when it carries no label', async () => {
    await render(<Icon testID="glyph" name="dog" size={16} color="#000000" />);

    expect(screen.queryByTestId('glyph')).toBeNull();
    expect(screen.getByTestId('glyph', hidden)).toBeTruthy();
  });

  it('is an image with that name when it carries a label', async () => {
    await render(<Icon name="dog" size={16} color="#000000" accessibilityLabel="Kennel open" />);

    expect(screen.getByRole('image', { name: 'Kennel open' })).toBeTruthy();
  });
});

describe('the text separator', () => {
  it('is drawn and not read', async () => {
    await render(<TextSeparator />);

    expect(screen.queryByText('·')).toBeNull();
    expect(screen.getByText('·', hidden)).toBeTruthy();
  });

  it('draws a bar when asked for one', async () => {
    await render(<TextSeparator mark="bar" />);

    expect(screen.getByText('|', hidden)).toBeTruthy();
  });
});

describe('the top banner', () => {
  it('draws its tone icon outside the screen reader order', async () => {
    await render(
      <NoticeBanner
        slot="syncError"
        tone="info"
        icon="dog"
        title="The kennel is open"
        testID="kennel-banner"
      />
    );

    expect(screen.getByText('The kennel is open')).toBeTruthy();
    expect(screen.queryAllByTestId('icon')).toHaveLength(0);
    expect(screen.getAllByTestId('icon', hidden)).toHaveLength(1);
  });
});

describe('the summary card supporting row', () => {
  const metric = (n: number) => ({
    label: `metric.${n}`,
    value: n,
    accessibilityLabel: `metric ${n}`,
    navigationTarget: '/fitness',
  });

  it('is the four metric buttons and no separator between them', async () => {
    await render(
      <SummaryCard
        heroValue={0}
        heroLabel="metrics.fitness"
        showSparkline={false}
        supportingMetrics={[metric(1), metric(2), metric(3), metric(4)]}
      />
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const row = screen.getByTestId('summary-card-supporting');
    expect(
      within(row)
        .getAllByRole('button')
        .map((b) => b.props.accessibilityLabel)
    ).toEqual(['metric 1', 'metric 2', 'metric 3', 'metric 4']);
    expect(within(row).queryAllByText('·')).toHaveLength(0);
    expect(within(row).getAllByText('·', hidden)).toHaveLength(3);
  });
});
