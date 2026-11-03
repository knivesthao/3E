import { useEffect, useId, useRef, useState } from 'react';

export interface UserMenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
}

// Circular avatar button opening an account menu: identity header plus
// profile actions (sign out built in, more items via `items`). Full
// keyboard support: Enter/Space opens, Escape closes, Up/Down moves.
export function UserMenu({
  email,
  onSignOut,
  items = [],
}: {
  email: string;
  onSignOut: () => void;
  items?: UserMenuItem[];
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const initial = (email.trim()[0] ?? '?').toUpperCase();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        !buttonRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const buttons = [...(panelRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
        if (buttons.length === 0) return;
        const i = buttons.indexOf(document.activeElement as HTMLElement);
        const next =
          e.key === 'ArrowDown' ? buttons[(i + 1) % buttons.length] : buttons[(i - 1 + buttons.length) % buttons.length];
        next.focus();
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    panelRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open ]);

  const choose = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  return (
    <span className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`Account: ${email}`}
        className="flex h-11 w-11 items-center justify-center rounded-full bg-accent-900 font-display text-lg font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_1px_2px_rgba(0,0,0,0.2)]"
      >
        <span aria-hidden="true">{initial}</span>
      </button>
      {open && (
        <div
          ref={panelRef}
          id={menuId}
          className="absolute right-0 top-full z-50 mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-md border border-stone-300 bg-white py-1 text-stone-900 shadow-lg"
        >
          <p className="break-all px-4 py-2 text-sm text-stone-600">
            Signed in as
            <br />
            <strong className="text-stone-900">{email}</strong>
          </p>
          <div role="menu" aria-label="Account" className="border-t border-stone-200 py-1">
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                onClick={choose(item.onSelect)}
                className={`block w-full px-4 py-2 text-left text-base hover:bg-stone-100 ${
                  item.danger ? 'text-red-900 underline decoration-red-900' : ''
                }`}
              >
                {item.label}
              </button>
            ))}
            <button
              type="button"
              role="menuitem"
              onClick={choose(onSignOut)}
              className="block w-full px-4 py-2 text-left text-base text-red-900 underline decoration-red-900 hover:bg-stone-100"
            >
              Sign out
            </button>
          </div>
        </div>
      )}
    </span>
  );
}
