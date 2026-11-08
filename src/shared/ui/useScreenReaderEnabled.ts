import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/** Whether a screen reader is on, kept current while the caller is mounted. */
export function useScreenReaderEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isScreenReaderEnabled()
      .then((on) => {
        if (live) setEnabled(on);
      })
      .catch(() => {
        // A platform that cannot answer is treated as having no screen reader.
      });
    const subscription = AccessibilityInfo.addEventListener('screenReaderChanged', setEnabled);
    return () => {
      live = false;
      subscription.remove();
    };
  }, []);
  return enabled;
}
