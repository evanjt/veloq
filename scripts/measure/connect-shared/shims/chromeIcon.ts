// Platform chrome glyphs come from a native symbol set; the page draws none here.
export type ChromeRole = 'close' | 'back' | 'more' | 'share' | 'search' | 'settings';
export function ChromeIcon(_: { name: ChromeRole; size: number; color: string; testID?: string }) {
  return null;
}
export function chromeMenuIcon(_: ChromeRole) {
  return {};
}
