import type { Context } from 'hono';

export type Form = Record<string, string | string[] | File | (string | File)[]>;

export async function form(c: Context): Promise<Form> {
  return (await c.req.parseBody({ all: true })) as Form;
}

export function str(f: Form, k: string, max = 10_000): string {
  const v = f[k];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' ? s.slice(0, max) : '';
}

export function strs(f: Form, k: string): string[] {
  const v = f[k];
  if (Array.isArray(v)) return (v as unknown[]).filter((x): x is string => typeof x === "string");
  return typeof v === 'string' ? [v] : [];
}

export function idParam(c: Context, name = 'id'): number {
  const n = Number(c.req.param(name));
  if (!Number.isInteger(n) || n <= 0) throw new Error('ID が不正です');
  return n;
}

export function redirectFlash(c: Context, url: string, msg: { ok?: string; err?: string }) {
  const u = new URL(url, 'http://x');
  if (msg.ok) u.searchParams.set('ok', msg.ok.slice(0, 300));
  if (msg.err) u.searchParams.set('err', msg.err.slice(0, 500));
  return c.redirect(u.pathname + u.search);
}

export function flashOf(c: Context): { ok?: string; err?: string } {
  return { ok: c.req.query('ok') || undefined, err: c.req.query('err') || undefined };
}
