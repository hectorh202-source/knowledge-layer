import { stRequest, ServiceTitanApiError } from "./auth";

/**
 * Paginated fetch helper for ServiceTitan list endpoints.
 *
 * Deliberately conservative about request rate. This app shares a ServiceTitan
 * tenant with the live voice booking agent, and throttling the phone system
 * mid-call is the worst outcome available to us. See OPEN-QUESTIONS.md 10.1.
 */

/** Standard ServiceTitan list envelope. */
export interface PagedResponse<T> {
  page: number;
  pageSize: number;
  totalCount: number | null;
  hasMore: boolean;
  data: T[];
}

export interface PaginateOptions {
  /** Records per request. ServiceTitan caps this per-endpoint; 200 is safe everywhere. */
  pageSize?: number;
  /** Pause between page requests, in ms. This is the main throttle. */
  delayMs?: number;
  /** Safety stop so a pagination bug can't loop forever. */
  maxPages?: number;
  /** Called after each page, for progress output. */
  onPage?: (info: { page: number; received: number; total: number }) => void;
}

const DEFAULT_PAGE_SIZE = 200;
const DEFAULT_DELAY_MS = 500;
const DEFAULT_MAX_PAGES = 500;

const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 2_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs a request, backing off on 429 and 5xx.
 *
 * Note: the copied auth client throws on >=400 without exposing response headers,
 * so we cannot read `Retry-After` and fall back to exponential backoff instead.
 * Tracked in OPEN-QUESTIONS.md 10.4.
 */
async function requestWithRetry<T>(
  basePath: string,
  path: string,
  query: Record<string, string | number | undefined>
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await stRequest<T>("GET", basePath, path, { query });
    } catch (error) {
      lastError = error;

      const retryable =
        error instanceof ServiceTitanApiError &&
        (error.status === 429 || error.status >= 500);

      if (!retryable || attempt === MAX_RETRIES) {
        throw error;
      }

      const backoff = BASE_BACKOFF_MS * 2 ** attempt;
      const status = (error as ServiceTitanApiError).status;
      console.warn(`    ${status} received, backing off ${backoff}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
      await sleep(backoff);
    }
  }

  throw lastError;
}

/**
 * Walks every page of a list endpoint and returns the accumulated records.
 *
 * Stops on `hasMore: false`, on an empty page, or at `maxPages` — whichever
 * comes first. Some ServiceTitan endpoints omit `hasMore`, so the empty-page
 * check is the real backstop.
 */
export async function fetchAllPages<T = unknown>(
  basePath: string,
  path: string,
  query: Record<string, string | number | undefined> = {},
  options: PaginateOptions = {}
): Promise<T[]> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;

  const records: T[] = [];
  let page = 1;

  while (page <= maxPages) {
    const response = await requestWithRetry<PagedResponse<T>>(basePath, path, {
      ...query,
      page,
      pageSize,
    });

    const batch = response.data ?? [];
    records.push(...batch);

    options.onPage?.({
      page,
      received: batch.length,
      total: records.length,
    });

    const done = batch.length === 0 || response.hasMore === false;
    if (done) break;

    page++;
    // Throttle between pages, not after the last one.
    await sleep(delayMs);
  }

  if (page > maxPages) {
    console.warn(`    stopped at maxPages=${maxPages} — results may be incomplete`);
  }

  return records;
}
