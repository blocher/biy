import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { createThemeStore, type ThemePreference } from "./themePreference";

let store: ReturnType<typeof createThemeStore> | undefined;
function useTheme() {
  const themeStore = (store ??= createThemeStore(window));
  return {
    ...useSyncExternalStore(themeStore.subscribe, themeStore.getSnapshot),
    setPreference: themeStore.setPreference,
  };
}

export function ThemeToggle() {
  const { theme, setPreference } = useTheme();
  return (
    <button
      type="button"
      className="theme-toggle"
      role="switch"
      aria-label="Dark mode"
      aria-checked={theme === "dark"}
      title={theme === "dark" ? "Turn off dark mode" : "Turn on dark mode"}
      onClick={() => setPreference(theme === "dark" ? "light" : "dark")}
    >
      <span className="theme-switch-track" aria-hidden="true">
        <span className="theme-switch-thumb" />
        <Sun size={16} />
        <Moon size={16} />
      </span>
      <span className="theme-switch-label">
        {theme === "dark" ? "Dark mode" : "Light mode"}
      </span>
    </button>
  );
}

export function ThemeSettings() {
  const { preference, setPreference } = useTheme();
  return (
    <section className="account-card theme-settings">
      <h2>Appearance</h2>
      <p>Choose a comfortable reading theme for this browser.</p>
      <label htmlFor="theme-preference">Color theme</label>
      <select
        id="theme-preference"
        value={preference}
        onChange={(event) =>
          setPreference(event.target.value as ThemePreference)
        }
      >
        <option value="system">Use device setting</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </section>
  );
}
