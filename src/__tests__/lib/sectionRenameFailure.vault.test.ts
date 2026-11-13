import {
  SectionRenameError,
  renameFailureMessageKey,
} from '@/features/routes/lib/sectionRenameFailure';

describe('renameFailureMessageKey', () => {
  it('names the taken name when the engine refused because another section shows it', () => {
    expect(renameFailureMessageKey(new SectionRenameError('taken', 'nameTaken'))).toBe(
      'sections.nameTaken'
    );
  });

  it('keeps the retry message for a failure that is not a taken name', () => {
    expect(renameFailureMessageKey(new SectionRenameError('db', 'failed'))).toBe(
      'sections.renameFailedMessage'
    );
    expect(renameFailureMessageKey(new Error('boom'))).toBe('sections.renameFailedMessage');
    expect(renameFailureMessageKey(undefined)).toBe('sections.renameFailedMessage');
  });
});
