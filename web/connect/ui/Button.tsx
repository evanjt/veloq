// The connect page's button, and the only one pages render. Variants mirror the
// app's Button: primary, secondary, ghost and destructive. State never rests on
// colour alone: pressed adds `aria-pressed`, busy adds `aria-busy` and a
// spinner, and focus-visible draws an outline.

import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md';

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  busy?: boolean;
  children: ReactNode;
};

export function Button({
  variant = 'secondary',
  size = 'md',
  busy = false,
  type = 'button',
  disabled,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className="ui-button"
      data-variant={variant}
      data-size={size}
      aria-busy={busy || undefined}
      disabled={disabled || busy}
    >
      {busy ? <span className="ui-spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

/** A link drawn as a button, for an action that leaves the page; it opens in a new tab. */
export function LinkButton({
  variant = 'secondary',
  size = 'md',
  href,
  children,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  href: string;
  children: ReactNode;
}) {
  return (
    <a
      className="ui-button"
      data-variant={variant}
      data-size={size}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  );
}
