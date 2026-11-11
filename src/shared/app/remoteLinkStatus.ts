import { create } from 'zustand';

interface RemoteLinkStatus {
  /** How many linked browsers are connected now, for the banner that says so. */
  connected: number;
  /** How many browsers are linked, as the settings row last read it. */
  linked: number;
}

export const useRemoteLinkStatus = create<RemoteLinkStatus>(() => ({ connected: 0, linked: 0 }));
