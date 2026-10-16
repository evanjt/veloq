/**
 * A modal, which covers the whole window, banners and status bar included.
 *
 * The stack beneath a filled top slot sees no top inset, because the banner has already cleared
 * the status bar. A modal opened from a screen there draws over the banner, so it takes the
 * device's insets back. Use this instead of `Modal` from react-native.
 */

import React from 'react';
import { Modal, type ModalProps } from 'react-native';

import { WindowInsets } from '@/shared/app/TopSafeAreaContext';

export function FullWindowModal({ children, ...props }: ModalProps) {
  return (
    <Modal {...props}>
      <WindowInsets>{children}</WindowInsets>
    </Modal>
  );
}
