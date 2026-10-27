/**
 * Scenario: the device goes offline and the pill's live region is read aloud. The
 * cloud glyph sat in the region as a bare icon, so TalkBack spoke its private-use
 * codepoint before the words, and the chevron of an action pill was read as part
 * of its name.
 *
 * Expected behaviour: the live region is named by its title and detail, and each
 * glyph is out of the screen reader's order, the chevron of an action pill too.
 * The pill is spoken once per platform: the live region on Android, the announcement
 * on iOS, which is where `useAnnounceOnAppear` acts.
 */

import React from 'react';
import { AccessibilityInfo, Platform } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { FloatingPill } from '@/shared/ui/FloatingPill';

jest.mock('@/shared/app', () => ({
  ...jest.requireActual('@/shared/app'),
  useTheme: () => ({ isDark: false }),
}));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

const originalOS = Platform.OS;

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  Platform.OS = originalOS;
  jest.restoreAllMocks();
});

const TITLE = "You're offline.";
const DETAIL = 'Sync and uploads resume when you are back online.';

function statusPill() {
  return render(
    <FloatingPill icon="cloud-off-outline" title={TITLE} detail={DETAIL} testID="pill" />
  );
}

function glyphsIn(root: ReturnType<typeof render>) {
  return root.UNSAFE_queryAllByType(MaterialCommunityIcons);
}

describe('the live region of a status pill', () => {
  it('is named by its title and detail, so the glyph is not part of the speech', () => {
    statusPill();

    expect(screen.getByTestId('pill').props.accessibilityLiveRegion).toBe('polite');
    expect(screen.getByTestId('pill').props.accessibilityLabel).toBe(
      `${TITLE}, ${DETAIL.replace(/\.$/, '')}`
    );
  });

  it('keeps its lead glyph out of the screen reader order', () => {
    const root = statusPill();

    const [lead] = glyphsIn(root);
    expect(lead?.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(lead?.props.accessibilityElementsHidden).toBe(true);
  });
});

describe('the chevron of an action pill', () => {
  it('is out of the screen reader order, so the button is named by its title alone', () => {
    const root = render(
      <FloatingPill
        icon="cloud-off-outline"
        title={TITLE}
        detail={DETAIL}
        onPress={() => {}}
        testID="pill"
      />
    );

    const glyphs = glyphsIn(root);
    const chevron = glyphs[glyphs.length - 1];
    expect(chevron?.props.name).toBe('chevron-right');
    expect(chevron?.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(chevron?.props.accessibilityElementsHidden).toBe(true);
  });
});

describe('the announcement', () => {
  const announcement = `${TITLE}. ${DETAIL}`;

  it('is spoken once on iOS', () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    Platform.OS = 'ios';

    render(
      <FloatingPill
        icon="cloud-off-outline"
        title={TITLE}
        detail={DETAIL}
        announcement={announcement}
        testID="pill"
      />
    );

    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(announcement);
  });

  it('is left to the live region on Android', () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    Platform.OS = 'android';

    render(
      <FloatingPill
        icon="cloud-off-outline"
        title={TITLE}
        detail={DETAIL}
        announcement={announcement}
        testID="pill"
      />
    );

    expect(announce).not.toHaveBeenCalled();
  });
});
