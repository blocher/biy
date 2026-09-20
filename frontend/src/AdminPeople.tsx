import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Check,
  KeyRound,
  LockKeyhole,
  Save,
  Search,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import { api } from "./api";
import { Sidebar } from "./navigation";

type ProgressBasis = "first-completion" | "leaderboard" | "january-1";

type AdminUser = {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  email: string;
  is_active: boolean;
  is_admin: boolean;
  has_usable_password: boolean;
  date_joined: string;
  last_login: string | null;
  leaderboard_visible: boolean;
  email_notifications: boolean;
  progress_basis: ProgressBasis;
  completed_days: number;
  journal_entries: number;
};

type UserForm = {
  username: string;
  first_name: string;
  last_name: string;
  email: string;
  is_active: boolean;
  is_admin: boolean;
  leaderboard_visible: boolean;
  email_notifications: boolean;
  progress_basis: ProgressBasis;
  password: string;
  confirmation: string;
};

const emptyForm = (): UserForm => ({
  username: "",
  first_name: "",
  last_name: "",
  email: "",
  is_active: true,
  is_admin: false,
  leaderboard_visible: true,
  email_notifications: true,
  progress_basis: "first-completion",
  password: "",
  confirmation: "",
});

const formFor = (member: AdminUser): UserForm => ({
  username: member.username,
  first_name: member.first_name,
  last_name: member.last_name,
  email: member.email,
  is_active: member.is_active,
  is_admin: member.is_admin,
  leaderboard_visible: member.leaderboard_visible,
  email_notifications: member.email_notifications,
  progress_basis: member.progress_basis,
  password: "",
  confirmation: "",
});

const displayName = (
  member: Pick<AdminUser, "first_name" | "last_name" | "username">,
) =>
  [member.first_name, member.last_name].filter(Boolean).join(" ") ||
  member.username;

const initials = (
  member: Pick<AdminUser, "first_name" | "last_name" | "username">,
) => {
  const letters = [member.first_name, member.last_name]
    .filter(Boolean)
    .map((part) => part[0]);
  return (letters.join("") || member.username[0] || "?").toUpperCase();
};

const formatDate = (value: string | null) =>
  value
    ? new Date(value).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "Not yet";

export function AdminPeople({
  user,
  onSessionChange,
  onError,
}: {
  user: string;
  onSessionChange: (username: string, isAdmin: boolean) => void;
  onError: (message: string) => void;
}) {
  const [members, setMembers] = useState<AdminUser[]>([]);
  const [selectedId, setSelectedId] = useState<number | "new" | null>(null);
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<UserForm>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    void api<AdminUser[]>("/admin/users")
      .then((rows) => {
        setMembers(rows);
        if (rows.length) {
          setSelectedId(rows[0].id);
          setForm(formFor(rows[0]));
        } else {
          setSelectedId("new");
        }
      })
      .catch((error) => onError(error.message))
      .finally(() => setLoading(false));
  }, [onError]);

  const selected =
    typeof selectedId === "number"
      ? members.find((member) => member.id === selectedId) || null
      : null;
  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    if (!term) return members;
    return members.filter((member) =>
      [displayName(member), member.username, member.email]
        .join(" ")
        .toLocaleLowerCase()
        .includes(term),
    );
  }, [members, query]);

  function choose(member: AdminUser) {
    setSelectedId(member.id);
    setForm(formFor(member));
    setNotice("");
  }

  function startNew() {
    setSelectedId("new");
    setForm(emptyForm());
    setNotice("");
  }

  function change<K extends keyof UserForm>(key: K, value: UserForm[K]) {
    setForm((old) => ({ ...old, [key]: value }));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setNotice("");
    if (form.password !== form.confirmation) {
      onError("The passwords do not match.");
      return;
    }
    if (selectedId === "new" && !form.password) {
      onError("Set an initial password for the new member.");
      return;
    }
    const wasCurrentUser = selected?.username === user;
    const payload = {
      username: form.username,
      first_name: form.first_name,
      last_name: form.last_name,
      email: form.email,
      is_active: form.is_active,
      is_admin: form.is_admin,
      leaderboard_visible: form.leaderboard_visible,
      email_notifications: form.email_notifications,
      progress_basis: form.progress_basis,
      password: form.password || (selectedId === "new" ? "" : null),
    };
    setSaving(true);
    try {
      const saved = await api<AdminUser>(
        selectedId === "new" ? "/admin/users" : `/admin/users/${selectedId}`,
        selectedId === "new" ? "POST" : "PUT",
        payload,
      );
      setMembers((rows) => {
        const next =
          selectedId === "new"
            ? [...rows, saved]
            : rows.map((row) => (row.id === saved.id ? saved : row));
        return next.sort((a, b) =>
          displayName(a).localeCompare(displayName(b)),
        );
      });
      setSelectedId(saved.id);
      setForm(formFor(saved));
      setNotice(
        selectedId === "new"
          ? `${displayName(saved)} can now sign in.`
          : `${displayName(saved)}’s profile has been saved.`,
      );
      if (wasCurrentUser)
        onSessionChange(saved.username, saved.is_admin && saved.is_active);
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const preview = {
    username: form.username || "new-member",
    first_name: form.first_name,
    last_name: form.last_name,
  };

  return (
    <div className="app-frame">
      <Sidebar user={user} />
      <main className="admin-people-page">
        <header className="admin-people-header">
          <div>
            <span className="eyebrow">ADMIN / PEOPLE</span>
            <h1>Care for your community.</h1>
            <p>Manage the people sharing this year of Scripture.</p>
          </div>
          <button className="primary" type="button" onClick={startNew}>
            <UserPlus size={18} /> Add a person
          </button>
        </header>

        <div className="admin-people-workspace">
          <section className="member-directory" aria-label="People">
            <div className="member-directory-heading">
              <h2>People</h2>
              <span>{members.length}</span>
            </div>
            <label className="member-search">
              <span className="sr-only">Search people</span>
              <Search size={17} />
              <input
                type="search"
                placeholder="Search by name, user name, or email"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div className="member-list">
              {loading && <p className="quiet">Opening the member list…</p>}
              {!loading && filtered.length === 0 && (
                <p className="quiet">No people match that search.</p>
              )}
              {filtered.map((member) => (
                <button
                  className={selectedId === member.id ? "selected" : ""}
                  type="button"
                  key={member.id}
                  onClick={() => choose(member)}
                >
                  <span className="member-avatar">{initials(member)}</span>
                  <span className="member-list-identity">
                    <strong>{displayName(member)}</strong>
                    <small>@{member.username}</small>
                  </span>
                  <span
                    className={`member-status ${member.is_active ? "active" : "inactive"}`}
                  >
                    {member.is_active ? "Active" : "Inactive"}
                  </span>
                  {member.is_admin && (
                    <ShieldCheck className="member-admin-mark" size={16} />
                  )}
                </button>
              ))}
            </div>
            <p className="member-directory-foot">
              <em>Small group. A deeper faith.</em>
              <span>
                {members.filter((member) => member.is_active).length} active
              </span>
            </p>
          </section>

          <section className="member-editor">
            <div className="member-editor-heading">
              <span className="member-avatar large">{initials(preview)}</span>
              <div>
                <span className="eyebrow">
                  {selectedId === "new" ? "NEW ACCOUNT" : "MEMBER PROFILE"}
                </span>
                <h2>
                  {selectedId === "new" ? "Add a person" : displayName(preview)}
                </h2>
                <p>
                  <span
                    className={`status-dot ${form.is_active ? "active" : ""}`}
                  />
                  {form.is_active ? "Active account" : "Sign-in disabled"}
                  {selected && (
                    <> · Joined {formatDate(selected.date_joined)}</>
                  )}
                </p>
              </div>
            </div>

            <form onSubmit={save}>
              <div className="member-form-grid">
                <section>
                  <h3>Personal details</h3>
                  <p className="section-help">
                    How this person appears in the study community.
                  </p>
                  <div className="name-fields">
                    <label className="account-field">
                      <span>First name</span>
                      <input
                        value={form.first_name}
                        onChange={(event) =>
                          change("first_name", event.target.value)
                        }
                        autoComplete="off"
                      />
                    </label>
                    <label className="account-field">
                      <span>Last name</span>
                      <input
                        value={form.last_name}
                        onChange={(event) =>
                          change("last_name", event.target.value)
                        }
                        autoComplete="off"
                      />
                    </label>
                  </div>
                  <label className="account-field">
                    <span>User name</span>
                    <input
                      required
                      value={form.username}
                      onChange={(event) =>
                        change("username", event.target.value)
                      }
                      autoComplete="off"
                    />
                  </label>
                  <label className="account-field">
                    <span>Email address</span>
                    <input
                      type="email"
                      value={form.email}
                      onChange={(event) => change("email", event.target.value)}
                      autoComplete="off"
                    />
                    <small className="field-help">
                      Used for shared reflection notifications when enabled.
                    </small>
                  </label>
                </section>

                <section className="member-access-section">
                  <h3>Access & preferences</h3>
                  <p className="section-help">
                    Sign-in, permissions, and reading defaults.
                  </p>
                  <label className="toggle-field">
                    <input
                      type="checkbox"
                      checked={form.is_active}
                      onChange={(event) =>
                        change("is_active", event.target.checked)
                      }
                    />
                    <span>
                      <strong>Active account</strong>
                      <small>Allows this person to sign in.</small>
                    </span>
                  </label>
                  <label className="toggle-field">
                    <input
                      type="checkbox"
                      checked={form.is_admin}
                      onChange={(event) =>
                        change("is_admin", event.target.checked)
                      }
                    />
                    <span>
                      <strong>Administrator</strong>
                      <small>
                        Can create accounts and edit member profiles.
                      </small>
                    </span>
                  </label>
                  <label className="toggle-field">
                    <input
                      type="checkbox"
                      checked={form.leaderboard_visible}
                      onChange={(event) =>
                        change("leaderboard_visible", event.target.checked)
                      }
                    />
                    <span>
                      <strong>Show progress on leaderboard</strong>
                      <small>
                        Shares completion totals with signed-in members.
                      </small>
                    </span>
                  </label>
                  <label className="toggle-field">
                    <input
                      type="checkbox"
                      checked={form.email_notifications}
                      onChange={(event) =>
                        change("email_notifications", event.target.checked)
                      }
                    />
                    <span>
                      <strong>Shared-note emails</strong>
                      <small>
                        Emails this person when a reflection is shared.
                      </small>
                    </span>
                  </label>
                  <label className="account-field">
                    <span>Reading schedule</span>
                    <select
                      value={form.progress_basis}
                      onChange={(event) =>
                        change(
                          "progress_basis",
                          event.target.value as ProgressBasis,
                        )
                      }
                    >
                      <option value="first-completion">
                        Personal start dates
                      </option>
                      <option value="leaderboard">
                        Leaderboard start date
                      </option>
                      <option value="january-1">January 1</option>
                    </select>
                  </label>
                </section>
              </div>

              <div className="member-lower-grid">
                <section className="member-password-section">
                  <div>
                    <KeyRound size={18} />
                    <h3>
                      {selectedId === "new"
                        ? "Initial password"
                        : "Reset password"}
                    </h3>
                  </div>
                  <p className="section-help">
                    {selectedId === "new"
                      ? "Share it privately; the new person can change it from Account."
                      : "Leave both fields blank to keep the current password."}
                  </p>
                  <div className="name-fields">
                    <label className="account-field">
                      <span>New password</span>
                      <input
                        type="password"
                        required={selectedId === "new"}
                        minLength={8}
                        value={form.password}
                        onChange={(event) =>
                          change("password", event.target.value)
                        }
                        autoComplete="new-password"
                      />
                    </label>
                    <label className="account-field">
                      <span>Confirm password</span>
                      <input
                        type="password"
                        required={
                          selectedId === "new" || Boolean(form.password)
                        }
                        minLength={8}
                        value={form.confirmation}
                        onChange={(event) =>
                          change("confirmation", event.target.value)
                        }
                        autoComplete="new-password"
                      />
                    </label>
                  </div>
                </section>

                {selected && (
                  <section
                    className="member-activity"
                    aria-label="Account activity"
                  >
                    <h3>Account activity</h3>
                    <dl>
                      <div>
                        <dt>Days completed</dt>
                        <dd>{selected.completed_days}</dd>
                      </div>
                      <div>
                        <dt>Journal entries</dt>
                        <dd>{selected.journal_entries}</dd>
                      </div>
                      <div>
                        <dt>Last sign-in</dt>
                        <dd>{formatDate(selected.last_login)}</dd>
                      </div>
                      <div>
                        <dt>Password</dt>
                        <dd>
                          {selected.has_usable_password ? "Set" : "Not set"}
                        </dd>
                      </div>
                    </dl>
                  </section>
                )}
              </div>

              <footer className="member-editor-actions">
                <p>
                  <LockKeyhole size={16} /> Personal reflections remain private
                  to their author.
                </p>
                <button className="primary" disabled={saving}>
                  {saving ? (
                    "Saving…"
                  ) : (
                    <>
                      <Save size={17} />
                      {selectedId === "new" ? "Create account" : "Save profile"}
                    </>
                  )}
                </button>
              </footer>
            </form>
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
