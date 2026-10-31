import type { D1Database, R2Bucket } from '@cloudflare/workers-types';

export type Bindings = {
  DB: D1Database;
  ART?: R2Bucket;
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
export type Variables = { userId: string; userEmail: string };
