import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import Library from './pages/Library';
import Studio from './pages/Studio';
import Editor from './pages/Editor';
import Reader from './pages/Reader';
import Costs from './pages/Costs';
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

  if (loading) return <p>Loading…</p>;

  return (
    <>
      <nav>
        <Link to="/">Library</Link> | <Link to="/studio">Studio</Link> | <Link to="/admin/costs">Costs</Link>
        {email ? (
          <>
            {' '}| {email} <button onClick={signOut}>Sign out</button>
          </>
        ) : (
          <>
            {' '}| <Link to="/signin">Sign in</Link>
          </>
        )}
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
          path="/admin/costs"
          element={
            <Guard email={email}>
              <Costs />
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
