import type { D1Database, Fetcher, R2Bucket } from '@cloudflare/workers-types';

export type Bindings = {
  DB: D1Database;
  // Published-books library: shared by every env, holds ONLY the books
  // table. Drafts, users, positions, and definitions stay in DB.
  LIBRARY_DB: D1Database;
  ART?: R2Bucket;
  LIBRARY_ART?: R2Bucket;
  // Static-asset fetcher (auto-provisioned when [assets] is configured).
  // The SPA fallback reads index.html through it; absent locally, the
  // fallback degrades to the JSON 404 instead of crashing.
  ASSETS?: Fetcher;
  DEV_LINKS?: string;
  MODEL_API_KEY?: string;
  AI_API_URL?: string;
  BASETEN_API_URL?: string;
  BASETEN_API_KEY?: string;
  BASETEN_MODEL?: string;
  MODAL_API_URL?: string;
  MODAL_PROXY_TOKEN?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
};
import type { Role } from './roles';
export type Variables = { userId: string; userEmail: string; userRole: Role };
