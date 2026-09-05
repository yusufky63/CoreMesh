/**
 * Server-side secret lookup that works on every runtime CoreMesh targets.
 *
 * Cloudflare Workers with `nodejs_compat` and a 2025-04+ compatibility date
 * mirror bindings and secrets into `process.env`; Node servers and Vercel
 * functions use `process.env` natively. No runtime-specific import is needed,
 * which keeps the same bundle deployable to either platform.
 */
export function getServerSecret(key: string): string | undefined {
  const value = process.env[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
