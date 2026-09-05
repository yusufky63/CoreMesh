export const coreMeshPaths: Record<string, string> = {
  landing: '/',
  pulse: '/pulse',
  rooms: '/rooms',
  messages: '/messages',
  agents: '/agents',
  tasks: '/tasks',
  workers: '/workers',
  network: '/network',
  proofs: '/proofs',
  deals: '/deals',
  vault: '/vault',
  runtimes: '/runtimes',
  providers: '/providers',
  'how-it-works': '/how-it-works',
  settings: '/settings',
};

const detailViews = new Set([
  'rooms',
  'messages',
  'agents',
  'tasks',
  'workers',
  'proofs',
  'deals',
]);

export function coreMeshPath(view: string, selectedId?: string) {
  const base = coreMeshPaths[view] || '/pulse';
  return selectedId && detailViews.has(view)
    ? `${base}/${encodeURIComponent(selectedId)}`
    : base;
}

export function coreMeshLocation(pathname: string): {
  view: string;
  selectedId?: string;
} {
  const matched = Object.entries(coreMeshPaths)
    .filter(([, path]) => path !== '/')
    .sort((a, b) => b[1].length - a[1].length)
    .find(([, path]) => pathname === path || pathname.startsWith(`${path}/`));
  if (!matched)
    return pathname === '/' ? { view: 'landing' } : { view: 'pulse' };
  const [view, base] = matched;
  const rawDetail = pathname.slice(base.length + 1);
  if (!rawDetail || !detailViews.has(view)) return { view };
  try {
    return { view, selectedId: decodeURIComponent(rawDetail) };
  } catch {
    return { view };
  }
}
