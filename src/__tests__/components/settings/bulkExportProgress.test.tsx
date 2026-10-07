/**
 * Scenario: the export runs on a Rust thread and reports how many activities
 * it has written, and of how many, four times a second. Until the first read
 * lands it has no total to report.
 *
 * Expected behaviour: the row shows the count while the worker runs, and a
 * native spinner only while there is no total to count against.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { BulkExportProgress } from '@/features/settings/components/BulkExportProgress';

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysWithValues());

it('shows a spinner and no count while the total is unknown', () => {
  render(
    <BulkExportProgress
      phase="generating"
      format="gpx"
      current={0}
      total={0}
      sizeBytes={0}
      isDark={false}
    />
  );

  expect(screen.getByTestId('bulk-export-spinner')).toBeTruthy();
  expect(screen.getByText(/export\.bulkExporting/)).toBeTruthy();
  expect(screen.queryByTestId('bulk-export-count')).toBeNull();
});

it('shows the count and no spinner once the worker reports a total', () => {
  render(
    <BulkExportProgress
      phase="generating"
      format="gpx"
      current={150}
      total={402}
      sizeBytes={0}
      isDark={false}
    />
  );

  expect(screen.queryByTestId('bulk-export-spinner')).toBeNull();
  expect(screen.getByTestId('bulk-export-count')).toHaveTextContent(
    'export.bulkCount:{"current":150,"total":402}'
  );
});

it('shows the size once the export has produced one', () => {
  render(
    <BulkExportProgress
      phase="sharing"
      format="gpx"
      current={402}
      total={402}
      sizeBytes={8_400_000}
      isDark={false}
    />
  );

  expect(screen.getByText('export.bulkSharing')).toBeTruthy();
  expect(screen.getByText(/8/)).toBeTruthy();
});

it('says nothing about a size it does not have yet', () => {
  render(
    <BulkExportProgress
      phase="generating"
      format="gpx"
      current={0}
      total={0}
      sizeBytes={0}
      isDark={false}
    />
  );

  expect(screen.queryByText(/B$/)).toBeNull();
});
