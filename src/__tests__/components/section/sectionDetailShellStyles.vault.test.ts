/**
 * Scenario: the section screen's shared sheet carried the action row's pill
 * styles and the content area's banner styles, though only those two
 * components read them.
 *
 * Expected behaviour: the shared sheet holds what the section's card itself
 * places, and each child owns its own sheet. The card sits in the map sheet,
 * which paints the ground, so the card paints none over it.
 */

import { StyleSheet } from 'react-native';
import { styles as shell } from '@/features/routes/components/section/SectionDetail.styles';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

describe('the section screen shell styles', () => {
  it('holds none of the action row or content area keys', () => {
    const childKeys = [
      'actionRow',
      'actionChips',
      'actionPill',
      'actionPillText',
      'contentSection',
      'disabledBanner',
      'disabledBannerDark',
      'disabledBannerText',
      'mergeBanner',
      'mergeBannerDark',
      'mergeBannerText',
      'mergeBannerTextDark',
    ];
    expect(Object.keys(shell).filter((key) => childKeys.includes(key))).toEqual([]);
  });

  it('keeps the keys the card places itself, with no ground of its own', () => {
    expect(Object.keys(shell)).toEqual(
      expect.arrayContaining([
        'scrollView',
        'listFooterContainer',
        'exportGpxButton',
        'rescanRefusal',
        'rescanRefusalText',
        'rescanRefusalTextDark',
      ])
    );
    expect(StyleSheet.flatten(shell.scrollView)).not.toHaveProperty('backgroundColor');
  });
});
