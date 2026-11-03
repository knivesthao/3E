// Shared in-memory R2 stub for route tests. Mirrors R2ObjectBody: routes
// read via arrayBuffer(), not .body.
export function makeBucket() {
  const store = new Map<string, { bytes: ArrayBuffer; contentType: string }>();
  return {
    store,
    async put(key: string, value: ArrayBuffer, opts?: { httpMetadata?: { contentType?: string } }) {
      store.set(key, { bytes: value, contentType: opts?.httpMetadata?.contentType ?? 'application/octet-stream' });
    },
    async get(key: string) {
      const row = store.get(key);
      if (!row) return null;
      return {
        body: new Blob([row.bytes]),
        httpMetadata: { contentType: row.contentType },
        arrayBuffer: async () => row.bytes,
      };
    },
    async list(opts?: { prefix?: string; cursor?: string; limit?: number }) {
      const keys = [...store.keys()]
        .filter((k) => !opts?.prefix || k.startsWith(opts.prefix))
        .sort();
      const start = opts?.cursor ? Number(opts.cursor) : 0;
      const limit = opts?.limit ?? 1000;
      const slice = keys.slice(start, start + limit);
      return {
        objects: slice.map((key) => ({ key })),
        truncated: start + limit < keys.length,
        cursor: String(start + limit),
      };
    },
  };
}

export type TestBucket = ReturnType<typeof makeBucket>;
