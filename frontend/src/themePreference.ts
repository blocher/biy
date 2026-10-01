export type Theme = "light" | "dark";
export type ThemePreference = Theme | "system";
export const THEME_STORAGE_KEY = "biy-theme";

export function themePreference(value: string | null): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

export function resolveTheme(
  preference: ThemePreference,
  darkSystem: boolean,
): Theme {
  return preference === "system" ? (darkSystem ? "dark" : "light") : preference;
}

// One store keeps sidebar, reader, and Account controls in sync, including tabs.
export function createThemeStore(browser: Window) {
  const media = browser.matchMedia("(prefers-color-scheme: dark)");
  let preference: ThemePreference = "system";
  try {
    preference = themePreference(
      browser.localStorage.getItem(THEME_STORAGE_KEY),
    );
  } catch {
    // Private browsing or a storage policy must not prevent reading.
  }
  let snapshot = { preference, theme: resolveTheme(preference, media.matches) };
  const listeners = new Set<() => void>();
  function apply() {
    const theme = resolveTheme(preference, media.matches);
    const root = browser.document.documentElement;
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    root.style.backgroundColor = theme === "dark" ? "#151e1b" : "#fbfaf6";
    browser.document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#151e1b" : "#123f34");
    if (snapshot.preference === preference && snapshot.theme === theme) return;
    snapshot = { preference, theme };
    listeners.forEach((listener) => listener());
  }
  function onStorage(event: StorageEvent) {
    if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
    // Ignore sessionStorage events; they are unrelated to this preference.
    try {
      if (event.storageArea && event.storageArea !== browser.localStorage)
        return;
    } catch {
      return;
    }
    preference = themePreference(event.newValue);
    apply();
  }
  apply();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      if (!listeners.size) {
        media.addEventListener("change", apply);
        browser.addEventListener("storage", onStorage);
        apply();
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          media.removeEventListener("change", apply);
          browser.removeEventListener("storage", onStorage);
        }
      };
    },
    setPreference(next: ThemePreference) {
      preference = next;
      try {
        if (next === "system")
          browser.localStorage.removeItem(THEME_STORAGE_KEY);
        else browser.localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // Retain the explicit choice in memory when persistence is blocked.
      }
      apply();
    },
  };
}
