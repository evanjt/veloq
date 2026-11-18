import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const BINDINGS = join(__dirname, '../../../modules/veloqrs/src/generated/veloqrs.ts');

/**
 * The variants of the engine's `DisconnectReason`, as the farewell line spells them: serde writes
 * each in camelCase, so `SwitchedOff` is `switchedOff`.
 */
export function engineFarewellReasons(): string[] {
  const text = readFileSync(BINDINGS, 'utf8');
  const start = text.indexOf('export enum DisconnectReason {');
  if (start < 0) throw new Error(`DisconnectReason is not declared in ${BINDINGS}`);
  const body = text.slice(start, text.indexOf('\n}', start));
  const variants = [...body.matchAll(/^ {2}(\w+),$/gm)].map((match) => match[1]);
  return variants.map((variant) => `${variant[0].toLowerCase()}${variant.slice(1)}`);
}
