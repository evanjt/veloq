// The colour scheme comes from the browser, with no preference store behind it.
export { useResolvedColorScheme } from './app';
export const useOpaqueChromeStore = (selector: (s: { preferOpaqueChrome: boolean }) => boolean) =>
  selector({ preferOpaqueChrome: false });
