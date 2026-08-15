/**
 * What we pull out of ServiceTitan, and why.
 *
 * This is a data table on purpose. Endpoint paths and filter parameter names are
 * the parts most likely to be wrong on the first run, and a table is far easier
 * to correct than logic scattered across a dozen scripts.
 *
 * Targets marked `uncertain` are ones where the path or query params are an
 * educated guess. The runner records failures and keeps going rather than
 * aborting, so one bad path does not cost you the whole export.
 */

export type ServiceTitanModule =
  | "pricebook"
  | "settings"
  | "jpm"
  | "crm"
  | "dispatch"
  | "accounting";

export interface ExportTarget {
  /** Output filename (without extension) and CLI selector for --only. */
  name: string;
  module: ServiceTitanModule;
  path: string;
  query?: Record<string, string | number | undefined>;
  /** Which open question or build step this export feeds. */
  why: string;
  /** Set when the path or params are unverified. */
  uncertain?: string;
  /** Skipped unless --include-large is passed. */
  large?: boolean;
}

/** ISO date for N months ago, used for the job/invoice history window. */
export function monthsAgoIso(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString();
}

export function buildTargets(historyMonths: number): ExportTarget[] {
  const since = monthsAgoIso(historyMonths);

  return [
    // ---- The service catalog itself -------------------------------------
    {
      name: "pricebook-services",
      module: "pricebook",
      path: "/services",
      why: "The real service list, in TitanZ's own naming. Seeds the `services` table.",
    },
    {
      name: "pricebook-categories",
      module: "pricebook",
      path: "/categories",
      why: "How services are grouped. Likely maps to service-page structure on the site.",
    },
    {
      name: "pricebook-equipment",
      module: "pricebook",
      path: "/equipment",
      why: "Brands and equipment serviced — feeds the brands_serviced content.",
    },
    {
      name: "pricebook-materials",
      module: "pricebook",
      path: "/materials",
      why: "Parts and costs. Useful for pricing breakdowns; can be very large.",
      large: true,
    },

    // ---- How the business is organized ----------------------------------
    {
      name: "business-units",
      module: "settings",
      path: "/business-units",
      why: "Divisions of the business. Often the real boundary between service lines.",
    },
    {
      name: "job-types",
      module: "jpm",
      path: "/job-types",
      why: "How work is actually categorized. The join key for revenue-by-service.",
    },
    {
      name: "technicians",
      module: "settings",
      path: "/technicians",
      why: "Skills and capacity. Relevant later for availability by required skill set.",
    },

    // ---- Geography -------------------------------------------------------
    {
      name: "zones",
      module: "dispatch",
      path: "/zones",
      why: "Real service-area geography. Answers OPEN-QUESTIONS 4.x — ZIPs vs 'and surrounding areas'.",
      uncertain: "Zones may be defined by ZIP, by polygon, or barely configured at all.",
    },

    // ---- Revenue history -------------------------------------------------
    {
      name: "jobs-completed",
      module: "jpm",
      path: "/jobs",
      query: { completedOnOrAfter: since, jobStatus: "Completed" },
      why: "Completed job history. With invoices, answers 4.1 (top revenue service) and 4.3 (real price ranges).",
      uncertain:
        "Filter param names are unverified — may be completedOnOrAfter / completedOnAfter, and jobStatus casing may differ.",
      large: true,
    },
    {
      name: "invoices",
      module: "accounting",
      path: "/invoices",
      query: { createdOnOrAfter: since },
      why: "Where the money actually lives. Join to jobs on jobId to get revenue per job type.",
      uncertain:
        "Revenue is on invoices, not jobs — join key and date filter param both need confirming on first run.",
      large: true,
    },
  ];
}
