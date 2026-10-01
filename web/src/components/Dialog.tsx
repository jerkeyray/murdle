"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Native modal semantics provide focus trapping, Escape, and an inert background. */
export function Dialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog ref={ref} className="game-dialog entry" aria-label={title} onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <div className="dialog-heading">
        <span className="label">{title}</span>
        <button className="text-button" onClick={onClose} aria-label={`Close ${title}`}>Close</button>
      </div>
      {children}
    </dialog>
  );
}
