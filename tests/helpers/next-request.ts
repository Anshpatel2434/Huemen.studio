/**
 * Stand-ins for the Next request plumbing that only exists inside a running
 * server: the cookie jar behind `cookies()` / `headers()` (next/headers) and
 * the page-cache invalidation `revalidatePath` (next/cache), which throws
 * outside a request ("static generation store missing").
 *
 * Nothing about WHO is asking is faked here. A test puts a cookie in the jar
 * (made by the app's own encoder, lib/auth startSession) and the real
 * getSession / resolveScope / data layer read it as they would in production.
 */

/** The request's cookies: name to value. Tests set it before each call. */
export const jar = new Map<string, string>();

type CookieOptions = Record<string, unknown>;

const store = {
  get(name: string) {
    return jar.has(name) ? { name, value: jar.get(name)! } : undefined;
  },
  getAll() {
    return [...jar].map(([name, value]) => ({ name, value }));
  },
  has(name: string) {
    return jar.has(name);
  },
  set(nameOrCookie: string | ({ name: string; value: string } & CookieOptions), value?: string) {
    if (typeof nameOrCookie === "string") jar.set(nameOrCookie, value ?? "");
    else jar.set(nameOrCookie.name, nameOrCookie.value);
    return store;
  },
  delete(name: string | { name: string }) {
    jar.delete(typeof name === "string" ? name : name.name);
    return store;
  },
  toString() {
    return [...jar].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; ");
  },
};

/** The next/headers module, as the app imports it. */
export const nextHeaders = {
  cookies: async () => store,
  headers: async () => new Headers(jar.size ? { cookie: store.toString() } : {}),
  draftMode: async () => ({ isEnabled: false, enable() {}, disable() {} }),
};

/** Paths the code under test asked to revalidate (the page cache is not under test). */
export const revalidated: string[] = [];

/** The next/cache module, as the app imports it. */
export const nextCache = {
  revalidatePath: (path: string) => {
    revalidated.push(path);
  },
  revalidateTag: () => undefined,
  updateTag: () => undefined,
  refresh: () => undefined,
};
