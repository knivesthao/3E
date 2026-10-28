import type { ButtonHTMLAttributes, ReactNode } from 'react';

// Shared UI primitives: one definition for buttons, fields, errors, and
// status chips so pages compose instead of reimplementing. All neutral
// stone styling; status is always a text label, never color alone.

type Variant = 'primary' | 'secondary' | 'danger';

export function buttonClass(variant: Variant = 'secondary'): string {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-md px-4 min-h-[44px] text-base font-medium border transition-colors disabled:opacity-60';
  if (variant === 'primary') return `${base} bg-stone-900 text-white border-stone-900`;
  if (variant === 'danger')
    return `${base} bg-white text-red-900 border-stone-300 underline decoration-red-900`;
  return `${base} bg-white text-stone-900 border-stone-300`;
}

export function Button({
  variant = 'secondary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button {...props} className={`${buttonClass(variant)} ${className}`} />;
}

export const inputClass =
  'block w-full rounded-md border border-stone-300 bg-white px-3 min-h-[44px] text-base text-stone-900 placeholder:text-stone-500';

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-base font-medium">{label}</span>
      {children}
    </label>
  );
}

export function Alert({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-md border border-stone-900 bg-stone-100 px-3 py-2 text-base">
      <strong>Error: </strong>
      {children}
    </p>
  );
}

export function Page({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6">
      <h1 className="mb-4 text-3xl font-bold">{title}</h1>
      <div className="flex flex-col gap-4">{children}</div>
    </main>
  );
}

// Status chip: solid for published, outline for draft. The words carry the
// meaning; the fill is decoration only.
export function Badge({ status }: { status: string }) {
  const published = status === 'published';
  return (
    <span
      className={`inline-flex items-center rounded-full border border-stone-900 px-2 py-0.5 text-sm font-medium ${
        published ? 'bg-stone-900 text-white' : 'bg-white text-stone-900'
      }`}
    >
      {status}
    </span>
  );
}
