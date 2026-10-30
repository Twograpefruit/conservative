import type { ApiError as ApiErrorBody } from '@ocg/protocol';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body: ApiErrorBody | Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init.body != null ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });
  const contentType = res.headers.get('content-type') ?? '';
  if (!res.ok) {
    let body: Record<string, unknown> = {};
    try {
      body = contentType.includes('json') ? await res.json() : { message: await res.text() };
    } catch {
      /* noop */
    }
    throw new ApiError(res.status, String(body.message ?? `HTTP ${res.status}`), body as unknown as ApiErrorBody);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function json(body: unknown): RequestInit {
  return { body: JSON.stringify(body) };
}

export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export async function streamNdjson<T>(
  path: string,
  body: unknown,
  onMessage: (msg: T) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    throw new ApiError(res.status, `HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      onMessage(JSON.parse(line) as T);
    }
  }
  if (buf.trim()) onMessage(JSON.parse(buf) as T);
}
