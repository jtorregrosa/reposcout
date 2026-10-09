import { type ChildProcess, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

// In development the page is served by Vite and the API by `reposcout ui` on its default port. The server only
// accepts its own Host and Origin, so the proxy presents the request as same-origin.
const API_PORT = 4477;
const API = `http://127.0.0.1:${API_PORT}`;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
// The tool version a SARIF export names.
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };

const listening = (port: number) =>
  new Promise<boolean>((resolve) => {
    const socket = connect(port, '127.0.0.1');
    socket.once('connect', () => resolve(!socket.destroy()));
    socket.once('error', () => resolve(false));
  });

// Starts `reposcout ui` from the sources when nothing answers on its port, so `pnpm dev:web` works on its own.
// An API server already running (built, or started by hand) is used as is and left alone.
function reposcoutApi(): Plugin {
  let child: ChildProcess | null = null;
  return {
    name: 'reposcout-api',
    apply: 'serve',
    async configureServer(server) {
      if (await listening(API_PORT)) {
        server.config.logger.info(`  reposcout ui already running on ${API}`);
        return;
      }
      child = spawn(process.execPath, ['--import', 'tsx', 'src/cli.ts', 'ui', '--no-open', '--port', String(API_PORT)], {
        cwd: ROOT,
        stdio: 'inherit',
        windowsHide: true,
      });
      child.on('exit', (code) => {
        if (code) server.config.logger.error(`reposcout ui exited with code ${code}; the dashboard has no API until it runs again.`);
        child = null;
      });
      const stop = () => child?.kill();
      server.httpServer?.once('close', stop);
      process.once('exit', stop);
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), reposcoutApi()],
  define: { __REPOSCOUT_VERSION__: JSON.stringify(version) },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: API,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (req) => {
            if (req.getHeader('origin')) req.setHeader('origin', API);
            req.removeHeader('sec-fetch-site');
          });
        },
      },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: true },
});
