import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  Bell,
  Check,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  Moon,
  Save,
  ShieldCheck,
  Smartphone,
  Sunrise,
  Trash2,
  UserRound,
} from "lucide-react";
import { usePreferences } from "./Preferences";
import { api } from "./api";
import { Sidebar } from "./navigation";
import { ThemeSettings } from "./Theme";
import {
  canPromptInstall,
  currentPushSubscription,
  disableCurrentPush,
  enablePush,
  isIOS,
  isInstalled,
  onInstallPromptChange,
  promptInstall,
  pushSupported,
  type PushDevice,
} from "./pwa";

type AccountData = {
  username: string;
  first_name: string;
  last_name: string;
  email: string;
};

function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
}) {
  const [shown, setShown] = useState(false);
  return (
    <label className="account-field password-field">
      <span>{label}</span>
      <div>
        <input
          type={shown ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          required
        />
        <button
          type="button"
          className="show-password"
          onClick={() => setShown(!shown)}
          aria-label={shown ? "Hide password" : "Show password"}
        >
          {shown ? <EyeOff size={17} /> : <Eye size={17} />}
        </button>
      </div>
    </label>
  );
}

export function Account({
  user,
  onUserChange,
  onError,
}: {
  user: string;
  onUserChange: (username: string) => void;
  onError: (message: string) => void;
}) {
  const prefs = usePreferences(onError);
  const [communityDate, setCommunityDate] = useState("");
  const [savingCommunity, setSavingCommunity] = useState(false);
  useEffect(() => {
    if (prefs.preferences)
      setCommunityDate(prefs.preferences.leaderboard_start_date);
  }, [prefs.preferences?.leaderboard_start_date]);
  async function saveCommunity(event: FormEvent) {
    event.preventDefault();
    if (
      !confirm(
        "Change the leaderboard start date for EVERYONE? This changes every member’s schedule when using the leaderboard start date.",
      )
    )
      return;
    setSavingCommunity(true);
    try {
      await api("/community-settings", "PUT", {
        start_date: communityDate,
        confirm_affects_everyone: true,
      });
      setNotice("The leaderboard start date has been updated for everyone.");
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setSavingCommunity(false);
    }
  }
  const [details, setDetails] = useState<AccountData>({
    username: user,
    first_name: "",
    last_name: "",
    email: "",
  });
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [savingDetails, setSavingDetails] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [notice, setNotice] = useState("");
  const [devices, setDevices] = useState<PushDevice[]>([]);
  const [currentEndpoint, setCurrentEndpoint] = useState("");
  const [pushBusy, setPushBusy] = useState(false);
  const [installAvailable, setInstallAvailable] = useState(canPromptInstall());
  const [installed, setInstalled] = useState(isInstalled());

  const loadPushState = useCallback(async () => {
    try {
      const [savedDevices, current] = await Promise.all([
        api<PushDevice[]>("/push/subscriptions"),
        currentPushSubscription(),
      ]);
      const knownCurrent =
        current &&
        savedDevices.some((device) => device.endpoint === current.endpoint);
      if (knownCurrent)
        await api("/push/subscriptions/current", "PUT", {
          endpoint: current.endpoint,
        });
      setDevices(savedDevices);
      setCurrentEndpoint(knownCurrent ? current.endpoint : "");
    } catch (e) {
      onError((e as Error).message);
    }
  }, [onError]);

  useEffect(() => {
    void loadPushState();
    return onInstallPromptChange(() => setInstallAvailable(canPromptInstall()));
  }, [loadPushState]);

  async function turnOnPush() {
    setPushBusy(true);
    try {
      await enablePush();
      const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (
        browserZone &&
        prefs.preferences?.notification_timezone !== browserZone
      )
        await prefs.update({ notification_timezone: browserZone });
      await loadPushState();
      setNotice("Notifications are enabled on this device.");
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setPushBusy(false);
    }
  }

  async function turnOffPush() {
    setPushBusy(true);
    try {
      const subscription = await currentPushSubscription();
      if (subscription) await disableCurrentPush(subscription);
      await loadPushState();
      setNotice("Notifications are disabled on this device.");
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setPushBusy(false);
    }
  }

  async function removeDevice(device: PushDevice) {
    setPushBusy(true);
    try {
      if (device.endpoint === currentEndpoint) {
        await turnOffPush();
        return;
      }
      await api(`/push/subscriptions/${device.id}`, "DELETE");
      await loadPushState();
      setNotice(`${device.device_name} will no longer receive notifications.`);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setPushBusy(false);
    }
  }

  async function installApp() {
    if (await promptInstall()) {
      setInstalled(true);
      setNotice("Bible in a Year has been installed.");
    }
  }

  useEffect(() => {
    void api<AccountData>("/account")
      .then(setDetails)
      .catch((e) => onError(e.message));
  }, [onError]);
  const change = (key: keyof AccountData, value: string) =>
    setDetails((old) => ({ ...old, [key]: value }));
  async function saveDetails(event: FormEvent) {
    event.preventDefault();
    setSavingDetails(true);
    setNotice("");
    try {
      const saved = await api<AccountData>("/account", "PUT", details);
      setDetails(saved);
      onUserChange(saved.username);
      setNotice("Your personal details have been saved.");
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setSavingDetails(false);
    }
  }
  async function savePassword(event: FormEvent) {
    event.preventDefault();
    setNotice("");
    if (password !== confirmation)
      return onError("Your new passwords do not match.");
    if (password.length < 8)
      return onError("Your new password must be at least 8 characters.");
    setSavingPassword(true);
    try {
      await api("/account/password", "PUT", { new_password: password });
      setPassword("");
      setConfirmation("");
      setNotice("Your password has been updated.");
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setSavingPassword(false);
    }
  }
  const name =
    [details.first_name, details.last_name].filter(Boolean).join(" ") ||
    details.username;
  async function updateEditions(
    changes: Partial<{ bible_enabled: boolean; catechism_enabled: boolean }>,
  ) {
    const saved = await prefs.update(changes);
    if (saved)
      window.dispatchEvent(
        new CustomEvent("edition-availability", {
          detail: {
            bible: saved.bible_enabled,
            catechism: saved.catechism_enabled,
          },
        }),
      );
  }
  return (
    <div className="app-frame">
      <Sidebar user={user} />
      <main className="account-page">
        <header className="account-header">
          <span className="eyebrow">SETTINGS / ACCOUNT</span>
          <h1>Your account</h1>
          <p>A quiet place to keep your details up to date.</p>
        </header>
        <div className="account-layout">
          <ThemeSettings />
          <section className="account-card profile-card">
            <div className="account-card-heading">
              <span className="account-icon">
                <UserRound size={20} />
              </span>
              <div>
                <h2>Personal details</h2>
                <p>This is how you appear in your study space.</p>
              </div>
            </div>
            <div className="identity-preview">
              <span className="large-avatar">{name[0].toUpperCase()}</span>
              <div>
                <strong>{name}</strong>
                <span>@{details.username}</span>
              </div>
            </div>
            <form onSubmit={saveDetails}>
              <label className="account-field full">
                <span>User name</span>
                <input
                  value={details.username}
                  onChange={(e) => change("username", e.target.value)}
                  autoComplete="username"
                  required
                />
              </label>
              <div className="name-fields">
                <label className="account-field">
                  <span>First name</span>
                  <input
                    value={details.first_name}
                    onChange={(e) => change("first_name", e.target.value)}
                    autoComplete="given-name"
                  />
                </label>
                <label className="account-field">
                  <span>Last name</span>
                  <input
                    value={details.last_name}
                    onChange={(e) => change("last_name", e.target.value)}
                    autoComplete="family-name"
                  />
                </label>
              </div>
              <label className="account-field full">
                <span>Email address</span>
                <input
                  type="email"
                  value={details.email}
                  onChange={(e) => change("email", e.target.value)}
                  autoComplete="email"
                  placeholder="you@example.com"
                />
                <small className="field-help">
                  Used for shared reflection notifications when enabled.
                </small>
              </label>
              <button className="primary" disabled={savingDetails}>
                {savingDetails ? (
                  "Saving…"
                ) : (
                  <>
                    <Save size={16} /> Save details
                  </>
                )}
              </button>
            </form>
          </section>
          <section className="account-card edition-settings">
            <h2>Your editions</h2>
            <p>Choose the journeys that appear throughout your study space.</p>
            <label>
              <input
                type="checkbox"
                disabled={
                  !prefs.preferences ||
                  prefs.saving ||
                  (prefs.preferences.bible_enabled &&
                    !prefs.preferences.catechism_enabled)
                }
                checked={prefs.preferences?.bible_enabled ?? true}
                onChange={(e) =>
                  void updateEditions({ bible_enabled: e.target.checked })
                }
              />{" "}
              Bible in a Year
            </label>
            <label>
              <input
                type="checkbox"
                disabled={
                  !prefs.preferences ||
                  prefs.saving ||
                  (prefs.preferences.catechism_enabled &&
                    !prefs.preferences.bible_enabled)
                }
                checked={prefs.preferences?.catechism_enabled ?? true}
                onChange={(e) =>
                  void updateEditions({ catechism_enabled: e.target.checked })
                }
              />{" "}
              Catechism in a Year
            </label>
            <p className="quiet">
              Keep at least one edition enabled. Hidden editions are removed
              from navigation, journals, and leaderboards.
            </p>
          </section>
          <section className="account-card collaboration-settings">
            <h2>Community preferences</h2>
            <p>Changes are saved to your account automatically.</p>
            <label>
              <input
                type="checkbox"
                disabled={!prefs.preferences || prefs.saving}
                checked={prefs.preferences?.leaderboard_visible ?? true}
                onChange={(e) =>
                  void prefs.update({ leaderboard_visible: e.target.checked })
                }
              />{" "}
              Show my progress on the leaderboard
            </label>
            <label>
              <input
                type="checkbox"
                disabled={!prefs.preferences || prefs.saving}
                checked={prefs.preferences?.email_notifications ?? true}
                onChange={(e) =>
                  void prefs.update({ email_notifications: e.target.checked })
                }
              />{" "}
              Email me when someone shares a note or journal entry
            </label>
            <p className="quiet">
              Notes and journal entries are private unless you mark them Shared.
              Shared entries are visible to signed-in members.
            </p>
          </section>
          <section className="account-card notification-settings">
            <div className="notification-settings-main">
              <div className="account-card-heading">
                <span className="account-icon">
                  <Bell size={20} />
                </span>
                <div>
                  <h2>Reading reminders</h2>
                  <p>
                    Gentle prompts, delivered at the times that work for you.
                  </p>
                </div>
              </div>
              <div className="reminder-time-row">
                <span className="reminder-symbol morning">
                  <Sunrise size={21} />
                </span>
                <div>
                  <strong>Morning</strong>
                  <small>Start the day with your reading</small>
                </div>
                <label className="switch-control">
                  <input
                    type="checkbox"
                    aria-label="Morning reminder"
                    disabled={!prefs.preferences || prefs.saving}
                    checked={
                      prefs.preferences?.morning_reminder_enabled ?? false
                    }
                    onChange={(e) =>
                      void prefs.update({
                        morning_reminder_enabled: e.target.checked,
                      })
                    }
                  />
                  <span />
                </label>
                <input
                  className="reminder-time"
                  type="time"
                  aria-label="Morning reminder time"
                  disabled={
                    !prefs.preferences ||
                    prefs.saving ||
                    !prefs.preferences.morning_reminder_enabled
                  }
                  value={prefs.preferences?.morning_reminder_time || "07:00"}
                  onChange={(e) =>
                    void prefs.update({ morning_reminder_time: e.target.value })
                  }
                />
              </div>
              <div className="reminder-time-row">
                <span className="reminder-symbol evening">
                  <Moon size={20} />
                </span>
                <div>
                  <strong>Evening</strong>
                  <small>Close the day with your reading</small>
                </div>
                <label className="switch-control">
                  <input
                    type="checkbox"
                    aria-label="Evening reminder"
                    disabled={!prefs.preferences || prefs.saving}
                    checked={
                      prefs.preferences?.evening_reminder_enabled ?? false
                    }
                    onChange={(e) =>
                      void prefs.update({
                        evening_reminder_enabled: e.target.checked,
                      })
                    }
                  />
                  <span />
                </label>
                <input
                  className="reminder-time"
                  type="time"
                  aria-label="Evening reminder time"
                  disabled={
                    !prefs.preferences ||
                    prefs.saving ||
                    !prefs.preferences.evening_reminder_enabled
                  }
                  value={prefs.preferences?.evening_reminder_time || "20:00"}
                  onChange={(e) =>
                    void prefs.update({ evening_reminder_time: e.target.value })
                  }
                />
              </div>
              <fieldset className="reminder-condition">
                <legend>When should reminders be sent?</legend>
                <div>
                  {(
                    [
                      ["incomplete", "Only when today’s reading is incomplete"],
                      ["always", "Always"],
                      ["never", "Never"],
                    ] as const
                  ).map(([value, label]) => (
                    <label
                      key={value}
                      className={
                        prefs.preferences?.reminder_condition === value
                          ? "active"
                          : ""
                      }
                    >
                      <input
                        type="radio"
                        name="reminder-condition"
                        value={value}
                        checked={
                          prefs.preferences?.reminder_condition === value
                        }
                        disabled={!prefs.preferences || prefs.saving}
                        onChange={() =>
                          void prefs.update({ reminder_condition: value })
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <small>
                  Uses your selected schedule start: personal, shared, or
                  January 1. Times use{" "}
                  {prefs.preferences?.notification_timezone.replaceAll(
                    "_",
                    " ",
                  ) || "your local time zone"}
                  .
                </small>
              </fieldset>
              <label className="shared-push-setting">
                <span className="reminder-symbol community">
                  <Bell size={19} />
                </span>
                <span>
                  <strong>Shared notes &amp; journal entries</strong>
                  <small>
                    Tell me when another member shares a reflection.
                  </small>
                </span>
                <span className="switch-control">
                  <input
                    type="checkbox"
                    aria-label="Shared reflection notifications"
                    disabled={!prefs.preferences || prefs.saving}
                    checked={
                      prefs.preferences?.shared_push_notifications ?? false
                    }
                    onChange={(e) =>
                      void prefs.update({
                        shared_push_notifications: e.target.checked,
                      })
                    }
                  />
                  <span />
                </span>
              </label>
            </div>
            <aside className="notification-device-panel">
              <h3>App &amp; permissions</h3>
              <div className="app-status-row">
                <Smartphone size={20} />
                <span>
                  <strong>
                    {installed ? "App installed" : "Install this app"}
                  </strong>
                  <small>
                    {installed
                      ? "Opens in its own window"
                      : "Keep BIY close at hand"}
                  </small>
                </span>
              </div>
              {!installed && installAvailable && (
                <button
                  type="button"
                  className="outline-button install-button"
                  onClick={() => void installApp()}
                >
                  <Download size={15} /> Install app
                </button>
              )}
              {!installed && !installAvailable && isIOS() && (
                <p className="install-help">
                  In Safari, tap Share, then “Add to Home Screen.” Open the
                  installed app to enable notifications.
                </p>
              )}
              {!installed && !installAvailable && !isIOS() && (
                <p className="install-help">
                  Use your browser’s Install option to add BIY to this device.
                </p>
              )}
              <details className="install-instructions" open={!installed}>
                <summary>How to install</summary>
                {isIOS() ? (
                  <ol>
                    <li>Open BIY in Safari.</li>
                    <li>Tap Share, then “Add to Home Screen.”</li>
                    <li>Open BIY from its new Home Screen icon.</li>
                  </ol>
                ) : (
                  <ol>
                    <li>
                      Open your browser menu or the Install icon in the address
                      bar.
                    </li>
                    <li>Choose “Install app” or “Add to Home screen.”</li>
                    <li>Open the installed BIY app and allow notifications.</li>
                  </ol>
                )}
                <p>
                  Repeat these steps on each device where you want reminders.
                </p>
              </details>
              <div className="app-status-row push-permission-row">
                <Bell size={20} />
                <span>
                  <strong>Push notifications</strong>
                  <small>
                    {currentEndpoint
                      ? "Enabled on this device"
                      : pushSupported() && (!isIOS() || installed)
                        ? "Not enabled here"
                        : isIOS() && !installed
                          ? "Install the app first"
                          : "Not supported here"}
                  </small>
                </span>
              </div>
              {pushSupported() &&
                (!isIOS() || installed) &&
                (currentEndpoint ? (
                  <button
                    type="button"
                    className="text-button"
                    disabled={pushBusy}
                    onClick={() => void turnOffPush()}
                  >
                    Disable on this device
                  </button>
                ) : (
                  <button
                    type="button"
                    className="primary enable-push-button"
                    disabled={pushBusy}
                    onClick={() => void turnOnPush()}
                  >
                    <Bell size={15} />{" "}
                    {pushBusy ? "Enabling…" : "Enable notifications"}
                  </button>
                ))}
              <div className="device-list">
                <h4>Your devices</h4>
                {devices.length === 0 ? (
                  <p>No devices are subscribed yet.</p>
                ) : (
                  devices.map((device) => (
                    <div key={device.id}>
                      <span>
                        <strong>{device.device_name}</strong>
                        <small>
                          {device.endpoint === currentEndpoint
                            ? "This device"
                            : `Seen ${new Date(device.last_seen_at).toLocaleDateString()}`}
                        </small>
                      </span>
                      <button
                        type="button"
                        disabled={pushBusy}
                        onClick={() => void removeDevice(device)}
                        aria-label={`Remove ${device.device_name}`}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </aside>
          </section>
          <section className="account-card community-date-card">
            <h2>Leaderboard start date</h2>
            <div className="community-warning">
              <strong>This affects everyone.</strong>
              <p>
                Changing this shared date changes ahead/behind calculations for
                all members using “Leaderboard start date.” Any member of this
                trusted group can update it.
              </p>
            </div>
            <form onSubmit={saveCommunity}>
              <label className="account-field">
                <span>Shared start date</span>
                <input
                  type="date"
                  required
                  value={communityDate}
                  onChange={(e) => setCommunityDate(e.target.value)}
                />
              </label>
              <button
                className="primary"
                disabled={!prefs.preferences || savingCommunity}
              >
                {savingCommunity ? "Updating…" : "Update for everyone"}
              </button>
            </form>
          </section>
          <section className="account-card password-card">
            <div className="account-card-heading">
              <span className="account-icon">
                <KeyRound size={20} />
              </span>
              <div>
                <h2>Change password</h2>
                <p>Use a strong password you do not use elsewhere.</p>
              </div>
            </div>
            <form onSubmit={savePassword}>
              <PasswordField
                label="New password"
                value={password}
                onChange={setPassword}
                autoComplete="new-password"
              />
              <small className="field-help">At least 8 characters.</small>
              <PasswordField
                label="Confirm new password"
                value={confirmation}
                onChange={setConfirmation}
                autoComplete="new-password"
              />
              <button className="outline-button" disabled={savingPassword}>
                {savingPassword ? (
                  "Updating…"
                ) : (
                  <>
                    <Check size={16} /> Update password
                  </>
                )}
              </button>
            </form>
            <p className="security-note">
              <ShieldCheck size={16} /> Your password is stored securely and
              never shown here.
            </p>
          </section>
        </div>
        {notice && (
          <p className="account-notice" role="status">
            <Check size={17} /> {notice}
          </p>
        )}
      </main>
    </div>
  );
}
