import { spawn } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { startServer } from '../dashboard/server.js';
import { ROOT, UI_DIR } from '../paths.js';

export async function uiCommand({ port, open, config }: { port: number; open: boolean; config: string }): Promise<void> {
  let server: Awaited<ReturnType<typeof startServer>>;
  try {
    server = await startServer({
      root: ROOT,
      uiDir: UI_DIR,
      configPath: resolve(ROOT, config),
      port,
      // A run started from the page re-enters this CLI the way it was launched, under tsx in development too.
      deps: { cliArgs: [...process.execArgv, process.argv[1] as string] },
    });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EADDRINUSE')
      throw new Error(`port ${port} is in use; is the dashboard already open? Use --port to pick another.`);
    throw e;
  }
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  console.log(`RepoScout dashboard: ${url}  (local only, read-only; Ctrl+C to stop)`);
  if (open) {
    const [cmd, args]: [string, string[]] =
      process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
    spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true })
      .on('error', () => {})
      .unref();
  }
  await new Promise((resolveWait) => process.once('SIGINT', resolveWait));
  server.close();
}
