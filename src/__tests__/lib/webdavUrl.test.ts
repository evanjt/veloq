import { normalizeWebdavUrl } from '@/lib/backup/backends/webdavBackend';

describe('normalizeWebdavUrl', () => {
  it('adds trailing slash to bare URL', () => {
    expect(normalizeWebdavUrl('https://cloud.example.com/remote.php/dav/files/user')).toBe(
      'https://cloud.example.com/remote.php/dav/files/user/'
    );
  });

  it('preserves existing trailing slash', () => {
    expect(normalizeWebdavUrl('https://cloud.example.com/remote.php/dav/files/user/')).toBe(
      'https://cloud.example.com/remote.php/dav/files/user/'
    );
  });

  it('collapses multiple trailing slashes', () => {
    expect(normalizeWebdavUrl('https://cloud.example.com/dav///')).toBe(
      'https://cloud.example.com/dav/'
    );
  });

  it('trims whitespace', () => {
    expect(normalizeWebdavUrl('  https://cloud.example.com/dav  ')).toBe(
      'https://cloud.example.com/dav/'
    );
  });

  it('handles Nextcloud full path', () => {
    expect(
      normalizeWebdavUrl('https://mycloud.com/remote.php/dav/files/alice/')
    ).toBe('https://mycloud.com/remote.php/dav/files/alice/');
  });

  it('handles root URL', () => {
    expect(normalizeWebdavUrl('https://dav.example.com')).toBe('https://dav.example.com/');
  });
});
