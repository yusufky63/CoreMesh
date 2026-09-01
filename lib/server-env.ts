import { env } from 'cloudflare:workers';

export function getServerSecret(key: string) {
  const bindings = env as unknown as Record<string, string | undefined>;
  return bindings[key] || process.env[key];
}
