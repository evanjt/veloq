import { layout as scale } from './spacing';
import { minTapTarget } from './tapTarget';

/**
 * The layout scale plus the one value that needs the platform.
 *
 * `spacing.ts` stays free of `react-native` so the widget codegen can read it
 * outside the RN runtime, and every call site still reads one `layout`.
 */
export const layout = { ...scale, minTapTarget } as const;
