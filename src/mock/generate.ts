import { makeRng, Rand } from "./random";
import {
  BUSINESS_UNITS,
  CATEGORIES,
  EQUIPMENT_BRANDS,
  JOB_TYPES,
  SKILLS,
  TECHNICIAN_NAMES,
  ZONES,
} from "./titanz";

/**
 * Generates ServiceTitan-shaped mock records.
 *
 * IMPORTANT — read before trusting any of this:
 *
 * The field names here are modeled from memory of the ServiceTitan v2 API, not
 * from its documentation or a real response. They are close enough to build a
 * pipeline against and NOT close enough to design a final schema against. Every
 * shape in this file is a guess until a real export confirms it. See
 * OPEN-QUESTIONS.md 3.6 and 4.5.
 *
 * The one relationship worth getting right is the invoice→job join, because
 * that's what revenue-per-service depends on. Invoices carry a nested
 * `job: { id, number, type }`, which is how the analysis step will link a
 * dollar amount to a job type.
 */

const HOURS_MS = 60 * 60 * 1000;

export interface MockOptions {
  seed: number;
  historyMonths: number;
  /** Roughly how many completed jobs to generate over the window. */
  jobCount: number;
}

interface Ids {
  businessUnits: Map<string, number>;
  categories: Map<string, number>;
  jobTypes: Map<string, number>;
}

/** Stable ids so cross-references line up between files. */
function buildIds(): Ids {
  const businessUnits = new Map(BUSINESS_UNITS.map((n, i) => [n, 1000 + i]));
  const categories = new Map(CATEGORIES.map((n, i) => [n, 2000 + i]));
  const jobTypes = new Map(JOB_TYPES.map((t, i) => [t.name, 3000 + i]));
  return { businessUnits, categories, jobTypes };
}

function isoNow(): string {
  return new Date().toISOString();
}

// --- individual target generators -----------------------------------------

function genBusinessUnits(ids: Ids): unknown[] {
  return BUSINESS_UNITS.map((name) => ({
    id: ids.businessUnits.get(name),
    name,
    officialName: `TitanZ Plumbing - ${name}`,
    active: true,
    email: "office@titanzplumbing.com",
    currency: "USD",
    createdOn: "2019-03-04T14:22:00Z",
    modifiedOn: isoNow(),
  }));
}

function genCategories(ids: Ids): unknown[] {
  return CATEGORIES.map((name, i) => ({
    id: ids.categories.get(name),
    name,
    active: true,
    description: `${name} services and equipment`,
    parentId: null,
    position: i + 1,
    categoryType: "Services",
    modifiedOn: isoNow(),
  }));
}

function genServices(rand: Rand, ids: Ids): unknown[] {
  // One or two pricebook entries per job type — a job type is what gets booked,
  // a service is what gets sold on the invoice. They are not the same thing,
  // and conflating them is an easy schema mistake to make later.
  const services: unknown[] = [];
  let nextId = 4000;

  for (const type of JOB_TYPES) {
    const variants = type.priceMax > 2000 ? ["Standard", "Premium"] : ["Standard"];

    for (const variant of variants) {
      const base = variant === "Premium" ? type.priceMax * 0.85 : type.priceMin * 1.15;
      services.push({
        id: nextId++,
        code: `TZ-${String(nextId).slice(-4)}`,
        displayName: variant === "Standard" ? type.name : `${type.name} (${variant})`,
        description: `${type.name} performed by a licensed TitanZ technician. Includes diagnosis, labor, and standard materials.`,
        active: true,
        price: rand.money(base),
        memberPrice: rand.money(base * 0.9),
        addOnPrice: rand.money(base * 1.05),
        hours: Number(rand.float(0.75, 6).toFixed(2)),
        taxable: true,
        categoryId: ids.categories.get(type.category),
        businessUnitId: ids.businessUnits.get(type.businessUnit),
        warranty: { duration: rand.pick([12, 24, 60]), description: "Parts and labor" },
        modifiedOn: isoNow(),
      });
    }
  }

  return services;
}

function genEquipment(rand: Rand, ids: Ids): unknown[] {
  return EQUIPMENT_BRANDS.flatMap((brand, i) => ({
    id: 5000 + i,
    code: `EQ-${1000 + i}`,
    displayName: `${brand} - Serviced & Installed`,
    description: `TitanZ services and installs ${brand} equipment.`,
    manufacturer: brand,
    active: true,
    price: rand.money(rand.float(280, 4200)),
    memberPrice: rand.money(rand.float(260, 3900)),
    categoryId: ids.categories.get(rand.pick(CATEGORIES)),
    manufacturerWarranty: { duration: rand.pick([12, 60, 72, 120]), description: "Manufacturer warranty" },
    modifiedOn: isoNow(),
  }));
}

function genJobTypes(rand: Rand, ids: Ids): unknown[] {
  return JOB_TYPES.map((type) => ({
    id: ids.jobTypes.get(type.name),
    name: type.name,
    businessUnitIds: [ids.businessUnits.get(type.businessUnit)],
    skills: rand.bool(0.4) ? [rand.pick(SKILLS)] : [],
    minimumDuration: rand.pick([60, 90, 120, 180, 240]),
    durationType: "Fixed",
    class: type.priceMin > 1000 ? "Install" : "Service",
    summary: `${type.name} — dispatched from ${type.businessUnit}`,
    active: true,
    priority: rand.pick(["Low", "Normal", "High"]),
    createdOn: "2019-03-04T14:22:00Z",
    modifiedOn: isoNow(),
  }));
}

function genTechnicians(rand: Rand, ids: Ids): unknown[] {
  return TECHNICIAN_NAMES.map((name, i) => ({
    id: 6000 + i,
    name,
    active: true,
    email: `${name.split(" ")[0].toLowerCase()}@titanzplumbing.com`,
    phoneNumber: `941555${String(1000 + i).slice(-4)}`,
    loginName: name.split(" ")[0].toLowerCase(),
    businessUnitId: ids.businessUnits.get(rand.pick(BUSINESS_UNITS)),
    roleId: rand.pick([1, 2]),
    skills: Array.from(new Set([rand.pick(SKILLS), rand.pick(SKILLS)])),
    dailyGoal: rand.money(rand.float(900, 2400)),
    isManagedTech: true,
    createdOn: "2020-06-11T09:00:00Z",
    modifiedOn: isoNow(),
  }));
}

function genZones(): unknown[] {
  return ZONES.map((zone, i) => ({
    id: 7000 + i,
    name: zone.name,
    zips: zone.zips,
    cities: [zone.name],
    territoryNumber: String(i + 1),
    active: true,
    serviceDaysEnabled: true,
    createdOn: "2019-03-04T14:22:00Z",
    modifiedOn: isoNow(),
  }));
}

/**
 * Jobs and invoices are generated together so they stay consistent, then split
 * into two files. Generating them independently would produce invoices that
 * reference jobs that don't exist, which would hide join bugs rather than
 * expose them.
 */
function genJobsAndInvoices(
  rand: Rand,
  ids: Ids,
  options: MockOptions
): { jobs: unknown[]; invoices: unknown[] } {
  const end = new Date();
  const start = new Date();
  start.setMonth(start.getMonth() - options.historyMonths);

  const weights = JOB_TYPES.map((t) => t.weight);
  const jobs: unknown[] = [];
  const invoices: unknown[] = [];

  for (let i = 0; i < options.jobCount; i++) {
    const type = JOB_TYPES[rand.weightedIndex(weights)];
    const jobId = 100000 + i;
    const jobNumber = String(200000 + i);
    const completedOn = rand.dateBetween(start, end);
    const businessUnitId = ids.businessUnits.get(type.businessUnit)!;
    const zone = rand.pick(ZONES);

    jobs.push({
      id: jobId,
      jobNumber,
      projectId: null,
      customerId: 50000 + rand.int(1, 3200),
      locationId: 60000 + rand.int(1, 3200),
      jobStatus: "Completed",
      completedOn,
      businessUnitId,
      jobTypeId: ids.jobTypes.get(type.name),
      priority: rand.pick(["Low", "Normal", "High", "Urgent"]),
      campaignId: 8000 + rand.int(0, 6),
      summary: `${type.name} — ${zone.name}`,
      // Source attribution matters later for Layer 5. Kept realistic-ish so the
      // measurement work has something to group by.
      customFields: [{ name: "Lead Source", value: rand.pick(["Google", "Repeat", "Referral", "GBP", "Yelp", "AI Assistant"]) }],
      createdOn: new Date(new Date(completedOn).getTime() - rand.int(2, 96) * HOURS_MS).toISOString(),
      modifiedOn: completedOn,
    });

    // Not every completed job produces an invoice in the window — warranty
    // callbacks and re-dos exist. ~4% gap keeps the join honest.
    if (rand.bool(0.96)) {
      const total = rand.money(rand.skewed(type.priceMin, type.priceMax));
      const salesTax = Math.round(total * 0.07 * 100) / 100;

      invoices.push({
        id: 300000 + i,
        syncStatus: "Posted",
        referenceNumber: `INV-${jobNumber}`,
        invoiceDate: completedOn,
        dueDate: new Date(new Date(completedOn).getTime() + 30 * 24 * HOURS_MS).toISOString(),
        subTotal: total,
        salesTax,
        total: Math.round((total + salesTax) * 100) / 100,
        balance: rand.bool(0.92) ? 0 : total,
        customerId: 50000 + rand.int(1, 3200),
        locationId: 60000 + rand.int(1, 3200),
        businessUnit: { id: businessUnitId, name: type.businessUnit },
        // The join the analysis step depends on.
        job: { id: jobId, number: jobNumber, type: type.name },
        items: [
          {
            id: 400000 + i,
            description: type.name,
            quantity: 1,
            cost: rand.money(total * rand.float(0.28, 0.46)),
            totalCost: total,
            type: "Service",
          },
        ],
        createdOn: completedOn,
        modifiedOn: completedOn,
      });
    }
  }

  return { jobs, invoices };
}

// --- entry point -----------------------------------------------------------

/**
 * Returns mock records for a given export target name, or null if that target
 * has no mock implementation yet.
 */
export function generateMockRecords(target: string, options: MockOptions): unknown[] | null {
  // A fresh RNG per call, seeded identically. This is what keeps "jobs-completed"
  // and "invoices" consistent across two separate calls — both replay the same
  // sequence and land on the same job ids and totals. Reordering the random
  // draws inside genJobsAndInvoices would silently break that join.
  const rand = new Rand(makeRng(options.seed));
  const ids = buildIds();

  switch (target) {
    case "pricebook-services":
      return genServices(rand, ids);
    case "pricebook-categories":
      return genCategories(ids);
    case "pricebook-equipment":
      return genEquipment(rand, ids);
    case "pricebook-materials":
      // Deliberately unimplemented — materials aren't needed until pricing
      // breakdowns, and inventing a parts catalog would be noise.
      return null;
    case "business-units":
      return genBusinessUnits(ids);
    case "job-types":
      return genJobTypes(rand, ids);
    case "technicians":
      return genTechnicians(rand, ids);
    case "zones":
      return genZones();
    case "jobs-completed":
      return genJobsAndInvoices(rand, ids, options).jobs;
    case "invoices":
      return genJobsAndInvoices(rand, ids, options).invoices;
    default:
      return null;
  }
}
