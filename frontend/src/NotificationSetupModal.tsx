import { useEffect, useRef, useState } from "react";
import { Bell, BookOpen, Moon, Sunrise } from "lucide-react";
import { usePreferences, type Preferences } from "./Preferences";
import { enablePush, isInstalled, onAppInstalled, pushSupported } from "./pwa";

type SetupDraft = Pick<
  Preferences,
  | "morning_reminder_enabled"
  | "morning_reminder_time"
  | "evening_reminder_enabled"
  | "evening_reminder_time"
  | "shared_push_notifications"
  | "reminder_condition"
>;

export function NotificationSetupModal({
  onError,
}: {
  onError: (message: string) => void;
}) {
  const prefs = usePreferences(onError);
  const [installed, setInstalled] = useState(isInstalled());
  const [draft, setDraft] = useState<SetupDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const continueButton = useRef<HTMLButtonElement>(null);

  useEffect(() => onAppInstalled(() => setInstalled(true)), []);
  useEffect(() => {
    if (!prefs.preferences || draft) return;
    setDraft({
      morning_reminder_enabled: prefs.preferences.morning_reminder_enabled,
      morning_reminder_time: prefs.preferences.morning_reminder_time,
      evening_reminder_enabled: prefs.preferences.evening_reminder_enabled,
      evening_reminder_time: prefs.preferences.evening_reminder_time,
      shared_push_notifications: prefs.preferences.shared_push_notifications,
      reminder_condition: prefs.preferences.reminder_condition,
    });
  }, [prefs.preferences, draft]);

  const open = Boolean(
    installed &&
    prefs.preferences &&
    !prefs.preferences.notification_setup_completed &&
    draft,
  );
  useEffect(() => {
    if (open) continueButton.current?.focus();
  }, [open]);

  if (!open || !draft) return null;

  const change = <K extends keyof SetupDraft>(key: K, value: SetupDraft[K]) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current));

  async function finishWithoutPush() {
    setBusy(true);
    await prefs.update({ ...draft, notification_setup_completed: true });
    setBusy(false);
  }

  async function continueToPermission() {
    setBusy(true);
    try {
      await enablePush();
      const notification_timezone =
        Intl.DateTimeFormat().resolvedOptions().timeZone ||
        prefs.preferences?.notification_timezone;
      await prefs.update({
        ...draft,
        notification_timezone,
        notification_setup_completed: true,
      });
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="notification-setup-backdrop">
      <section
        className="notification-setup-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="notification-setup-title"
      >
        <div className="notification-setup-mark">
          <BookOpen size={24} />
        </div>
        <span className="eyebrow">BIY IS INSTALLED</span>
        <h2 id="notification-setup-title">Set your study reminders</h2>
        <p className="notification-setup-intro">
          Choose what feels helpful. Next, your browser will ask permission to
          deliver notifications.
        </p>

        <div className="notification-setup-options">
          <div className="notification-setup-row">
            <span className="reminder-symbol morning">
              <Sunrise size={21} />
            </span>
            <span>
              <strong>Morning reminder</strong>
              <small>A gentle nudge to begin today’s reading.</small>
            </span>
            <label className="switch-control">
              <input
                type="checkbox"
                aria-label="Morning reminder"
                checked={draft.morning_reminder_enabled}
                onChange={(event) =>
                  change("morning_reminder_enabled", event.target.checked)
                }
              />
              <span />
            </label>
            <input
              className="reminder-time"
              type="time"
              aria-label="Morning reminder time"
              disabled={!draft.morning_reminder_enabled}
              value={draft.morning_reminder_time}
              onChange={(event) =>
                change("morning_reminder_time", event.target.value)
              }
            />
          </div>
          <div className="notification-setup-row">
            <span className="reminder-symbol evening">
              <Moon size={20} />
            </span>
            <span>
              <strong>Evening reminder</strong>
              <small>A moment to return before the day ends.</small>
            </span>
            <label className="switch-control">
              <input
                type="checkbox"
                aria-label="Evening reminder"
                checked={draft.evening_reminder_enabled}
                onChange={(event) =>
                  change("evening_reminder_enabled", event.target.checked)
                }
              />
              <span />
            </label>
            <input
              className="reminder-time"
              type="time"
              aria-label="Evening reminder time"
              disabled={!draft.evening_reminder_enabled}
              value={draft.evening_reminder_time}
              onChange={(event) =>
                change("evening_reminder_time", event.target.value)
              }
            />
          </div>
          <label className="notification-setup-shared">
            <span className="reminder-symbol community">
              <Bell size={19} />
            </span>
            <span>
              <strong>Shared notes &amp; journal entries</strong>
              <small>Know when another member shares a reflection.</small>
            </span>
            <span className="switch-control">
              <input
                type="checkbox"
                aria-label="Shared reflection notifications"
                checked={draft.shared_push_notifications}
                onChange={(event) =>
                  change("shared_push_notifications", event.target.checked)
                }
              />
              <span />
            </span>
          </label>
          <label className="notification-setup-condition">
            <span>Send reading reminders</span>
            <select
              value={draft.reminder_condition}
              onChange={(event) =>
                change(
                  "reminder_condition",
                  event.target.value as SetupDraft["reminder_condition"],
                )
              }
            >
              <option value="incomplete">
                Only when today’s reading is incomplete
              </option>
              <option value="always">Always</option>
              <option value="never">Never</option>
            </select>
          </label>
        </div>

        <p className="notification-setup-note">
          Your browser will ask for permission in the next step. You can change
          these choices anytime on the Account page.
        </p>
        <button
          ref={continueButton}
          type="button"
          className="primary notification-setup-continue"
          disabled={busy || !pushSupported()}
          onClick={() => void continueToPermission()}
        >
          {busy ? "Setting up…" : "Continue to browser permission"}
        </button>
        {!pushSupported() && (
          <p className="notification-setup-unsupported">
            This browser cannot receive push notifications, but your reminder
            preferences can still be saved.
          </p>
        )}
        <button
          type="button"
          className="text-button notification-setup-later"
          disabled={busy}
          onClick={() => void finishWithoutPush()}
        >
          Not now
        </button>
      </section>
    </div>
  );
}
