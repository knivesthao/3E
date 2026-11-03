// Transactional email for magic links (Resend). Plain fetch, no SDK, so it
// stays Workers-compatible. Best-effort by design: failures return false,
// never throw, and never touch the token — a failed send just means the
// link expires unused. The route reports `emailed` so the UI can say so.
const RESEND_URL = 'https://api.resend.com/emails';

export async function sendMagicLink(
  env: { RESEND_API_KEY?: string; EMAIL_FROM?: string },
  to: string,
  link: string,
): Promise<boolean> {
  const apiKey = env.RESEND_API_KEY;
  const from = env.EMAIL_FROM;
  if (!apiKey || !from || to === '') return false;
  try {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        from,
        to,
        subject: 'Sign in to 3E',
        text: `Tap to sign in to 3E (expires in 15 minutes):\n\n${link}\n\nIf you did not ask for this, ignore it.`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
