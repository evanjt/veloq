/**
 * Scenario: closing an insight sheet is a press that only leaves, so it fires no haptic.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { changeLanguage, initialiseI18n } from '@/i18n';
import { InsightDetailSheet } from '@/features/insights/components/InsightDetailSheet';
import * as haptics from '@/shared/ui/haptics';
import type { Insight } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/app/navigation', () => ({ tapTo: jest.fn(), navigateTo: jest.fn() }));
jest.mock('@/shared/ui/haptics', () => ({
  selection: jest.fn(),
  light: jest.fn(),
  medium: jest.fn(),
  success: jest.fn(),
}));

const insight = {
  id: 'fitness_milestone-ridge',
  category: 'fitness_milestone',
  priority: 1,
  title: 'Fitness at a season high',
  icon: 'chart-line',
  iconTone: 'info',
  timestamp: 0,
  isNew: false,
} as Insight;

describe('closing an insight sheet', () => {
  beforeAll(() => initialiseI18n('en-GB'));
  beforeEach(() => {
    changeLanguage('en-GB');
    jest.clearAllMocks();
  });

  it('calls onClose and fires no haptic, on a first press and a second', async () => {
    const onClose = jest.fn();
    await render(<InsightDetailSheet insight={insight} onClose={onClose} />);

    await fireEvent.press(screen.getByLabelText('Close'));
    await fireEvent.press(screen.getByLabelText('Close'));

    expect(onClose).toHaveBeenCalledTimes(2);
    expect(haptics.light).not.toHaveBeenCalled();
    expect(haptics.medium).not.toHaveBeenCalled();
    expect(haptics.selection).not.toHaveBeenCalled();
    expect(haptics.success).not.toHaveBeenCalled();
  });
});
