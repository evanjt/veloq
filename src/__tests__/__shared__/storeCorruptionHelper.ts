import AsyncStorage from '@react-native-async-storage/async-storage';

// Shared drivers for the repeated AsyncStorage corruption-recovery pattern across
// preference/recording/section store tests. Not a test file itself.

type InitFn = () => Promise<void>;

// Writes each corrupt payload, runs initialize, and runs the caller's assertion.
// `expect` is passed in so this file holds no test framework state.
export async function eachCorruptPayloadRecovers(
  storageKey: string,
  initialize: InitFn,
  payloads: string[],
  assertRecovered: () => void,
  beforeEachPayload?: () => void
): Promise<void> {
  for (const payload of payloads) {
    await AsyncStorage.clear();
    await AsyncStorage.setItem(storageKey, payload);
    beforeEachPayload?.();
    await initialize();
    assertRecovered();
  }
}
