import { useState } from 'react';
import type { FormEvent } from 'react';
import { requestLink } from '../lib/api';

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [devLink, setDevLink] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await requestLink(email);
      setSent(true);
      setDevLink(res.devLink ?? null);
    } catch {
      setError('Could not send the sign-in link.');
    }
  }

  return (
    <main>
      <h1>Sign in</h1>
      <form onSubmit={submit}>
        <input
          type="email"
          required
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button type="submit">Send magic link</button>
      </form>
      {error && <p>{error}</p>}
      {sent && <p>Link sent. Check your inbox (dev: click below).</p>}
      {devLink && (
        <p>
          <a href={devLink}>Sign in (dev link)</a>
        </p>
      )}
    </main>
  );
}
