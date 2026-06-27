import { normalizeWebdavUrl } from '@/features/settings/lib/autobackup/backends/webdavBackend';

describe('normalizeWebdavUrl', () => {
  it('normalizes trailing slashes, whitespace, and bare/root URLs', () => {
    const cases: [string, string][] = [
      [
        'https://cloud.example.com/remote.php/dav/files/user',
        'https://cloud.example.com/remote.php/dav/files/user/',
      ],
      [
        'https://cloud.example.com/remote.php/dav/files/user/',
        'https://cloud.example.com/remote.php/dav/files/user/',
      ],
      ['https://cloud.example.com/dav///', 'https://cloud.example.com/dav/'],
      ['  https://cloud.example.com/dav  ', 'https://cloud.example.com/dav/'],
      [
        'https://mycloud.com/remote.php/dav/files/alice/',
        'https://mycloud.com/remote.php/dav/files/alice/',
      ],
      ['https://dav.example.com', 'https://dav.example.com/'],
    ];

    for (const [input, expected] of cases) {
      expect(normalizeWebdavUrl(input)).toBe(expected);
    }
  });
});
