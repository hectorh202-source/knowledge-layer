import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { agenciesEnabled, mayAccess, type Agency } from "../tenancy/agency";
import {
  accountFor,
  billingEnabled,
  clientBilling,
  ensureCustomerFor,
  saveAccount,
  startBilling,
  summary,
} from "../billing/store";
import {
  billingPortalUrl,
  cancelSubscription,
  dashboardCustomerUrl,
  dashboardSubscriptionUrl,
  ping,
  resumeSubscription,
  seedCatalog,
  stripeEnabled,
  stripeMode,
  subscriptionFor,
} from "../billing/stripe";

/**
 * Billing routes.
 *
 * Small, because Stripe does the work. Putting a client on a plan is one call
 * that returns a link; everything else reads what Stripe already knows.
 */

interface AgencyRequest extends Request {
  agency?: Agency | null;
}

export function billingRoutes(visibleSlugs: (req: Request) => Promise<string[]>): Router {
  const router = express.Router();

  router.use((_req: Request, res: Response, next: NextFunction) => {
    if (!billingEnabled()) {
      res.status(503).json({
        error: "billing_unavailable",
        message: "Billing needs Supabase. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.",
      });
      return;
    }
    next();
  });

  /**
   * The agency guard again, because the one in the main router is bound to
   * "/clients/:slug" and never fires on "/billing/clients/:slug".
   *
   * A duplicated guard is the mistake that fails safe. The missing one hands
   * another agency's revenue to whoever guesses a slug.
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

  /** Everyone, and what Stripe says about them. */
  router.get("/", async (req: Request, res: Response) => {
    try {
      res.json(await summary(await visibleSlugs(req)));
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  /** One client. Read live, so a payment made a minute ago is already here. */
  router.get("/clients/:slug", async (req: Request, res: Response) => {
    try {
      res.json({
        ...(await clientBilling(req.params.slug)),
        stripe: { enabled: stripeEnabled(), mode: stripeMode() },
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  /**
   * Put a client on a plan.
   *
   * The whole flow in one call: creates the payment link and returns it. The
   * client pays once and Stripe bills them monthly from then on.
   */
  router.post("/clients/:slug/start", async (req: Request, res: Response) => {
    try {
      const { priceId, setupPriceId, contactEmail } = req.body ?? {};
      if (!priceId) throw new Error("Pick a plan.");

      const account = await startBilling({
        slug: req.params.slug,
        priceId: String(priceId),
        setupPriceId: setupPriceId ? String(setupPriceId) : null,
        contactEmail: contactEmail ? String(contactEmail) : undefined,
      });

      res.json({ account });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.put("/clients/:slug/account", async (req: Request, res: Response) => {
    try {
      res.json({
        account: await saveAccount(req.params.slug, {
          contactEmail: String(req.body?.contactEmail ?? ""),
          notes: String(req.body?.notes ?? ""),
        }),
      });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  /**
   * Cancel at the end of the paid period.
   *
   * Never immediately: they have paid for this month and should get it.
   * Cancelling mid-period is a refund conversation, which belongs in the Stripe
   * dashboard where a refund can actually be issued.
   */
  router.post("/clients/:slug/cancel", async (req: Request, res: Response) => {
    try {
      const sub = await subscriptionFor(req.params.slug);
      if (!sub) throw new Error("No subscription to cancel.");
      await cancelSubscription(sub.id, false);
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post("/clients/:slug/resume", async (req: Request, res: Response) => {
    try {
      const sub = await subscriptionFor(req.params.slug);
      if (!sub) throw new Error("No subscription to resume.");
      await resumeSubscription(sub.id);
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  /**
   * A link into Stripe's own portal, for changing the card or fetching
   * receipts.
   *
   * Not rebuilt here. Every version of that feature means handling card
   * details, and there is no version of that worth owning.
   */
  router.post("/clients/:slug/portal", async (req: Request, res: Response) => {
    try {
      const account = await accountFor(req.params.slug);
      if (!account?.stripeCustomerId) throw new Error("No Stripe customer yet — nobody has paid.");

      const back = `${req.protocol}://${req.get("host")}/`;
      res.json({ url: await billingPortalUrl(account.stripeCustomerId, back) });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  /**
   * A way into Stripe's dashboard for this client, with the customer created.
   *
   * For keying a card on a call. Building a card field here instead meant an
   * iframe, a publishable key and a script from js.stripe.com, to reproduce a
   * screen Stripe already ships — and to move card handling closer to us,
   * which is the opposite of the direction worth travelling.
   *
   * Creating the customer first is what makes it work: it carries the tenant
   * slug, so a subscription made by hand in the dashboard still finds its way
   * back to the right client.
   */
  router.post("/clients/:slug/dashboard", async (req: Request, res: Response) => {
    try {
      const customerId = await ensureCustomerFor(
        req.params.slug,
        String(req.body?.email ?? "") || undefined,
        String(req.body?.name ?? "") || undefined
      );

      res.json({
        customerId,
        subscribeUrl: dashboardSubscriptionUrl(customerId),
        customerUrl: dashboardCustomerUrl(customerId),
      });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  /** Create the starting products in Stripe, so nobody has to learn its UI. */
  router.post("/catalog", async (_req: Request, res: Response) => {
    try {
      res.json(await seedCatalog());
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.get("/stripe", async (_req: Request, res: Response) => {
    res.json({ enabled: stripeEnabled(), mode: stripeMode(), ...(await ping()) });
  });

  return router;
}
