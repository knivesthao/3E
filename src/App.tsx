import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { BrowserRouter, NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { UserMenu } from './components/UserMenu';
import Library from './pages/Library';
import Studio from './pages/Studio';
import Editor from './pages/Editor';
import Reader from './pages/Reader';
import Flashcards from './pages/Flashcards';
import Admin from './pages/Admin';
import Exam from './pages/Exam';
import Privacy from './pages/Privacy';
import Terms from './pages/Terms';
import About from './pages/About';
import SignIn from './pages/SignIn';
import InviteSignup from './pages/InviteSignup';
import Classes from './pages/Classes';
import { getMe, logout } from './lib/api';
import type { UserRole } from './lib/api';
import { canAccess } from './lib/access';
import type { Surface } from './lib/access';

function Guard({
  email,
  role,
  surface,
  children,
}: {
  email: string | null;
  role: UserRole | null;
  surface: Surface;
  children: ReactNode;
}) {
  if (email === null) return <Navigate to="/signin" replace />;
  if (!canAccess(surface, role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  const [email, setEmail] = useState<string | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    getMe()
      .then((me) => {
        setEmail(me.user.email);
        setRole(me.user.role);
      })
      .catch(() => {
        setEmail(null);
        setRole(null);
      })
      .finally(() => setLoading(false));
  }, []);

  async function signOut() {
    try {
      await logout();
    } finally {
      setEmail(null);
      setRole(null);
      navigate('/signin');
    }
  }

  if (loading) return <p className="p-4 text-base">Loading…</p>;

  return (
    <>
      <nav
        aria-label="Main"
        className="sticky top-0 z-40 border-b border-stone-200 bg-white"
      >
        <div className="mx-auto flex w-full max-w-2xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 sm:px-6">
          <NavLink
            to="/"
            className="font-display text-xl font-bold text-accent-900 no-underline"
          >
            3E
          </NavLink>
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              isActive
                ? 'border-b-2 border-accent-900 pb-0.5 font-semibold text-stone-900'
                : 'text-stone-600 underline decoration-stone-300 underline-offset-4 hover:decoration-stone-500'
            }
          >
            Library
          </NavLink>
          {canAccess('classes', role) ? (
            <NavLink
              to="/classes"
              className={({ isActive }) =>
                isActive
                  ? 'border-b-2 border-accent-900 pb-0.5 font-semibold text-stone-900'
                  : 'text-stone-600 underline decoration-stone-300 underline-offset-4 hover:decoration-stone-500'
              }
            >
              Classes
            </NavLink>
          ) : null}
          {canAccess('studio', role) ? (
            <NavLink
              to="/studio"
              className={({ isActive }) =>
                isActive
                  ? 'border-b-2 border-accent-900 pb-0.5 font-semibold text-stone-900'
                  : 'text-stone-600 underline decoration-stone-300 underline-offset-4 hover:decoration-stone-500'
              }
            >
              Studio
            </NavLink>
          ) : null}
          <NavLink
            to="/about"
            className={({ isActive }) =>
              isActive
                ? 'border-b-2 border-accent-900 pb-0.5 font-semibold text-stone-900'
                : 'text-stone-600 underline decoration-stone-300 underline-offset-4 hover:decoration-stone-500'
            }
          >
            About
          </NavLink>
          <span className="ms-auto flex flex-wrap items-center gap-2 text-sm">
            {email ? (
              <UserMenu
                email={email}
                onSignOut={signOut}
                items={
                  role === 'admin' ? [{ label: 'Admin', onSelect: () => navigate('/admin') }] : []
                }
              />
            ) : (
              <NavLink
                to="/signin"
                className={({ isActive }) =>
                  isActive
                    ? 'border-b-2 border-accent-900 pb-0.5 font-semibold text-stone-900'
                    : 'text-stone-600 underline decoration-stone-300 underline-offset-4 hover:decoration-stone-500'
                }
              >
                Sign in
              </NavLink>
            )}
          </span>
        </div>
      </nav>
      <Routes>
        <Route path="/signin" element={<SignIn />} />
        <Route path="/signup/:code" element={<InviteSignup />} />
        <Route
          path="/"
          element={
            <Guard email={email} role={role} surface="library">
              <Library />
            </Guard>
          }
        />
        <Route
          path="/classes"
          element={
            <Guard email={email} role={role} surface="classes">
              <Classes />
            </Guard>
          }
        />
        <Route
          path="/studio"
          element={
            <Guard email={email} role={role} surface="studio">
              <Studio />
            </Guard>
          }
        />
        <Route
          path="/studio/:id"
          element={
            <Guard email={email} role={role} surface="studio">
              <Editor />
            </Guard>
          }
        />
        <Route
          path="/read/:id"
          element={
            <Guard email={email} role={role} surface="library">
              <Reader />
            </Guard>
          }
        />
        <Route path="/s/:bookId" element={<Reader />} />
        <Route
          path="/practice/:id"
          element={
            <Guard email={email} role={role} surface="library">
              <Flashcards />
            </Guard>
          }
        />
        <Route
          path="/practice/alphabet"
          element={
            <Guard email={email} role={role} surface="library">
              <Flashcards />
            </Guard>
          }
        />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/about" element={<About />} />
        <Route
          path="/admin"
          element={
            <Guard email={email} role={role} surface="admin">
              <Admin />
            </Guard>
          }
        />
        <Route path="/admin/costs" element={<Navigate to="/admin" replace />} />
        <Route
          path="/exam"
          element={
            <Guard email={email} role={role} surface="library">
              <Exam />
            </Guard>
          }
        />
      </Routes>
    </>
  );
}

export function Root() {
  return (
    <BrowserRouter>
      <App />
    </BrowserRouter>
  );
}
