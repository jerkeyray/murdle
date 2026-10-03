"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Native modal semantics provide focus trapping, Escape, and an inert background. */
export function Dialog({ title, children, onClose, className = "" }: { title: string; children: ReactNode; onClose: () => void; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement;
    dialog?.showModal();
    headingRef.current?.focus({ preventScroll: true });
    return () => {
      dialog?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog ref={ref} className={`game-dialog entry ${className}`} aria-label={title} onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <div className="dialog-heading">
        <span ref={headingRef} className="label" tabIndex={-1}>{title}</span>
        <button className="icon-button dialog-close" onClick={onClose} aria-label={`Close ${title}`}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
      {children}
    </dialog>
  );
}
