/**
 * Linked browser delegates: the browsers trusted to read this library from
 * another device.
 */

import type { DisconnectReason, FfiLinkedDevice } from '../generated/veloqrs';
import type { DelegateHost } from './host';

/** Every linked browser, most recently linked first. */
export function listLinkedDevices(host: DelegateHost): FfiLinkedDevice[] {
  if (!host.ready) return [];
  return host.timed('listLinkedDevices', () => host.engine.remote().listLinkedDevices());
}

/** Unlink a browser so it can never reconnect. False when none had that id. */
export function removeLinkedDevice(host: DelegateHost, id: string): boolean {
  if (!host.ready) throw new Error('Engine not initialised');
  return host.timed('removeLinkedDevice', () => host.engine.remote().removeLinkedDevice(id));
}

/**
 * Answer a linked browser's connection offer. Throws when the browser is not
 * linked or the offer does not parse.
 */
export function acceptOffer(host: DelegateHost, offer: string): string {
  if (!host.ready) throw new Error('Engine not initialised');
  return host.timed('acceptOffer', () => host.engine.remote().acceptOffer(offer));
}

/** The relay rooms to wait in while the app is open, one per linked browser. */
export function linkedRooms(host: DelegateHost): string[] {
  if (!host.ready) return [];
  return host.timed('linkedRooms', () => host.engine.remote().linkedRooms());
}

/** End every linked browser's connection, telling each why first. */
export function disconnectAll(host: DelegateHost, reason: DisconnectReason): void {
  if (!host.ready) return;
  host.timed('disconnectAll', () => host.engine.remote().disconnectAll(reason));
}

/** Say whether the app is in front; a linked browser's write is answered only while it is. */
export function setInFront(host: DelegateHost, inFront: boolean): void {
  if (!host.ready) return;
  host.timed('setInFront', () => host.engine.remote().setInFront(inFront));
}

/** Set the name this phone gives a linked browser in its hello; blank sends none. */
export function setDeviceName(host: DelegateHost, name: string): void {
  if (!host.ready) return;
  host.timed('setDeviceName', () => host.engine.remote().setDeviceName(name));
}

/** How many linked browsers are connected now. */
export function connectedCount(host: DelegateHost): number {
  if (!host.ready) return 0;
  return host.timed('connectedCount', () => host.engine.remote().connectedCount());
}

/** Open a pairing from a browser's QR code. Returns the room it waits in. */
export function beginPairing(host: DelegateHost, qr: string): string {
  if (!host.ready) throw new Error('Engine not initialised');
  return host.timed('beginPairing', () => host.engine.remote().beginPairing(qr));
}

/** The name of a proved browser waiting to be accepted, or null. */
export function pairingRequest(host: DelegateHost): string | null {
  if (!host.ready) return null;
  return host.timed('pairingRequest', () => host.engine.remote().pairingRequest()) ?? null;
}

/** Accept or decline the waiting browser. True when one was linked. */
export function confirmPairing(host: DelegateHost, accept: boolean): boolean {
  if (!host.ready) throw new Error('Engine not initialised');
  return host.timed('confirmPairing', () => host.engine.remote().confirmPairing(accept));
}

/** Close the open pairing. */
export function cancelPairing(host: DelegateHost): void {
  if (!host.ready) return;
  host.timed('cancelPairing', () => host.engine.remote().cancelPairing());
}
