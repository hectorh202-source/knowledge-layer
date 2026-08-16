import type { ClientReport } from "./build";

/**
 * The report as a printable page.
 *
 * Written to survive Ctrl+P, because the realistic way this reaches a client is
 * as a PDF attached to an email. Colours are kept legible in greyscale, nothing
 * depends on hover, and the print stylesheet drops the page furniture.
 *
 * Self-contained: no external stylesheet, font or script. It has to render the
 * same from an email attachment as it does in the portal.
 */
export function renderReport(report: ClientReport): string {
  const date = new Date(report.generatedAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const ran = report.findable.ranAt
    ? new Date(report.findable.ranAt).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  const passed = report.findable.checks.filter((c) => c.state === "pass").length;
  const total = report.findable.checks.length;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(report.business)} — AI discoverability report</title>
<style>
*{box-sizing:border-box}
body{margin:0;padding:2.5rem 1.5rem;background:#f5f6f8;color:#15171c;
  font:15px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.sheet{max-width:46rem;margin:0 auto;background:#fff;border:1px solid #e4e7ec;border-radius:12px;
  padding:2.5rem}
h1{font-size:1.5rem;margin:0 0 .2rem}
h2{font-size:1.05rem;margin:2.2rem 0 .3rem}
h2:first-of-type{margin-top:1.8rem}
.lede{color:#6b7280;margin:0 0 .3rem}
.meta{color:#6b7280;font-size:.82rem}
.intro{margin:.9rem 0 0;padding:.9rem 1rem;background:#f7f8fa;border-radius:8px;font-size:.9rem}
table{width:100%;border-collapse:collapse;margin:.7rem 0 0;font-size:.9rem}
td,th{text-align:left;padding:.5rem .4rem;border-bottom:1px solid #eef0f4;vertical-align:top}
th{font-size:.72rem;text-transform:uppercase;letter-spacing:.07em;color:#6b7280;font-weight:600}
td.state{width:6.5rem;white-space:nowrap}
.tag{display:inline-block;font-size:.72rem;padding:.12rem .45rem;border-radius:999px;
  border:1px solid currentColor}
.ok{color:#1a7f4b}.no{color:#a71d2a}.unk{color:#8a6d1f}
.sub{color:#6b7280;font-size:.84rem;margin:.12rem 0 0}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(7.5rem,1fr));gap:.6rem;margin:.9rem 0 0}
.stat{border:1px solid #e4e7ec;border-radius:8px;padding:.7rem}
.stat .n{font-size:1.35rem;font-weight:600}
.stat .l{color:#6b7280;font-size:.76rem}
ol{margin:.7rem 0 0;padding-left:1.1rem}
li{margin:0 0 .7rem}
.who{display:inline-block;font-size:.7rem;text-transform:uppercase;letter-spacing:.06em;
  border:1px solid #c9cfda;border-radius:999px;padding:.05rem .45rem;margin-right:.4rem;color:#4b5563}
.foot{margin:2.4rem 0 0;padding-top:1rem;border-top:1px solid #eef0f4;color:#6b7280;font-size:.8rem}
@media print{
  body{background:#fff;padding:0}
  .sheet{border:0;border-radius:0;padding:0;max-width:none}
  h2{break-after:avoid}
  table,li{break-inside:avoid}
}
</style>
</head>
<body>
<div class="sheet">

<h1>${esc(report.business)}</h1>
<p class="lede">How findable this business is to AI assistants</p>
<p class="meta">${esc(report.domain)} · ${esc(date)}</p>

<div class="intro">
  When someone asks ChatGPT, Gemini or Perplexity to recommend a business like yours, the assistant
  reads the web and answers from what it finds. This report covers what it can currently see about
  you, what it cannot, and what we are doing about the difference.
</div>

<h2>Can AI find you?</h2>
<p class="sub">${
    ran
      ? `${passed} of ${total} technical checks passing, last checked ${esc(ran)}.`
      : "These checks have not been run yet."
  }</p>
${
  report.findable.checks.length
    ? `<table><tr><th>Check</th><th>Status</th></tr>${report.findable.checks
        .map(
          (check) => `<tr><td>${esc(check.label)}${
            check.detail ? `<div class="sub">${esc(check.detail)}</div>` : ""
          }</td><td class="state">${tag(check.state)}</td></tr>`
        )
        .join("")}</table>`
    : `<p class="sub">Nothing to show until the first check runs.</p>`
}

<h2>Is your information consistent?</h2>
<p class="sub">${esc(report.consistency.note)}</p>
${
  report.consistency.fields.length
    ? `<table><tr><th>Detail</th><th>What we see</th></tr>${report.consistency.fields
        .map(
          (field) => `<tr><td>${esc(fieldName(field.field))}</td><td>${
            field.agrees
              ? `${esc(field.values[0]?.raw ?? "")} <span class="tag ok">matches</span>`
              : field.values
                  .map((v) => `${esc(v.raw)}<div class="sub">${esc(v.sources.join(", "))}</div>`)
                  .join('<div style="height:.4rem"></div>')
          }</td></tr>`
        )
        .join("")}</table>`
    : `<p class="sub">Not enough sources to compare yet.</p>`
}

<h2>Where you appear</h2>
<p class="sub">Assistants lean heavily on directory pages when recommending a local business.
${report.presence.confirmed} of ${report.presence.total} confirmed.</p>
${
  report.presence.found.length
    ? `<table><tr><th>Confirmed</th></tr>${report.presence.found
        .map((f) => `<tr><td>${esc(f.name)}<div class="sub">${esc(f.url)}</div></td></tr>`)
        .join("")}</table>`
    : ""
}
${
  report.presence.unconfirmed.length
    ? `<p class="sub" style="margin-top:.7rem"><strong>Not yet confirmed:</strong> ${esc(
        report.presence.unconfirmed.join(", ")
      )}. These sites block automated checking, so this means we have not verified them by hand
      yet — not that you are absent from them.</p>`
    : ""
}

<h2>What we have published for you</h2>
<div class="grid">
  ${stat(report.published.services, "Services listed")}
  ${stat(report.published.areas, "Areas covered")}
  ${stat(report.published.questions, "Questions answered")}
  ${stat(report.published.openDays + "/7", "Days of hours")}
</div>
<p class="sub" style="margin-top:.8rem">${markupLine(report.published.markup)}</p>

${
  report.actions.length
    ? `<h2>What happens next</h2><ol>${report.actions
        .map(
          (action) =>
            `<li><span class="who">${action.who === "us" ? "We do this" : "We need you"}</span>${esc(
              action.what
            )}<div class="sub">${esc(action.why)}</div></li>`
        )
        .join("")}</ol>`
    : `<h2>What happens next</h2><p class="sub">Nothing outstanding.</p>`
}

<p class="foot">
  Every figure here is measured, not estimated. Where something could not be checked automatically
  it is marked unconfirmed rather than guessed either way.
</p>

</div>
</body>
</html>`;
}

function stat(value: string | number, label: string): string {
  return `<div class="stat"><div class="n">${esc(String(value))}</div><div class="l">${esc(label)}</div></div>`;
}

function tag(state: "pass" | "fail" | "unknown"): string {
  if (state === "pass") return `<span class="tag ok">passing</span>`;
  if (state === "fail") return `<span class="tag no">needs work</span>`;
  return `<span class="tag unk">partial</span>`;
}

function fieldName(field: string): string {
  const names: Record<string, string> = {
    name: "Business name",
    phone: "Phone number",
    street: "Street",
    city: "Town or city",
    region: "State",
    postalCode: "ZIP code",
  };
  return names[field] ?? field;
}

function markupLine(status: string): string {
  if (status === "current") {
    return "Your business details are published on your website in a format AI can read directly, and they are up to date.";
  }
  if (status === "stale") {
    return "Your details are published on your website but have drifted out of date. We are updating them.";
  }
  if (status === "foreign") {
    return "Your website publishes business details we did not create, and they may not match your listing. We are replacing them.";
  }
  return "Your business details are not yet published on your website in a machine-readable form. That is next on our list.";
}

function esc(value: string): string {
  return String(value).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string)
  );
}
