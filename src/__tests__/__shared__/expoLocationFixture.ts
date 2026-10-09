import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const SOURCE = 'android/src/main/java/expo/modules/location';

/** Where each file the altitude patch edits sits inside the expo-location package. */
export const FILES = {
  gradle: 'android/build.gradle',
  results: `${SOURCE}/records/LocationResults.kt`,
  module: `${SOURCE}/LocationModule.kt`,
  tasks: `${SOURCE}/taskConsumers/LocationTaskConsumer.kt`,
  helper: `${SOURCE}/records/SeaLevelAltitude.kt`,
} as const;

/** The lines upstream carries where the patch edits, with the context around them. */
export const UPSTREAM: Record<Exclude<keyof typeof FILES, 'helper'>, string> = {
  gradle: [
    'dependencies {',
    "  api 'com.google.android.gms:play-services-location:21.0.1'",
    '}',
    '',
  ].join('\n'),
  results: [
    '  constructor(location: Location) : this(',
    '    latitude = location.latitude,',
    '    longitude = location.longitude,',
    '    altitude = location.altitude,',
    '    accuracy = location.accuracy.toDouble(),',
    '  )',
    '        GeocodeResponse(',
    '          latitude = location.latitude,',
    '          longitude = location.longitude,',
    '          accuracy = location.accuracy,',
    '          altitude = location.altitude',
    '        )',
    '',
  ].join('\n'),
  module: [
    '      override fun onLocationResult(locationResult: LocationResult) {',
    '        val location = locationResult.lastLocation',
    '        if (location != null) {',
    '          callbacks.onLocationChanged(location)',
    '        } else if (!isLocationAvailable) {',
    '',
  ].join('\n'),
  tasks: [
    '    if (result != null) {',
    '      handleLocationUpdate(result.locations)',
    '    } else {',
    '      try {',
    '        mLocationClient.lastLocation.addOnCompleteListener { task ->',
    '          task.result?.let { handleLocationUpdate(listOf(it)) }',
    '        }',
    '',
  ].join('\n'),
};

/** `LocationResults.kt` as the earlier patch left it: the validity guard, no datum. */
export const GUARDED_RESULTS = UPSTREAM.results.replace(
  'altitude = location.altitude,',
  'altitude = if (location.hasAltitude()) location.altitude else null,'
);

/** Writes an expo-location package under `root/node_modules`, upstream unless overridden. */
export function writeExpoLocation(
  root: string,
  overrides: Partial<Record<keyof typeof FILES, string>> = {}
): string {
  const pkg = join(root, 'node_modules', 'expo-location');
  const sources: Partial<Record<keyof typeof FILES, string>> = { ...UPSTREAM, ...overrides };
  for (const [key, source] of Object.entries(sources)) {
    const target = join(pkg, FILES[key as keyof typeof FILES]);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, source);
  }
  return pkg;
}
