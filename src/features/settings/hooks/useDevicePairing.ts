import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { remote } from 'veloqrs';
import { confirmAction } from '@/shared/ui/dialog';
import { remoteLink } from '../lib/remoteLinkSession';

/**
 * Starts pairing from an invitation the opening link carried. Nothing happens
 * for a missing or empty code; the invitation goes through `read` exactly as
 * a scanned one does, and a refusal leaves the screen as it was.
 */
export function pairFromLink(code: string | undefined, read: (qr: string) => boolean): boolean {
  if (!code) return false;
  return read(code);
}

export type PairingPhase = 'idle' | 'scanning' | 'waiting' | 'expired';

const POLL_MS = 500;
/** A little past the invitation's two minutes, so the engine refuses first. */
const GIVE_UP_MS = 130_000;

/**
 * Linking a browser: scan its code, wait in its room for it to prove the
 * secret, then ask the athlete. Only an accept pins the browser.
 */
export function useDevicePairing(onLinked: () => void, inviteCode?: string | undefined) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<PairingPhase>('idle');
  const room = useRef<string | null>(null);

  const leaveRoom = useCallback(() => {
    if (room.current) remoteLink.leave(room.current);
    room.current = null;
  }, []);

  const scan = useCallback(() => setPhase('scanning'), []);

  const read = useCallback((qr: string) => {
    let opened: string;
    try {
      opened = remote.beginPairing(qr);
    } catch {
      return false;
    }
    room.current = opened;
    remoteLink.join(opened);
    setPhase('waiting');
    return true;
  }, []);

  // The opening link's invitation is read once, when the screen first mounts.
  const invited = useRef(false);
  useEffect(() => {
    if (invited.current) return;
    invited.current = true;
    pairFromLink(inviteCode, read);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, []);

  const cancel = useCallback(() => {
    if (room.current) remote.cancelPairing();
    leaveRoom();
    setPhase('idle');
  }, [leaveRoom]);

  useEffect(() => {
    if (phase !== 'waiting') return undefined;
    const giveUp = setTimeout(() => {
      clearInterval(poll);
      remote.cancelPairing();
      leaveRoom();
      setPhase('expired');
    }, GIVE_UP_MS);
    const poll = setInterval(() => {
      const name = remote.pairingRequest();
      if (name === null) return;
      clearInterval(poll);
      clearTimeout(giveUp);
      const finish = (accept: boolean) => {
        remote.confirmPairing(accept);
        leaveRoom();
        setPhase('idle');
        if (accept) onLinked();
      };
      confirmAction({
        title: t('remoteLink.confirmTitle', { name }),
        message: t('remoteLink.confirmMessage'),
        confirmLabel: t('remoteLink.confirm'),
        cancelLabel: t('remoteLink.decline'),
        required: true,
        onConfirm: () => finish(true),
        onCancel: () => finish(false),
      });
    }, POLL_MS);
    return () => {
      clearInterval(poll);
      clearTimeout(giveUp);
    };
  }, [phase, leaveRoom, onLinked, t]);

  // Leaving the screen mid-pairing ends it rather than leaving a room open.
  useEffect(
    () => () => {
      if (room.current) {
        remote.cancelPairing();
        remoteLink.leave(room.current);
      }
    },
    []
  );

  return { phase, scan, read, cancel };
}
