import { openSheet } from './sheetRequest';

/** An explanation of how something works: a title and a body whose paragraphs are split by a blank line. */
export interface ExplainerInput {
  title: string;
  body: string;
}

/**
 * Opens an explanation in the explainer sheet. Explanations are read, not acknowledged, so they
 * take a sheet; a system alert stays for confirmations, errors and notices.
 */
export function openExplainer(input: ExplainerInput): void {
  void openSheet<ExplainerInput, never>('sheets/explainer', input);
}
