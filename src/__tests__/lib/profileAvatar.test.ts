/**
 * Scenario: a stored profile URL whose image cannot be fetched, offline or
 * because the upstream photo has moved.
 *
 * Expected behaviour: the account icon is drawn. The stored string is still
 * truthy, so a presence check alone leaves an empty circle in the header.
 */
import { canDrawProfilePhoto } from '@/shared/ui/profileAvatar';

describe('canDrawProfilePhoto', () => {
  it('draws a stored http photo', () => {
    expect(canDrawProfilePhoto('https://intervals.icu/photo.jpg', false)).toBe(true);
  });

  it('falls back once the load has failed, even though the URL is still there', () => {
    expect(canDrawProfilePhoto('https://intervals.icu/photo.jpg', true)).toBe(false);
  });

  it('falls back for a value that is not an http URL', () => {
    expect(canDrawProfilePhoto('/relative/photo.jpg', false)).toBe(false);
  });

  it('falls back for an empty string', () => {
    expect(canDrawProfilePhoto('', false)).toBe(false);
  });

  it('falls back for a missing value', () => {
    expect(canDrawProfilePhoto(undefined, false)).toBe(false);
    expect(canDrawProfilePhoto(null, false)).toBe(false);
  });

  it('falls back for a value that is not a string', () => {
    expect(canDrawProfilePhoto(42, false)).toBe(false);
  });
});
