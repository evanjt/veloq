/**
 * What a backup run compares a carrier's copy against: the zip's SHA-256 and
 * its length in bytes. The record zip is kilobytes, so it is read whole.
 */

import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';

export interface ZipFingerprint {
  sha256: string;
  size: number;
}

export async function zipFingerprint(uri: string): Promise<ZipFingerprint> {
  const bytes = await new File(uri).bytes();
  const digest = new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes));
  const sha256 = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
  return { sha256, size: bytes.length };
}
