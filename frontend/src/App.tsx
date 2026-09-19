import { useEffect, useState, useCallback } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  useLocation,
  Link,
} from "react-router-dom";
import { ArrowRight, X } from "lucide-react";
import { api, setCSRF } from "./api";
import type { Library } from "./types";
import { Brand, LogoutContext } from "./navigation";
import { AudioProvider } from "./Audio";
import { Study } from "./Study";
import { LibraryPage, Journal } from "./Library";
import { Home } from "./Home";
function AppContent() {
  const [user, setUser] = useState<string | null>(null),
    [checking, setChecking] = useState(true),
    [library, setLibrary] = useState<Library | null>(null),
    [error, setError] = useState(""),
    [username, setUsername] = useState("ben"),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false);
  const location = useLocation(),
    onError = useCallback((message: string) => setError(message), []);
  const refresh = useCallback(() => {
    void api<Library>("/library")
      .then(setLibrary)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    api<{ user: { username: string } | null; csrf: string }>("/session")
      .then((s) => {
        setCSRF(s.csrf);
        setUser(s.user?.username || null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setChecking(false));
    const expired = () => {
      setUser(null);
      setLibrary(null);
    };
    window.addEventListener("session-expired", expired);
    return () => window.removeEventListener("session-expired", expired);
  }, []);
  useEffect(() => {
    if (user) refresh();
  }, [user, refresh]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);
  async function login(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api<{ user: { username: string }; csrf: string }>(
        "/login",
        "POST",
        { username, password },
      );
      setCSRF(result.csrf);
      setUser(result.user.username);
      setPassword("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    try {
      await api("/logout", "POST");
      setUser(null);
      setLibrary(null);
      const session = await api<{ csrf: string }>("/session");
      setCSRF(session.csrf);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const notice = error && (
    <div className="toast" role="alert">
      <span>{error}</span>
      <button aria-label="Dismiss message" onClick={() => setError("")}>
        <X size={18} />
      </button>
    </div>
  );
  if (checking)
    return (
      <div className="loading">
        <Brand />
        <p role="status">Opening your journey…</p>
        {notice}
      </div>
    );
  if (!user)
    return (
      <div className="login-page">
        <section className="login-story">
          <Brand />
          <span className="eyebrow">YOUR DAILY COMPANION</span>
          <h1>
            A little each day.
            <br />
            <em>A story that changes everything.</em>
          </h1>
          <p>
            Listen closely. Read deeply.
            <br />
            Make room for the Word.
          </p>
          <div className="login-colors">
            {[
              "#64b6bd",
              "#771051",
              "#cd3d37",
              "#dbbe7d",
              "#31a153",
              "#493390",
              "#221f20",
              "#8db5e2",
              "#f4d02b",
              "#d8792d",
              "#b1922f",
              "#efefef",
            ].map((c) => (
              <i key={c} style={{ background: c }} />
            ))}
          </div>
        </section>
        <section className="login-form">
          <span className="eyebrow">BIBLE IN A YEAR</span>
          <h2>Welcome back.</h2>
          <p>Pick up where you left off.</p>
          <form onSubmit={login}>
            <label htmlFor="username">Username</label>
            <input
              id="username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button className="primary" disabled={busy}>
              {busy ? "Signing in…" : "Continue your journey"}
              <ArrowRight size={17} />
            </button>
          </form>
          <p className="quiet account-help">
            This is a private study space. Accounts are added by the owner.
          </p>
        </section>
        {notice}
      </div>
    );
  if (!library)
    return (
      <div className="loading">
        <Brand />
        <p role="status">Loading your reading plan…</p>
        <button onClick={refresh}>Try again</button>
        {notice}
      </div>
    );
  return (
    <LogoutContext.Provider value={logout}>
      <AudioProvider key={user} onError={onError}>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <div id="main-content">
          <Routes>
            <Route
              path="/"
              element={
                <Home
                  user={user}
                  library={library}
                  onChange={refresh}
                  onError={onError}
                />
              }
            />
            <Route
              path="/plan"
              element={
                <LibraryPage
                  user={user}
                  library={library}
                  onChange={refresh}
                  onError={onError}
                  mode="plan"
                />
              }
            />
            <Route
              path="/extras"
              element={
                <LibraryPage
                  user={user}
                  library={library}
                  onChange={refresh}
                  onError={onError}
                  mode="extras"
                />
              }
            />
            <Route
              path="/journal"
              element={<Journal user={user} onError={onError} />}
            />
            {["/day/:day", "/episode/:episode"].map((path) => (
              <Route
                key={path}
                path={path}
                element={
                  <Study user={user} onError={onError} onChange={refresh} />
                }
              />
            ))}
            {["/day/:day/reader", "/episode/:episode/reader"].map((path) => (
              <Route
                key={path}
                path={path}
                element={
                  <Study
                    user={user}
                    onError={onError}
                    onChange={refresh}
                    reader
                  />
                }
              />
            ))}
            <Route
              path="*"
              element={
                <div className="simple-page">
                  <h1>Page not found</h1>
                  <Link to="/">Return to your journey</Link>
                </div>
              }
            />
          </Routes>
        </div>
        {notice}
      </AudioProvider>
    </LogoutContext.Provider>
  );
}
export default function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}
