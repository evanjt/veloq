/**
 * Scenario: the five parameter captions were written one at a time. Three carry
 * a distance, two of them printed `200m` with no space and the third
 * `200000 m`, which is 200 km written in metres.
 *
 * Expected behaviour: one formatter for every distance caption in the panel,
 * promoting to kilometres where metres stop meaning anything, with the spacing
 * the rest of the app uses.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { PreviewParamPanel } from '@/features/routes/components/preview/PreviewParamPanel';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${Object.values(vars).join(',')}` : key,
  }),
}));

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

const params = {
  proximityThreshold: 200,
  minSectionLength: 150,
  maxSectionLength: 200000,
  minActivities: 2,
  divergenceThreshold: 0.15,
};

function captions(overrides: Partial<typeof params> = {}) {
  const { UNSAFE_getAllByType } = render(
    <PreviewParamPanel params={{ ...params, ...overrides }} onChange={jest.fn()} />
  );
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text } = require('react-native');
  return UNSAFE_getAllByType(Text).map((n: { props: { children: string } }) => n.props.children);
}

describe('the distance captions', () => {
  it('promotes a 200 km ceiling out of metres', () => {
    expect(captions()).toContain('settings.sectionMaxLength:200.0 km');
  });

  it('keeps a short distance in metres, spaced the way the app spaces it', () => {
    const rendered = captions();
    expect(rendered).toContain('settings.sectionProximity:200 m');
    expect(rendered).toContain('settings.sectionMinLength:150 m');
  });

  it('spaces every distance caption the same way', () => {
    for (const caption of captions()) {
      if (!caption.startsWith('settings.section')) continue;
      const value = caption.split(':')[1];
      if (!/[a-z]+$/.test(value)) continue;
      expect(value).toMatch(/^[\d.]+ (m|km)$/);
    }
  });

  it('promotes at the kilometre, not at some threshold of its own', () => {
    expect(captions({ minSectionLength: 999 })).toContain('settings.sectionMinLength:999 m');
    expect(captions({ minSectionLength: 1000 })).toContain('settings.sectionMinLength:1.0 km');
  });

  it('leaves the two captions that are not distances alone', () => {
    const rendered = captions();
    expect(rendered).toContain('settings.sectionMinActivities:2');
    expect(rendered).toContain('settings.sectionSameTraffic:0.15');
  });
});
