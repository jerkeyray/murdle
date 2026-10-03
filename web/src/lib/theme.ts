/**
 * Theme and contrast live on documentElement, not in React state.
 *
 * The inline script in layout.tsx applies them before first paint to avoid a
 * flash, which makes the DOM the source of truth. React subscribes to it
 * through useSyncExternalStore rather than mirroring it into component state —
 * mirroring would mean reading the DOM in an effect, which is the pattern
 * useSyncExternalStore exists to replace.
 */

export type Theme = "dark" | "light" | "system";

const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  const scheme = window.matchMedia("(prefers-color-scheme: light)");
  const onScheme = () => { if (getTheme() === "system") { applyTheme("system"); emit(); } };
  const onStorage = (event: StorageEvent) => {
    if (event.key === "wordle.theme") { applyTheme(normalizeTheme(event.newValue)); emit(); }
    if (event.key === "wordle.contrast") { document.documentElement.dataset.contrast = event.newValue === "cb" ? "cb" : "normal"; emit(); }
  };
  scheme.addEventListener("change", onScheme);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    scheme.removeEventListener("change", onScheme);
    window.removeEventListener("storage", onStorage);
  };
}

function normalizeTheme(theme: string | null | undefined): Theme {
  return theme === "light" || theme === "dark" ? theme : "system";
}

export function getTheme(): Theme {
  return normalizeTheme(document.documentElement.dataset.themePreference);
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
  return "system";
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

function applyTheme(theme: Theme) {
  document.documentElement.dataset.themePreference = theme;
  document.documentElement.dataset.theme = theme === "system"
    ? window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"
    : theme;
}

export function setTheme(theme: Theme) {
  applyTheme(theme);
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
