import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { BrowserRouter, NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { UserMenu } from './components/UserMenu';
import Library from './pages/Library';
import Studio from './pages/Studio';
import Editor from './pages/Editor';
import Reader from './pages/Reader';
import Admin from './pages/Admin';
import Exam from './pages/Exam';
import SignIn from './pages/SignIn';
import { getMe, logout } from './lib/api';

function Guard({ email, children }: { email: string | null; children: ReactNode }) {
  if (email === null) return <Navigate to="/signin" replace />;
  return <>{children}</>;
}

export default function App() {
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    getMe()
      .then((me) => setEmail(me.user.email))
      .catch(() => setEmail(null))
      .finally(() => setLoading(false));
  }, []);

  async function signOut() {
    try {
      await logout();
    } finally {
      setEmail(null);
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
          <NavLink
            to="/admin"
            className={({ isActive }) =>
              isActive
                ? 'border-b-2 border-accent-900 pb-0.5 font-semibold text-stone-900'
                : 'text-stone-600 underline decoration-stone-300 underline-offset-4 hover:decoration-stone-500'
            }
          >
            Admin
          </NavLink>
          <span className="ms-auto flex flex-wrap items-center gap-2 text-sm">
            {email ? (
              <UserMenu email={email} onSignOut={signOut} />
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
        <Route
          path="/"
          element={
            <Guard email={email}>
              <Library />
            </Guard>
          }
        />
        <Route
          path="/studio"
          element={
            <Guard email={email}>
              <Studio />
            </Guard>
          }
        />
        <Route
          path="/studio/:id"
          element={
            <Guard email={email}>
              <Editor />
            </Guard>
          }
        />
        <Route
          path="/read/:id"
          element={
            <Guard email={email}>
              <Reader />
            </Guard>
          }
        />
        <Route path="/s/:bookId" element={<Reader />} />
        <Route
          path="/admin"
          element={
            <Guard email={email}>
              <Admin />
            </Guard>
          }
        />
        <Route path="/admin/costs" element={<Navigate to="/admin" replace />} />
        <Route
          path="/exam"
          element={
            <Guard email={email}>
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
