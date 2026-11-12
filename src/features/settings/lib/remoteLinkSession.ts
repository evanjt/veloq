import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { remote } from 'veloqrs';
import { useRemoteLinkStatus } from '@/shared/app/remoteLinkStatus';
import { experimentalOn } from './experimental';
import { createRemoteLink, type RelaySocket, type RemoteLink } from './remoteLink';

/** The link relay's rooms. Its worker shares the auth host and keeps nothing. */
const LINK_RELAY_URL = 'wss://auth.veloq.fit/link/';

/** Its own tag, so releasing it never releases recording's keep-awake. */
const KEEP_AWAKE_TAG = 'veloq-remote-link';

const link = createRemoteLink({
  enabled: () => experimentalOn('remoteLink'),
  engine: {
    linkedRooms: () => remote.linkedRooms(),
    acceptOffer: (offer) => remote.acceptOffer(offer),
    disconnectAll: () => remote.disconnectAll(),
    setInFront: (inFront) => remote.setInFront(inFront),
    connectedCount: () => remote.connectedCount(),
  },
  relayUrl: LINK_RELAY_URL,
  open: relaySocket,
  keepAwake: {
    on: () => {
      activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    },
    off: () => {
      deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
    },
  },
  diagnose: __DEV__ ? (line) => console.warn(`[remote link] ${line}`) : undefined,
});

function relaySocket(url: string): RelaySocket {
  const ws = new WebSocket(url);
  const socket: RelaySocket = {
    send: (message) => ws.send(message),
    close: () => ws.close(),
    onmessage: null,
    onclose: null,
  };
  ws.onmessage = (event) => socket.onmessage?.({ data: event.data });
  ws.onclose = () => socket.onclose?.();
  return socket;
}

link.subscribe(({ connected, rooms }) => useRemoteLinkStatus.setState({ connected, rooms }));

function readLinked(): void {
  useRemoteLinkStatus.setState({ linked: remote.listLinkedDevices().length });
}

/**
 * The app's one remote link, driven by the foreground and the linked devices
 * screen. Each foreground and refresh also reads how many browsers are linked.
 */
export const remoteLink: RemoteLink = {
  ...link,
  foreground() {
    link.foreground();
    readLinked();
  },
  refresh() {
    link.refresh();
    readLinked();
  },
};

/** End every browser's connection now, as the connected banner's action. */
export function disconnectRemoteLink(): void {
  remote.disconnectAll();
  useRemoteLinkStatus.setState({ connected: remote.connectedCount() });
}
