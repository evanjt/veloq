// Hands the browser a file to save.

/** Saves `text` as a file called `name`; the browser's own download, with no request made. */
export function saveText(name: string, mime: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
