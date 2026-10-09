import { existsSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

export interface StaticAsset {
  file: string;
  type: string;
  // Vite fingerprints everything under assets/, so those files never change under the same name.
  immutable: boolean;
}

// Maps a request path to a file of the built web app. A path with no extension is a client-side route and gets
// index.html; anything resolving outside the build directory is refused.
export function resolveAsset(uiDir: string, pathname: string): StaticAsset | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const root = resolve(uiDir);
  const target = resolve(root, `.${decoded}`);
  if (target !== root && !target.startsWith(root + sep)) return null;
  const ext = extname(target).toLowerCase();
  if (ext && existsSync(target) && statSync(target).isFile()) {
    const type = TYPES[ext];
    return type ? { file: target, type, immutable: decoded.startsWith('/assets/') } : null;
  }
  if (ext) return null;
  const index = resolve(root, 'index.html');
  return existsSync(index) ? { file: index, type: TYPES['.html'] as string, immutable: false } : null;
}
