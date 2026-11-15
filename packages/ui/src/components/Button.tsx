import { forwardRef, type ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'text' | 'ghost' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'md' | 'sm';
}

/** Echter <button>, 44 px Klickfläche (40 px in „sm“). Primär: grün mit dunkler Schrift; Text-Button: unterstrichen, Unterstreichung grün. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', className, type = 'button', ...rest },
  ref,
) {
  const cls = ['lp-btn', `lp-btn--${variant}`, size === 'sm' ? 'lp-btn--sm' : '', className]
    .filter(Boolean)
    .join(' ');
  return <button ref={ref} type={type} className={cls} {...rest} />;
});
