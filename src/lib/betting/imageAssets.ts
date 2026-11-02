/**
 * Pictures for the bot's cards — manager avatars, player headshots, team logos — fetched from
 * Sleeper's CDN on the server and handed to the renderer as data URIs.
 *
 * Built for a 1.9 GB box that already runs out of memory during builds, so every limit is explicit:
 *
 *  - at most MAX_INFLIGHT fetches at once across ALL requests, so several cards rendering together
 *    cannot open dozens of sockets;
 *  - a hard per-fetch timeout, after which the card draws initials rather than waiting;
 *  - nothing over MAX_BYTES is kept (a thumb is ~3–25 KB), and the cache is bounded by total bytes
 *    as well as entries, oldest out first;
 *  - a failure is remembered briefly, so a missing headshot is not refetched for every card.
 *
 * Every failure is a null, and every caller treats null as "draw the fallback". A picture is
 * decoration; it must never be the reason a card does not render.
 *
 * Only the Sleeper CDN, and only ids that are plain alphanumerics, so nothing a league member
 * types can steer the server's fetches anywhere else.
 */

const CDN = 'https://sleepercdn.com';
const MAX_INFLIGHT = 4;
let timeoutMs = 2500;
const MAX_BYTES = 80_000;
const CACHE_MAX_ENTRIES = 250;
const CACHE_MAX_BYTES = 6_000_000;
const HIT_TTL_MS = 24 * 60 * 60_000;
const MISS_TTL_MS = 60 * 60_000;

const SAFE_ID = /^[A-Za-z0-9]{1,64}$/;

export function avatarUrl(avatarId: string | null | undefined): string | null {
  return avatarId && SAFE_ID.test(avatarId) ? `${CDN}/avatars/thumbs/${avatarId}` : null;
}

export function headshotUrl(playerId: string | null | undefined): string | null {
  return playerId && SAFE_ID.test(playerId) ? `${CDN}/content/nfl/players/thumb/${playerId}.jpg` : null;
}

export function teamLogoUrl(team: string | null | undefined): string | null {
  return team && SAFE_ID.test(team) ? `${CDN}/images/team_logos/nfl/${team.toLowerCase()}.png` : null;
}

type Entry = { data: string | null; bytes: number; expires: number };

/** Insertion-ordered, so the first key is the oldest — evicted first. */
const cache = new Map<string, Entry>();
let cachedBytes = 0;

function remember(url: string, data: string | null) {
  const old = cache.get(url);
  if (old) {
    cachedBytes -= old.bytes;
    cache.delete(url);
  }
  const bytes = data?.length ?? 0;
  cache.set(url, { data, bytes, expires: Date.now() + (data ? HIT_TTL_MS : MISS_TTL_MS) });
  cachedBytes += bytes;
  while (cache.size > CACHE_MAX_ENTRIES || cachedBytes > CACHE_MAX_BYTES) {
    const [k, e] = cache.entries().next().value as [string, Entry];
    cache.delete(k);
    cachedBytes -= e.bytes;
  }
}

let inflight = 0;
const waiting: (() => void)[] = [];

async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (inflight >= MAX_INFLIGHT) await new Promise<void>(resolve => waiting.push(resolve));
  inflight++;
  try {
    return await fn();
  } finally {
    inflight--;
    waiting.shift()?.();
  }
}

/** The fetch to use; replaceable so tests never touch the network. */
let fetcher: typeof fetch = (...args) => fetch(...args);

export function setImageFetcherForTests(f: typeof fetch | null, opts: { timeoutMs?: number } = {}): void {
  fetcher = f ?? ((...args) => fetch(...args));
  timeoutMs = opts.timeoutMs ?? 2500;
  cache.clear();
  cachedBytes = 0;
}

export function imageCacheStats(): { entries: number; bytes: number; inflight: number } {
  return { entries: cache.size, bytes: cachedBytes, inflight };
}

/**
 * The image type from the file's own first bytes — never from the Content-Type header. Sleeper's CDN
 * labels its headshot thumbs (`.jpg`) image/jpeg while serving PNGs, and its avatars image/png while
 * serving JPEGs; satori trusts the data URI's type, and one mislabelled picture threw "Invalid JPEG"
 * and took the whole card down. Anything that is neither PNG nor JPEG is refused.
 */
export function sniffImageType(buf: Buffer): 'image/png' | 'image/jpeg' | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  return null;
}

/** One picture as a data URI, or null if it is missing, slow, too big or not an image. */
export async function fetchImage(url: string | null): Promise<string | null> {
  if (!url || !url.startsWith(`${CDN}/`)) return null;
  const hit = cache.get(url);
  if (hit && hit.expires > Date.now()) return hit.data;

  const data = await slot(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetcher(url, { signal: controller.signal });
      if (!res.ok) return null;
      const declared = Number(res.headers.get('content-length'));
      if (declared > MAX_BYTES) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0 || buf.length > MAX_BYTES) return null;
      const type = sniffImageType(buf);
      return type ? `data:${type};base64,${buf.toString('base64')}` : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  });
  remember(url, data);
  return data;
}

/** Several at once, through the same cap. Keys map to their picture, or null. */
export async function fetchImages(urls: Record<string, string | null>): Promise<Record<string, string | null>> {
  const keys = Object.keys(urls);
  const out = await Promise.all(keys.map(k => fetchImage(urls[k])));
  return Object.fromEntries(keys.map((k, i) => [k, out[i]]));
}
