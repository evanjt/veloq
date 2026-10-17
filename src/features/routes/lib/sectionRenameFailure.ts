export type SectionRenameFailure = 'nameTaken' | 'failed';

/**
 * What saving a typed name came to. A refused name carries the line the field
 * shows under it, or no line when a dialog has already said why.
 */
export type NameSaveOutcome = { saved: true } | { saved: false; reason: string | null };

export class SectionRenameError extends Error {
  constructor(
    message: string,
    public readonly reason: SectionRenameFailure
  ) {
    super(message);
    this.name = 'SectionRenameError';
  }
}

/** The line a refused rename shows: a taken name cannot be fixed by trying again. */
export function renameFailureMessageKey(
  error: unknown
): 'sections.nameTaken' | 'sections.renameFailedMessage' {
  return error instanceof SectionRenameError && error.reason === 'nameTaken'
    ? 'sections.nameTaken'
    : 'sections.renameFailedMessage';
}
