/**
 * Our own domain shapes — deliberately NOT ServiceTitan's.
 *
 * Everything downstream of normalization speaks these types. When the real
 * export lands and ServiceTitan's actual field names turn out to differ from
 * the mock's, only `normalize.ts` changes. See OPEN-QUESTIONS.md 4.5.
 */

export interface JobType {
  id: number;
  name: string;
  businessUnitIds: number[];
}

export interface Job {
  id: number;
  jobTypeId: number | null;
  businessUnitId: number | null;
  completedOn: string | null;
  leadSource: string | null;
}

export interface Invoice {
  id: number;
  /** Null when the invoice carries no job reference — tracked as a coverage gap. */
  jobId: number | null;
  /** Pre-tax. This is the number that means "what the work sold for". */
  subTotal: number;
  total: number;
  invoiceDate: string | null;
}

export interface Dataset {
  jobTypes: JobType[];
  jobs: Job[];
  invoices: Invoice[];
  source: {
    dir: string;
    environment: string;
    mock: boolean;
  };
}

/** Distribution summary for a set of dollar amounts. */
export interface Distribution {
  n: number;
  min: number;
  p10: number;
  p25: number;
  median: number;
  p75: number;
  p90: number;
  max: number;
  mean: number;
  total: number;
}

export interface JobTypeRevenue {
  jobTypeId: number;
  jobTypeName: string;
  /** Invoices successfully joined to a job of this type. */
  invoiceCount: number;
  /** Completed jobs of this type, including any with no invoice. */
  jobCount: number;
  revenue: number;
  revenueShare: number;
  distribution: Distribution;
  /** Defensible range to publish, derived from p10–p90 and rounded outward. */
  publishRange: { low: number; high: number };
  /** Set when the sample is too small to publish a range from. */
  thinSample: boolean;
}

export interface CoverageReport {
  jobs: number;
  invoices: number;
  invoicesJoined: number;
  invoicesOrphaned: number;
  invoicesWithoutJobRef: number;
  jobsWithoutInvoice: number;
  jobsWithoutType: number;
}

export interface RevenueReport {
  generatedAt: string;
  source: Dataset["source"];
  coverage: CoverageReport;
  totalRevenue: number;
  byRevenue: JobTypeRevenue[];
  byVolume: JobTypeRevenue[];
  /** Job types making up the first 80% of revenue. */
  topEightyPercent: string[];
  warnings: string[];
}
