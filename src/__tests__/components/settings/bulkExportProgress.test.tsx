/**
 * Scenario: the export runs on a Rust thread and reports how many activities
 * it has written, and of how many, four times a second. Until the first read
 * lands it has no total to report.
 *
 * Expected behaviour: the row shows the count while the worker runs, and a
 * native spinner only while there is no total to count against.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { BulkExportProgress } from '@/features/settings/components/BulkExportProgress';

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysWithValues());

it('shows a spinner and no count while the total is unknown', async () => {
  await render(
    <BulkExportProgress
      phase="generating"
      format="gpx"
      current={0}
      total={0}
      sizeBytes={0}
      isDark={false}
      onCancel={jest.fn()}
    />
  );

  expect(screen.getByTestId('bulk-export-spinner')).toBeTruthy();
  expect(screen.getByText(/export\.bulkExporting/)).toBeTruthy();
  expect(screen.queryByTestId('bulk-export-count')).toBeNull();
});

it('shows the count and no spinner once the worker reports a total', async () => {
  await render(
    <BulkExportProgress
      phase="generating"
      format="gpx"
      current={150}
      total={402}
      sizeBytes={0}
      isDark={false}
      onCancel={jest.fn()}
    />
  );

  expect(screen.queryByTestId('bulk-export-spinner')).toBeNull();
  expect(screen.getByTestId('bulk-export-count')).toHaveTextContent(
    'export.bulkCount:{"current":150,"total":402}'
  );
});

it('shows the size once the export has produced one', async () => {
  await render(
    <BulkExportProgress
      phase="sharing"
      format="gpx"
      current={402}
      total={402}
      sizeBytes={8_400_000}
      isDark={false}
      onCancel={jest.fn()}
    />
  );

  expect(screen.getByText('export.bulkSharing')).toBeTruthy();
  expect(screen.getByText(/8/)).toBeTruthy();
});

it('says nothing about a size it does not have yet', async () => {
  await render(
    <BulkExportProgress
      phase="generating"
      format="gpx"
      current={0}
      total={0}
      sizeBytes={0}
      isDark={false}
      onCancel={jest.fn()}
    />
  );

  expect(screen.queryByText(/B$/)).toBeNull();
});

it('exposes the running count as a progress bar a screen reader can read', async () => {
  await render(
    <BulkExportProgress
      phase="generating"
      format="gpx"
      current={120}
      total={490}
      sizeBytes={0}
      isDark={false}
      onCancel={jest.fn()}
    />
  );

  expect(screen.getByRole('progressbar').props.accessibilityValue).toEqual({
    min: 0,
    max: 490,
    now: 120,
  });
});

it('marks the row busy before the worker reports a total', async () => {
  await render(
    <BulkExportProgress
      phase="generating"
      format="gpx"
      current={0}
      total={0}
      sizeBytes={0}
      isDark={false}
      onCancel={jest.fn()}
    />
  );

  expect(screen.queryByRole('progressbar')).toBeNull();
  expect(screen.getByTestId('bulk-export-spinner').props.accessibilityState).toEqual({
    busy: true,
  });
});

it('offers Cancel while writing and not once the share sheet opens on the whole file', async () => {
  const onCancel = jest.fn();
  const row = (phase: 'generating' | 'sharing') => (
    <BulkExportProgress
      phase={phase}
      format="gpx"
      current={150}
      total={402}
      sizeBytes={0}
      isDark={false}
      onCancel={onCancel}
    />
  );
  const { rerender } = await render(row('generating'));

  fireEvent.press(screen.getByTestId('bulk-export-cancel'));
  expect(onCancel).toHaveBeenCalledTimes(1);

  await rerender(row('sharing'));
  expect(screen.queryByTestId('bulk-export-cancel')).toBeNull();
});
