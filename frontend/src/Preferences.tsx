import { useEffect, useState } from "react";
import { api } from "./api";
import type { ProgressBasis } from "./progress";
export type Preferences = {
  progress_basis: ProgressBasis;
  leaderboard_visible: boolean;
  email_notifications: boolean;
  leaderboard_start_date: string;
  bible_enabled: boolean;
  catechism_enabled: boolean;
  notification_timezone: string;
  reminder_condition: "incomplete" | "always" | "never";
  morning_reminder_enabled: boolean;
  morning_reminder_time: string;
  evening_reminder_enabled: boolean;
  evening_reminder_time: string;
  shared_push_notifications: boolean;
  notification_setup_completed: boolean;
};
export function usePreferences(onError: (message: string) => void) {
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let live = true;
    api<Preferences>("/preferences")
      .then((p) => {
        if (live) setPreferences(p);
      })
      .catch((e) => onError(e.message));
    return () => {
      live = false;
    };
  }, [onError]);
  useEffect(() => {
    const synchronize = (event: Event) =>
      setPreferences((event as CustomEvent<Preferences>).detail);
    window.addEventListener("preferences-updated", synchronize);
    return () => window.removeEventListener("preferences-updated", synchronize);
  }, []);
  async function update(changes: Partial<Preferences>) {
    const previous = preferences;
    if (previous) setPreferences({ ...previous, ...changes });
    setSaving(true);
    try {
      const saved = await api<Preferences>("/preferences", "PATCH", changes);
      setPreferences(saved);
      window.dispatchEvent(
        new CustomEvent<Preferences>("preferences-updated", { detail: saved }),
      );
      return saved;
    } catch (e) {
      setPreferences(previous);
      onError((e as Error).message);
      return null;
    } finally {
      setSaving(false);
    }
  }
  return { preferences, saving, update };
}
export function BasisSelect({
  preferences,
  saving,
  update,
}: ReturnType<typeof usePreferences>) {
  return (
    <label className="progress-basis">
      <span>Schedule starts from</span>
      <select
        aria-label="Schedule starts from"
        disabled={!preferences || saving}
        value={preferences?.progress_basis || "first-completion"}
        onChange={(e) =>
          void update({ progress_basis: e.target.value as ProgressBasis })
        }
      >
        <option value="first-completion">Personal start dates</option>
        <option value="leaderboard">Leaderboard start date</option>
        <option value="january-1">January 1</option>
      </select>
    </label>
  );
}
