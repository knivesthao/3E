import { useState } from 'react';
import type { FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { requestLink } from '../lib/api';
import { Alert, Button, Field, Page, inputClass } from '../components/ui';

// Invited signup for teachers and creators. The invite code is consumed by
// the API before any session is minted; public signup without a code always
// creates a student.
export default function InviteSignup() {
  const { code = '' } = useParams();
  const [email, setEmail] = useState('');
  const [devLink, setDevLink] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await requestLink(email, code);
      if (!res.devLink && !res.emailed) {
        setError('Email sign-in is not set up yet. Try again later.');
        return;
      }
      setSent(true);
      setDevLink(res.devLink ?? null);
    } catch {
      setError('That invite link is invalid, expired, or already used.');
    }
  }

  return (
    <Page title="Accept invite">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label="School email">
          <input
            type="email"
            required
            autoComplete="email"
            placeholder="you@school.org"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
        </Field>
        <div>
          <Button type="submit" variant="primary">Send invite sign-in link</Button>
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
