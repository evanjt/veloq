/**
 * Scenario: a title that is also a control carried the header role on the
 * pressable itself. Android keeps one role per node, so the header role
 * displaced the button role and the control was announced as a heading with
 * nothing saying it could be activated.
 *
 * Expected behaviour: on Android the pressable is a button with its label and
 * state, and the heading is a separate node that is not pressable and not a
 * second focus stop. On iOS the header trait stays on the control.
 */
import React from 'react';
import { Platform, Text } from 'react-native';
import { render } from '@testing-library/react-native';

import { CollapsibleSection } from '@/shared/ui/CollapsibleSection';
import { HeroNameRow } from '@/shared/ui/DetailHero';

jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

const originalOS = Platform.OS;
afterEach(() => {
  Platform.OS = originalOS;
});

type Node = { props: Record<string, unknown> };

function findAll(root: { findAll: (p: (n: Node) => boolean) => Node[] }, role: string) {
  return root.findAll(
    (n) => n.props.accessibilityRole === role && typeof n.props.accessibilityLabel === 'string'
  );
}

function expectSplit(root: { findAll: (p: (n: Node) => boolean) => Node[] }, label: string) {
  const buttons = findAll(root, 'button').filter((n) => typeof n.props.onPress === 'function');
  expect(buttons.length).toBeGreaterThan(0);
  expect(buttons[0]!.props.accessibilityLabel).toContain(label);

  const headings = findAll(root, 'header');
  expect(headings.length).toBeGreaterThan(0);
  for (const heading of headings) {
    expect(heading.props.onPress).toBeUndefined();
    expect(heading.props.importantForAccessibility).toBe('no');
    expect(heading.props.accessibilityLabel).toContain(label);
  }
  expect(findAll(root, 'header').some((n) => typeof n.props.onPress === 'function')).toBe(false);
}

describe('a title that is also a control', () => {
  it('CollapsibleSection is a button with its state and a separate heading on Android', async () => {
    Platform.OS = 'android';
    const { UNSAFE_root } = await render(
      <CollapsibleSection title="Gear" expanded={false} onToggle={jest.fn()} testID="gear-header">
        <Text>content</Text>
      </CollapsibleSection>
    );

    expectSplit(UNSAFE_root, 'Gear');
    const button = findAll(UNSAFE_root, 'button').find(
      (n) => typeof n.props.onPress === 'function'
    )!;
    expect(button.props.accessibilityState).toEqual({ expanded: false });
  });

  it('CollapsibleSection keeps the header role on the control on iOS', async () => {
    Platform.OS = 'ios';
    const { UNSAFE_root } = await render(
      <CollapsibleSection title="Gear" expanded onToggle={jest.fn()}>
        <Text>content</Text>
      </CollapsibleSection>
    );

    const pressable = findAll(UNSAFE_root, 'header').find(
      (n) => typeof n.props.onPress === 'function'
    );
    expect(pressable).toBeDefined();
  });

  it('the rename title is a button with a separate heading on Android', async () => {
    Platform.OS = 'android';
    const { UNSAFE_root } = await render(
      <HeroNameRow
        name="Route 1"
        editable={{
          isEditing: false,
          editName: '',
          inputRef: { current: null },
          label: 'Route name',
          testIDPrefix: 'route',
          onStartEdit: jest.fn(),
          onSave: jest.fn(),
          onCancel: jest.fn(),
          onChange: jest.fn(),
        }}
      />
    );

    expectSplit(UNSAFE_root, 'Route 1');
  });
});
