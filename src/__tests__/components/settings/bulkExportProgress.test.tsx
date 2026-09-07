/**
 * Scenario: the export is one blocking FFI call, so the row reporting it is on
 * the thread that cannot repaint until the call returns.
 *
 * Expected behaviour: the row shows a native spinner and says which phase it is
 * in. It never shows a percentage or an n-of-m, because there is no count until
 * the call returns and by then the export is over.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { BulkExportProgress } from '@/features/settings/components/BulkExportProgress';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

it('shows a spinner and the phase while generating, with no count', () => {
  render(<BulkExportProgress phase="generating" format="gpx" sizeBytes={0} isDark={false} />);

  expect(screen.getByTestId('bulk-export-spinner')).toBeTruthy();
  expect(screen.getByText(/export\.bulkExporting/)).toBeTruthy();
  expect(screen.queryByText(/%/)).toBeNull();
  expect(screen.queryByText(/\d+\s*\/\s*\d+/)).toBeNull();
});

it('shows the size once the export has produced one', () => {
  render(<BulkExportProgress phase="sharing" format="gpx" sizeBytes={8_400_000} isDark={false} />);

  expect(screen.getByText('export.bulkSharing')).toBeTruthy();
  expect(screen.getByText(/8/)).toBeTruthy();
  expect(screen.queryByText(/%/)).toBeNull();
});

it('says nothing about a size it does not have yet', () => {
  render(<BulkExportProgress phase="generating" format="gpx" sizeBytes={0} isDark={false} />);

  expect(screen.queryByText(/B$/)).toBeNull();
});
