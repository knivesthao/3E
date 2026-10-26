import type { D1Database } from '@cloudflare/workers-types';

export type Bindings = { DB: D1Database; DEV_LINKS?: string };
export type Variables = { userId: string; userEmail: string };
