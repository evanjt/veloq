// The app opens sheets through its router; the page has no sheet to open.
export type SheetResult<R> = { kind: 'selected'; value: R } | { kind: 'cancelled' };
export function openSheet<I, R>(_route: string, _input: I): Promise<SheetResult<R>> {
  return Promise.resolve({ kind: 'cancelled' });
}
export function useSheetOpener() {
  return openSheet;
}
