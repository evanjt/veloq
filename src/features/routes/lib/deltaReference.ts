/**
 * The words for each reference the delta plot measures against: a short name
 * written on the flat line and offered in "Compare with", and the phrase its
 * legend reads ("Flat line: your previous record, ...").
 */

import { FfiReferenceSource } from 'veloqrs';

const NAME_KEYS = {
  [FfiReferenceSource.Record]: 'sections.deltaReferenceRecord',
  [FfiReferenceSource.AthleteSet]: 'sections.deltaReferenceAthleteSet',
  [FfiReferenceSource.PreviousRecord]: 'sections.deltaReferencePreviousRecord',
  [FfiReferenceSource.Typical]: 'sections.deltaReferenceTypical',
} as const;

const PHRASE_KEYS = {
  [FfiReferenceSource.Record]: 'sections.deltaReferenceRecordPhrase',
  [FfiReferenceSource.AthleteSet]: 'sections.deltaReferenceAthleteSetPhrase',
  [FfiReferenceSource.PreviousRecord]: 'sections.deltaReferencePreviousRecordPhrase',
  [FfiReferenceSource.Typical]: 'sections.deltaReferenceTypicalPhrase',
} as const;

export function referenceNameKey(source: FfiReferenceSource) {
  return NAME_KEYS[source];
}

export function referencePhraseKey(source: FfiReferenceSource) {
  return PHRASE_KEYS[source];
}
