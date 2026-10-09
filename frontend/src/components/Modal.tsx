"use client";

/**
 * One dialog, used by every screen that asks for something.
 *
 * There were four hand-rolled `fixed inset-0` overlays before this, each with
 * slightly different padding, a different close button and its own ideas about
 * the Escape key — which is the kind of difference nobody decides and everybody
 * notices. This is the single one: backdrop click and Escape close it, the page
 * behind stops scrolling, and the dialog itself scrolls when the content is
 * taller than the viewport.
 *
 * `steps` turns it into a wizard. A long form is not made shorter by putting it
 * in a popup — it is made shorter by asking for one thing at a time, and the
 * footer then carries Back/Next instead of Save.
 */

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface Props {
  title: string;
  /** One line under the title: what this dialog is for. */
  lede?: string;
  onClose: () => void;
  children: ReactNode;
  /** The buttons. Cancel is added for you, on the left. */
  footer?: ReactNode;
  /** "md" fits a form; "lg" fits a form beside a preview. */
  size?: "sm" | "md" | "lg";
  /** Wizard: which step is showing, and what they are called. */
  step?: number;
  stepLabels?: string[];
}

const WIDTH = { sm: "max-w-md", md: "max-w-2xl", lg: "max-w-4xl" };

export default function Modal({
  title,
  lede,
  onClose,
  children,
  footer,
  size = "md",
  step,
  stepLabels,
}: Props) {
  const dialog = useRef<HTMLDivElement>(null);
  // Keyboard and screen-reader users land inside the dialog, and go back to
  // whatever opened it when it closes, instead of being left on the page
  // behind the backdrop.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialog.current?.focus({ preventScroll: true });
    return () => opener?.focus?.();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    // The page behind must not scroll under the dialog: on a long list, the
    // wheel otherwise moves the page and the dialog appears frozen.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  // Portalled to <body>: an ancestor with a transform, filter or animation
  // turns `position: fixed` into "fixed to that ancestor", and the backdrop
  // then stops short of the viewport.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain bg-black/50 p-4 backdrop-blur-sm sm:items-center"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`card my-auto w-full ${WIDTH[size]} animate-scale-in space-y-4 p-5 shadow-2xl focus:outline-none`}
        // The backdrop closes; a click inside must not travel up to it.
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">{title}</h2>
            {lede && <p className="mt-0.5 text-sm text-text-muted">{lede}</p>}
          </div>
          <button className="btn-ghost btn-sm shrink-0" onClick={onClose} aria-label="Close">
            <span aria-hidden="true">✕</span>
          </button>
        </div>

        {stepLabels && stepLabels.length > 1 && (
          <ol className="flex flex-wrap items-center gap-1.5 text-xs">
            {stepLabels.map((label, i) => (
              <li
                key={label}
                className={`rounded-full px-2.5 py-1 ${
                  i === step
                    ? "bg-accent text-accent-fg font-medium"
                    : i < (step ?? 0)
                      ? "bg-good/15 text-good"
                      : "bg-edge text-text-subtle"
                }`}
              >
                {i < (step ?? 0) ? "✓ " : `${i + 1}. `}
                {label}
              </li>
            ))}
          </ol>
        )}

        <div className="space-y-3">{children}</div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-edge pt-3">
          {footer}
        </div>
      </div>
    </div>,
    document.body,
  );
}
