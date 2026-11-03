import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from './ui';

// Reusable accessible dialog. Bottom sheet on phones (thumb reach, safe
// area), centered card on larger screens. Escape and overlay tap both
// cancel; focus returns to the opener on close.
export function Dialog({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);

  useEffect(() => {
    openerRef.current = document.activeElement;
    panelRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKey);
      if (openerRef.current instanceof HTMLElement) openerRef.current.focus();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-center"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-t-xl border border-stone-300 bg-white p-5 sm:rounded-xl"
      >
        <h2 id={titleId} className="mb-2 text-xl font-bold">
          {title}
        </h2>
        {description && <p className="mb-4">{description}</p>}
        {children}
      </div>
    </div>
  );
}

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}

// useConfirm renders one dialog host and returns requestConfirm, which
// resolves true only on explicit confirm. Destructive actions await it
// instead of firing immediately — fat-finger protection on touch screens.
export function useConfirm() {
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);

  const requestConfirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setPending({ confirmLabel: 'Confirm', danger: true, ...opts, resolve });
      }),
    [],
  );

  const close = useCallback(
    (ok: boolean) => {
      pending?.resolve(ok);
      setPending(null);
    },
    [pending],
  );

  const dialog = pending && (
    <Dialog title={pending.title} description={pending.message} onClose={() => close(false)}>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button onClick={() => close(false)}>Cancel</Button>
        <Button onClick={() => close(true)} variant={pending.danger ? 'danger' : 'primary'}>
          {pending.confirmLabel}
        </Button>
      </div>
    </Dialog>
  );

  return { requestConfirm, dialog };
}
