import { useEffect } from 'react';
import { useNavigation } from 'expo-router';

const SETTLED_FALLBACK_MS = 1000;
type TransitionEvent = { data: { closing: boolean } };
type TransitionNavigation = {
  addListener: (
    name: 'transitionStart' | 'transitionEnd',
    listener: (event: TransitionEvent) => void
  ) => () => void;
};

/** Runs a screen task after its opening transition, or after a settled mount. */
export function useAfterNavigationTransition(task: () => void): void {
  const navigation = useNavigation<TransitionNavigation>();

  useEffect(() => {
    let finished = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      task();
    };
    const removeStart = navigation.addListener('transitionStart', (event) => {
      if (!event.data.closing && timer) clearTimeout(timer);
    });
    const removeEnd = navigation.addListener('transitionEnd', (event) => {
      if (!event.data.closing) run();
    });
    if (!finished) timer = setTimeout(run, SETTLED_FALLBACK_MS);

    return () => {
      finished = true;
      if (timer) clearTimeout(timer);
      removeStart();
      removeEnd();
    };
  }, [navigation, task]);
}
