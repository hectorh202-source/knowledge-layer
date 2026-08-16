# Knowledge Layer — documentation

A multi-tenant platform that makes home-services businesses findable and citable
by AI answer engines: ChatGPT, Gemini, Perplexity, Copilot.

It gathers what is true about a business from several independent sources,
reconciles the disagreements, holds it behind an approval gate, and publishes it
as structured data a machine can read.

## Start here

| Doc | What it covers |
|---|---|
| [setup.md](setup.md) | Clone to running portal, and the API keys you need |
| [workflow.md](workflow.md) | Onboarding a client, start to finish |
| [architecture.md](architecture.md) | How the pieces fit and where data lives |
| [google.md](google.md) | Places, place IDs, and why name search does not work |
| [markup.md](markup.md) | JSON-LD generation, validation, and getting it onto a site |
| [audits.md](audits.md) | Tier 1, NAP consistency, directories, live verification |
| [gotchas.md](gotchas.md) | **Read this one.** Everything that bit us and why |
| [reference.md](reference.md) | Commands, routes, environment, file layout |
| [maintaining.md](maintaining.md) | Keeping these docs true as the app changes |

If you are picking this up cold, read **setup** then **workflow**, then skim
**gotchas** — most of the surprising behaviour in this app is deliberate, and
gotchas explains what each decision was protecting against.

## The one-sentence version

Being *found* is Tier 1 and mostly settings work; being *chosen* is Tier 2 and
mostly content; everything involving APIs and agent protocols is Tier 3 and
speculative — see [BUILD-CHECKLIST.md](../BUILD-CHECKLIST.md), which governs
what gets built and in what order.

## Principles the code holds to

These are not aspirations. Each one is enforced somewhere in the codebase, and
[gotchas.md](gotchas.md) records what happened when one was missing.

**Nothing auto-approves.** Every extracted fact lands with `approved: false` and
`published: false`. A scraped answer is a promise made in a business's name, and
a scraped licence number is a compliance claim.

**Provenance travels with the value.** Every candidate carries where it came
from, how it was recognised, and a confidence. You can judge a value rather than
trust it.

**A human value is never overwritten.** Promote fills blanks and reports
conflicts. It does not correct people.

**Unknown is not the same as absent.** Where something cannot be established —
directory listings, most obviously — the app says so rather than guessing. A
confident false negative gets acted on, and an audit that has lied twice stops
being read.

**Measure before building.** Several features in this app are shaped by what an
external service actually returned, not by what the documentation implied. Where
that happened, the measurement is recorded in the code comment and in
[gotchas.md](gotchas.md).
