/**
 * The lines a shared crash log opens with, so a report can be matched to the
 * build, the platform and the engine state that produced it.
 *
 * Read when the log is shared, not when a crash is recorded: the entries
 * outlive an update, and the header names what the athlete runs as they send
 * it. An open engine has migrated its library to the schema this build
 * supports, so the commit names the schema too, and a library from a newer
 * build is the `ForwardSchema` reason the failure line gives. Every read here
 * is guarded, since a header that throws loses the log.
 */

import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { InitOutcome } from 'veloqrs';

import { useEngineStatus } from '@/features/routes/stores/EngineStatusStore';
import { buildCommit, formatVersionLine } from '@/shared/format/buildStamp';
import { currentEngineReadState } from '@/shared/native/useEngineSubscription';

/** The store build number: `versionCode` on Android, `buildNumber` on iOS. */
function nativeBuild(): string | undefined {
  const config = Constants.expoConfig;
  const build = Platform.OS === 'ios' ? config?.ios?.buildNumber : config?.android?.versionCode;
  return build === undefined || build === '' ? undefined : String(build);
}

function versionLine(): string {
  const line = formatVersionLine(Constants.expoConfig?.version ?? 'unknown', buildCommit());
  const build = nativeBuild();
  return `Veloq ${build ? `${line}, build ${build}` : line}`;
}

function engineLine(): string {
  const state = currentEngineReadState();
  if (state === 'ready') return 'Engine open';
  if (state === 'closed') return 'Engine not open';
  const reason = useEngineStatus.getState().initFailureReason;
  return `Engine failed to open: ${reason === null ? 'unknown' : (InitOutcome[reason] ?? reason)}`;
}

function guarded(read: () => string, fallback: string): string {
  try {
    return read();
  } catch {
    return fallback;
  }
}

export function crashLogHeader(): string {
  return [
    guarded(versionLine, 'Veloq unknown'),
    guarded(() => `Platform ${Platform.OS} ${Platform.Version}`, 'Platform unknown'),
    guarded(engineLine, 'Engine unknown'),
  ].join('\n');
}
