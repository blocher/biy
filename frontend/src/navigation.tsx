import { createContext, useContext } from "react";
import { NavLink, Link } from "react-router-dom";
import {
  BookOpen,
  MessageCircle,
  NotebookPen,
  LogOut,
  Sun,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";
export const LogoutContext = createContext(() => {});
export const AdminContext = createContext(false);
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
  const isAdmin = useContext(AdminContext);
  const body = (
    <>
      <Brand />
      <nav className="navigation" aria-label="Main navigation">
        <NavLink to="/" end>
          <BookOpen size={20} /> Reading plan
        </NavLink>
        <NavLink to="/chat">
          <MessageCircle size={20} /> Ask
        </NavLink>
        <NavLink to="/journal">
          <NotebookPen size={20} /> My journal
        </NavLink>
        <NavLink to="/leaderboard">
          <Users size={20} /> Leaderboard
        </NavLink>
        <NavLink to="/account">
          <Settings size={20} /> Account
        </NavLink>
        {isAdmin && (
          <NavLink to="/admin/people">
            <ShieldCheck size={20} /> People
          </NavLink>
        )}
      </nav>
      <div className="sidebar-bottom">
        <NavLink className="account" to="/account">
          <span className="avatar">{user[0].toUpperCase()}</span>
          <div>
            <strong>{user}</strong>
            <small>One day at a time.</small>
          </div>
        </NavLink>
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
