import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { agenciesEnabled, mayAccess, type Agency } from "../tenancy/agency";
import {
  accountFor,
  billingEnabled,
  dueNow,
  invoiceClient,
  invoicesFor,
  listPlans,
  markPaid,
  saveAccount,
  slugForInvoice,
  slugForSubscription,
  subscribe,
  summary,
  updateSubscription,
  voidInvoice,
} from "../billing/store";

/**
 * Billing routes.
 *
 * Split from the main admin router because billing is the one area where a
 * mistake costs money rather than a re-run, and keeping it in its own file
 * makes "what can touch an invoice" a question with a short answer.
 *
 * Mounted inside the authenticated admin API, so every request here has
 * already been through sign-in and the agency guard.
 */

/** Dollars from a form to integer cents, refusing anything that is not money. */
function cents(value: unknown, field: string): number {
  const n = typeof value === "number" ? value : Number(String(value ?? "").replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) throw new Error(`${field} must be an amount, like 800 or 800.00.`);
  // Rounded rather than truncated: 8.005 entered from a spreadsheet should be
  // 801 cents, not 800. Off-by-one-cent errors in an invoice erode trust in
  // every other number on it.
  return Math.round(n * 100);
}

interface AgencyRequest extends Request {
  agency?: Agency | null;
}

export function billingRoutes(visibleSlugs: (req: Request) => Promise<string[]>): Router {
  const router = express.Router();

  // One guard for the whole surface. Every route below needs the database, and
  // failing once with a clear message beats five different errors.
  router.use((_req: Request, res: Response, next) => {
    if (!billingEnabled()) {
      res.status(503).json({
        error: "billing_unavailable",
        message:
          "Billing needs Supabase. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env, " +
          "then apply the billing migration.",
      });
      return;
    }
    next();
  });

  /**
   * The agency guard again, because the one in the main router is bound to
   * "/clients/:slug" and these routes live at "/billing/clients/:slug" — a
   * different path, so it never fires here.
   *
   * Writing it out a second time is worse than reusing it, and reusing it is
   * not possible without restructuring the mount. Of the two, a duplicated
   * guard is the mistake that fails safe; the missing one hands another
   * agency's invoices to whoever guesses a slug.
   */
  router.use("/clients/:slug", (req: AgencyRequest, res: Response, next: NextFunction) => {
    void (async () => {
      try {
        if (!agenciesEnabled()) return next();
        if (!(await mayAccess(req.agency?.id ?? null, req.params.slug))) {
          res.status(404).json({ error: "not_found" });
          return;
        }
        next();
      } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
      }
    })();
  });

  /**
   * The same check, for routes that address a row by id rather than by slug.
   *
   * A UUID is not an access control. It is a bet that one never reaches the
   * wrong window — and these rows are invoices, so the bet is not worth taking
   * when the lookup costs one query.
   */
  const ownsRow = async (
    req: AgencyRequest,
    res: Response,
    lookup: (id: string) => Promise<string | null>
  ): Promise<boolean> => {
    if (!agenciesEnabled()) return true;
    const slug = await lookup(req.params.id);
    if (slug && (await mayAccess(req.agency?.id ?? null, slug))) return true;
    res.status(404).json({ error: "not_found" });
    return false;
  };

  /** The billing page: every client, what they pay, what is outstanding. */
  router.get("/", async (req: Request, res: Response) => {
    try {
      const slugs = await visibleSlugs(req);
      const [data, plans] = await Promise.all([summary(slugs), listPlans()]);
      res.json({ ...data, plans, due: await dueNow(slugs) });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  /** One client's billing: account, subscription, invoice history. */
  router.get("/clients/:slug", async (req: Request, res: Response) => {
    try {
      const [found, invoices, plans] = await Promise.all([
        accountFor(req.params.slug),
        invoicesFor(req.params.slug),
        listPlans(),
      ]);
      res.json({
        account: found?.account ?? null,
        subscription: found?.subscription ?? null,
        invoices,
        plans,
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.put("/clients/:slug/account", async (req: Request, res: Response) => {
    try {
      const account = await saveAccount(req.params.slug, {
        companyName: String(req.body?.companyName ?? ""),
        contactName: String(req.body?.contactName ?? ""),
        contactEmail: String(req.body?.contactEmail ?? ""),
        notes: String(req.body?.notes ?? ""),
      });
      res.json({ account });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post("/clients/:slug/subscription", async (req: Request, res: Response) => {
    try {
      const { planId, monthly, setup, interval, startedOn } = req.body ?? {};
      if (!planId) throw new Error("Pick a plan.");

      // Blank means "use the plan's price". Zero is a real answer and must not
      // be swallowed by a falsy check — a free client is a decision someone
      // made, and it should survive being typed.
      const override =
        monthly === "" || monthly === null || monthly === undefined
          ? null
          : cents(monthly, "Monthly");

      const subscription = await subscribe(req.params.slug, {
        planId: String(planId),
        monthlyCents: override,
        setupCents: setup === "" || setup === undefined ? undefined : cents(setup, "Setup"),
        interval: interval === "annual" ? "annual" : "monthly",
        startedOn: startedOn ? String(startedOn) : undefined,
      });

      res.json({ subscription });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.patch("/subscriptions/:id", async (req: AgencyRequest, res: Response) => {
    try {
      if (!(await ownsRow(req, res, slugForSubscription))) return;
      const { status, monthly } = req.body ?? {};
      await updateSubscription(req.params.id, {
        status,
        monthlyCents:
          monthly === undefined ? undefined : monthly === "" ? null : cents(monthly, "Monthly"),
      });
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  /**
   * Raise this client's next invoice.
   *
   * Returns `{invoice: null}` rather than an error when nothing is due. Billing
   * the same period twice is the failure that matters here, and a route that
   * quietly does nothing is the right shape for a button someone may press
   * twice.
   */
  router.post("/clients/:slug/invoice", async (req: Request, res: Response) => {
    try {
      const invoice = await invoiceClient(req.params.slug, {
        dueDays: Number(req.body?.dueDays ?? 14),
      });
      res.json({ invoice });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  /**
   * Bill everyone who is due.
   *
   * Each client is invoiced independently and a failure is reported rather than
   * thrown: one client with a broken subscription must not stop the other
   * forty-nine from being billed this month.
   */
  router.post("/run", async (req: Request, res: Response) => {
    try {
      const slugs = await dueNow(await visibleSlugs(req));
      const issued: { slug: string; number: string; totalCents: number }[] = [];
      const failed: { slug: string; error: string }[] = [];

      for (const slug of slugs) {
        try {
          const invoice = await invoiceClient(slug, { dueDays: Number(req.body?.dueDays ?? 14) });
          if (invoice) {
            issued.push({ slug, number: invoice.number, totalCents: invoice.totalCents });
          }
        } catch (error) {
          failed.push({ slug, error: error instanceof Error ? error.message : String(error) });
        }
      }

      res.json({ issued, failed });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post("/invoices/:id/paid", async (req: AgencyRequest, res: Response) => {
    try {
      if (!(await ownsRow(req, res, slugForInvoice))) return;
      await markPaid(req.params.id, String(req.body?.method ?? ""));
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post("/invoices/:id/void", async (req: AgencyRequest, res: Response) => {
    try {
      if (!(await ownsRow(req, res, slugForInvoice))) return;
      await voidInvoice(req.params.id);
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  return router;
}
