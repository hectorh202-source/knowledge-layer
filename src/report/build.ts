import { auditDirectories, type DirectoryReport } from "../audit/directory-presence";
import { auditNap, type NapReport } from "../audit/nap";
import { verifyMarkup, type VerifyResult } from "../audit/verify-markup";
import { MANUAL_CHECKS } from "../audit/tier1";
import { loadProfile, validateProfile } from "../data/profile";
import { loadBrands, loadCredentials, loadFaqs, loadServiceAreas, loadServices } from "../data/content";
import { readSettings, readTier1 } from "../tenancy/store";

/**
 * The report a client actually receives.
 *
 * Everything else in this app is built for the operator. This is the artifact
 * that goes to the business owner, and it answers three questions in their
 * language: can AI find me, is my information consistent, and what did you
 * publish.
 *
 * TWO RULES.
 *
 * 1. No invented metrics. There is no visibility score, no grade, no
 *    percentage out of nowhere. Every number here traces to something measured,
 *    and where nothing was measured the report says so. A fabricated score is
 *    the easiest thing in the world to put on a page like this and the fastest
 *    way to make every other number on it untrustworthy.
 *
 * 2. Unknown is not failure and not success. Directory listings cannot be
 *    checked automatically, so they are reported as unconfirmed rather than
 *    dressed up either way — the same rule the audits themselves follow.
 *
 * The stored Tier 1 result is used rather than re-running the audit, because a
 * report should describe a check that happened at a stated time, not silently
 * perform a fresh one whose result nobody has reviewed.
 */

export interface ReportCheck {
  label: string;
  /** What this means for the business, in their language. */
  detail: string;
  state: "pass" | "fail" | "unknown";
}

export interface ReportAction {
  who: "us" | "you";
  what: string;
  why: string;
}

export interface ClientReport {
  business: string;
  domain: string;
  generatedAt: string;

  findable: {
    checks: ReportCheck[];
    ranAt: string | null;
    manualDone: number;
    manualTotal: number;
  };

  consistency: {
    checked: boolean;
    conflicts: number;
    fields: { field: string; agrees: boolean; values: { raw: string; sources: string[] }[] }[];
    note: string;
  };

  presence: {
    confirmed: number;
    total: number;
    found: { name: string; url: string }[];
    unconfirmed: string[];
  };

  published: {
    markup: VerifyResult["status"];
    markupUrl: string;
    services: number;
    areas: number;
    questions: number;
    credentials: number;
    openDays: number;
  };

  actions: ReportAction[];
}

/**
 * Plain-language rewrites, keyed by the real check ids from tier1.ts.
 *
 * The audit's own labels are written for the operator — "robots.txt allows AI
 * crawlers" assumes you know what that file is. These say what it means for the
 * business instead. Any id without an entry falls back to the audit's label
 * rather than showing a raw identifier.
 */
const CHECK_COPY: Record<string, { label: string; detail: string }> = {
  "site-up": {
    label: "Your website is reachable",
    detail: "If it is not, nothing else matters — an AI cannot read a page it cannot load.",
  },
  "no-login-wall": {
    label: "Pages are public",
    detail: "Content behind a login is invisible to every search and answer engine.",
  },
  robots: {
    label: "AI crawlers are allowed",
    detail: "A single line in a file called robots.txt can block them all without anyone noticing.",
  },
  "crawler-reach": {
    label: "AI crawlers can actually reach the site",
    detail:
      "Being allowed is not the same as getting through. Some hosting turns crawlers away before " +
      "the site ever sees them.",
  },
  sitemap: {
    label: "A sitemap is published",
    detail: "It tells search engines which pages exist rather than leaving them to guess.",
  },
  "contact-text": {
    label: "Your phone number is readable",
    detail: "A number inside an image cannot be read, quoted, or dialled from an answer.",
  },
  "services-page": {
    label: "A page saying what you do",
    detail: "An assistant cannot recommend you for work it cannot tell you perform.",
  },
  "areas-page": {
    label: "A page saying where you work",
    detail: "Most of these searches are local. Coverage has to be stated, not implied.",
  },
  credentials: {
    label: "Licensing is stated",
    detail: "Assistants qualify recommendations with it, and customers ask for it.",
  },
};

export async function buildReport(tenant: string): Promise<ClientReport> {
  const settings = readSettings(tenant);
  if (!settings) throw new Error(`No client "${tenant}".`);

  const profile = loadProfile(tenant);
  const validation = profile ? validateProfile(profile) : { blocking: ["no profile"], missing: [] };

  const approved = <T extends { approved: boolean; published?: boolean }>(items: T[]): T[] =>
    items.filter((item) => item.approved && item.published);

  // The audits. Run in parallel — two of them are network-bound and there is no
  // reason for a report to take twice as long as its slowest check.
  const [nap, markup] = await Promise.all([
    auditNap(tenant).catch(() => null),
    verifyMarkup(tenant).catch(() => null),
  ]);
  const directories: DirectoryReport = auditDirectories(tenant);

  const tier1 = readTier1(tenant);
  const stored = tier1.report as
    | { ranAt?: string; checks?: { id: string; label: string; state: string; detail?: string }[] }
    | null;

  const checks: ReportCheck[] = (stored?.checks ?? []).map((check) => {
    const copy = CHECK_COPY[check.id];
    return {
      // Fall back to the audit's own label. A raw id in a client-facing
      // document is worse than operator phrasing.
      label: copy?.label ?? check.label,
      detail: copy?.detail ?? "",
      // The audit has a third state, warn, for something present but weak.
      // Collapsing it into fail would overstate the problem in a document the
      // client reads as a verdict.
      state: check.state === "pass" ? "pass" : check.state === "fail" ? "fail" : "unknown",
    };
  });

  const actions = buildActions({
    validation,
    nap,
    directories,
    markup,
    manualOutstanding: MANUAL_CHECKS.length - MANUAL_CHECKS.filter((c) => tier1.manual[c.id]?.checked).length,
  });

  return {
    business: profile?.name || settings.name || tenant,
    domain: settings.domain,
    generatedAt: new Date().toISOString(),

    findable: {
      checks,
      ranAt: stored?.ranAt ?? null,
      manualDone: MANUAL_CHECKS.filter((c) => tier1.manual[c.id]?.checked).length,
      manualTotal: MANUAL_CHECKS.length,
    },

    consistency: {
      checked: nap !== null,
      conflicts: nap?.conflicts ?? 0,
      fields:
        nap?.findings.map((finding) => ({
          field: finding.field,
          agrees: finding.agrees,
          values: finding.groups.map((group) => ({ raw: group.raw, sources: group.sources })),
        })) ?? [],
      // Said plainly, because "corroboration" is our word, not the client's.
      note:
        nap && nap.conflicts === 0
          ? "Your name, address and phone match everywhere we can see them."
          : "Where these disagree, a search engine may treat you as two different businesses.",
    },

    presence: {
      confirmed: directories.found,
      total: directories.entries.length,
      found: directories.entries
        .filter((entry) => entry.state === "found" && entry.url)
        .map((entry) => ({ name: entry.name, url: entry.url as string })),
      unconfirmed: directories.entries
        .filter((entry) => entry.state !== "found")
        .map((entry) => entry.name),
    },

    published: {
      markup: markup?.status ?? "missing",
      markupUrl: markup?.url ?? `https://${settings.domain}`,
      services: approved(loadServices(tenant)).length,
      areas: approved(loadServiceAreas(tenant)).length,
      questions: approved(loadFaqs(tenant)).length,
      credentials: approved(loadCredentials(tenant)).length,
      openDays: profile ? profile.hours.filter((h) => !h.isClosed).length : 0,
    },

    actions,
  };
}

/**
 * What happens next, split by who does it.
 *
 * A report that only lists problems reads as a bill of complaints. Splitting by
 * owner turns it into a plan, and makes visible that most of the remaining work
 * is ours.
 */
function buildActions(input: {
  validation: { blocking: string[]; missing: string[] };
  nap: NapReport | null;
  directories: DirectoryReport;
  markup: VerifyResult | null;
  manualOutstanding: number;
}): ReportAction[] {
  const actions: ReportAction[] = [];

  if (input.markup && input.markup.status !== "current") {
    actions.push({
      who: "us",
      what: "Publish your business details to the site in a format AI can read",
      why: "Without it an assistant has to guess your hours and coverage from prose, or skip you.",
    });
  }

  if (input.nap && input.nap.conflicts > 0) {
    actions.push({
      who: "you",
      what: "Confirm which version of your details is correct",
      why: "They differ between your site and your Google listing, and we should not guess which is right.",
    });
  }

  if (input.directories.entries.length - input.directories.found > 0) {
    actions.push({
      who: "us",
      what: `Check and claim your listings on ${input.directories.entries.length - input.directories.found} directories`,
      why:
        "When someone asks an assistant for a recommendation, it usually reads directory pages. " +
        "A business missing from them is not considered at all.",
    });
  }

  if (input.validation.missing.some((field) => field.startsWith("priceRange"))) {
    actions.push({
      who: "you",
      what: "Decide what pricing you are willing to publish",
      why:
        "Assistants quote the businesses that publish numbers. A starting price or a minimum charge " +
        "is usually enough, and competitors who do this get named where you do not.",
    });
  }

  if (input.validation.blocking.length > 0) {
    actions.push({
      who: "us",
      what: "Fill the remaining gaps in your business record",
      why: "Until these are in place there is not enough for an assistant to identify you confidently.",
    });
  }

  if (input.manualOutstanding > 0) {
    actions.push({
      who: "us",
      what: `Complete ${input.manualOutstanding} checks that need account access`,
      why: "Google Search Console and your business profile can only be verified from inside those accounts.",
    });
  }

  return actions;
}
