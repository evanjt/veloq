/**
 * What Expo says about a push, and what of that the worker may log.
 *
 * Expo answers a send with a ticket and hands over a receipt for it later,
 * once Apple or Google has answered. Either can refuse the push, and only an
 * unregistered device is something the worker acts on: a missing or revoked
 * platform credential refuses every push to that platform, and the only place
 * that shows is the log. So every refusal is logged, as an object Workers Logs
 * indexes by field, and Expo's message is logged with the token taken out,
 * since Expo writes the token into it.
 */

/** A ticket or a receipt, as Expo returns either. */
export interface ExpoOutcome {
  status?: string;
  id?: string;
  message?: string;
  details?: { error?: string };
}

/** One push Expo accepted, kept until its receipt is read. */
export interface SentPush {
  athleteId: string;
  token: string;
  platform: string;
  legacy: boolean;
}

/** Where Expo refused a push: answering the send, or in the receipt after. */
export type RefusalStage = "ticket" | "receipt";

export interface PushRefusal {
  event: "expo_push_refused";
  stage: RefusalStage;
  error: string;
  message: string;
  platform: string;
  legacy: boolean;
}

export const RECEIPT_PREFIX = "receipt:";

/** A sent push waiting for its receipt, in the `DEVICE_TOKENS` namespace. */
export function receiptKey(ticketId: string): string {
  return `${RECEIPT_PREFIX}${ticketId}`;
}

/**
 * How long a sent push waits for its receipt. Expo has most receipts within
 * fifteen minutes and keeps them a day, so a few hours gives the check several
 * runs at each one without holding anything long.
 */
export const RECEIPT_TTL_SECONDS = 3 * 60 * 60;

/** Expo takes at most this many ids in one receipt request. */
export const RECEIPT_BATCH = 1000;

const EXPO_TOKEN = /Expo(nent)?PushToken\[[^\]]*\]/g;

/** Expo's text with the token, and anything shaped like one, taken out. */
export function withoutToken(text: string, token: string): string {
  const named = token ? text.split(token).join("<token>") : text;
  return named.replace(EXPO_TOKEN, "<token>");
}

/** The line a refused ticket or receipt is logged as, or null for one that is ok. */
export function pushRefusal(
  stage: RefusalStage,
  outcome: ExpoOutcome,
  sent: Pick<SentPush, "token" | "platform" | "legacy">
): PushRefusal | null {
  if (outcome.status !== "error") return null;
  return {
    event: "expo_push_refused",
    stage,
    error: outcome.details?.error ?? "unknown",
    message: withoutToken(outcome.message ?? "", sent.token),
    platform: sent.platform,
    legacy: sent.legacy,
  };
}

/** Whether Expo says the device behind the token is gone for good. */
export function isUnregistered(outcome: ExpoOutcome): boolean {
  return outcome.status === "error" && outcome.details?.error === "DeviceNotRegistered";
}

/** Whether a kept push reads back whole, since a row written by hand might not. */
export function isSentPush(value: unknown): value is SentPush {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.athleteId === "string" &&
    typeof row.token === "string" &&
    typeof row.platform === "string" &&
    typeof row.legacy === "boolean"
  );
}
