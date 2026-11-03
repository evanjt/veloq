"""PUT one byte range of a file to an upload URL over a socket with a capped TCP MSS.

The upload hosts' full-size segments are dropped on a path whose MTU is above
1500, so the connection sets TCP_MAXSEG to 1400 before it connects and every
packet stays under 1500. Without it an upload hangs with no error.

Usage: python3 -I put-part.py <url> <file> <offset> <length> <headers.json>
"""
import http.client
import json
import socket
import sys
import urllib.parse

MSS = 1400


class CappedConnection(http.client.HTTPSConnection):
    def connect(self):
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_MAXSEG, MSS)
        sock.settimeout(self.timeout)
        sock.connect((self.host, self.port))
        self.sock = self._context.wrap_socket(sock, server_hostname=self.host)


def main():
    url, path, offset, length, headers_path = sys.argv[1:6]
    offset, length = int(offset), int(length)
    with open(path, "rb") as handle:
        handle.seek(offset)
        body = handle.read(length)
    with open(headers_path) as handle:
        headers = json.load(handle)
    parts = urllib.parse.urlsplit(url)
    target = parts.path + ("?" + parts.query if parts.query else "")
    connection = CappedConnection(parts.hostname, parts.port or 443, timeout=120)
    connection.request("PUT", target, body=body, headers=headers)
    status = connection.getresponse().status
    if status >= 300:
        sys.exit(f"upload part at {offset} answered {status}")


main()
