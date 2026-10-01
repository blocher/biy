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
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      onClick={() => setPreference(next)}
    >
      {next === "dark" ? <Moon size={18} /> : <Sun size={18} />}
      <span>{next === "dark" ? "Dark mode" : "Light mode"}</span>
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
