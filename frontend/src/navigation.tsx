import { createContext, useContext } from "react";
import { NavLink, Link, useLocation, useNavigate } from "react-router-dom";
import {
  BookOpen,
  MessageCircle,
  NotebookPen,
  LogOut,
  Sun,
  Settings,
  ShieldCheck,
  Users,
  LibraryBig,
} from "lucide-react";
import { editionName, useEdition, type Edition } from "./Edition";
export const LogoutContext = createContext(() => {});
export const AdminContext = createContext(false);
export function Brand() {
  const { edition } = useEdition();
  return (
    <Link className="brand" to="/" aria-label={`${editionName(edition)} home`}>
      <div className="brand-art">
        <Sun />
        <BookOpen />
      </div>
      <span>
        {edition === "bible" ? "Bible" : "Catechism"}
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
  const { edition, availability, setEdition } = useEdition();
  const location = useLocation();
  const navigate = useNavigate();
  function switchEdition(next: Edition) {
    setEdition(next);
    if (next === "catechism" && location.pathname === "/commentaries") navigate("/");
    else if (location.pathname === "/chat") navigate("/chat");
  }
  const body = (
    <>
      <Brand />
      {availability.bible && availability.catechism && (
        <div className="edition-switcher" aria-label="Study edition">
          <button
            aria-pressed={edition === "bible"}
            onClick={() => switchEdition("bible")}
          >
            Bible
          </button>
          <button
            aria-pressed={edition === "catechism"}
            onClick={() => switchEdition("catechism")}
          >
            Catechism
          </button>
        </div>
      )}
      <nav className="navigation" aria-label="Main navigation">
        <NavLink to="/" end>
          <BookOpen size={20} /> Reading plan
        </NavLink>
        <NavLink to="/chat">
          <MessageCircle size={20} /> Ask
        </NavLink>
        {edition === "bible" && (
          <NavLink to="/commentaries">
            <LibraryBig size={20} /> Commentaries
          </NavLink>
        )}
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
            <small>{editionName(edition)}</small>
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
