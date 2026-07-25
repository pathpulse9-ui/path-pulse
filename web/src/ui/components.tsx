import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
} from 'react';

/** Shared UI kit primitives. Kept intentionally small; grows per phase. */

export function Button({
  variant = 'primary',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' }) {
  return <button {...props} data-variant={variant} className="pp-btn" />;
}

export function Card({
  title,
  actions,
  children,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="pp-card">
      {(title || actions) && (
        <header className="pp-card__head">
          {title && <h2 className="pp-card__title">{title}</h2>}
          {actions && <div className="pp-card__actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Field({
  label,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="pp-field">
      <span>{label}</span>
      <input {...props} className="pp-input" />
    </label>
  );
}

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'brand' | 'success' | 'warn' | 'danger';
  children: ReactNode;
}) {
  return (
    <span className="pp-badge" data-tone={tone}>
      {children}
    </span>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'success' | 'warn' | 'danger';
}) {
  return (
    <div className="pp-stat" data-tone={tone}>
      <div className="pp-stat__label">{label}</div>
      <div className="pp-stat__value">{value}</div>
      {hint && <div className="pp-stat__hint">{hint}</div>}
    </div>
  );
}

export function EmptyState({
  title,
  phase,
  children,
}: {
  title: string;
  phase?: string;
  children?: ReactNode;
}) {
  return (
    <div className="pp-empty">
      {phase && <Badge tone="brand">{phase}</Badge>}
      <h3>{title}</h3>
      {children && <p className="pp-muted">{children}</p>}
    </div>
  );
}
