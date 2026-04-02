import { apiConfig } from '@/config/api';

/** Normalized cluster identity for per-cluster limits (no trailing slash). */
export function clusterKeyFromBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, '');
}

class Semaphore {
  private running = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async acquire(): Promise<void> {
    if (this.running < this.max) {
      this.running++;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.running++;
  }

  release(): void {
    this.running--;
    const next = this.waiters.shift();
    if (next) next();
  }
}

const semaphores = new Map<string, Semaphore>();

function getSemaphore(clusterKey: string): Semaphore {
  let s = semaphores.get(clusterKey);
  if (!s) {
    const max = Math.max(1, apiConfig.clusterMaxConcurrentRequests ?? 4);
    s = new Semaphore(max);
    semaphores.set(clusterKey, s);
  }
  return s;
}

const inflight = new Map<string, Promise<Response>>();
const lastRunAt = new Map<string, number>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Cluster-wide fetch guard: concurrency limit, optional in-flight dedupe + cooldown (GET only when no AbortSignal).
 * Joiners receive a cloned Response so each caller can read the body.
 */
export async function runClusterGovernedFetch(
  clusterKey: string,
  url: string,
  method: string,
  fetcher: () => Promise<Response>,
  abortSignal?: AbortSignal | null
): Promise<Response> {
  const dedupeKey = `${clusterKey}::${method}:${url}`;

  if (abortSignal) {
    const sem = getSemaphore(clusterKey);
    await sem.acquire();
    try {
      if (abortSignal.aborted) throw new DOMException('Aborted', 'AbortError');
      return await fetcher();
    } finally {
      sem.release();
    }
  }

  const existing = inflight.get(dedupeKey);
  if (existing) {
    return existing.then((r) => r.clone());
  }

  let resolve!: (r: Response) => void;
  let reject!: (e: unknown) => void;
  const p = new Promise<Response>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  inflight.set(dedupeKey, p);

  void (async () => {
    try {
      const cooldownMs = Math.max(0, apiConfig.clusterRequestCooldownMs ?? 0);
      const last = lastRunAt.get(dedupeKey);
      const now = Date.now();
      if (last != null && cooldownMs > 0 && now - last < cooldownMs) {
        await sleep(cooldownMs - (now - last));
      }

      const sem = getSemaphore(clusterKey);
      await sem.acquire();
      try {
        const response = await fetcher();
        resolve(response);
      } catch (e) {
        reject(e);
      } finally {
        inflight.delete(dedupeKey);
        lastRunAt.set(dedupeKey, Date.now());
        sem.release();
      }
    } catch (e) {
      inflight.delete(dedupeKey);
      lastRunAt.set(dedupeKey, Date.now());
      reject(e);
    }
  })();

  return p.then((r) => r.clone());
}
