# Gotchas

Everything here bit us in practice. Each entry records the symptom, the cause,
the fix, and — where one exists — the guard that stops it recurring.

The pattern worth noticing: **almost every one of these failed silently.** The
app looked healthy, the tests passed, and the damage was only visible from
outside.

---

## Google and Places

### A live listing returns nothing from any search

**Symptom.** Searching the exact business name in Places returns `{}`. The
listing is demonstrably live on Maps, verified, rated 5.0 with 60 reviews.

**Wrong conclusion, reached twice.** "The profile must be unverified or
unpublished." It was not.

**Cause.** The details response carries no `formattedAddress`. It is a
service-area business with a hidden street address, and Google excludes those
from every search surface. Seven surfaces tested, all empty — full table in
[google.md](google.md).

**Fix.** Reach the listing by place ID, taken from the client's own website.
Search was removed from the codebase entirely.

**Lesson.** When a search returns nothing for something you can see with your own
eyes, suspect the API's policy before the data.

### `cid` is not a place ID

`maps.google.com/?cid=538250680958853982` is a different identifier. It cannot be
passed to `places/{id}` and cannot be converted server-side — following one
returns a JavaScript shell. Google Maps URLs are equally useless: hex CID pairs
and `/g/…` Knowledge Graph IDs, neither convertible.

The app rejects `cid` as a place ID with an explicit message rather than failing
obscurely.

### Google's 24/7 hours shape published a six-day closure

**Symptom.** None. The markup would have been wrong and nothing would have said so.

**Cause.** A business open around the clock returns a **single** period —
`{open: {day: 0, hour: 0, minute: 0}}` with no `close` and no other days listed.
Read literally that means "open Sunday, closed Monday to Saturday".

**Impact had it shipped.** A 24-hour emergency business publishing JSON-LD saying
it is closed six days a week. Worse than publishing no hours, and exactly the
kind of fact an answer engine repeats verbatim.

**Fix.** A lone period opening at midnight with no close maps to all seven days
open. Verified against the live payload.

**Caught only because** the details call finally ran against a real listing. It
had been flagged in advance as the most likely thing to be wrong, and it was.

### The legacy Places API is separately enabled

`maps.googleapis.com` endpoints return `REQUEST_DENIED` with *"You're calling a
legacy API, which is not enabled for your project"* until you enable the entry
called **"Places API"** — the one *without* "(New)". Enabling one does not enable
the other.

---

## Extraction

### Reviewer profiles scraped as the business's own URL

**Symptom.** `gbpUrl` on a client profile pointed at a stranger's Google reviewer
page. It reached the published `sameAs`, asserting the business *is the same
entity as* some random reviewer.

**Cause.** A review widget links every individual reviewer's Google profile.
Those match `google.com/maps/…` perfectly. One site produced over a hundred,
drowning the real listing.

**Fix.** `/maps/contrib/` is excluded. They are people, not businesses.

**Still bites afterwards** — see [promote never overwrites](#promote-never-overwrites-so-bad-values-persist).

### Intake files go stale when you add an extractor

**Symptom.** A newly built extractor appears to do nothing.

**Cause.** `website.json` was written before the extractor existed. Nothing
re-reads a site automatically.

**Fix.** Re-crawl. It has caught us three times — place IDs, profile links, and
the reviewer-URL fix.

### Promote never overwrites, so bad values persist

Promote fills blanks and reports conflicts. It does **not** correct a value
already set — deliberately, because it must never overwrite a human.

The consequence: fixing an extractor bug does not fix the data it already wrote.
The reviewer-URL `gbpUrl` survived the extractor fix and a re-crawl, and had to
be cleared by hand in the portal before the correct value could land.

### A field added later crashed promote outright

**Symptom.** `Promote failed: next.entity[key] is not iterable`. Nothing written.

**Cause.** `mergeIntake` read one intake file's keys and indexed into another's.
`website.json` predated the `placeId` field, so that key came back `undefined`
and the spread threw.

**Fix.** Normalise against the full field list and skip missing arrays. **Any**
field added in future would have broken every older intake file the same way.

---

## The portal

### A comment froze the entire portal

**Symptom.** Page stuck on "Loading…" forever. Page returns `200`, API answers
normally, server logs nothing.

**Cause.** A comment in `src/admin/ui.ts` explaining why the closing script
sequence must be escaped **spelled that sequence out literally**. The whole
portal is one inline script, so the browser closed the element at the comment and
discarded everything after it. Client JS was truncated mid-function.

**Diagnosis** required extracting the inline script and running it through a
parser. Nothing else pointed at it.

**Guard.** `assertSingleScript` runs at import and throws at boot if a second
closing tag appears.

**A second bug inside the guard:** the first version also counted *opening* tags
and failed immediately, because the page legitimately contains one inside the
snippet-builder string. Opening tags in strings are inert — an HTML parser inside
a script element looks for the close and nothing else.

### Arguments were pasted into a Windows shell unquoted

**Symptom.** A business named `Junk Chucker - Junk Removal & Hauling` searched for
`Junk`, and the console printed `'Hauling' is not recognized as an internal or
external command`.

**Cause.** `runScript` called `npx.cmd` with `shell: true`. Node's `execFile` with
a shell pastes the argument array into one command string with **no quoting**.
Every space split an argument and the `&` terminated the command.

**Worse than a broken search.** Every value typed into the portal reaches that
function, so `&`, `|`, `>` and `^` were live command injection into our own
shell. Local-only because the portal binds to 127.0.0.1 with no auth — which
changes the moment it is exposed.

**Fix.** Run `process.execPath` against `node_modules/tsx/dist/cli.mjs` directly.
No shell, no `.cmd` shim, arguments passed as an array the whole way down.

### The same field stored twice

**Symptom.** Renaming a client in Settings changed the nav label and nothing a
crawler sees.

**Cause.** `name`, `domain` and `schemaType` lived in both `settings.json` and
`business-profile.json`. The profile copy publishes; the settings copy was
decorative.

**Fix.** The profile owns them. Settings reads through, and the settings PATCH
route refuses them so a stale page cannot write an old name over a fresh edit.
Migration in `scripts/migrate-profile-fields.ts`.

**The same class of bug**, twice more: `BusinessDto` was a hand-maintained copy
of `BusinessProfile` and drifted every time a field changed — it now extends it.

---

## Storage

### Keys in `.env` decide which database you are editing

**Symptom.** Client list suddenly empty, or — much worse — edits made locally
landing in production.

**Cause.** `storage()` picks Supabase whenever `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` are both set. Pasting production keys in to test one
thing repoints every read and write, and nothing on screen says so.

**Fix.** `CONTENT_STORE=files` pins the file store regardless of keys.
`CONTENT_STORE=supabase` is the opposite guard: it throws rather than falling
back to files when keys are missing, so a typo'd variable name fails loudly
instead of writing a client's data somewhere nobody is looking for it.

### A client in the `tenants` table is not a migrated client

**Symptom.** `content:migrate` reporting a client as already done, while the
portal shows it as empty.

**Cause.** `npm run content:load` creates a `tenants` row and published content
rows. It writes none of what the portal needs — settings, audit state, intake,
unapproved content. Checking `tenantExists` therefore skips exactly the clients
that most need migrating.

**Fix.** The migration keys on the presence of a **settings** row. Settings are
written by the portal and by the migration and by nothing else, so they are the
one reliable sign that a client has been through this.

---

## Repository

### `.gitignore` excluded source code

**Symptom.** None locally. A fresh clone would not compile.

**Cause.** `data/` — unanchored — matches a directory named `data` at any depth,
including `src/data/`. `profile.ts` and `content.ts` had **never been committed**.

**Found** by noticing `git status` showed 20 modified files when 22 had been
edited.

**Fix.** `/data/`, anchored.

---

## Validation and vocabulary

### The dictionary is not an inventory

`src/jsonld/vocabulary.json` mirrors schema.org. It is **not** a list of what the
app emits, and must not be pruned to one.

The entries never emitted are how the validator knows `taxID` is real and
`telephon` is not. They are the control group. Pruned to the eleven properties
actually used, the check could only confirm that you emitted what you emitted —
a tautology maintaining 150 lines that can no longer fail.

It is also generated. `npm run vocabulary:build` rebuilds it from schema.org, so
any hand-pruning reappears.

### An audit that reads its own output back

**Symptom.** The NAP audit reported four sources in perfect agreement,
immediately after publishing our markup to the client's site.

**Cause.** Two of those "sources" were our own snippet. The crawl re-read the
JSON-LD we had just pasted, and the live-markup check read the same node. Both
agreed with the profile because both *were* the profile.

**Why it matters.** The audit would have reported a clean bill of health forever
after publication — exactly when it most needs to keep watching Google, the one
source that stays independent.

**Fix.** Every value is now marked independent or not. The live-markup source is
independent only when the node does not carry our `@id`; a crawl value is
independent unless it came from JSON-LD while our markup is live. A field can
agree everywhere and still be uncorroborated, and the report says so.

**Lesson.** When a check starts passing right after you changed something it
measures, ask whether you changed the thing or the measurement.

### `&amp;` reported as a name conflict

**Symptom.** `Titanz Plumbing & Air Conditioning` versus `Titanz Plumbing &amp;
Air Conditioning`, flagged HIGH.

**Cause.** Markup read off a live page arrives HTML-escaped — some plugins escape
JSON-LD contents even though they need not. The normaliser turned `&` into `and`
and left `&amp;` as the word "amp".

**Fix.** Entities are decoded before comparison.

**Why it mattered enough to fix immediately.** This audit's entire value rests on
people trusting its findings. One false conflict of this kind and the whole
report gets skimmed.

### False positives are worse than no check

The validator's first run produced ~90 warnings per build from two bugs in
itself:

- `{"@id": "..."}` reported as an untyped node. It is a **node reference**,
  correct JSON-LD.
- `dayOfWeek` reported as the wrong type. **Enumeration members are URL strings**;
  `https://schema.org/Monday` is right.

Left unfixed, either would have trained everyone to ignore the panel — making the
feature worse than not having it. The same principle drives `unknown` rather than
`not listed` in the directory audit.

---

## External services

### Directories cannot be searched

Yelp `403`s server requests including for profiles that exist. Facebook `400`s.
BBB and Bing return `200` with JavaScript-rendered results, so the HTML contains
the query echoed back and nothing else. Full table in
[audits.md](audits.md#directory-presence).

### `robots.txt` is not the only thing that blocks crawlers

An audited site had a clean `robots.txt` and still returned a consistent `429` to
GPTBot while a browser agent got `200` with identical timing. Response headers
identified the host's CDN edge with `Content-Length: 0` — the request never
reached the application.

That is a hosting ticket. OAI-SearchBot, PerplexityBot, ClaudeBot and Googlebot
all passed on the same site, so the site was not invisible to ChatGPT — only to
one of OpenAI's two crawlers.

### DNS changes move email too

Putting a domain behind Cloudflare means changing nameservers, which moves *all*
DNS including MX and SPF/DKIM records. Preconditions before doing it: written
owner sign-off, an exported zone file diffed against what Cloudflare imports, and
propagation from any recent nameserver change fully settled first.

The real risk is a missed record, not the move itself. Nothing breaks until
nameservers change, so the diff is the entire safety net.

---

## Working on this codebase

### Windows paths in scratch scripts

`/tmp` in Git Bash does not resolve to a path Node can read. Use the scratchpad
directory with a full Windows path, or write scratch files into the project root
and delete them.

### tsx and top-level await

Scratch `.ts` files run through `tsx` compile as CJS, so top-level `await` fails
with *"Top-level await is currently not supported"*. Wrap it in an
`async function main()`.

### Test the assumption before building on it

Three features in this app were shaped, or cancelled, by measuring what an
external service actually returned:

- the autocomplete dropdown, **cancelled** — it returns competitors and a business
  in Canada
- phone lookup, **built then removed** — it works, and not for the businesses that
  need it
- the directory checker, **redesigned** — search is impossible, so it reports
  `unknown` instead of lying

Each measurement took minutes. Building on the assumption would have cost days
and shipped something confidently wrong.
