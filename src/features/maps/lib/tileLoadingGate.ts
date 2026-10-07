/**
 * Turns the page's tile loading and settled messages into one visible flag.
 *
 * A pan over cached tiles settles within a frame or two, so the flag only
 * rises once loading has outlasted `delayMs`. A settle with nothing showing
 * or pending changes nothing.
 */
export function createTileLoadingGate(delayMs: number, onChange: (visible: boolean) => void) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let visible = false;

  const clear = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return {
    loading() {
      if (visible || timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        visible = true;
        onChange(true);
      }, delayMs);
    },
    settled() {
      clear();
      if (!visible) return;
      visible = false;
      onChange(false);
    },
    /** For unmount and page loss: drops the state without telling anyone. */
    cancel() {
      clear();
      visible = false;
    },
  };
}
