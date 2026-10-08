# Reads, or runs one expression in, the pages a debuggable WebView exposes on a
# forwarded DevTools port.
#
#   python3 -I scripts/measure-retained-webview-pages.py <port>
#   python3 -I scripts/measure-retained-webview-pages.py <port> <target-prefix> <expression>
#
# With no expression it prints one line per page: the target id, whether
# `window.map` is set, its pitch, and the document's `performance.timeOrigin`.
import json
import sys
import urllib.request

import websocket

STATE = (
    "JSON.stringify({map: !!window.map,"
    " pitch: window.map && window.map.getPitch ? Math.round(window.map.getPitch()) : null,"
    " origin: Math.round(performance.timeOrigin)})"
)


def evaluate(target, expression):
    ws = websocket.create_connection(target["webSocketDebuggerUrl"], timeout=15, suppress_origin=True)
    try:
        ws.send(json.dumps({
            "id": 1,
            "method": "Runtime.evaluate",
            "params": {"expression": expression, "returnByValue": True},
        }))
        while True:
            message = json.loads(ws.recv())
            if message.get("id") == 1:
                return message["result"]["result"].get("value")
    finally:
        ws.close()


def main(port, prefix=None, expression=None):
    targets = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=10))
    pages = [t for t in targets if t.get("type") == "page" and "webSocketDebuggerUrl" in t]
    if expression is not None:
        page = next(t for t in pages if t["id"].startswith(prefix))
        print(evaluate(page, expression))
        return
    for page in pages:
        try:
            state = json.loads(evaluate(page, STATE))
            print(f"{page['id'][:8]} map={int(state['map'])} pitch={state['pitch']} origin={state['origin']}")
        except Exception as error:  # a page mid-reload answers nothing
            print(f"{page['id'][:8]} error={type(error).__name__}")


if __name__ == "__main__":
    main(int(sys.argv[1]), *sys.argv[2:4])
