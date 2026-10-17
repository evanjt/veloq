/**
 * Scenario: every container drew its own radius, shadow and dark ground.
 *
 * Expected behaviour: one `Card` with a flat and a raised variant, one radius
 * and one dark surface. A caller cannot redraw the container and the parent
 * stack owns the spacing.
 */

import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import { Card, type CardProps } from '@/shared/ui/Card';
import { CardHeader } from '@/shared/ui/CardHeader';
import { colors, darkColors, layout, shadows, spacing, typography } from '@/theme';

let mockIsDark = false;
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: mockIsDark }),
}));

const flat = (node: { props: { style?: unknown } }): Record<string, unknown> =>
  (StyleSheet.flatten(node.props.style as never) as Record<string, unknown>) ?? {};

afterEach(() => {
  mockIsDark = false;
});

describe('Card surface', () => {
  it('draws a flat card on the light surface with no shadow', async () => {
    const { getByTestId } = await render(
      <Card variant="flat" testID="c">
        <Text>x</Text>
      </Card>
    );
    const style = flat(getByTestId('c'));
    expect(style.backgroundColor).toBe(colors.surface);
    expect(style.borderRadius).toBe(layout.borderRadius);
    expect(style.shadowOpacity).toBeUndefined();
    expect(style.elevation).toBeUndefined();
  });

  it('gives a raised card the card shadow in light', async () => {
    const { getByTestId } = await render(
      <Card variant="raised" testID="c">
        <Text>x</Text>
      </Card>
    );
    expect(flat(getByTestId('c'))).toMatchObject(shadows.card);
  });

  it('puts both variants on the dark card surface', async () => {
    mockIsDark = true;
    for (const variant of ['flat', 'raised'] as const) {
      const { getByTestId } = await render(
        <Card variant={variant} testID={variant}>
          <Text>x</Text>
        </Card>
      );
      expect(flat(getByTestId(variant)).backgroundColor).toBe(darkColors.surfaceRaised);
    }
  });

  it('swaps the raised shadow for a border in dark', async () => {
    mockIsDark = true;
    const { getByTestId } = await render(
      <Card variant="raised" testID="c">
        <Text>x</Text>
      </Card>
    );
    const style = flat(getByTestId('c'));
    expect(style.borderWidth).toBe(1);
    expect(style.borderColor).toBe(darkColors.border);
    expect(style).toMatchObject(shadows.none);
  });

  it('draws a flat dark card with no border', async () => {
    mockIsDark = true;
    const { getByTestId } = await render(
      <Card variant="flat" testID="c">
        <Text>x</Text>
      </Card>
    );
    expect(flat(getByTestId('c')).borderWidth).toBeUndefined();
  });
});

describe('Card padding and clipping', () => {
  it('pads by default and clips on an inner view when padding is none', async () => {
    const padded = await render(
      <Card variant="flat" testID="c">
        <Text testID="child">x</Text>
      </Card>
    );
    expect(flat(padded.getByTestId('c-body')).padding).toBe(spacing.md);

    const bare = await render(
      <Card variant="raised" padding="none" testID="b">
        <Text>x</Text>
      </Card>
    );
    const body = flat(bare.getByTestId('b-body'));
    expect(body.overflow).toBe('hidden');
    expect(body.padding).toBeUndefined();
    expect(flat(bare.getByTestId('b')).overflow).toBeUndefined();
  });
});

describe('Card layout style', () => {
  it('passes layout keys through and carries no margin of its own', async () => {
    const { getByTestId } = await render(
      <Card variant="flat" testID="c" style={{ alignSelf: 'flex-start' }}>
        <Text>x</Text>
      </Card>
    );
    const style = flat(getByTestId('c'));
    expect(style.alignSelf).toBe('flex-start');
    expect(style.margin).toBeUndefined();
    expect(style.marginTop).toBeUndefined();
    expect(style.marginBottom).toBeUndefined();
    expect(style.marginHorizontal).toBeUndefined();
  });
});

describe('Card press', () => {
  it('requires a role and label when pressable', () => {
    type PressableCardProps = Extract<CardProps, { onPress: () => void }>;
    const roleRequired: object extends Pick<PressableCardProps, 'accessibilityRole'>
      ? false
      : true = true;
    const labelRequired: object extends Pick<PressableCardProps, 'accessibilityLabel'>
      ? false
      : true = true;
    expect(roleRequired).toBe(true);
    expect(labelRequired).toBe(true);
  });

  it('is a button that fires the handler when given onPress', async () => {
    const onPress = jest.fn();
    const { getByRole } = await render(
      <Card variant="flat" onPress={onPress} accessibilityRole="button" accessibilityLabel="Open">
        <Text>x</Text>
      </Card>
    );
    await fireEvent.press(getByRole('button'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('Card title', () => {
  it('names the card with a header in the card title role', () => {
    const { getByRole } = render(
      <Card variant="flat" title="Weekly load">
        <Text>x</Text>
      </Card>
    );
    const style = flat(getByRole('header', { name: 'Weekly load' }));
    expect(style.fontSize).toBe(typography.cardTitle.fontSize);
    expect(style.fontWeight).toBe(typography.cardTitle.fontWeight);
    expect(style.lineHeight).toBe(typography.cardTitle.lineHeight);
    expect(style.color).toBe(colors.textPrimary);
    expect(style.textTransform).toBeUndefined();
  });

  it('draws the title in the dark primary text colour in dark', () => {
    mockIsDark = true;
    const { getByRole } = render(
      <Card variant="raised" title="Weekly load">
        <Text>x</Text>
      </Card>
    );
    expect(flat(getByRole('header', { name: 'Weekly load' })).color).toBe(darkColors.textPrimary);
  });

  it('puts the accessory beside the title and the title before the content', () => {
    const { getByRole, getByTestId, toJSON } = render(
      <Card
        variant="flat"
        testID="c"
        title="Weekly load"
        titleAccessory={<Text testID="picker">Week</Text>}
      >
        <Text testID="content">x</Text>
      </Card>
    );
    const header = getByTestId('c-header');
    expect(header).toContainElement(getByRole('header', { name: 'Weekly load' }));
    expect(header).toContainElement(getByTestId('picker'));
    const order = JSON.stringify(toJSON());
    expect(order.indexOf('Weekly load')).toBeLessThan(order.indexOf('"content"'));
  });

  it('draws no header when the card has no title', () => {
    const { queryByRole } = render(
      <Card variant="flat">
        <Text>x</Text>
      </Card>
    );
    expect(queryByRole('header')).toBeNull();
  });
});

describe('CardHeader', () => {
  it('heads a card a feature draws itself, with the same role and a caption under it', () => {
    const { getByRole, getByTestId } = render(
      <CardHeader title="Activity calendar" subtitle="Jan to Dec" testID="h" />
    );
    const title = flat(getByRole('header', { name: 'Activity calendar' }));
    expect(title.fontSize).toBe(typography.cardTitle.fontSize);
    expect(title.fontWeight).toBe(typography.cardTitle.fontWeight);
    expect(title.color).toBe(colors.textPrimary);
    expect(getByTestId('h-subtitle')).toHaveTextContent('Jan to Dec');
    expect(flat(getByTestId('h-subtitle')).color).toBe(colors.textSecondary);
  });
});
