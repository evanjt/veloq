/** The WebDAV endpoint and credentials a Nextcloud app-password QR code carries. */
export interface NextcloudLogin {
  url: string;
  user: string;
  password: string;
}

const PREFIX = 'nc://login/';

/**
 * Read `nc://login/user:USER&password:PASSWORD&server:SERVER` into the user's
 * WebDAV files endpoint. A login name may hold a space or an `@`, so it is
 * percent-encoded in the path and kept as written for the credentials. Null
 * for anything that is not such a code or lacks one of the three fields.
 */
export function parseNextcloudLogin(data: string): NextcloudLogin | null {
  if (!data.startsWith(PREFIX)) return null;
  const parts: Record<string, string> = {};
  for (const part of data.slice(PREFIX.length).split('&')) {
    const colonIdx = part.indexOf(':');
    if (colonIdx > 0) {
      parts[part.slice(0, colonIdx)] = part.slice(colonIdx + 1);
    }
  }
  const { user, password, server } = parts;
  if (!user || !password || !server) return null;
  const baseUrl = server.endsWith('/') ? server.slice(0, -1) : server;
  return {
    url: `${baseUrl}/remote.php/dav/files/${encodeURIComponent(user)}/`,
    user,
    password,
  };
}
