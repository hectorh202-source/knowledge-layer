import type { DashboardData, ReviewSection } from "./data";

/**
 * Renders the review dashboard.
 *
 * Self-contained HTML, no build step and no dependencies. Its job is to make
 * the approval queue visible: 80-odd extracted items sitting in JSON files are
 * effectively invisible, and nothing reaches an answer engine until someone
 * reads them and says yes.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max - 1) + "…" : value;
}

function renderSection(section: ReviewSection): string {
  if (section.items.length === 0) {
    return `
      <section class="card">
        <div class="card-head">
          <h2>${escapeHtml(section.label)}</h2>
          <span class="muted">nothing yet</span>
        </div>
      </section>`;
  }

  const rows = section.items
    .map((item) => {
      const status = item.approved
        ? item.published
          ? `<span class="pill live">live</span>`
          : `<span class="pill ok">approved</span>`
        : `<span class="pill wait">pending</span>`;

      const secondary = item.secondary
        ? `<div class="secondary">${escapeHtml(truncate(item.secondary, 180))}</div>`
        : "";

      const note = item.note ? `<div class="note">${escapeHtml(item.note)}</div>` : "";

      return `
        <tr>
          <td>${status}</td>
          <td>
            <div class="primary">${escapeHtml(item.primary)}</div>
            ${secondary}
            ${note}
          </td>
          <td class="meta">
            <span class="src">${escapeHtml(item.source)}</span>
            <span class="conf conf-${escapeHtml(item.confidence)}">${escapeHtml(item.confidence)}</span>
          </td>
        </tr>`;
    })
    .join("");

  return `
    <section class="card">
      <div class="card-head">
        <h2>${escapeHtml(section.label)}</h2>
        <span class="counts">
          <strong>${section.items.length}</strong> total ·
          <strong>${section.approved}</strong> approved ·
          <strong>${section.published}</strong> live
        </span>
      </div>
      <table>${rows}</table>
    </section>`;
}

export function renderDashboard(data: DashboardData): string {
  const profileRows = data.profileFields
    .map((field) => {
      const filled = field.value !== null && field.value !== "";
      const state = filled ? "ok" : field.blocking ? "bad" : "warn";
      const shown = filled ? escapeHtml(truncate(field.value!, 60)) : "—";
      return `
        <tr>
          <td class="label">${escapeHtml(field.label)}</td>
          <td class="value ${state}">${shown}</td>
        </tr>`;
    })
    .join("");

  const blockingBanner =
    data.blocking.length > 0
      ? `<div class="banner bad">
           <strong>Blocking:</strong> ${data.blocking.map(escapeHtml).join(", ")}.
           Until these are filled, the API serves no business record and the
           catalog will not publish an entry.
         </div>`
      : `<div class="banner ok"><strong>Entity resolves.</strong> Name, phone and location are all set.</div>`;

  const hoursBanner =
    data.openDays === 0
      ? `<div class="banner warn">
           <strong>No opening hours.</strong> One of the most commonly asked and
           most citable facts in home services is missing. Google Places can fill this.
         </div>`
      : "";

  const pending = data.totalItems - data.totalApproved;
  const approvalBanner =
    pending > 0
      ? `<div class="banner warn">
           <strong>${pending} item${pending === 1 ? "" : "s"} awaiting approval.</strong>
           Nothing extracted is served until a human confirms it. Edit
           <code>content/*.json</code>, set <code>approved</code> and
           <code>published</code>, then run <code>npm run content:load</code>.
         </div>`
      : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(data.businessName)} — Knowledge Layer</title>
<style>
  :root {
    --bg: #f6f7f9; --card: #fff; --ink: #14161a; --muted: #6b7280;
    --line: #e5e7eb; --ok: #0f7b3d; --okbg: #e7f6ed;
    --warn: #8a5a00; --warnbg: #fdf3e0; --bad: #a71d2a; --badbg: #fdeaec;
    --live: #1e40af; --livebg: #e6edff;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #0e1013; --card: #16191e; --ink: #e8eaed; --muted: #9aa1ab;
      --line: #262b33; --ok: #6ee7a0; --okbg: #10281a;
      --warn: #f0c274; --warnbg: #2a2113; --bad: #ff9aa4; --badbg: #2c1418;
      --live: #9ab6ff; --livebg: #151d33;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 2rem 1.25rem 4rem;
    background: var(--bg); color: var(--ink);
    font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  .wrap { max-width: 980px; margin: 0 auto; }
  header { margin-bottom: 1.5rem; }
  h1 { font-size: 1.5rem; margin: 0 0 .2rem; letter-spacing: -.01em; }
  .sub { color: var(--muted); font-size: .9rem; }
  .banner {
    border: 1px solid var(--line); border-left-width: 4px;
    border-radius: 8px; padding: .7rem .9rem; margin: .6rem 0; font-size: .9rem;
  }
  .banner.ok   { border-left-color: var(--ok);   background: var(--okbg); }
  .banner.warn { border-left-color: var(--warn); background: var(--warnbg); }
  .banner.bad  { border-left-color: var(--bad);  background: var(--badbg); }
  code {
    background: rgba(128,128,128,.16); padding: .1rem .3rem;
    border-radius: 4px; font-size: .85em;
  }
  .card {
    background: var(--card); border: 1px solid var(--line);
    border-radius: 10px; margin: 1rem 0; overflow: hidden;
  }
  .card-head {
    display: flex; justify-content: space-between; align-items: baseline;
    gap: 1rem; padding: .85rem 1rem; border-bottom: 1px solid var(--line);
    flex-wrap: wrap;
  }
  .card-head h2 { font-size: 1rem; margin: 0; }
  .counts, .muted { color: var(--muted); font-size: .85rem; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: .6rem 1rem; border-bottom: 1px solid var(--line); vertical-align: top; }
  tr:last-child td { border-bottom: 0; }
  td.label { color: var(--muted); width: 9rem; }
  td.value.ok   { color: var(--ink); }
  td.value.warn { color: var(--warn); }
  td.value.bad  { color: var(--bad); font-weight: 600; }
  .primary { font-weight: 500; }
  .secondary { color: var(--muted); font-size: .87rem; margin-top: .15rem; }
  .note { color: var(--warn); font-size: .8rem; margin-top: .25rem; }
  .pill {
    display: inline-block; padding: .12rem .5rem; border-radius: 999px;
    font-size: .72rem; font-weight: 600; white-space: nowrap;
  }
  .pill.ok   { background: var(--okbg);   color: var(--ok); }
  .pill.wait { background: var(--warnbg); color: var(--warn); }
  .pill.live { background: var(--livebg); color: var(--live); }
  td.meta { text-align: right; white-space: nowrap; font-size: .78rem; }
  .src { color: var(--muted); }
  .conf { margin-left: .4rem; opacity: .8; }
  .conf-low { color: var(--warn); }
  .links a {
    display: inline-block; margin-right: .8rem; color: inherit;
    font-size: .85rem; text-decoration: none; border-bottom: 1px solid var(--line);
  }
  .links a:hover { border-bottom-color: currentColor; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>${escapeHtml(data.businessName)}</h1>
    <div class="sub">${data.domain ? escapeHtml(data.domain) : "no domain set"} ·
      ${data.totalApproved} of ${data.totalItems} items approved</div>
  </header>

  ${blockingBanner}
  ${hoursBanner}
  ${approvalBanner}

  <section class="card">
    <div class="card-head">
      <h2>Business identity</h2>
      <span class="counts">${data.openDays} open day${data.openDays === 1 ? "" : "s"} of 7</span>
    </div>
    <table>${profileRows}</table>
  </section>

  ${data.sections.map(renderSection).join("")}

  <section class="card">
    <div class="card-head"><h2>What the API serves</h2></div>
    <div style="padding:.85rem 1rem" class="links">
      <a href="/v1/business">/v1/business</a>
      <a href="/v1/services">/v1/services</a>
      <a href="/v1/service-areas">/v1/service-areas</a>
      <a href="/v1/brands">/v1/brands</a>
      <a href="/v1/faqs">/v1/faqs</a>
      <a href="/v1/credentials">/v1/credentials</a>
      <a href="/jsonld">/jsonld</a>
      <a href="/openapi.json">/openapi.json</a>
    </div>
  </section>
</div>
</body>
</html>`;
}
