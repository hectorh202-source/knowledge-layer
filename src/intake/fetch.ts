/**
 * Polite fetching.
 *
 * We're crawling other people's websites — customers' sites, but still sites we
 * don't operate. Respecting robots.txt and rate limiting isn't optional
 * politeness here: this runs from your infrastructure against many customers,
 * and a crawler that ignores robots is one complaint away from an IP block that
 * breaks the product for everyone.
 */

const USER_AGENT =
  "KnowledgeLayerBot/0.1 (+business knowledge extraction; contact site owner)";

const TIMEOUT_MS = 15_000;
const DEFAULT_DELAY_MS = 1_000;

export interface FetchedPage {
  url: string;
  status: number;
  html: string;
}

export class PoliteFetcher {
  private disallowed: string[] = [];
  private lastFetchAt = 0;
  private robotsLoaded = false;

  constructor(
    private origin: string,
    private delayMs: number = DEFAULT_DELAY_MS
  ) {}

  private async throttle(): Promise<void> {
    const elapsed = Date.now() - this.lastFetchAt;
    if (elapsed < this.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs - elapsed));
    }
    this.lastFetchAt = Date.now();
  }

  /**
   * Loads robots.txt.
   *
   * Deliberately conservative parsing: we collect Disallow rules from both the
   * wildcard group and any group naming us, and we don't implement Allow
   * overrides. Erring toward not fetching is the right direction for a bot
   * running against customer sites.
   */
  async loadRobots(): Promise<void> {
    if (this.robotsLoaded) return;
    this.robotsLoaded = true;

    try {
      const response = await this.rawFetch(`${this.origin}/robots.txt`);
      if (response.status !== 200) return;

      let applies = false;
      for (const rawLine of response.html.split("\n")) {
        const line = rawLine.split("#")[0].trim();
        if (line === "") continue;

        const [rawKey, ...rest] = line.split(":");
        const key = rawKey.trim().toLowerCase();
        const value = rest.join(":").trim();

        if (key === "user-agent") {
          applies = value === "*" || value.toLowerCase().includes("knowledgelayer");
        } else if (key === "disallow" && applies && value !== "") {
          this.disallowed.push(value);
        }
      }
    } catch {
      // No robots.txt, or unreachable. Proceed — absence is permission.
    }
  }

  isAllowed(url: string): boolean {
    let pathname: string;
    try {
      pathname = new URL(url).pathname;
    } catch {
      return false;
    }
    return !this.disallowed.some((rule) => pathname.startsWith(rule));
  }

  private async rawFetch(url: string): Promise<FetchedPage> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });

      const html = await response.text();
      return { url: response.url || url, status: response.status, html };
    } finally {
      clearTimeout(timer);
    }
  }

  async get(url: string): Promise<FetchedPage> {
    await this.loadRobots();

    if (!this.isAllowed(url)) {
      throw new Error("disallowed by robots.txt");
    }

    await this.throttle();
    return this.rawFetch(url);
  }
}
