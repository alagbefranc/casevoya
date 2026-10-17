/** In-memory cookie jar shared by a test file. `resetCookieJar` clears it between tests. */
const jar = new Map<string, string>();

export function resetCookieJar() {
  jar.clear();
}

export async function cookies() {
  return {
    get(name: string) {
      return jar.has(name) ? { name, value: jar.get(name)! } : undefined;
    },
    getAll() {
      return [...jar].map(([name, value]) => ({ name, value }));
    },
    set(name: string, value: string) {
      jar.set(name, value);
    },
    delete(name: string) {
      jar.delete(name);
    },
  };
}

export async function headers() {
  return new Headers();
}
