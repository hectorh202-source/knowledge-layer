# Keeping these docs true

Documentation that drifts is worse than none: it is confidently wrong, and
somebody acts on it. The same reasoning that produced `unknown` rather than
`not listed` in the directory audit applies here.

Two mechanisms. One is a rule, one is a check that fails loudly.

## The rule

**A change is not finished until the docs match it.** In the same commit, not a
follow-up.

| If you… | Update |
|---|---|
| Add or rename an npm script | [reference.md](reference.md) |
| Add a route | [reference.md](reference.md) |
| Change the onboarding steps or their order | [workflow.md](workflow.md) |
| Add a profile field or change what is emitted | [markup.md](markup.md) |
| Add an audit | [audits.md](audits.md) |
| Change how Google is queried | [google.md](google.md) |
| Add an environment variable | [setup.md](setup.md) |
| **Get bitten by something** | **[gotchas.md](gotchas.md)** |

That last row is the one that matters most and is easiest to skip. If something
cost you an hour, it will cost the next person an hour unless it is written
down. Record the **symptom** first — that is what someone searches for — then the
cause, the fix, and any guard.

`AGENTS.md` at the repository root states this rule for AI assistants working on
the codebase, so it survives without anyone remembering to ask.

## The check

```bash
npm run docs:check
```

`scripts/check-docs.ts` verifies the mechanical claims:

- every npm script is documented in `reference.md`
- every command documented in `reference.md` exists in `package.json`
- every source file referenced in the docs exists on disk
- every relative link between docs resolves
- every environment variable in `.env.example` is documented in `setup.md`

It cannot check that prose is *true* — only that it has not gone stale in the
ways that are machine-detectable. Those are exactly the ways it usually does.

Run it before committing. It exits non-zero on failure, so it can be wired into
CI later.

## What belongs where

**`docs/`** — how the app works and how to operate it. Durable.

**[OPEN-QUESTIONS.md](../OPEN-QUESTIONS.md)** — decisions, open risks, and things
deliberately postponed. Chronological, append-mostly. The standing rule there:
anything we don't have, don't know, or postpone gets logged automatically.

**[BUILD-CHECKLIST.md](../BUILD-CHECKLIST.md)** — what to build and in what
order, with the tier guards.

When something moves from open question to settled behaviour, it graduates from
OPEN-QUESTIONS into `docs/`. The OPEN-QUESTIONS entry stays, marked resolved,
because the reasoning is worth keeping even when the conclusion is now obvious.

## Style

Short sentences. Say what happens, not what is intended.

Prefer a measured result over a claim. "Yelp returns 403 to a browser-agent
request, including for a profile that exists" is worth more than "Yelp blocks
scrapers", because the next person can tell whether it still holds.

Where a decision looks strange, say what it was protecting against. Most of the
odd-looking choices in this codebase are load-bearing, and the ones that are not
should be deleted rather than explained.
