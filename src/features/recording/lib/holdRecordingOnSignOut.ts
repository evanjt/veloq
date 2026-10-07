import { useRecordingStore } from '../stores/RecordingStore';
import type { RecordingBackup } from '../types';
import {
  buildRecordingBackup,
  loadRecordingBackup,
  saveRecordingBackup,
} from './storage/recordingBackup';
import {
  libraryHoldsRide,
  restoreRecordingBackup,
  resumeRecordingBackup,
} from './restoreRecordingBackup';
import { sessionReturnRoute } from './sessionReturnRoute';

const heldInMemory = new Map<string, RecordingBackup>();

/** Stop and hold a ride for the athlete who recorded it. */
export async function holdRecordingOnSignOut(athleteId: string | null): Promise<void> {
  const store = useRecordingStore.getState();
  if (!athleteId || store.athleteId !== athleteId || store.status === 'idle') return;
  if (store.mode === 'manual' || store.savedToLibrary) {
    store.reset();
    return;
  }
  if (store.status === 'recording' || store.status === 'paused') store.stopRecording();
  const held = useRecordingStore.getState();
  const backup = buildRecordingBackup(held);
  if (backup && (await saveRecordingBackup(backup))) {
    const current = useRecordingStore.getState();
    if (current.athleteId === held.athleteId && current.streams === held.streams) current.reset();
  }
}

/** Reopen a held ride only for its athlete, after authentication. */
export async function resumeHeldRecordingForAthlete(athleteId: string): Promise<string | null> {
  const state = useRecordingStore.getState();
  if (state.status !== 'idle' && state.savedToLibrary) {
    // The library holds it, so there is nothing to reopen for anyone.
    state.reset();
  } else if (state.status !== 'idle') {
    if (state.athleteId === athleteId) {
      return state.status === 'stopped' ? sessionReturnRoute(state) : null;
    }
    const backup = buildRecordingBackup(state);
    if (!backup) return null;
    const saved = await saveRecordingBackup(backup);
    if (!saved && backup.athleteId) {
      heldInMemory.set(backup.athleteId, backup);
    }
    const current = useRecordingStore.getState();
    if (current.athleteId !== state.athleteId || current.streams !== state.streams) return null;
    useRecordingStore.getState().reset();
  }
  const inMemory = heldInMemory.get(athleteId);
  if (inMemory) {
    heldInMemory.delete(athleteId);
    // Its save can finish after the hold took it, and the library then has it.
    if (!libraryHoldsRide(inMemory)) return restoreRecordingBackup(inMemory);
  }
  const backup = await loadRecordingBackup();
  if (!backup || backup.status !== 'stopped' || backup.athleteId !== athleteId) return null;
  return resumeRecordingBackup();
}
