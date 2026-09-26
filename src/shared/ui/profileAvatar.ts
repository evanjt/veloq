/**
 * Whether an athlete's profile photo can be drawn.
 *
 * Two things make a stored URL undrawable and neither is falsiness: a value
 * that is not an http URL, and a load that has already failed. A stored string
 * stays truthy after the image 404s or after the network goes, so a bare
 * `profileUrl ? <Image/> : <Icon/>` renders an empty circle rather than the
 * account icon it has a branch for.
 */
export function canDrawProfilePhoto(profileUrl: unknown, loadFailed: boolean): boolean {
  if (loadFailed) return false;
  return typeof profileUrl === 'string' && profileUrl.startsWith('http');
}
