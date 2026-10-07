// The route and the adb argv for a scripted mock GPS ride. Pure, so the tooling
// project tests it without a handset.

export const LOOP_METRES = 2000;
export const ACCURACY_METRES = 5;

const RADIUS = LOOP_METRES / (2 * Math.PI);
const METRES_PER_DEGREE = 111_320;

/** One fix per second around a circle of `LOOP_METRES`, starting at `origin`. */
export function routeFixes(origin, speed, seconds) {
  const fixes = [];
  const cosLat = Math.cos((origin.lat * Math.PI) / 180);
  for (let t = 0; t <= seconds; t++) {
    const angle = (speed * t) / RADIUS;
    // Centred so that angle 0 is the origin.
    const north = RADIUS * Math.sin(angle);
    const east = RADIUS * (1 - Math.cos(angle));
    fixes.push({
      lat: origin.lat + north / METRES_PER_DEGREE,
      lng: origin.lng + east / (METRES_PER_DEGREE * cosLat),
      accuracy: ACCURACY_METRES,
      offsetSeconds: t,
    });
  }
  return fixes;
}

const provider = (...args) => ['shell', 'cmd', 'location', 'providers', ...args];

export function setupCommands() {
  return [
    ['shell', 'appops', 'set', 'com.android.shell', 'android:mock_location', 'allow'],
    provider('add-test-provider', 'gps'),
    provider('set-test-provider-enabled', 'gps', 'true'),
  ];
}

export function fixCommand(fix) {
  return provider(
    'set-test-provider-location',
    'gps',
    '--location',
    `${fix.lat.toFixed(6)},${fix.lng.toFixed(6)}`,
    '--accuracy',
    String(fix.accuracy)
  );
}

export function cleanupCommands() {
  return [
    provider('remove-test-provider', 'gps'),
    ['shell', 'appops', 'set', 'com.android.shell', 'android:mock_location', 'default'],
  ];
}

export function sessionCommands(fixes) {
  return [...setupCommands(), ...fixes.map(fixCommand), ...cleanupCommands()];
}
