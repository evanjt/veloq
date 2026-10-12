/**
 * Scenario: a VoiceOver user places the start and end of a new section.
 * Expected behaviour: each step's prompt is spoken once as the step begins, and
 * TalkBack gets the same prompt through a polite live region.
 */

import React from 'react';
import { AccessibilityInfo, Platform } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import {
  SectionCreationOverlay,
  type CreationState,
} from '@/features/maps/components/SectionCreationOverlay';

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({
  useMetricSystem: () => true,
  useTheme: () => ({ isDark: false }),
}));

const announce = AccessibilityInfo.announceForAccessibility as jest.Mock;
const originalOS = Platform.OS;

function overlay(state: CreationState, endIndex: number | null = null) {
  return (
    <SectionCreationOverlay
      state={state}
      startIndex={state === 'selectingStart' ? null : 10}
      endIndex={endIndex}
      coordinateCount={100}
      sectionDistance={endIndex === null ? null : 1000}
      sectionPointCount={endIndex === null ? null : 40}
      onConfirm={jest.fn()}
      onCancel={jest.fn()}
      onReset={jest.fn()}
    />
  );
}

function setOS(os: typeof Platform.OS) {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
}

beforeEach(() => {
  announce.mockClear();
});

afterEach(() => {
  setOS(originalOS);
});

describe('section creation step announcements', () => {
  it('announces each step once on iOS as the selection moves on', async () => {
    setOS('ios');
    const view = await render(overlay('selectingStart'));
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenLastCalledWith('maps.tapSelectStart');

    await view.rerender(overlay('selectingStart'));
    expect(announce).toHaveBeenCalledTimes(1);

    await view.rerender(overlay('selectingEnd'));
    expect(announce).toHaveBeenCalledTimes(2);
    expect(announce).toHaveBeenLastCalledWith('maps.tapSelectEnd');

    await view.rerender(overlay('complete', 50));
    expect(announce).toHaveBeenCalledTimes(3);
    expect(announce).toHaveBeenLastCalledWith('maps.sectionSelected, 1.0 km');
  });

  it('leaves the speaking to the live region on Android', async () => {
    setOS('android');
    const view = await render(overlay('selectingStart'));
    await view.rerender(overlay('selectingEnd'));
    expect(announce).not.toHaveBeenCalled();

    const prompt = screen.getByText('maps.tapSelectEnd');
    expect(prompt.props.accessibilityLiveRegion).toBe('polite');
  });
});
