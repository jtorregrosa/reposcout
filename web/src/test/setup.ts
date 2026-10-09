import '@testing-library/jest-dom/vitest';
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// jest-dom declares its matchers on a 'vitest' it cannot resolve from pnpm's store, so the typecheck never sees
// them; declared here, 'vitest' resolves to the root's.
declare module 'vitest' {
  interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown> extends TestingLibraryMatchers<T, R> {}
}

// Pages are lazy chunks; the first one a test opens takes longer than the default second to appear.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// jsdom lacks the layout and media APIs Radix and the theme read. Width queries match, so pages lay out as on a
// desktop, where the findings list and the detail sit side by side.
window.matchMedia ??= ((query: string) => ({
  matches: query.includes('min-width'),
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

Element.prototype.scrollIntoView ??= () => {};
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
