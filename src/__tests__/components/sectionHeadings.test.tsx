/**
 * Scenario: a screen reader user skims a long screen by its headings, the way
 * the headings rotor and heading navigation move.
 *
 * Expected behaviour: a tour slide's title and a collapsible section's title
 * are headings. The collapsible title stays the control that opens and closes
 * the section, with its expanded state, so one stop both names the section and
 * toggles it.
 */

import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { WhatsNewSlide } from '@/features/settings/components/whatsNew/WhatsNewSlide';
import { CollapsibleSection } from '@/shared/ui/CollapsibleSection';
import { SectionTitle } from '@/shared/ui/SectionTitle';

jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

describe('a section title', () => {
  it('is a heading carrying its text', async () => {
    await render(<SectionTitle>Climbs near home</SectionTitle>);

    expect(screen.getByRole('header', { name: 'Climbs near home' })).toBeTruthy();
  });
});

describe('a tour slide', () => {
  it('titles itself as a heading', async () => {
    await render(
      <WhatsNewSlide icon="map" title="Sections" body="Repeated parts of your rides." />
    );

    expect(screen.getByRole('header', { name: 'Sections' })).toBeTruthy();
  });
});

describe('a collapsible section', () => {
  it('is a heading that toggles, with its expanded state', async () => {
    const onToggle = jest.fn();
    await render(
      <CollapsibleSection title="Records" expanded={false} onToggle={onToggle}>
        <Text>content</Text>
      </CollapsibleSection>
    );

    const heading = screen.getByRole('header', { name: 'Records' });
    expect(heading.props.accessibilityState).toEqual({ expanded: false });

    await fireEvent.press(heading);
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it('reports itself expanded once open', async () => {
    await render(
      <CollapsibleSection title="Records" expanded onToggle={jest.fn()}>
        <Text>content</Text>
      </CollapsibleSection>
    );

    expect(screen.getByRole('header', { name: 'Records' }).props.accessibilityState).toEqual({
      expanded: true,
    });
  });
});
