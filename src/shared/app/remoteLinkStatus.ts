import { create } from 'zustand';

interface RemoteLinkStatus {
  /** How many linked browsers are connected now, for the banner that says so. */
  connected: number;
  /** How many browsers are linked, as the settings row last read it. */
  linked: number;
  /** How many rooms the phone is open in on the relay, waiting for a browser. */
  rooms: number;
}

export const useRemoteLinkStatus = create<RemoteLinkStatus>(() => ({
  connected: 0,
  linked: 0,
  rooms: 0,
}));
