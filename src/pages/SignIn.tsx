import { useState } from 'react';
import type { FormEvent } from 'react';
import { requestLink } from '../lib/api';
import { Alert, Button, Field, Page, inputClass } from '../components/ui';

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
      if (!res.devLink && !res.emailed) {
        setError('Email sign-in is not set up yet. Try again later.');
        return;
      }
      setSent(true);
      setDevLink(res.devLink ?? null);
    } catch {
      setError('Could not send the sign-in link.');
    }
  }

  return (
    <Page title="Sign in">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label="Email">
          <input
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
        </Field>
        <div>
          <Button type="submit" variant="primary">Send magic link</Button>
        </div>
      </form>
      {error && <Alert>{error}</Alert>}
      {sent && devLink && <p>Link sent. Check your inbox (dev: click below).</p>}
      {sent && !devLink && <p>Link sent. Check your inbox.</p>}
      {devLink && (
        <p>
          <a href={devLink} className="underline underline-offset-2">
            Sign in (dev link)
          </a>
        </p>
      )}
    </Page>
  );
}
