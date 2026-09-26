/**
 * Scenario: the backup screen's mount effect resumes an export the last visit
 * left owed. `nothing-pending` says the resume found no owed file; it says
 * nothing about a run.
 *
 * Expected behaviour: only the two outcomes about an owed file move the row.
 * An export started while the resume is still settling keeps its notice.
 */

import { act, renderHook } from '@testing-library/react-native';

import { useExportDatabaseBackup } from '@/features/settings/hooks/useBackup';
import { exportDatabaseBackup, resumePendingDatabaseExport } from '@/features/settings/lib/backup';

jest.mock('@/features/settings/lib/backup', () => ({
  exportDatabaseBackup: jest.fn(),
  resumePendingDatabaseExport: jest.fn(),
  restoreBackup: jest.fn(),
  restoreDatabaseBackup: jest.fn(),
}));

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

const mockExport = exportDatabaseBackup as jest.Mock;
const mockResume = resumePendingDatabaseExport as jest.Mock;

/** A promise whose settling this test decides. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('the resume on mount', () => {
  it('leaves an export started while it was settling alone', async () => {
    const resume = deferred<string>();
    mockResume.mockReturnValue(resume.promise);
    mockExport.mockResolvedValue('still-running');

    const { result } = renderHook(() => useExportDatabaseBackup());

    await act(async () => {
      await result.current.exportDatabaseBackup();
    });
    expect(result.current.stillRunning).toBe(true);

    await act(async () => {
      resume.resolve('nothing-pending');
      await resume.promise;
    });

    expect(result.current.stillRunning).toBe(true);
  });

  it('clears the row when the owed copy has landed', async () => {
    const resume = deferred<string>();
    mockResume.mockReturnValue(resume.promise);
    mockExport.mockResolvedValue('still-running');

    const { result } = renderHook(() => useExportDatabaseBackup());
    await act(async () => {
      await result.current.exportDatabaseBackup();
    });
    expect(result.current.stillRunning).toBe(true);

    await act(async () => {
      resume.resolve('shared');
      await resume.promise;
    });

    expect(result.current.stillRunning).toBe(false);
  });

  it('keeps the row when the owed copy is still going', async () => {
    mockResume.mockResolvedValue('still-running');

    const { result } = renderHook(() => useExportDatabaseBackup());
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.stillRunning).toBe(true);
  });
});
