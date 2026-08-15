/**
 * The fictional shape of TitanZ Plumbing, used to seed mock exports.
 *
 * These are plausible numbers for a Southwest Florida plumbing company, not
 * TitanZ's real ones. Nothing here should ever be treated as a source of truth
 * about the business — it exists so the pipeline has realistic-shaped input.
 *
 * The price ranges and volume weights are the part that matters. They're set so
 * volume and revenue rank differently: drain clearing is the most common job,
 * repipes are rare but carry the revenue. If those two rankings agreed, the
 * revenue analysis would be a formality rather than a real question.
 */

export interface MockJobType {
  name: string;
  /** Relative job volume over the history window. */
  weight: number;
  /** Realistic invoice total range for this job type, in dollars. */
  priceMin: number;
  priceMax: number;
  category: string;
  businessUnit: string;
}

export const BUSINESS_UNITS = [
  "Plumbing Service",
  "Plumbing Install",
  "Drain & Sewer",
] as const;

export const CATEGORIES = [
  "Water Heaters",
  "Drains & Sewer",
  "Fixtures",
  "Repiping",
  "Leak Detection",
  "Water Treatment",
  "Gas",
  "Service Calls",
] as const;

export const JOB_TYPES: MockJobType[] = [
  // High volume, low ticket — the bread and butter.
  { name: "Drain Clearing",                weight: 180, priceMin: 149,  priceMax: 450,   category: "Drains & Sewer",  businessUnit: "Drain & Sewer" },
  { name: "Emergency Service Call",        weight: 120, priceMin: 125,  priceMax: 385,   category: "Service Calls",   businessUnit: "Plumbing Service" },
  { name: "Toilet Repair",                 weight: 95,  priceMin: 145,  priceMax: 425,   category: "Fixtures",        businessUnit: "Plumbing Service" },
  { name: "Faucet / Fixture Install",      weight: 88,  priceMin: 225,  priceMax: 750,   category: "Fixtures",        businessUnit: "Plumbing Service" },
  { name: "Water Heater Repair",           weight: 76,  priceMin: 185,  priceMax: 650,   category: "Water Heaters",   businessUnit: "Plumbing Service" },
  { name: "Garbage Disposal Replacement",  weight: 54,  priceMin: 285,  priceMax: 650,   category: "Fixtures",        businessUnit: "Plumbing Service" },
  { name: "Backflow Testing",              weight: 48,  priceMin: 95,   priceMax: 250,   category: "Service Calls",   businessUnit: "Plumbing Service" },

  // Mid volume, mid ticket.
  { name: "Water Heater Replacement - Tank", weight: 62, priceMin: 1400, priceMax: 2800, category: "Water Heaters",   businessUnit: "Plumbing Install" },
  { name: "Leak Detection",                weight: 44,  priceMin: 250,  priceMax: 800,   category: "Leak Detection",  businessUnit: "Plumbing Service" },
  { name: "Toilet Replacement",            weight: 41,  priceMin: 450,  priceMax: 1100,  category: "Fixtures",        businessUnit: "Plumbing Install" },
  { name: "Hydro Jetting",                 weight: 34,  priceMin: 450,  priceMax: 1200,  category: "Drains & Sewer",  businessUnit: "Drain & Sewer" },
  { name: "Gas Line Install",              weight: 22,  priceMin: 550,  priceMax: 2400,  category: "Gas",             businessUnit: "Plumbing Install" },

  // Low volume, high ticket — where the revenue hides.
  { name: "Water Heater Replacement - Tankless", weight: 19, priceMin: 3200, priceMax: 6500,  category: "Water Heaters",  businessUnit: "Plumbing Install" },
  { name: "Water Softener Install",        weight: 17,  priceMin: 1800, priceMax: 4200,  category: "Water Treatment", businessUnit: "Plumbing Install" },
  { name: "Slab Leak Repair",              weight: 14,  priceMin: 1800, priceMax: 5500,  category: "Leak Detection",  businessUnit: "Plumbing Service" },
  { name: "Well Pump Service",             weight: 12,  priceMin: 450,  priceMax: 2200,  category: "Water Treatment", businessUnit: "Plumbing Service" },
  { name: "Sewer Line Repair",             weight: 11,  priceMin: 2500, priceMax: 9000,  category: "Drains & Sewer",  businessUnit: "Drain & Sewer" },
  { name: "Repipe - Whole Home",           weight: 7,   priceMin: 6500, priceMax: 18000, category: "Repiping",        businessUnit: "Plumbing Install" },
];

/** Dispatch zones. Southwest Florida, Charlotte and Sarasota county area. */
export const ZONES = [
  { name: "Port Charlotte",  zips: ["33948", "33952", "33953", "33954", "33980", "33981"] },
  { name: "Punta Gorda",     zips: ["33950", "33955", "33982", "33983"] },
  { name: "North Port",      zips: ["34286", "34287", "34288", "34289", "34291"] },
  { name: "Englewood",       zips: ["34223", "34224"] },
  { name: "Venice",          zips: ["34285", "34292", "34293"] },
  { name: "Cape Coral North", zips: ["33909", "33991", "33993"] },
];

/** Equipment brands serviced — feeds brands_serviced content later. */
export const EQUIPMENT_BRANDS = [
  "Rheem", "A.O. Smith", "Bradford White", "Navien", "Rinnai",
  "State Water Heaters", "Moen", "Delta", "Kohler", "InSinkErator",
  "Pentair", "Culligan", "Zoeller", "Goulds",
];

export const TECHNICIAN_NAMES = [
  "Marcus Webb", "Danny Ortiz", "Ray Pulaski", "Tyler Boone", "Junior Alvarez",
  "Chris Nakamura", "Wade Fontaine", "Sam Reyes", "Eli Brandt", "Trevor Nash",
];

/** Skill tags attached to technicians and job types. */
export const SKILLS = [
  "Backflow Certified", "Gas Certified", "Sewer Camera", "Hydro Jetting",
  "Slab Leak", "Water Treatment", "Well Systems", "Repipe",
];
