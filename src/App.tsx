import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import Library from './pages/Library';
import Studio from './pages/Studio';
import Editor from './pages/Editor';
import Reader from './pages/Reader';
import Admin from './pages/Admin';
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
        className="bg-stone-900 text-white"
      >
        <div className="mx-auto flex w-full max-w-2xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 sm:px-6">
          <span className="font-display text-lg font-bold">3E</span>
          <Link to="/" className="underline underline-offset-4">Library</Link>
          <Link to="/studio" className="underline underline-offset-4">Studio</Link>
          <Link to="/admin" className="underline underline-offset-4">Admin</Link>
          <span className="ms-auto flex flex-wrap items-center gap-2 text-sm">
            {email ? (
              <>
                <span className="break-all text-stone-200">{email}</span>
                <button
                  onClick={signOut}
                  className="rounded-md border border-stone-400 px-3 text-sm underline underline-offset-2"
                >
                  Sign out
                </button>
              </>
            ) : (
              <Link to="/signin" className="underline underline-offset-4">Sign in</Link>
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
