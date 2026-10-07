/**
 * Scenario: the wellness trends chart printed stored kilograms to an imperial athlete.
 * Expected behaviour: the weight row reads pounds, converted, under imperial, and kilograms
 * under metric.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { WellnessTrendsChart } from '@/features/wellness/components/WellnessTrendsChart';
import type { WellnessData } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

let mockIsMetric = true;
jest.mock('@/shared/app/useMetricSystem', () => ({ useMetricSystem: () => mockIsMetric }));

const DAYS: WellnessData[] = Array.from({ length: 30 }, (_, i) => ({
  id: `2026-06-${String(i + 1).padStart(2, '0')}`,
  weight: 72.5,
}));

describe('wellness weight row units', () => {
  it('shows kilograms for a metric athlete', () => {
    mockIsMetric = true;
    const tree = render(<WellnessTrendsChart data={DAYS} timeRange="1m" />);
    expect(tree.getByText('72.5')).toBeTruthy();
    expect(tree.getByText('kg')).toBeTruthy();
  });

  it('shows converted pounds for an imperial athlete', () => {
    mockIsMetric = false;
    const tree = render(<WellnessTrendsChart data={DAYS} timeRange="1m" />);
    expect(tree.getByText('159.8')).toBeTruthy();
    expect(tree.getByText('lbs')).toBeTruthy();
  });
});
