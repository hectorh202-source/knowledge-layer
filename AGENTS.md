# Working on this codebase

Read [docs/README.md](docs/README.md) first, then
[docs/gotchas.md](docs/gotchas.md). Most of the surprising behaviour here is
deliberate, and gotchas explains what each decision was protecting against.

## Update the docs in the same change

**A change is not finished until the docs match it.** Same commit, not a
follow-up. The mapping from change to document is in
[docs/maintaining.md](docs/maintaining.md).

Before committing:

```bash
npm run docs:check
```

It verifies script names, file paths, links and environment variables. It cannot
check that prose is true.

**If something bit you, add it to [docs/gotchas.md](docs/gotchas.md)** — symptom
first, since that is what the next person searches for, then cause, fix, and any
guard. This is the row that gets skipped and the one that pays for itself.

Anything unknown, missing or postponed goes in
[OPEN-QUESTIONS.md](OPEN-QUESTIONS.md). What gets built and in what order is
governed by [BUILD-CHECKLIST.md](BUILD-CHECKLIST.md).

## Rules the code enforces

Do not weaken these without saying so explicitly.

**Nothing auto-approves.** Extracted facts land `approved: false, published:
false`. A scraped answer is a promise made in a business's name.

**Provenance travels with every value** — source, method, confidence.

**Promote never overwrites a human value.** It fills blanks and reports
conflicts.

**Unknown is never reported as absent.** A confident false negative gets acted
on, and an audit that has lied twice stops being read.

**The business profile owns everything that publishes.** Settings holds
operational config only.

## Measure before building on an assumption

Three features here were shaped or cancelled by testing what a service actually
returns rather than trusting documentation — the autocomplete dropdown, phone
lookup, and the directory checker. Each measurement took minutes; each would
have cost days and shipped something confidently wrong.

If a feature depends on how an external service behaves, verify it with a real
request first and record the result in the code comment.

## Testing

The user tests in the portal. Do not modify client data in
`content/tenants/` — fix the app and say what to click.

`npm run typecheck` must pass. Scratch scripts go in the scratchpad directory,
not `/tmp` (which does not resolve for Node on Windows), and need an
`async function main()` wrapper because `tsx` compiles them as CJS.
