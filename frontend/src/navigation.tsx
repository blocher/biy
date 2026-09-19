import { createContext, useContext } from "react";
import { NavLink, Link } from "react-router-dom";
import {
  BookOpen,
  Home,
  NotebookPen,
  Headphones,
  LogOut,
  Sun,
} from "lucide-react";
export const LogoutContext = createContext(() => {});
export function Brand() {
  return (
    <Link className="brand" to="/" aria-label="Bible in a Year home">
      <div className="brand-art">
        <Sun />
        <BookOpen />
      </div>
      <span>
        Bible
        <br />
        in a Year
      </span>
    </Link>
  );
}
export function Sidebar({
  user,
  embedded = false,
}: {
  user: string;
  embedded?: boolean;
}) {
  const logout = useContext(LogoutContext);
  const body = (
    <>
      <Brand />
      <nav className="navigation" aria-label="Main navigation">
        <NavLink to="/" end>
          <Home size={20} /> My journey
        </NavLink>
        <NavLink to="/plan">
          <BookOpen size={20} /> Reading plan
        </NavLink>
        <NavLink to="/journal">
          <NotebookPen size={20} /> My journal
        </NavLink>
        <NavLink to="/extras">
          <Headphones size={20} /> Extra episodes
        </NavLink>
      </nav>
      <div className="sidebar-bottom">
        <div className="account">
          <span className="avatar">{user[0].toUpperCase()}</span>
          <div>
            <strong>{user}</strong>
            <small>One day at a time.</small>
          </div>
        </div>
        <button onClick={logout}>
          <LogOut size={17} /> Sign out
        </button>
        <p className="motto">
          His story.
          <br />
          <em>Your everyday.</em>
        </p>
      </div>
    </>
  );
  return embedded ? (
    <div className="sidebar-inner">{body}</div>
  ) : (
    <aside className="sidebar">{body}</aside>
  );
}
