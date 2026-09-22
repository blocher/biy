import { useEffect, useState, useCallback, useRef } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  useLocation,
  Link,
  Navigate,
} from "react-router-dom";
import { ArrowRight, X } from "lucide-react";
import { api, setCSRF } from "./api";
import type { Library } from "./types";
import { AdminContext, Brand, LogoutContext } from "./navigation";
import { AudioProvider } from "./Audio";
import { Study } from "./Study";
import { StudyChat } from "./StudyChat";
import { Journal } from "./Library";
import { Home } from "./Home";
import { Leaderboard } from "./Leaderboard";
import { Account } from "./Account";
import { AdminPeople } from "./AdminPeople";
import { Commentaries } from "./Commentaries";
import { NotificationSetupModal } from "./NotificationSetupModal";
import {
  EditionContext,
  editionName,
  persistEdition,
  storedEdition,
  type Edition,
  type EditionAvailability,
} from "./Edition";
function AppContent() {
  const [user, setUser] = useState<string | null>(null),
    [isAdmin, setIsAdmin] = useState(false),
    [checking, setChecking] = useState(true),
    [library, setLibrary] = useState<Library | null>(null),
    [libraryFailure, setLibraryFailure] = useState(false),
    [slowLibrary, setSlowLibrary] = useState(false),
    [error, setError] = useState(""),
    [username, setUsername] = useState("ben"),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [edition, setEditionState] = useState<Edition>(storedEdition),
    [availability, setAvailability] = useState<EditionAvailability>({
      bible: true,
      catechism: true,
    });
  const location = useLocation(),
    onError = useCallback((message: string) => setError(message), []);
  const libraryRequest = useRef(0);
  const refresh = useCallback(() => {
    const request = ++libraryRequest.current;
    setLibraryFailure(false);
    setSlowLibrary(false);
    const slowTimer = window.setTimeout(() => {
      if (libraryRequest.current === request) setSlowLibrary(true);
    }, 10000);
    void api<Library>("/library")
      .then((result) => {
        if (libraryRequest.current === request) setLibrary(result);
      })
      .catch((e) => {
        if (libraryRequest.current !== request) return;
        setLibraryFailure(true);
        setError(e.message);
      })
      .finally(() => window.clearTimeout(slowTimer));
  }, []);
  useEffect(() => {
    api<{ user: { username: string; is_admin: boolean } | null; csrf: string }>(
      "/session",
    )
      .then((s) => {
        setCSRF(s.csrf);
        setUser(s.user?.username || null);
        setIsAdmin(s.user?.is_admin || false);
      })
      .catch((e) => setError(e.message))
      .finally(() => setChecking(false));
    const expired = () => {
      setUser(null);
      setIsAdmin(false);
      setLibrary(null);
    };
    window.addEventListener("session-expired", expired);
    return () => window.removeEventListener("session-expired", expired);
  }, []);
  useEffect(() => {
    if (!user) return;
    let live = true;
    const requestedEdition = storedEdition();
    refresh();
    void api<{ bible_enabled: boolean; catechism_enabled: boolean }>(
      "/preferences",
    )
      .then((preferences) => {
        if (!live) return;
        const nextAvailability = {
          bible: preferences.bible_enabled,
          catechism: preferences.catechism_enabled,
        };
        setAvailability(nextAvailability);
        let next = requestedEdition;
        if (!nextAvailability[next])
          next = nextAvailability.bible ? "bible" : "catechism";
        persistEdition(next);
        setEditionState(next);
        if (next !== requestedEdition) {
          setLibrary(null);
          refresh();
        }
      })
      .catch((e) => setError(e.message));
    return () => {
      live = false;
    };
  }, [user, refresh]);
  useEffect(() => {
    document.documentElement.dataset.edition = edition;
    document.title = `${editionName(edition)} · Your daily companion`;
  }, [edition]);
  useEffect(() => {
    const updateAvailability = (event: Event) => {
      const next = (event as CustomEvent<EditionAvailability>).detail;
      setAvailability(next);
      if (!next[edition]) {
        const fallback: Edition = next.bible ? "bible" : "catechism";
        persistEdition(fallback);
        setEditionState(fallback);
        setLibrary(null);
        window.setTimeout(refresh, 0);
      }
    };
    window.addEventListener("edition-availability", updateAvailability);
    return () =>
      window.removeEventListener("edition-availability", updateAvailability);
  }, [edition, refresh]);
  const setEdition = useCallback(
    (next: Edition) => {
      if (!availability[next] || next === edition) return;
      persistEdition(next);
      setEditionState(next);
      setLibrary(null);
      window.setTimeout(refresh, 0);
    },
    [availability, edition, refresh],
  );
  useEffect(() => {
    const linked = new URLSearchParams(location.search).get("edition");
    if (
      (linked === "bible" || linked === "catechism") &&
      availability[linked] &&
      linked !== edition
    )
      setEdition(linked);
  }, [availability, edition, location.search, setEdition]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);
  async function login(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api<{
        user: { username: string; is_admin: boolean };
        csrf: string;
      }>("/login", "POST", { username, password });
      setCSRF(result.csrf);
      setUser(result.user.username);
      setIsAdmin(result.user.is_admin);
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
      setIsAdmin(false);
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
          <span className="eyebrow">YOUR DAILY COMPANIONS</span>
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
        {(libraryFailure || slowLibrary) && (
          <button onClick={refresh}>
            {libraryFailure ? "Try again" : "Taking a while — try again"}
          </button>
        )}
        {notice}
      </div>
    );
  return (
    <EditionContext.Provider value={{ edition, availability, setEdition }}>
      <LogoutContext.Provider value={logout}>
        <AdminContext.Provider value={isAdmin}>
          <AudioProvider key={user} onError={onError}>
            <a className="skip-link" href="#main-content">
              Skip to content
            </a>
            <div id="main-content">
              <Routes>
                <Route
                  path="/chat"
                  element={<StudyChat key={user} user={user} />}
                />
                <Route
                  path="/commentaries"
                  element={
                    <Commentaries
                      user={user}
                      library={library}
                      onError={onError}
                    />
                  }
                />
                <Route
                  path="/"
                  element={
                    <Home
                      key={edition}
                      user={user}
                      library={library}
                      onChange={refresh}
                      onError={onError}
                    />
                  }
                />
                <Route
                  path="/plan"
                  element={<Navigate to={`/${location.search}`} replace />}
                />
                <Route path="/extras" element={<Navigate to="/" replace />} />
                <Route
                  path="/journal"
                  element={<Journal user={user} onError={onError} />}
                />
                <Route
                  path="/leaderboard"
                  element={<Leaderboard user={user} onError={onError} />}
                />
                <Route
                  path="/account"
                  element={
                    <Account
                      user={user}
                      onUserChange={setUser}
                      onError={onError}
                    />
                  }
                />
                <Route
                  path="/admin/people"
                  element={
                    isAdmin ? (
                      <AdminPeople
                        user={user}
                        onSessionChange={(username, admin) => {
                          setUser(username);
                          setIsAdmin(admin);
                        }}
                        onError={onError}
                      />
                    ) : (
                      <Navigate to="/" replace />
                    )
                  }
                />
                {["/day/:day", "/episode/:episode"].map((path) => (
                  <Route
                    key={path}
                    path={path}
                    element={
                      <Study
                        user={user}
                        completedDays={library.completed}
                        onError={onError}
                        onChange={refresh}
                      />
                    }
                  />
                ))}
                {["/day/:day/reader", "/episode/:episode/reader"].map(
                  (path) => (
                    <Route
                      key={path}
                      path={path}
                      element={
                        <Study
                          user={user}
                          completedDays={library.completed}
                          onError={onError}
                          onChange={refresh}
                          reader
                        />
                      }
                    />
                  ),
                )}
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
            <NotificationSetupModal onError={onError} />
            {notice}
          </AudioProvider>
        </AdminContext.Provider>
      </LogoutContext.Provider>
    </EditionContext.Provider>
  );
}
export default function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}
