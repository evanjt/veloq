import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { SectionCreationOverlay } from '@/features/maps/components/SectionCreationOverlay';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({
  useMetricSystem: () => true,
  useTheme: () => ({ isDark: false }),
}));

function renderSelection(sectionPointCount: number) {
  return render(
    <SectionCreationOverlay
      state="complete"
      startIndex={0}
      endIndex={sectionPointCount - 1}
      coordinateCount={sectionPointCount}
      sectionDistance={1000}
      sectionPointCount={sectionPointCount}
      onConfirm={jest.fn()}
      onCancel={jest.fn()}
      onReset={jest.fn()}
    />
  );
}

describe('large section selection', () => {
  it('warns about processing time at both large sizes without claiming save will fail', () => {
    const view = renderSelection(5000);
    fireEvent.press(screen.getByText('1.0 km'));
    expect(screen.getByText('routes.largeSectionPerformanceWarning')).toBeTruthy();

    view.rerender(
      <SectionCreationOverlay
        state="complete"
        startIndex={0}
        endIndex={7999}
        coordinateCount={8000}
        sectionDistance={1000}
        sectionPointCount={8000}
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
        onReset={jest.fn()}
      />
    );
    expect(screen.getByText('routes.largeSectionPerformanceWarning')).toBeTruthy();
    expect(screen.queryByText('Section may be too large to save')).toBeNull();
  });
});
