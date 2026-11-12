/**
 * The numbers the engine's enums take in the generated bindings, by the word
 * the link writes for each.
 *
 * The generators match these numbers rather than import the enums, so the
 * linked browser, which has no native module, runs the same code. The browser
 * converts a reply's words to these numbers in `engineForm`.
 * `nativeContracts.test.ts` holds each table to the bindings.
 */

export const EFFICIENCY_DIRECTION = { improving: 0, flat: 1, worsening: 2 } as const;

export const LOAD_METRIC = { tss: 0, duration: 1 } as const;

export const IMPROVEMENT_BASIS = { medianOfThree: 0, firstToLast: 1 } as const;
