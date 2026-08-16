/**
 * The login page.
 *
 * Deliberately separate from ADMIN_HTML rather than a view inside it. The
 * portal's single-page app fetches client data on boot; serving it to someone
 * unauthenticated would mean every one of those requests 401s behind the login
 * form. A signed-out visitor should get a page that does nothing but log in.
 */
export function loginPage(options: { error?: string; configured: boolean }): string {
  const message = options.configured
    ? options.error
      ? `<div class="err">${escapeHtml(options.error)}</div>`
      : ""
    : `<div class="err">Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in .env.</div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in — Knowledge Layer</title>
<style>
:root{--bg:#f5f6f8;--panel:#fff;--ink:#15171c;--muted:#6b7280;--line:#e4e7ec;--accent:#2b5cff;
  --bad:#a71d2a;--badbg:#fdeaec}
@media (prefers-color-scheme:dark){:root{--bg:#0d0f13;--panel:#15181e;--ink:#e9ebef;--muted:#98a1ae;
  --line:#242932;--accent:#6f8cff;--bad:#ff9aa4;--badbg:#2c1418}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
  background:var(--bg);color:var(--ink);
  font:15px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.card{width:100%;max-width:22rem;background:var(--panel);border:1px solid var(--line);
  border-radius:12px;padding:1.6rem}
h1{font-size:1.15rem;margin:0 0 .25rem}
.sub{color:var(--muted);font-size:.85rem;margin:0 0 1.2rem}
label{display:block;font-size:.8rem;color:var(--muted);margin:0 0 .25rem}
input{width:100%;font:inherit;font-size:.9rem;padding:.55rem .6rem;border-radius:8px;
  border:1px solid var(--line);background:var(--panel);color:var(--ink);margin-bottom:.8rem}
input:focus{outline:2px solid var(--accent);outline-offset:1px;border-color:var(--accent)}
button{width:100%;font:inherit;font-size:.9rem;padding:.55rem;border-radius:8px;cursor:pointer;
  border:1px solid var(--accent);background:var(--accent);color:#fff}
button:hover{filter:brightness(1.1)}
.err{background:var(--badbg);color:var(--bad);border-radius:8px;padding:.55rem .7rem;
  font-size:.83rem;margin:0 0 1rem}
.foot{color:var(--muted);font-size:.76rem;margin:1rem 0 0}
</style>
</head>
<body>
<form class="card" method="post" action="/login">
  <h1>Knowledge Layer</h1>
  <p class="sub">AI discoverability portal</p>
  ${message}
  <label for="email">Email</label>
  <input id="email" name="email" type="email" autocomplete="username" required autofocus>
  <label for="password">Password</label>
  <input id="password" name="password" type="password" autocomplete="current-password" required>
  <button type="submit">Sign in</button>
  <p class="foot">Accounts are created in Supabase. There is no signup here by design.</p>
</form>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}
