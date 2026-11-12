// The part of react-dom the page uses. The package ships no types of its own.

declare module 'react-dom/client' {
  import type { ReactNode } from 'react';

  export interface Root {
    render: (children: ReactNode) => void;
    unmount: () => void;
  }

  export function createRoot(container: Element | DocumentFragment): Root;
}
