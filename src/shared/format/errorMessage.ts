/** The message of a thrown value: an Error's own message, else its string form. */
export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
