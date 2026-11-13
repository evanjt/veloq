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
      sectionDistance={1000}
      sectionPointCount={sectionPointCount}
      onConfirm={jest.fn()}
      onCancel={jest.fn()}
      onReset={jest.fn()}
    />
  );
}

describe('large section selection', () => {
  it('warns about processing time at both large sizes without claiming save will fail', async () => {
    const view = await renderSelection(5000);
    expect(screen.getByText('routes.largeSectionPerformanceWarning')).toBeTruthy();

    await view.rerender(
      <SectionCreationOverlay
        state="complete"
        startIndex={0}
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

/**
 * Scenario: a section fails to save and the overlay offers its technical details.
 *
 * Expected behaviour: the details toggle is the shared small Button, announced as expanded or
 * not, and its press shows the engine's message.
 */
describe('section creation technical details', () => {
  it('opens the details from a Button that reports whether they are shown', async () => {
    await render(
      <SectionCreationOverlay
        state="error"
        startIndex={0}
        sectionDistance={1000}
        sectionPointCount={10}
        error={{ message: 'Could not save', technicalDetails: 'engine said no' }}
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
        onReset={jest.fn()}
      />
    );
    const toggle = screen.getByTestId('section-creation-technical-toggle');
    expect(screen.getByTestId('section-creation-technical-toggle-label')).toHaveTextContent(
      'common.showDetails'
    );
    expect(toggle.props.accessibilityState).toEqual(expect.objectContaining({ expanded: false }));
    await fireEvent.press(toggle);
    expect(screen.getByText('engine said no')).toBeTruthy();
    expect(screen.getByTestId('section-creation-technical-toggle-label')).toHaveTextContent(
      'common.hideDetails'
    );
    expect(
      screen.getByTestId('section-creation-technical-toggle').props.accessibilityState
    ).toEqual(expect.objectContaining({ expanded: true }));
  });
});
