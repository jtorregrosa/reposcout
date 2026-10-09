import picomatch from 'picomatch';

const cache = new Map<string, picomatch.Matcher>();

const matcher = (glob: string): picomatch.Matcher => {
  let m = cache.get(glob);
  if (!m) {
    m = picomatch(glob, { dot: true, nocase: true });
    cache.set(glob, m);
  }
  return m;
};

export function matchesAny(path: string, globs: readonly string[]): boolean {
  return globs.some((g) => matcher(g)(path));
}
