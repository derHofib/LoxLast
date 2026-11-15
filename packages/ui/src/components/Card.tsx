import type { HTMLAttributes, ReactNode } from 'react';

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode;
  actions?: ReactNode;
}

export function Card({ title, actions, children, className, ...rest }: CardProps) {
  return (
    <section className={`lp-card${className ? ` ${className}` : ''}`} {...rest}>
      {title || actions ? (
        <header className="lp-card__header">
          {title ? <h2 className="lp-card__title">{title}</h2> : <span />}
          {actions}
        </header>
      ) : null}
      {children}
    </section>
  );
}
