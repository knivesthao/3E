import type { D1Database } from '@cloudflare/workers-types';

export type Bindings = { DB: D1Database; DEV_LINKS?: string; MODEL_API_KEY?: string; AI_API_URL?: string };
export type Variables = { userId: string; userEmail: string };
