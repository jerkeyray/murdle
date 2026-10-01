/**
 * Theme and contrast live on documentElement, not in React state.
 *
 * The inline script in layout.tsx applies them before first paint to avoid a
 * flash, which makes the DOM the source of truth. React subscribes to it
 * through useSyncExternalStore rather than mirroring it into component state —
 * mirroring would mean reading the DOM in an effect, which is the pattern
 * useSyncExternalStore exists to replace.
 */

export type Theme = "dark" | "light";

const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getTheme(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function getColorBlind(): boolean {
  return document.documentElement.dataset.contrast === "cb";
}

/**
 * Snapshots used during server render and hydration. They match the defaults
 * the inline script falls back to; if the player has chosen otherwise,
 * useSyncExternalStore re-renders with the real value straight after hydration.
 */
export function getServerTheme(): Theme {
  return "dark";
}

export function getServerColorBlind(): boolean {
  return false;
}

function persist(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode or blocked storage. The setting still applies for this
    // session; it just will not be remembered.
  }
}

export function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  persist("wordle.theme", theme);
  emit();
}

export function setColorBlind(on: boolean) {
  if (on) {
    document.documentElement.dataset.contrast = "cb";
  } else {
    delete document.documentElement.dataset.contrast;
  }
  persist("wordle.contrast", on ? "cb" : "normal");
  emit();
}
