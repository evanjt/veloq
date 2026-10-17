/**
 * Scenario: each animated surface typed its own durations, so two banners
 * entered at different speeds, a card faded out slower than it faded in and a
 * sync strip faded in over 700 ms.
 *
 * Expected behaviour: the motion tokens hold the style guide's nine durations
 * and four curves, no pair exits slower than it enters, and the banner and the
 * pills render the shared preset objects rather than building their own.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { duration, easingCurve, motionPairs, motionPresets } from '@/theme/motion';
import { OfflinePill } from '@/shared/ui/StatusPills';
import { NoticeBanner } from '@/shared/ui/NoticeBanner';
import { TourReturnPill } from '@/features/settings/components/whatsNew/TourReturnPill';
import { useWhatsNewStore } from '@/features/settings/stores/WhatsNewStore';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysWithValues());
jest.mock('@/shared/app', () => ({
  ...jest.requireActual('@/shared/app'),
  useTheme: () => ({ isDark: false }),
}));
jest.mock('@/shared/app/useTheme', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/app/NetworkContext', () => ({
  useNetwork: () => ({ isOnline: false, offlineBannerShown: true }),
}));

type Animated = { props: { entering?: unknown; exiting?: unknown } };

function animated(root: { findAll: (p: (n: Animated) => boolean) => Animated[] }) {
  const [node] = root.findAll((n) => n.props.entering !== undefined);
  if (!node) throw new Error('nothing rendered with an entering animation');
  return { entering: node.props.entering, exiting: node.props.exiting };
}

describe('motion tokens', () => {
  it('hold the style guide durations', () => {
    expect(duration).toEqual({
      instant: 100,
      quick: 150,
      exit: 200,
      standard: 250,
      slow: 300,
      message: 600,
      pulse: 800,
      hold: 1500,
      loop: 2400,
    });
  });

  it('hold the style guide curves', () => {
    expect(easingCurve).toEqual({
      standard: [0.4, 0, 0.2, 1],
      enter: [0, 0, 0.2, 1],
      exit: [0.4, 0, 1, 1],
      linear: [0, 0, 1, 1],
    });
  });

  it('pair banners, pills and cards as the guide does', () => {
    expect(motionPairs.banner).toEqual({ enter: duration.standard, exit: duration.exit });
    expect(motionPairs.pill).toEqual({ enter: duration.exit, exit: duration.quick });
    expect(motionPairs.card).toEqual({ enter: duration.slow, exit: duration.exit });
    expect(motionPairs.message).toEqual({ enter: duration.message, exit: duration.message });
  });

  it('never exit slower than they enter', () => {
    for (const pair of Object.values(motionPairs)) {
      expect(pair.exit).toBeLessThanOrEqual(pair.enter);
    }
  });
});

describe('shared presets', () => {
  it('slide the notice banner in and out with the banner preset', () => {
    const { UNSAFE_root } = render(
      <NoticeBanner slot="syncError" tone="warning" icon="alert" title="Paused" testID="notice" />
    );

    expect(animated(UNSAFE_root).entering).toBe(motionPresets.banner.entering);
    expect(animated(UNSAFE_root).exiting).toBe(motionPresets.banner.exiting);
  });

  it('fade the offline pill with the pill preset', () => {
    const { UNSAFE_root } = render(<OfflinePill />);

    expect(animated(UNSAFE_root).entering).toBe(motionPresets.pill.entering);
    expect(animated(UNSAFE_root).exiting).toBe(motionPresets.pill.exiting);
  });

  it('fade the tour return pill with the same pill preset', () => {
    useWhatsNewStore.setState({ tourState: { exploring: true } } as never);
    const { UNSAFE_root } = render(<TourReturnPill />);

    expect(animated(UNSAFE_root).entering).toBe(motionPresets.pill.entering);
    expect(animated(UNSAFE_root).exiting).toBe(motionPresets.pill.exiting);
  });
});
