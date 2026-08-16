/**
 * The admin portal, as one self-contained page.
 *
 * No build step and no framework: the whole thing is served as a string, which
 * means it can never be out of sync with the server that renders it and there
 * is nothing to compile before someone can look at their clients.
 */
export const ADMIN_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Knowledge Layer</title>
<style>
:root{
  --bg:#f5f6f8; --panel:#fff; --sidebar:#111318; --sidebar-ink:#c9cfda;
  --ink:#15171c; --muted:#6b7280; --line:#e4e7ec; --accent:#2b5cff;
  --ok:#0f7b3d; --okbg:#e8f6ee; --warn:#8a5a00; --warnbg:#fdf3e1;
  --bad:#a71d2a; --badbg:#fdeaec; --live:#1e40af; --livebg:#e7edff;
  --radius:10px;
}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){
  --bg:#0d0f13; --panel:#15181e; --sidebar:#0a0c10; --sidebar-ink:#8f98a8;
  --ink:#e9ebef; --muted:#98a1ae; --line:#242932; --accent:#6f8cff;
  --ok:#68e39b; --okbg:#0f2a1b; --warn:#efc276; --warnbg:#2a2113;
  --bad:#ff9aa4; --badbg:#2c1418; --live:#9bb7ff; --livebg:#141d33;
}}
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;background:var(--bg);color:var(--ink);
  font:14.5px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
.app{display:grid;grid-template-columns:250px 1fr;min-height:100vh}
/* sidebar */
aside{background:var(--sidebar);color:var(--sidebar-ink);padding:1.1rem .8rem;
  display:flex;flex-direction:column;gap:.3rem;position:sticky;top:0;height:100vh;overflow-y:auto}
.brand{color:#fff;font-weight:650;letter-spacing:-.01em;padding:.2rem .5rem 1rem;font-size:1.02rem}
.brand small{display:block;font-weight:400;color:var(--sidebar-ink);font-size:.74rem;margin-top:.15rem}
/* Sign out sits at the foot of the sidebar rather than wherever the list of
   sections happens to end. */
#signOut{margin-top:auto;padding-top:.8rem}
.navlabel{font-size:.67rem;text-transform:uppercase;letter-spacing:.09em;
  color:#5d6675;padding:.9rem .5rem .3rem}
.nav{display:block;width:100%;text-align:left;background:none;border:0;color:var(--sidebar-ink);
  padding:.44rem .55rem;border-radius:7px;cursor:pointer;font:inherit;font-size:.87rem}
.nav:hover{background:rgba(255,255,255,.06);color:#fff}
.nav.on{background:var(--accent);color:#fff}
.nav .badge{float:right;font-size:.72rem;opacity:.75}
.client{display:flex;align-items:center;gap:.5rem;min-width:0}
.switcher{display:flex;width:100%;align-items:center;justify-content:space-between;gap:.5rem;
  background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:8px;
  color:var(--sidebar-ink);padding:.55rem .6rem;margin:0 0 .5rem;cursor:pointer;text-align:left}
.switcher:hover{background:rgba(255,255,255,.11);color:#fff}
.switcher-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.switcher-hint{font-size:.72rem;opacity:.7;flex:none}
.pick{display:flex;width:100%;align-items:center;justify-content:space-between;gap:.6rem;
  background:none;border:0;border-bottom:1px solid var(--line);padding:.6rem .3rem;
  cursor:pointer;text-align:left;font:inherit;color:inherit}
.pick:hover{background:var(--hover,#f2f4f7)}
.pick.on{background:var(--accent);color:#fff}
.pick .sub{margin:0;font-size:.76rem}
.pick.on .sub{color:rgba(255,255,255,.8)}
.dot{width:7px;height:7px;border-radius:50%;flex:none;background:var(--muted)}
.dot.ready{background:#3ddc84}.dot.blocked{background:#ff6b6b}
/* main */
main{padding:1.6rem 2rem 5rem;max-width:1120px}
h1{font-size:1.35rem;margin:0 0 .15rem;letter-spacing:-.01em}
h2{font-size:1rem;margin:0}
.sub{color:var(--muted);font-size:.87rem;margin-bottom:1.2rem}
.card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);
  margin-bottom:1rem;overflow:hidden}
.card-h{display:flex;justify-content:space-between;align-items:center;gap:1rem;
  padding:.8rem 1rem;border-bottom:1px solid var(--line);flex-wrap:wrap}
.card-b{padding:1rem}
.grid{display:grid;gap:.8rem;grid-template-columns:repeat(auto-fit,minmax(165px,1fr))}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:.85rem 1rem}
.stat .n{font-size:1.7rem;font-weight:640;letter-spacing:-.02em}
.stat .l{color:var(--muted);font-size:.78rem;margin-top:.1rem}
table{width:100%;border-collapse:collapse}
td,th{padding:.55rem .8rem;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:600}
tr:last-child td{border-bottom:0}
.primary{font-weight:500}
.secondary{color:var(--muted);font-size:.85rem;margin-top:.12rem;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.pill{display:inline-block;padding:.1rem .48rem;border-radius:999px;font-size:.7rem;font-weight:640;white-space:nowrap}
.pill.ok{background:var(--okbg);color:var(--ok)}
.pill.wait{background:var(--warnbg);color:var(--warn)}
.pill.live{background:var(--livebg);color:var(--live)}
.pill.bad{background:var(--badbg);color:var(--bad)}
.banner{border:1px solid var(--line);border-left-width:4px;border-radius:8px;
  padding:.7rem .9rem;margin-bottom:.8rem;font-size:.88rem}
/* Text left, action right. Without this the button sits inline at the end of a
   sentence, so its position moves with the copy — which changes between the
   waiting and idle states of the same banner. */
.banner.split{display:flex;align-items:center;justify-content:space-between;gap:1rem}
.banner.split .btn{flex:none}
.banner.ok{border-left-color:var(--ok);background:var(--okbg)}
.banner.warn{border-left-color:var(--warn);background:var(--warnbg)}
.banner.bad{border-left-color:var(--bad);background:var(--badbg)}
/* Every button is the accent colour. The primary class is kept as a no-op so
   existing markup still reads correctly and nothing had to be rewritten.
   No backticks in here: this stylesheet lives inside a template literal. */
/* Both elements, because some actions are navigations. An anchor styled as a
   button keeps middle-click and open-in-new-tab working, which a button with a
   click handler quietly takes away. */
.btn{font:inherit;font-size:.83rem;padding:.4rem .75rem;border-radius:7px;
  border:1px solid var(--accent);background:var(--accent);color:#fff;cursor:pointer;
  display:inline-block;text-decoration:none;line-height:1.4}
.btn:hover{filter:brightness(1.1);color:#fff}
.btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
/* Dismissals. A Cancel that looks identical to Confirm makes a dialog a
   coin toss, so it drops back to an outline — present and clickable, but not
   competing with the action the dialog exists to perform. */
.btn.quiet{background:var(--panel);border-color:var(--line);color:var(--ink)}
.btn.quiet:hover{border-color:var(--accent);filter:none}
/* Destructive actions stay outlined and red. With everything else solid blue,
   a quiet red button is both unmistakable and — correctly — less inviting to
   press than the action you actually came to perform. */
.btn.danger{background:var(--panel);border-color:var(--line);color:var(--bad)}
.btn.danger:hover{border-color:var(--bad);filter:none}
.btn:disabled{opacity:.5;cursor:not-allowed;filter:none}
.row{display:flex;gap:.5rem;flex-wrap:wrap;align-items:center}
input,select,textarea{font:inherit;font-size:.87rem;padding:.42rem .55rem;border-radius:7px;
  border:1px solid var(--line);background:var(--bg);color:var(--ink);width:100%}
textarea{min-height:5rem;resize:vertical}
label.f{display:block;margin-bottom:.7rem}
label.f span{display:block;font-size:.76rem;color:var(--muted);margin-bottom:.2rem}
.cols2{display:grid;grid-template-columns:1fr 1fr;gap:0 .9rem}
.meta{color:var(--muted);font-size:.76rem;white-space:nowrap;text-align:right}
.conf-low{color:var(--warn)}
label.f a{color:var(--accent);text-decoration:none;font-size:.74rem}
label.f a:hover{text-decoration:underline}
code{background:rgba(128,128,128,.14);padding:.08rem .3rem;border-radius:4px;font-size:.85em}
pre{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:.8rem;
  overflow:auto;max-height:420px;font-size:.78rem;margin:0;white-space:pre-wrap;word-break:break-word}
.toggle{display:inline-flex;gap:.3rem}
.empty{color:var(--muted);padding:1.4rem 1rem;text-align:center;font-size:.88rem}
dialog{border:1px solid var(--line);border-radius:var(--radius);background:var(--panel);
  color:var(--ink);padding:0;max-width:460px;width:92%}
dialog::backdrop{background:rgba(0,0,0,.45)}
.dlg-b{padding:1rem}
.dlg-f{padding:.8rem 1rem;border-top:1px solid var(--line);display:flex;justify-content:flex-end;gap:.5rem}
#toast{position:fixed;right:1.1rem;bottom:1.1rem;background:var(--panel);border:1px solid var(--line);
  border-left:4px solid var(--accent);border-radius:8px;padding:.6rem .9rem;font-size:.85rem;
  box-shadow:0 8px 26px rgba(0,0,0,.16);opacity:0;transform:translateY(8px);
  transition:.18s;pointer-events:none;max-width:380px;z-index:99}
#toast.show{opacity:1;transform:none}

/* Every request, however small, moves this. The portal used to sit visually
   still between a click and its re-render — against a database that is a real
   pause, and a still screen reads as a click that missed. */
#progress{position:fixed;top:0;left:0;right:0;height:2px;z-index:200;
  background:transparent;overflow:hidden;opacity:0;transition:opacity .15s}
#progress.on{opacity:1}
#progress::after{content:"";position:absolute;inset:0;width:40%;
  background:var(--accent);animation:slide 1.1s ease-in-out infinite}
@keyframes slide{0%{left:-40%}100%{left:100%}}

/* A button mid-action. Kept the same width as its resting state so a row of
   buttons does not jump sideways the moment one is pressed. */
.btn .spin{display:inline-block;width:.62rem;height:.62rem;margin-right:.35rem;
  border:2px solid currentColor;border-right-color:transparent;border-radius:50%;
  vertical-align:-1px;animation:spin .6s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}

/* Optimistic rows. The change is already on screen; this says it is not
   confirmed yet, without moving anything. */
/* Stripe's card iframe. Styled to sit in a normal field so it does not look
   bolted on, but the input itself belongs to Stripe — the number never enters
   this page's DOM, which is what keeps the app out of PCI scope. */
#cardField{border:1px solid var(--line);border-radius:7px;padding:.55rem;background:var(--bg)}
#cardField.StripeElement--focus{border-color:var(--accent)}
#cardField.StripeElement--invalid{border-color:var(--bad)}
#cardErr{color:var(--bad);font-size:.8rem;margin-top:.4rem;min-height:1rem}

tr.pending{opacity:.55}
tr.pending .btn{pointer-events:none}

/* The long jobs — a crawl, a promote, a database load. Dismissable on
   purpose: a crawl runs for minutes and there is no reason to hold someone
   hostage to it. Hiding leaves the work running and the top bar moving. */
#busy{position:fixed;inset:0;z-index:150;display:none;align-items:center;justify-content:center;
  background:rgba(0,0,0,.45)}
#busy.on{display:flex}
#busy .box{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);
  padding:1.1rem 1.2rem;max-width:420px;width:90%;box-shadow:0 18px 50px rgba(0,0,0,.28)}
#busy h3{font-size:.98rem;margin:0 0 .3rem;display:flex;align-items:center;gap:.5rem}
#busy .ring{width:.85rem;height:.85rem;border:2px solid var(--accent);
  border-right-color:transparent;border-radius:50%;animation:spin .6s linear infinite;flex:none}
#busy p{font-size:.83rem;color:var(--muted);margin:0 0 .9rem;line-height:1.45}
#busy .dlg-f{padding:0;border:0}
@media(max-width:820px){.app{grid-template-columns:1fr}aside{position:static;height:auto}
  main{padding:1.2rem}.cols2{grid-template-columns:1fr}}
</style>
</head>
<body>
<div class="app">
  <aside>
    <div class="brand">Knowledge Layer<small>AI discoverability portal</small></div>
    <div id="clientNav"></div>
    <div class="navlabel">System</div>
    <button class="nav" data-sys="status">Status</button>
    <button class="nav" data-sys="clients">All clients</button>
    <button class="nav" data-sys="billing">Billing</button>
    <button class="nav" data-sys="team">Team</button>
    <button class="nav" data-sys="platform" id="platformNav" hidden>Platform</button>
    <form method="post" action="/logout" id="signOut" hidden><button class="nav" type="submit">Sign out</button></form>
  </aside>
  <main id="main"><div class="empty">Loading…</div></main>
</div>

<dialog id="clientPicker">
  <div class="dlg-b">
    <h2 style="margin-bottom:.6rem">Switch client</h2>
    <input id="pickSearch" placeholder="Filter by name or domain" autocomplete="off">
    <div id="pickList" style="margin-top:.7rem;max-height:52vh;overflow:auto"></div>
  </div>
  <div class="dlg-f">
    <button class="btn" type="button" id="pickAdd">+ Add client</button>
    <button class="btn quiet" type="button" id="pickCancel">Cancel</button>
  </div>
</dialog>

<dialog id="newClient">
  <div class="dlg-b">
    <h2 style="margin-bottom:.8rem">Add a client</h2>
    <label class="f"><span>Business name</span><input id="ncName" placeholder="TitanZ Plumbing &amp; Air Conditioning"></label>
    <label class="f"><span>Website domain</span><input id="ncDomain" placeholder="acme.com"></label>
    <label class="f"><span>Business type (schema.org)</span>
      <select id="ncType">
        <option>LocalBusiness</option><option>Plumber</option><option>HVACBusiness</option>
        <option>Electrician</option><option>RoofingContractor</option>
        <option>GeneralContractor</option><option>HomeAndConstructionBusiness</option>
      </select></label>
    <div class="sub" style="margin:0">Nothing is invented. The profile starts empty and fills from Google, then the website, then you.</div>
  </div>
  <div class="dlg-f">
    <button class="btn quiet" type="button" id="ncCancel">Cancel</button>
    <button class="btn primary" type="button" id="ncGo">Create</button>
  </div>
</dialog>

<script src="https://js.stripe.com/v3/"></script>

<div id="progress"></div>

<div id="busy">
  <div class="box">
    <h3><span class="ring"></span><span id="busyTitle">Working</span></h3>
    <p id="busyText"></p>
    <div class="dlg-f"><button class="btn quiet" type="button" id="busyHide">Hide &mdash; keep it running</button></div>
  </div>
</div>

<div id="toast"></div>

<script>
const KINDS = {
  "services":{label:"Services",fields:[["name","Service name"],["category","Category"],["description","Description"]]},
  "service-areas":{label:"Service areas",fields:[["name","City or area"],["zips","ZIP codes (comma separated)"]]},
  "brands":{label:"Brands",fields:[["name","Brand"]]},
  "faqs":{label:"Questions & answers",fields:[["question","Question"],["answer","Answer"]]},
  "credentials":{label:"Licenses & credentials",fields:[["title","Title"],["identifier","Number"],["issuer","Issuer"],["validUntil","Valid until (YYYY-MM-DD)"]]}
};
const SECTIONS = ["overview","discoverability","profile",...Object.keys(KINDS),"sources","publishing","settings","client-billing"];
const LABELS = {overview:"Overview",discoverability:"Discoverability",profile:"Business profile",sources:"Sources",publishing:"Publishing",settings:"Settings","client-billing":"Billing",...Object.fromEntries(Object.entries(KINDS).map(([k,v])=>[k,v.label]))};

let clients = [], current = null, view = "clients", detail = null, agency = null, isPlatformAdmin = false;

/**
 * Where you are, kept in the URL.
 *
 * Without this the whole app lived in two JavaScript variables, so refreshing
 * anywhere dropped you back onto the first client's overview — losing your place
 * halfway through reviewing thirty-three services, which is exactly the moment
 * someone hits reload.
 *
 * replaceState rather than pushState: it survives a refresh without turning
 * every section click into a history entry to press Back through.
 */
const SYSTEM_VIEWS = ["status","clients","billing","team","platform"];

function syncLocation(){
  const next = SYSTEM_VIEWS.indexOf(view)!==-1 ? "#/"+view
             : current ? "#/"+encodeURIComponent(current)+"/"+view
             : "#/clients";
  if(location.hash !== next) history.replaceState(null,"",next);
}

function parseLocation(){
  const parts = location.hash.replace(/^#\/?/,"").split("/").filter(Boolean).map(decodeURIComponent);
  if(parts.length === 0) return {};
  if(parts.length === 1) return SYSTEM_VIEWS.indexOf(parts[0])!==-1 ? {view:parts[0]} : {slug:parts[0]};
  return {slug:parts[0], view:parts[1]};
}

/** A URL can say anything. Only render a view that exists. */
function validView(v){ return SECTIONS.indexOf(v)!==-1 || SYSTEM_VIEWS.indexOf(v)!==-1; }

const esc = s => String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const $ = id => document.getElementById(id);

function toast(msg,ms=3200){const t=$("toast");t.textContent=msg;t.classList.add("show");
  clearTimeout(t._h);t._h=setTimeout(()=>t.classList.remove("show"),ms);}

/**
 * Requests in flight, and the bar that shows them.
 *
 * A counter rather than a boolean: several requests overlap routinely, and a
 * boolean lets the first one to finish switch the indicator off while the rest
 * are still running.
 */
let inFlight = 0;
function flight(delta){
  inFlight = Math.max(0, inFlight + delta);
  $("progress").classList.toggle("on", inFlight > 0);
}

async function api(path,opts){
  flight(1);
  try{
    const r = await fetch("/admin/api"+path,{headers:{"Content-Type":"application/json"},...opts});
    const body = await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(body.error||("HTTP "+r.status));
    return body;
  } finally { flight(-1); }
}

/**
 * A button, while its action runs.
 *
 * Returns the restore function. The label is replaced rather than merely
 * disabled because a greyed-out button says "you cannot do this" where a
 * spinner says "this is happening" — and they are different messages.
 */
function working(btn, label){
  if(!btn) return ()=>{};
  const html = btn.innerHTML, wide = btn.offsetWidth;
  btn.style.minWidth = wide + "px";
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span>' + esc(label || btn.textContent.trim());
  return () => { btn.disabled = false; btn.innerHTML = html; btn.style.minWidth = ""; };
}

/**
 * Long jobs still running, keyed by client and action.
 *
 * The registry exists because the button's running state used to live only in
 * the DOM: hide the overlay, navigate away and come back, and the button was
 * back to normal while the crawl was still going. State that outlives a render
 * has to be held outside the thing being re-rendered.
 */
const running = new Map();

/**
 * Paint every button that belongs to a running job, and unpaint any that no
 * longer does.
 *
 * Runs after each render, so a view rebuilt mid-job comes back with its button
 * still spinning. Only jobs for the client on screen are painted — another
 * client's crawl is running, but not here.
 */
function paintJobs(){
  const stale = new Set(document.querySelectorAll("[data-busy]"));

  for(const job of running.values()){
    if(job.slug !== current) continue;
    for(const btn of document.querySelectorAll(job.selector)){
      stale.delete(btn);
      if(btn.dataset.busy) continue;
      btn.dataset.busy = "1";
      btn.dataset.idle = btn.innerHTML;
      btn.style.minWidth = btn.offsetWidth + "px";
      btn.disabled = true;
      btn.innerHTML = '<span class="spin"></span>' + esc(job.label);
    }
  }

  for(const btn of stale){
    btn.innerHTML = btn.dataset.idle || btn.innerHTML;
    btn.disabled = false;
    btn.style.minWidth = "";
    delete btn.dataset.busy;
    delete btn.dataset.idle;
  }
}

/**
 * Start a long job. Returns the function that ends it.
 *
 * The selector is how the button is found again after a re-render, so it has
 * to match the markup the view produces rather than the element clicked.
 *
 * No backticks anywhere in this file: it is all one template literal, and one
 * in a comment ends the string right here.
 */
function startJob(selector, label){
  const key = current + "|" + selector;
  running.set(key, {slug: current, selector, label});
  paintJobs();
  return () => { running.delete(key); paintJobs(); };
}

/**
 * The blocking-but-dismissable overlay, for work measured in seconds.
 *
 * Hiding does not cancel: the request has already left, and offering a Cancel
 * that only hides the box would be a lie about what it does. The top bar keeps
 * moving, and the result still lands when it lands.
 */
function busy(title, text){
  $("busyTitle").textContent = title;
  $("busyText").textContent = text || "";
  $("busy").classList.add("on");
  return () => $("busy").classList.remove("on");
}
$("busyHide").addEventListener("click", ()=>$("busy").classList.remove("on"));

async function loadClients(){
  const r = await api("/clients");
  clients = r.clients;
  // Null when agencies are off — the local single-operator setup.
  agency = r.agency || null;
  renderNav();
}

/**
 * Load a client and show them.
 *
 * The main pane says so while it happens. Loading a client is a database read
 * of everything they have, and leaving the previous client's page on screen
 * throughout meant the only sign anything had happened was the page changing
 * several seconds later — or, if it failed, never.
 */
async function openClient(slug,section,btn){
  const done = working(btn, "Opening");
  const name = (clients.find(c=>c.slug===slug)||{}).name || slug;
  $("main").innerHTML = '<div class="empty"><span class="spin" style="border-color:var(--muted);'+
    'border-right-color:transparent"></span> Loading '+esc(name)+'…</div>';
  try{
    detail = await api("/clients/"+slug);
    current = slug; view = validView(section) ? section : "overview";
    syncLocation(); renderNav(); render();
  }catch(err){
    // Leave the previous client selected. Half-switching to a client that
    // failed to load is a worse place to be than not having switched.
    render(); toast("Could not open "+name+" — "+err.message);
  } finally { done(); }
}

/** Red when the profile is incomplete or discoverability is failing — both block being found. */
function clientReady(c){ return c.blockingCount===0 && !(c.tier1 && c.tier1.failed>0); }

function renderNav(){
  const nav = $("clientNav");

  // One client, not a list. A sidebar that grows with the roster is fine at two
  // clients and unusable at twenty — the section links, which are what you
  // actually navigate with, get pushed off the bottom.
  const active = clients.find(c=>c.slug===current);
  // Whose clients these are. Invisible with one agency, essential with two —
  // and worth showing before someone edits the wrong company's profile.
  let html = agency ? '<div class="navlabel">'+esc(agency.name)+'</div>' : "";
  html += '<div class="navlabel">Client</div>';

  if(active){
    html += '<button class="switcher" data-picker="1">'+
      '<span class="client"><span class="dot '+(clientReady(active)?"ready":"blocked")+'"></span>'+
      '<span class="switcher-name">'+esc(active.name)+'</span></span>'+
      '<span class="switcher-hint">Change ▾</span></button>';
  } else {
    html += '<button class="switcher" data-picker="1">'+
      '<span class="client"><span class="switcher-name">Select a client</span></span>'+
      '<span class="switcher-hint">▾</span></button>';
  }

  if(current && detail){
    html += '<div class="navlabel">'+esc(detail.settings.name)+'</div>';
    for(const s of SECTIONS){
      const sec = detail.sections.find(x=>x.kind===s);
      const badge = sec ? '<span class="badge">'+sec.approved+"/"+sec.items.length+'</span>' : "";
      html += '<button class="nav '+(view===s?"on":"")+'" data-sec="'+s+'">'+LABELS[s]+badge+'</button>';
    }
  }
  nav.innerHTML = html;
}

function tier1Pill(t){
  if(!t || !t.ran) return '<span class="pill wait">not checked</span>';
  if(t.complete) return '<span class="pill ok">complete</span>';
  if(t.failed>0) return '<span class="pill bad">'+t.failed+' failing</span>';
  return '<span class="pill wait">'+t.manualDone+'/'+t.manualTotal+' confirmed</span>';
}

function statusPill(it){
  if(!it.approved) return '<span class="pill wait">pending</span>';
  return it.published ? '<span class="pill live">live</span>' : '<span class="pill ok">approved</span>';
}

/**
 * Which directories are checked, and where each one stands.
 *
 * Rendered from the client payload rather than behind a button. The audit is
 * pure file reads, so there is nothing to defer, and "which eight?" should not
 * be a question you have to click to answer.
 */
function directoriesCard(){
  const d = detail.directories;
  if(!d) return "";

  const rows = d.entries.map(e=>
    '<tr><td>'+(e.state==="found"
        ? '<span class="pill ok">found</span>'
        : '<span class="pill wait">unknown</span>')+'</td>'+
      '<td><div class="primary">'+esc(e.name)+'</div><div class="secondary">'+esc(e.why)+'</div></td>'+
      '<td class="meta">'+(e.state==="found"
        ? '<a href="'+esc(e.url)+'" target="_blank" rel="noopener">open profile ↗</a>'+
          '<div class="secondary">'+esc(e.via)+'</div>'
        : '<a href="'+esc(e.searchUrl)+'" target="_blank" rel="noopener">search ↗</a>')+
      '</td></tr>').join("");

  return '<div class="card"><div class="card-h"><h2>Directory listings</h2>'+
    '<span class="meta">'+d.found+' of '+d.entries.length+' confirmed</span></div>'+
    '<div class="card-b" style="padding-bottom:0">'+
    '<div class="sub">When someone asks an assistant for the best plumber in a city, the pages it retrieves are overwhelmingly aggregators. '+
    'Those pages are the candidate set the answer is built from, so a business absent from them was never in the running, however good the markup on its own site.</div>'+
    '<div class="sub">Searching '+esc(d.business)+(d.where?' in '+esc(d.where):"")+'. '+
    'Found a listing? Paste its URL into <strong>Business profile &rarr; Other profiles</strong> &mdash; that publishes it as <code>sameAs</code>, '+
    'flips this row to found, and adds it as a source for the NAP comparison.</div></div>'+
    '<table><tr><th></th><th>Directory</th><th></th></tr>'+rows+'</table>'+
    '<div class="card-b">'+
    (d.otherProfiles.length
      ? '<div class="sub" style="margin:0 0 .5rem">Other profile links on the site: '+
        d.otherProfiles.map(u=>'<a href="'+esc(u)+'" target="_blank" rel="noopener">'+esc(u)+'</a>').join(", ")+'</div>'
      : "")+
    d.notes.map(n=>'<div class="sub" style="margin:0 0 .5rem">'+esc(n)+'</div>').join("")+
    '<div class="sub" style="margin:0"><strong>&ldquo;Unknown&rdquo; is not &ldquo;not listed&rdquo;.</strong> These platforms refuse automated searches &mdash; '+
    'Yelp returns 403 even for profiles that exist &mdash; so reporting an absence would frequently be a lie. Each search link is about ten seconds by hand.</div>'+
    '</div></div>';
}

function contentView(kind){
  const sec = detail.sections.find(s=>s.kind===kind);
  const rows = sec.items.map(it=>
    '<tr'+(it._pending?' class="pending"':'')+'><td>'+statusPill(it)+'</td><td><div class="primary">'+esc(it.primary)+'</div>'+
    (it.secondary?'<div class="secondary">'+esc(it.secondary)+'</div>':"")+'</td>'+
    '<td class="meta">'+esc(it.source)+' <span class="conf-'+esc(it.confidence)+'">'+esc(it.confidence)+'</span></td>'+
    '<td class="meta"><div class="toggle">'+
      '<button class="btn" data-act="'+(it.approved?"unapprove":"approve")+'" data-i="'+it.index+'">'+(it.approved?"Unapprove":"Approve")+'</button>'+
      (it.approved?'<button class="btn" data-act="'+(it.published?"unpublish":"publish")+'" data-i="'+it.index+'">'+(it.published?"Unpublish":"Publish")+'</button>':"")+
      '<button class="btn danger" data-act="delete" data-i="'+it.index+'">Delete</button>'+
    '</div></td></tr>').join("");

  const fields = KINDS[kind].fields.map(([k,l])=>
    '<label class="f"><span>'+l+'</span><input data-new="'+k+'" placeholder="'+esc(l)+'"></label>').join("");

  return '<h1>'+LABELS[kind]+'</h1><div class="sub">'+sec.items.length+' total · '+sec.approved+
    ' approved · '+sec.published+' live. Nothing is served until it is approved and published.</div>'+
    '<div class="card"><div class="card-h"><h2>Items</h2><div class="row">'+
      '<button class="btn" data-bulk="approve">Approve all</button>'+
      '<button class="btn" data-bulk="publish">Publish approved</button>'+
      '<button class="btn" data-bulk="unpublish">Unpublish all</button>'+
    '</div></div>'+
    (sec.items.length? '<table><tr><th>Status</th><th>Item</th><th>Source</th><th></th></tr>'+rows+'</table>'
      : '<div class="empty">Nothing here yet. Run a source, or add one by hand below.</div>')+
    '</div>'+
    '<div class="card"><div class="card-h"><h2>Add by hand</h2></div><div class="card-b">'+
      '<div class="cols2">'+fields+'</div>'+
      '<button class="btn primary" id="addItem">Add</button></div></div>'+
    (kind==="faqs" ? faqGeneratorCard() : "");
}

/**
 * Assembling answers from approved facts.
 *
 * On the Q&A page rather than beside each source list. This was originally a
 * brand-only card on the Brands page, which meant it sat there telling every
 * non-HVAC client to "approve at least one brand first" — permanently useless
 * to a hauler or a locksmith. Brands are one input among several, so the card
 * belongs where the output lands.
 */
function faqGeneratorCard(){
  return '<div class="card"><div class="card-h"><h2>Generate from approved facts</h2>'+
    '<div class="row"><button class="btn" data-gen="dry">Preview</button>'+
    '<button class="btn primary" data-gen="run">Generate</button></div></div><div class="card-b">'+
    '<div class="sub" style="margin:0 0 .7rem">Turns service areas, hours, credentials and brands into questions. Those facts are already in the app, '+
    'structured and approved &mdash; but structured data is not what gets quoted. A sentence is.</div>'+
    '<div class="sub" style="margin:0 0 .7rem">Uses <strong>approved items only</strong> and writes nothing that is not already known. No pricing, no response times, '+
    'no claims about being the best &mdash; a plausible invented detail is the worst possible output, because it survives review by reading well.</div>'+
    '<div class="sub" style="margin:0 0 .7rem">One question per service area, because &ldquo;do you serve Venice&rdquo; is a real search. '+
    '<strong>Not one per service</strong> &mdash; thirty-four near-identical entries is filler, and filler reads as spam and gives an engine nothing to quote. Services get one roll-up.</div>'+
    '<pre id="genOut">Nothing generated yet.</pre>'+
    '</div></div>';
}

function profileView(){
  const p = detail.profile, a = p.address||{}, g = p.geo||{};
  const f=(k,l,v,ph)=>'<label class="f"><span>'+l+'</span><input data-p="'+k+'" value="'+esc(v??"")+
    '"'+(ph?' placeholder="'+esc(ph)+'"':"")+'></label>';
  // A plain string list is one value per line. Simpler to edit than a row of
  // inputs with add/remove buttons, and it pastes straight out of a spreadsheet.
  const list=(k,l,v,hint)=>'<label class="f"><span>'+l+'</span>'+
    '<textarea data-p="'+k+'" placeholder="'+esc(hint||"")+'">'+esc((v||[]).join("\n"))+'</textarea></label>';
  const blocking = detail.validation.blocking;

  return '<h1>Business profile</h1><div class="sub">Who this business is. Without name, phone and location an answer engine cannot resolve it at all.</div>'+
    (blocking.length? '<div class="banner bad"><strong>Blocking:</strong> '+blocking.map(esc).join(", ")+'</div>'
      : '<div class="banner ok"><strong>Entity resolves.</strong></div>')+
    (detail.validation.missing.length? '<div class="banner warn"><strong>Missing:</strong> '+detail.validation.missing.map(esc).join(", ")+'</div>':"")+
    '<div class="card"><div class="card-h"><h2>Identity</h2></div><div class="card-b"><div class="cols2">'+
      f("name","Business name",p.name)+f("legalName","Legal name",p.legalName)+
      f("phone","Phone (canonical NAP)",p.phone)+f("email","Email",p.email)+
      f("domain","Domain",p.domain)+f("gbpUrl","Google Business Profile URL",p.gbpUrl)+
      f("foundedYear","Founded",p.foundedYear)+
      '<label class="f"><span>schema.org type</span><select data-p="schemaType">'+
        ["LocalBusiness","Plumber","HVACBusiness","Electrician","RoofingContractor","GeneralContractor","HomeAndConstructionBusiness","MovingCompany","Locksmith","HousePainter"]
          .map(t=>'<option '+(t===(p.schemaType||"LocalBusiness")?"selected":"")+'>'+t+'</option>').join("")+'</select></label>'+
    '</div><label class="f"><span>Description</span><textarea data-p="description">'+esc(p.description??"")+'</textarea></label>'+
    '</div></div>'+
    '<div class="card"><div class="card-h"><h2>How customers are served</h2></div><div class="card-b">'+
      '<div class="sub">Decides whether an address is published at all. A service-area business publishing a home address is a privacy problem; '+
      'one publishing no served areas cannot be matched to &ldquo;near me&rdquo;.</div>'+
      '<label class="f"><span>Business type</span><select data-p="businessType">'+
        ['storefront','service_area','hybrid'].map(v=>'<option value="'+v+'"'+((p.businessType||'storefront')===v?' selected':'')+'>'+
          (v==='storefront'?'Storefront — customers come to us':v==='service_area'?'Service area — we travel to customers':'Hybrid — both')+'</option>').join("")+
      '</select></label>'+
      '<label class="f"><span>Primary Google category</span><input data-p="primaryCategory" value="'+esc(p.primaryCategory??"")+'" placeholder="e.g. Plumber, Junk removal service"></label>'+
      '<div class="sub" style="margin:.2rem 0 0">Copy it verbatim from the Google Business Profile. It is the field Google matches queries against.</div>'+
    '</div></div>'+
    '<div class="card"><div class="card-h"><h2>Address</h2>'+
      ((p.businessType==="service_area")?'<span class="meta">optional for a service-area business</span>':"")+'</div><div class="card-b"><div class="cols2">'+
      f("address.street","Street",a.street)+f("address.city","City",a.city)+
      f("address.region","State",a.region)+f("address.postalCode","ZIP",a.postalCode)+
    '</div></div></div>'+
    hoursCard(p.hours||[])+
    '<div class="card"><div class="card-h"><h2>Other profiles</h2><span class="meta">'+((p.sameAs||[]).length)+' linked</span></div><div class="card-b">'+
      '<div class="sub">Facebook, Yelp, BBB, Angi, LinkedIn. This is how an answer engine confirms the business here is the same one it has seen elsewhere &mdash; '+
      'one source is an assertion, several agreeing is corroboration, and corroboration is what earns a citation.</div>'+
      '<textarea data-p="sameAs" placeholder="One URL per line">'+esc((p.sameAs||[]).join("\n"))+'</textarea>'+
      '<div class="sub" style="margin:.2rem 0 0">One per line, full URLs including https://.</div>'+
    '</div></div>'+

    '<div class="card"><div class="card-h"><h2>Branding</h2></div><div class="card-b"><div class="cols2">'+
      f("alternateName","Trading name / DBA",p.alternateName)+f("slogan","Slogan",p.slogan)+
      f("logoUrl","Logo URL",p.logoUrl)+f("founder","Founder",p.founder)+
    '</div>'+
    list("imageUrls","Photo URLs",p.imageUrls,"One full URL per line — vehicles, crew, completed work")+
    '</div></div>'+

    '<div class="card"><div class="card-h"><h2>Commerce</h2></div><div class="card-b"><div class="cols2">'+
      f("priceRange","Price range",p.priceRange,"$ to $$$$")+
      f("currenciesAccepted","Currency",p.currenciesAccepted,"USD")+
    '</div>'+
    list("paymentAccepted","Payments accepted",p.paymentAccepted,"One per line — Cash, Credit Card, Check, Financing")+
    '<div class="sub" style="margin:.2rem 0 0">Price range and payment methods are two of the things an assistant leans on hardest when deciding who to name.</div>'+
    '</div></div>'+

    '<div class="card"><div class="card-h"><h2>Location &amp; reach</h2></div><div class="card-b"><div class="cols2">'+
      f("geo.latitude","Latitude",g.latitude)+f("geo.longitude","Longitude",g.longitude)+
      f("hasMap","Map URL",p.hasMap)+
    '</div>'+
    list("languages","Languages",p.languages,"One per line — English, Spanish")+
    '<div class="sub" style="margin:.2rem 0 0">Coordinates publish for every business type, including service-area. Unlike a street address they expose no doorstep when set to the middle '+
    'of the area served, and they are what let a crawler answer &ldquo;near me&rdquo; at all.</div>'+
    '</div></div>'+

    '<div class="card"><div class="card-h"><h2>Trust signals</h2></div><div class="card-b"><div class="cols2">'+
      f("numberOfEmployees","Employees",p.numberOfEmployees)+f("bookingUrl","Booking URL",p.bookingUrl)+
    '</div>'+
    list("memberOf","Associations",p.memberOf,"One per line — BBB, PHCC, NATE")+
    list("awards","Awards",p.awards,"One per line")+
    '</div></div>'+

    '<div class="card"><div class="card-h"><h2>Attributes</h2><span class="meta">'+((p.attributes||[]).length)+'</span></div><div class="card-b">'+
      '<div class="sub">The Google Business Profile toggles schema.org has no field for &mdash; veteran-owned, free estimates, wheelchair accessible. '+
      'They answer real questions, so they publish as additionalProperty rather than being dropped.</div>'+
      '<textarea data-p="attributes" placeholder="One per line: Name = Value, or just Name for a yes">'+
        esc((p.attributes||[]).map(a=>a.value&&a.value!=="Yes"?a.name+" = "+a.value:a.name).join("\n"))+'</textarea>'+
    '</div></div>'+

    '<div class="card"><div class="card-h"><h2>Additional contacts</h2></div><div class="card-b">'+
      '<div class="sub">Extra lines beyond the canonical NAP number, typed so a crawler knows which is which.</div>'+
      '<textarea data-p="contactPoints" placeholder="One per line: type | phone | email &mdash; e.g. emergency | 941-555-0100 |">'+
        esc((p.contactPoints||[]).map(c=>[c.contactType,c.phone||"",c.email||""].join(" | ")).join("\n"))+'</textarea>'+
    '</div></div>'+

    '<div class="card"><div class="card-h"><h2>Holiday &amp; special hours</h2></div><div class="card-b">'+
      '<div class="sub">Dated exceptions to the week above. Kept separate because &ldquo;closed Christmas Day&rdquo; is a fact about one date &mdash; folded into the weekly '+
      'pattern it would say the business shuts every Thursday forever.</div>'+
      '<textarea data-p="specialHours" placeholder="One per line: 2026-12-25 | closed &nbsp;or&nbsp; 2026-12-24 | 08:00 | 12:00">'+
        esc((p.specialHours||[]).map(h=>h.isClosed?h.date+" | closed":[h.date,h.opens,h.closes].join(" | ")).join("\n"))+'</textarea>'+
    '</div></div>'+

    '<button class="btn primary" id="saveProfile">Save profile</button>';
}

/**
 * The seven-day hours editor.
 *
 * Previously this card printed a count and nothing else, so hours imported from
 * Google landed in the file and stayed invisible — and hours are the one field
 * a person most often needs to correct, because Google's are frequently stale.
 */
function hoursCard(hours){
  const DAYS=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const byDay={};
  hours.forEach(h=>{ if(h && typeof h.day==="number") byDay[h.day]=h; });

  const rows=DAYS.map((label,day)=>{
    const h=byDay[day]||{};
    // A day that is neither marked closed nor given times is unknown, not open.
    const closed=h.isClosed===true;
    return '<tr><td class="primary">'+label+'</td>'+
      '<td><label class="meta" style="display:flex;gap:.35rem;align-items:center">'+
        '<input type="checkbox" data-hclosed="'+day+'"'+(closed?' checked':'')+' style="width:auto"> closed</label></td>'+
      '<td><input type="time" data-hopens="'+day+'" value="'+esc(h.opens||"")+'"'+(closed?' disabled':'')+'></td>'+
      '<td><input type="time" data-hcloses="'+day+'" value="'+esc(h.closes||"")+'"'+(closed?' disabled':'')+'></td></tr>';
  }).join("");

  const open=hours.filter(h=>h && !h.isClosed && h.opens && h.closes).length;

  return '<div class="card"><div class="card-h"><h2>Hours</h2><span class="meta">'+open+' open day'+(open===1?"":"s")+' of 7</span></div>'+
    '<div class="card-b" style="padding-bottom:0"><div class="sub">Google Places fills these when you pull. Verify them &mdash; a listing&rsquo;s hours are often years out of date, '+
    'and an answer engine will repeat them verbatim.</div></div>'+
    '<table><tr><th>Day</th><th></th><th>Opens</th><th>Closes</th></tr>'+rows+'</table>'+
    '<div class="card-b"><button class="btn" id="hours247">Set 24/7</button> '+
    '<button class="btn" id="hoursWeekdays">Mon&ndash;Fri 8&ndash;5</button></div></div>';
}

function overviewView(){
  const s = detail.summary, pending = s.itemCount - s.approvedCount;
  const stat=(n,l)=>'<div class="stat"><div class="n">'+n+'</div><div class="l">'+l+'</div></div>';

  const t = s.tier1;
  return '<h1>'+esc(s.name)+'</h1><div class="sub">'+esc(s.domain||"no domain set")+'</div>'+
    (!t || !t.ran
      ? '<div class="banner split warn"><span><strong>Discoverability not checked.</strong> Until it is, there is no evidence AI can reach this site at all.</span><button class="btn" data-goto="discoverability">Check now</button></div>'
      : t.failed>0
        ? '<div class="banner split bad"><span><strong>'+t.failed+' discoverability check'+(t.failed===1?"":"s")+' failing.</strong> These block being found.</span><button class="btn" data-goto="discoverability">Review</button></div>'
        : t.complete ? '<div class="banner ok"><strong>Tier 1 complete.</strong> Ready for Tier 2.</div>' : "")+
    (s.blockingCount>0? '<div class="banner bad"><strong>'+s.blockingCount+' blocking gap'+(s.blockingCount===1?"":"s")+
      ' in the business profile.</strong> The API serves no business record and the catalog will not publish until these are filled.</div>':"")+
    ((detail.pendingIntake&&detail.pendingIntake.total>0)
      ? '<div class="banner split warn"><span><strong>'+detail.pendingIntake.total+' extracted candidate'+
        (detail.pendingIntake.total===1?"":"s")+' not yet promoted.</strong> They stay out of the sections until you do.</span>'+
        '<button class="btn" data-goto="sources">Go to Sources</button></div>'
      : "")+
    (pending>0? '<div class="banner warn"><strong>'+pending+' item'+(pending===1?"":"s")+' awaiting approval.</strong> Nothing extracted reaches an answer engine until someone confirms it.</div>':"")+
    (detail.expiredCredentials>0? '<div class="banner bad"><strong>'+detail.expiredCredentials+' expired credential(s) approved.</strong> Never served, but worth removing.</div>':"")+
    '<div class="grid">'+stat(s.itemCount,"Items")+stat(s.approvedCount,"Approved")+stat(s.publishedCount,"Live")+
      stat(t&&t.ran ? t.passed+"/"+(t.passed+t.failed) : "—","Checks passing")+
      stat(t ? t.manualDone+"/"+t.manualTotal : "—","Manual confirmed")+
      stat(detail.openDays+"/7","Open days")+'</div>'+
    '<div class="card" style="margin-top:1rem"><div class="card-h"><h2>Content</h2></div><table>'+
      detail.sections.map(sec=>'<tr><td class="primary">'+LABELS[sec.kind]+'</td>'+
        '<td class="meta">'+sec.items.length+' total</td><td class="meta">'+sec.approved+' approved</td>'+
        '<td class="meta">'+sec.published+' live</td>'+
        '<td class="meta"><button class="btn" data-goto="'+sec.kind+'">Review</button></td></tr>').join("")+
    '</table></div>';
}

async function discoverabilityView(){
  const t = await api("/clients/"+current+"/tier1");
  const r = t.report;
  const pill = s => s==="pass"?'<span class="pill ok">pass</span>'
    : s==="fail"?'<span class="pill bad">fail</span>'
    : s==="warn"?'<span class="pill wait">check</span>':'<span class="pill wait">unknown</span>';

  const autoRows = r ? r.checks.map(c=>
    '<tr><td>'+pill(c.state)+'</td><td><div class="primary">'+esc(c.label)+'</div>'+
    '<div class="secondary">'+esc(c.detail)+'</div>'+
    (c.fix?'<div class="secondary" style="color:var(--warn)">Fix: '+esc(c.fix)+'</div>':"")+
    '</td></tr>').join("") : "";

  const manualRows = t.manualChecks.map(m=>{
    const st = t.manual[m.id]||{checked:false,note:""};
    return '<tr><td style="width:2.2rem"><input type="checkbox" data-manual="'+m.id+'" '+(st.checked?"checked":"")+' style="width:auto"></td>'+
      '<td><div class="primary">'+esc(m.label)+'</div><div class="secondary">'+esc(m.hint)+'</div></td>'+
      '<td class="meta">'+(st.checked?'<span class="pill ok">done</span>':'<span class="pill wait">to do</span>')+'</td></tr>';
  }).join("");

  const doneManual = t.manualChecks.filter(m=>(t.manual[m.id]||{}).checked).length;
  const testDone = (t.manual["ai-test"]||{}).checked;
  const allClear = r && r.failed===0 && doneManual===t.manualChecks.length;

  return '<h1>Discoverability</h1><div class="sub">Tier 1 — without these, AI cannot find this business. With them, it can.</div>'+
    (allClear? '<div class="banner ok"><strong>Tier 1 complete.</strong> Every automated check passes and every manual item is confirmed. Ready for Tier 2.</div>'
      : r && r.failed>0 ? '<div class="banner bad"><strong>'+r.failed+' automated check'+(r.failed===1?"":"s")+' failing.</strong> These block discovery.</div>' : "")+
    (!testDone? '<div class="banner warn"><strong>The test has not been run.</strong> Ask ChatGPT, Gemini and Perplexity for a business like this one in its city. If it appears, Tier 1 is solved. That is the whole measure.</div>':"")+
    '<div class="card"><div class="card-h"><h2>Automated checks</h2>'+
      '<div class="row">'+(r?'<span class="meta">ran '+esc(new Date(r.ranAt).toLocaleString())+'</span>':"")+
      '<button class="btn primary" id="runAudit">'+(r?"Re-run":"Run checks")+'</button></div></div>'+
      (r? '<table>'+autoRows+'</table>' : '<div class="empty">Not run yet. This fetches the site as each AI crawler and checks robots.txt, the sitemap and contact details.</div>')+
    '</div>'+
    '<div class="card"><div class="card-h"><h2>Name, address &amp; phone consistency</h2>'+
      '<button class="btn primary" id="runNap">Compare sources</button></div>'+
      '<div class="card-b" style="padding-bottom:0"><div class="sub">Compares what the profile, the website crawl, Google and the site&rsquo;s own markup each say. '+
      'An engine that sees two different phone numbers has no way to know they are one business, so neither record accumulates the corroboration that earns a citation.</div></div>'+
      '<div id="napOut" class="card-b"><div class="sub" style="margin:0">Not compared yet.</div></div>'+
    '</div>'+
    directoriesCard()+
    '<div class="card"><div class="card-h"><h2>Needs a person</h2><span class="meta">'+doneManual+' of '+t.manualChecks.length+' confirmed</span></div>'+
      '<div class="card-b" style="padding-bottom:0"><div class="sub">These need an account login or judgment. Unchecked means unverified, not failing.</div></div>'+
      '<table>'+manualRows+'</table></div>';
}

/**
 * "ran 2 hours ago — 47 found", or the fallback when a source has never run.
 *
 * Relative rather than absolute because the only question this answers is
 * whether what you are looking at is current. "16/08/2026, 14:34" makes you do
 * that subtraction yourself.
 */
function lastRun(source, fallback){
  const runs = detail.intakeRuns || [];
  const run = runs.find(r=>r.source===source);
  if(!run) return fallback;

  let when = "";
  if(run.ranAt){
    const mins = Math.round((Date.now() - new Date(run.ranAt).getTime())/60000);
    when = mins < 1 ? "just now"
      : mins < 60 ? mins+" min ago"
      : mins < 1440 ? Math.round(mins/60)+"h ago"
      : Math.round(mins/1440)+"d ago";
  }
  return "ran "+when+(run.found ? " — "+run.found+" found" : "");
}

function sourcesView(){
  const p = detail.pendingIntake || {total:0};
  const S = (detail.settings && detail.settings.sources) || {};
  const parts = Object.entries(p).filter(([k,v])=>k!=="total"&&v>0)
    .map(([k,v])=>v+" "+(LABELS[k]||k).toLowerCase());

  return '<h1>Sources</h1><div class="sub">The website first, then Google, then you. Everything extracted arrives unapproved.</div>'+

  // Promoting is a banner at the top rather than a third card at the bottom.
  // It renders unconditionally: the count covers content items only, and a
  // Google pull returns hours, phone and address with nothing to count while
  // still needing to be promoted. Rendering it only when the count is non-zero
  // would leave that data stranded with nothing on screen offering to move it.
  '<div class="banner split '+(p.total>0?"warn":"")+'"><span>'+
    (p.total>0
      ? '<strong>'+p.total+' candidate'+(p.total===1?"":"s")+' waiting to be promoted'+
        (parts.length?' &mdash; '+esc(parts.join(", ")):"")+'.</strong> A crawl only writes candidates; until you promote them the '+
        'sections stay empty. Nothing a person entered is overwritten &mdash; conflicts are reported instead.'
      : '<strong>Promote after every source.</strong> Nothing new is counted right now, but a Google pull returns hours, phone and address '+
        'with no items to count, and those still need promoting.')+
    '</span><button class="btn primary" data-run="promote">Promote</button></div>'+
  // Each source's configuration sits in that source's card. It used to live on
  // the Settings page, which meant a crawl that missed the services page sent
  // you to another screen to paste a URL and back again — the field you needed
  // as far as possible from the button you were pressing.
  '<div class="card"><div class="card-h"><h2>1 &nbsp;Website</h2><span class="meta">'+esc(lastRun("website","run this first"))+'</span></div><div class="card-b">'+
    '<div class="sub" style="margin:0 0 .7rem">Crawls the domain, respecting robots.txt. Prefers structured data the site already publishes. '+
    'It also picks up the client&rsquo;s Google place ID from their own markup &mdash; embedded maps and review widgets carry it &mdash; which is why this runs first: '+
    'for a service-area business that ID is the only way into Google.</div>'+
    '<label class="f"><span>Services page URL'+
      (S.servicesPageUrl?' &nbsp;<a href="'+esc(S.servicesPageUrl)+'" target="_blank" rel="noopener">open ↗</a>':"")+
      '</span><input data-src="servicesPageUrl" value="'+esc(S.servicesPageUrl||"")+'" placeholder="https://'+esc(detail.settings.domain)+'/what-we-do"></label>'+
    '<label class="f"><span>Service areas page URL'+
      (S.serviceAreasPageUrl?' &nbsp;<a href="'+esc(S.serviceAreasPageUrl)+'" target="_blank" rel="noopener">open ↗</a>':"")+
      '</span><input data-src="serviceAreasPageUrl" value="'+esc(S.serviceAreasPageUrl||"")+'" placeholder="https://'+esc(detail.settings.domain)+'/coverage"></label>'+
    '<div class="sub" style="margin:0 0 .7rem">Optional, and saved as you type. Point the extractor straight at the right pages when the site words things its own way &mdash; '+
    'a site saying &quot;What We Do&quot; instead of &quot;Services&quot; finds nothing otherwise. Leave blank to fall back to the heuristics.</div>'+
    '<button class="btn primary" data-run="website">Crawl website</button></div></div>'+
  '<div class="card"><div class="card-h"><h2>2 &nbsp;Google Places</h2>'+
    '<span class="meta">'+esc(lastRun("places", S.googlePlaceId?"place ID set":"needs a place ID"))+'</span></div>'+
    '<div class="card-b"><div class="sub" style="margin:0 0 .7rem">Hours, phone and address from public Google data using your own API key. Google permits storing place_id only, so treat the rest as a suggestion the owner confirms.</div>'+
    '<label class="f"><span>Google place ID'+
      (S.googlePlaceId?' &nbsp;<a href="https://www.google.com/maps/place/?q=place_id:'+encodeURIComponent(S.googlePlaceId)+'" target="_blank" rel="noopener">open ↗</a>':"")+
      '</span><input data-src="googlePlaceId" value="'+esc(S.googlePlaceId||"")+'" placeholder="ChIJ… or paste any Google link containing one"></label>'+
    '<div class="sub" style="margin:0 0 .7rem">The only way in. There is <strong>no search</strong> &mdash; Google returns no service-area business from any lookup endpoint, '+
    'so a live, verified, well-reviewed listing can be unfindable by name or phone, and that describes most home-services clients.</div>'+
    '<div class="sub" style="margin:0 0 .7rem">The crawl above fills this in when the site carries it. Otherwise ask the client for their <strong>Google review link</strong> '+
    'and paste the whole thing &mdash; the ID is extracted. A <code>cid=</code> link will not do: different identifier, not convertible. Without an ID, enter the business by hand.</div>'+
    '<button class="btn primary" data-run="places">Pull from Google</button></div></div>'+
  '<div class="card"><div class="card-h"><h2>Output</h2></div><pre id="runOut">Run a source to see its output.</pre></div>';
}

function publishingView(){
  return '<h1>Publishing</h1><div class="sub">What leaves this system, and where it goes.</div>'+
  // One card, because it is one task in three steps. Two cards meant two Copy
  // buttons — raw JSON and the same JSON wrapped in a script tag — where only
  // the wrapped one is ever what you want, since that is what gets pasted and
  // both validators accept it.
  '<div class="card"><div class="card-h"><h2>schema.org markup</h2>'+
    '<div class="row"><button class="btn" id="loadJsonld">1 Generate</button>'+
    '<button class="btn" id="copySnippet">2 Copy snippet</button>'+
    '<button class="btn primary" id="verifyMarkup">3 Check the live site</button></div></div>'+
    '<div class="card-b" style="padding-bottom:0">'+
    '<div class="sub">Generate, paste into the site&rsquo;s <strong>&lt;head&gt;</strong>, then check it arrived. '+
    'Every CMS has a field for it &mdash; WordPress: theme header or an SEO plugin&rsquo;s header-code box. '+
    'Squarespace: Settings &rarr; Advanced &rarr; Code Injection. Wix: Settings &rarr; Custom Code. Webflow: Project Settings &rarr; Custom Code.</div>'+
    '<div class="sub"><strong>A pasted snippet goes stale.</strong> Correct the day it is pasted and drifting from then on &mdash; hours change here, '+
    'nobody re-pastes, and the site serves last quarter&rsquo;s answer while this portal looks perfectly healthy. Run step 3 after pasting, and again '+
    'whenever the profile changes.</div></div>'+
    '<div class="card-b">'+
    '<div id="jsonldIssues"></div>'+
    '<pre id="jsonldOut">Not generated yet.</pre>'+
    '<div id="verifyOut"></div>'+
    '<div class="sub" style="margin:.7rem 0 0">Validated against the schema.org vocabulary on every generate &mdash; a property on the wrong type is '+
    'dropped silently by crawlers, so nothing else would tell you. Neither official validator has an API, so spot-check occasionally with '+
    '<a href="https://validator.schema.org/" target="_blank" rel="noopener">Schema Markup Validator &#8599;</a> or '+
    '<a href="https://search.google.com/test/rich-results" target="_blank" rel="noopener">Rich Results Test &#8599;</a>. Both accept the copied snippet.</div>'+
    '</div></div>'+

  '<div class="card"><div class="card-h"><h2>Client report</h2>'+
    '<a class="btn" href="/admin/api/clients/'+encodeURIComponent(current)+'/report" target="_blank" rel="noopener" style="text-decoration:none">Open report ↗</a></div>'+
    '<div class="card-b"><div class="sub" style="margin:0">What the client sees for their money: what AI can find, whether their details agree across the web, '+
    'what has been published, and what happens next. Written for the business owner rather than for you, and laid out to print straight to PDF. '+
    'Every figure is measured &mdash; there is no visibility score, because inventing one would make the real numbers beside it untrustworthy.</div>'+
  '</div></div>'+

  '<div class="card"><div class="card-h"><h2>Database</h2></div><div class="card-b">'+
    '<div class="sub" style="margin:0 0 .7rem">Pushes approved content to Supabase. Publishing the profile is a separate, deliberate act.</div>'+
    '<div class="row"><button class="btn" data-db="dry">Dry run</button>'+
    '<button class="btn" data-db="load">Load</button>'+
    '<button class="btn primary" data-db="publish">Load &amp; publish</button></div>'+
    '<pre id="dbOut" style="margin-top:.8rem">Not run yet.</pre></div></div>';
}

function settingsView(){
  const s = detail.settings, L = s.links||{}, S = s.sources||{};
  const link=(k,l,ph)=>'<label class="f"><span>'+l+
    (L[k]?' &nbsp;<a href="'+esc(L[k])+'" target="_blank" rel="noopener">open ↗</a>':"")+
    '</span><input data-l="'+k+'" value="'+esc(L[k]||"")+'" placeholder="'+esc(ph)+'"></label>';

  return '<h1>Settings</h1><div class="sub">Per-client configuration.</div>'+
  '<div class="card"><div class="card-h"><h2>Deployment</h2></div><div class="card-b">'+
    '<label class="f"><span>Public API URL (once deployed)</span>'+
      '<input data-s="apiBaseUrl" value="'+esc(s.apiBaseUrl)+'" placeholder="https://api.'+esc(s.domain)+'"></label>'+
  '</div></div>'+

  // Content sources used to live here, one page away from the buttons that
  // consume them. Each field belongs to exactly one source, so each now sits
  // in that source's card — see sourcesView.

  '<div class="card"><div class="card-h"><h2>Accounts &amp; access</h2></div><div class="card-b">'+
    '<div class="sub">Where this client\'s infrastructure lives. Ownership matters more than the links: '+
    'an account the client owns means churn is losing access, not untangling custody of their DNS.</div>'+
    '<label class="f"><span>Who owns the Cloudflare account?</span><select data-l="cloudflareOwner">'+
      [["","— not set up —"],["client","The client owns it, we are a member"],["agency","We own it"]]
        .map(([v,t])=>'<option value="'+v+'" '+(v===(L.cloudflareOwner||"")?"selected":"")+'>'+t+'</option>').join("")+
    '</select></label>'+
    (L.cloudflareOwner==="agency"
      ? '<div class="banner warn" style="margin:.2rem 0 .8rem">Holding their nameservers means holding their DNS — site and email both. Fine, but it is custody you have to hand back cleanly if they leave.</div>'
      : "")+
    '<div class="cols2">'+
      link("cloudflareUrl","Cloudflare zone","https://dash.cloudflare.com/…")+
      link("searchConsoleUrl","Google Search Console","https://search.google.com/search-console?resource_id=…")+
      link("gbpManageUrl","Google Business Profile (manage)","https://business.google.com/…")+
      link("cmsUrl","Site admin","https://"+esc(s.domain)+"/wp-admin")+
      link("hostingUrl","Hosting control panel","https://hpanel.hostinger.com/…")+
      link("registrar","Domain registrar","")+
    '</div>'+
    '<label class="f"><span>Hosting provider</span><input data-l="hostingProvider" value="'+esc(L.hostingProvider||"")+'" placeholder="Hostinger"></label>'+
  '</div></div>'+

  '<div class="card"><div class="card-h"><h2>Notes</h2></div><div class="card-b">'+
    '<textarea data-s="notes">'+esc(s.notes)+'</textarea></div></div>'+

  '<div class="row"><button class="btn primary" id="saveSettings">Save</button>'+
  '<button class="btn danger" id="deleteClient">Delete client</button></div>';
}

/** Cents to "$800". Whole dollars unless there are cents to show. */
function usd(cents){
  const n = (cents||0)/100;
  return "$" + n.toLocaleString("en-US", {minimumFractionDigits: n%1?2:0, maximumFractionDigits:2});
}

/** Stripe's subscription statuses, in words that mean something here. */
function subStatus(row){
  if(row.awaitingPayment) return '<span class="pill wait">link sent, unpaid</span>';
  const map = {
    active:'<span class="pill ok">active</span>',
    trialing:'<span class="pill ok">trial</span>',
    past_due:'<span class="pill bad">card failing</span>',
    unpaid:'<span class="pill bad">unpaid</span>',
    canceled:'<span class="pill">cancelled</span>',
    incomplete:'<span class="pill wait">incomplete</span>',
    incomplete_expired:'<span class="pill">expired</span>',
    paused:'<span class="pill wait">paused</span>',
  };
  return map[row.status] || '<span class="pill">'+esc(row.status)+'</span>';
}

/**
 * Billing.
 *
 * Stripe charges the cards. This page reads what Stripe currently says and
 * nothing else — there is no invoice to raise, no month-end run, and no
 * ledger here to disagree with the money.
 */
async function billingView(){
  let r;
  try { r = await api("/billing"); }
  catch(err){
    return '<h1>Billing</h1><div class="banner bad"><strong>Not available.</strong> '+esc(err.message)+'</div>';
  }

  const st = r.stripe || {};
  if(!st.enabled){
    return '<h1>Billing</h1>'+
      '<div class="banner warn"><strong>Stripe is not connected.</strong> '+
      'Add <code>STRIPE_SECRET_KEY</code> to .env and restart. Billing is entirely Stripe &mdash; '+
      'this app holds no prices, no invoices and no card details.</div>';
  }

  const noPlans = !(r.prices && r.prices.recurring && r.prices.recurring.length);

  const rows = (r.rows||[]).slice().sort((a,b)=>b.overdueCents-a.overdueCents).map(row=>
    '<tr><td><div class="primary">'+esc(row.tenantSlug)+'</div>'+
      (row.contactEmail?'<div class="secondary">'+esc(row.contactEmail)+'</div>':'')+'</td>'+
    '<td class="meta">'+subStatus(row)+
      (row.cancelAtPeriodEnd?'<div class="secondary">ends '+esc(row.renewsOn||"")+'</div>':'')+'</td>'+
    '<td class="meta">'+(row.amountCents?usd(row.amountCents)+' /'+esc(row.interval):'&mdash;')+'</td>'+
    '<td class="meta">'+(row.cancelAtPeriodEnd?'&mdash;':esc(row.renewsOn||"—"))+'</td>'+
    '<td class="meta">'+(row.overdueCents>0?'<span class="pill bad">'+usd(row.overdueCents)+'</span>':'&mdash;')+'</td>'+
    '<td class="meta"><button class="btn" data-bill="'+esc(row.tenantSlug)+'">Open</button></td></tr>'
  ).join("");

  const stat=(v,l)=>'<div class="stat"><div class="n">'+v+'</div><div class="l">'+l+'</div></div>';

  return '<h1>Billing</h1><div class="sub">Stripe charges the cards. This reads what Stripe says &mdash; '+
    'there is no invoice to raise and no month-end run.</div>'+

    (st.mode==="live"
      ? '<div class="banner bad"><strong>LIVE mode.</strong> Payment links take real money.</div>'
      : '<div class="banner ok"><strong>Test mode.</strong> Links are payable with test cards and nothing is charged. '+
        'Swap the key in .env when you are ready.</div>')+

    (noPlans
      ? '<div class="banner split warn"><span><strong>No plans in Stripe yet.</strong> '+
        'Creates two products &mdash; ' + usd(80000) + ' a month and a ' + usd(250000) + ' one-off setup &mdash; '+
        'which you can then edit in the Stripe dashboard. Prices live there, not here.</span>'+
        '<button class="btn primary" id="seedCatalog">Create them</button></div>'
      : '')+

    (r.overdueCents>0
      ? '<div class="banner bad"><strong>'+usd(r.overdueCents)+' overdue.</strong> '+
        'Stripe is retrying those cards. Nothing is cut off &mdash; a failed card should not become '+
        'a client&rsquo;s discoverability outage.</div>'
      : '')+

    '<div class="grid">'+
      stat(usd(r.mrrCents),"Monthly recurring")+
      stat(usd(r.mrrCents*12),"Annual run rate")+
      stat(r.activeCount,"Paying")+
      stat(r.awaitingCount,"Awaiting payment")+
    '</div>'+

    '<div class="card"><div class="card-h"><h2>Clients</h2></div>'+
      (rows.length
        ? '<table><tr><th>Client</th><th>Status</th><th>Rate</th><th>Renews</th><th>Overdue</th><th></th></tr>'+rows+'</table>'
        : '<div class="empty">Nobody is being billed yet. Open a client below to start.</div>')+
    '</div>'+

    ((r.unbilledSlugs||[]).length
      ? '<div class="card"><div class="card-h"><h2>Not billed</h2><span class="meta">'+r.unbilledSlugs.length+'</span></div>'+
        '<div class="card-b"><div class="sub">No plan and no payment link, so they count towards nothing above.</div>'+
        '<div class="row">'+r.unbilledSlugs.map(sl=>
          '<button class="btn quiet" data-bill="'+esc(sl)+'">'+esc(sl)+' &rarr;</button>').join("")+
        '</div></div></div>'
      : '')+

    '<div class="card"><div class="card-b"><div class="sub" style="margin:0">'+
      '<strong>Prices are edited in Stripe</strong>, not here. There is deliberately no second copy &mdash; '+
      'a price that exists in two places is a price that will eventually disagree with itself.</div></div></div>';
}

/**
 * One client's billing.
 *
 * Two clicks to start: pick the plan, press the button. The client pays once
 * and Stripe charges the card every month after that. Nothing here is touched
 * again unless something changes.
 */
async function clientBillingView(){
  let r;
  try { r = await api("/billing/clients/"+current); }
  catch(err){
    return '<h1>Billing</h1><div class="banner bad"><strong>Not available.</strong> '+esc(err.message)+'</div>';
  }

  const name = detail && detail.settings ? detail.settings.name : current;
  const st = r.stripe || {};
  const acc = r.account, sub = r.subscription;
  const rec = (r.prices && r.prices.recurring) || [];
  const one = (r.prices && r.prices.oneOff) || [];

  if(!st.enabled){
    return '<h1>Billing</h1><div class="banner warn"><strong>Stripe is not connected.</strong> '+
      'Add <code>STRIPE_SECRET_KEY</code> to .env and restart.</div>';
  }

  // --- paying already -------------------------------------------------------
  if(sub && sub.live){
    const invoiceRows = (r.invoices||[]).map(inv=>
      '<tr><td><div class="primary">'+esc(inv.number||inv.id)+'</div>'+
        '<div class="secondary">'+esc(inv.createdOn||"")+'</div></td>'+
      '<td class="meta">'+usd(inv.amountCents)+'</td>'+
      '<td class="meta">'+(inv.status==="paid"
        ? '<span class="pill ok">paid</span>'
        : inv.status==="open" ? '<span class="pill wait">open</span>'
        : '<span class="pill">'+esc(inv.status)+'</span>')+'</td>'+
      '<td class="meta">'+(inv.url?'<a class="btn quiet" href="'+esc(inv.url)+'" target="_blank" rel="noopener">View ↗</a>':'')+'</td></tr>'
    ).join("");

    const paid = (r.invoices||[]).reduce((t,i)=>t+i.amountPaidCents,0);

    return '<h1>Billing</h1><div class="sub">'+esc(name)+' is being charged automatically by Stripe.</div>'+

      (st.mode==="live"?'':'<div class="banner ok"><strong>Test mode.</strong> No real money is moving.</div>')+

      (sub.status==="past_due"
        ? '<div class="banner bad"><strong>Their card is failing.</strong> Stripe is retrying on its own schedule. '+
          'Nothing is cut off, and nothing here needs doing unless it keeps failing.</div>'
        : sub.cancelAtPeriodEnd
          ? '<div class="banner split warn"><span><strong>Cancelling on '+esc(sub.renewsOn||"")+'.</strong> '+
            'They keep the month they have paid for.</span>'+
            '<button class="btn primary" id="resumeSub">Keep them on</button></div>'
          : '<div class="banner ok"><strong>'+usd(sub.amountCents)+' every '+esc(sub.interval)+'.</strong> '+
            'Next charge '+esc(sub.renewsOn||"—")+'. Card on file, charged automatically.</div>')+

      '<div class="grid">'+
        '<div class="stat"><div class="n">'+usd(paid)+'</div><div class="l">Paid to date</div></div>'+
        '<div class="stat"><div class="n">'+usd(sub.amountCents)+'</div><div class="l">Per '+esc(sub.interval)+'</div></div>'+
        '<div class="stat"><div class="n">'+esc(sub.startedOn||"—")+'</div><div class="l">Since</div></div>'+
      '</div>'+

      '<div class="card"><div class="card-h"><h2>Payments</h2>'+
        '<button class="btn quiet" id="stripePortal">Manage card in Stripe ↗</button></div>'+
        (invoiceRows
          ? '<table><tr><th>Invoice</th><th>Amount</th><th>Status</th><th></th></tr>'+invoiceRows+'</table>'
          : '<div class="empty">No payments yet.</div>')+
      '</div>'+

      (sub.cancelAtPeriodEnd?'':
        '<div class="card"><div class="card-b"><div class="row" style="justify-content:space-between">'+
          '<div class="sub" style="margin:0">Cancelling stops the next charge. They keep the period they have paid for.</div>'+
          '<button class="btn danger" id="cancelSub">Cancel subscription</button>'+
        '</div></div></div>');
  }

  // --- not paying yet -------------------------------------------------------
  if(!rec.length){
    return '<h1>Billing</h1><div class="banner warn"><strong>No plans in Stripe.</strong> '+
      'Create them on the Billing page first &mdash; sidebar &rarr; Billing.</div>';
  }

  const planOptions = rec.map(pr=>
    '<option value="'+esc(pr.id)+'">'+esc(pr.productName)+' — '+usd(pr.amountCents)+' / '+esc(pr.interval)+'</option>').join("");

  const setupOptions = '<option value="">No setup fee</option>' + one.map(pr=>
    '<option value="'+esc(pr.id)+'"'+(/setup/i.test(pr.productName)?' selected':'')+'>'+
    esc(pr.productName)+' — '+usd(pr.amountCents)+'</option>').join("");

  const link = acc && acc.paymentLinkUrl;
  const staleMode = link && acc.stripeMode && acc.stripeMode !== st.mode;

  return '<h1>Billing</h1><div class="sub">Put '+esc(name)+' on a plan and send them one link. '+
    'They pay once; Stripe charges the card every month after that.</div>'+

    (st.mode==="live"
      ? '<div class="banner bad"><strong>LIVE mode.</strong> This link takes real money.</div>'
      : '<div class="banner ok"><strong>Test mode.</strong> Pay it with <code>4242 4242 4242 4242</code>, any future expiry, any CVC.</div>')+

    (staleMode
      ? '<div class="banner warn"><strong>That link was made in '+esc(acc.stripeMode)+' mode.</strong> '+
        'It will not work now. Create a new one.</div>'
      : '')+

    (link && !staleMode
      ? '<div class="card"><div class="card-h"><h2>Payment link</h2>'+
          '<span class="meta">waiting for payment</span></div><div class="card-b">'+
          '<div class="sub" style="margin:0 0 .6rem">Send this to them. It sets up the subscription and takes '+
          'the setup fee in one payment.</div>'+
          '<input id="payLink" readonly value="'+esc(link)+'" style="margin-bottom:.6rem">'+
          '<div class="row">'+
            '<button class="btn primary" id="copyPayLink">Copy link</button>'+
            '<a class="btn quiet" href="'+esc(link)+'" target="_blank" rel="noopener">Open ↗</a>'+
            (acc.contactEmail
              ? '<a class="btn quiet" href="mailto:'+esc(acc.contactEmail)+
                '?subject='+encodeURIComponent("Getting started")+
                '&body='+encodeURIComponent("Here is the link to get started:\n\n"+link)+'">Email it ↗</a>'
              : '')+
          '</div>'+
        '</div></div>'
      : '')+

    '<div class="card"><div class="card-h"><h2>'+(link?"Change the plan":"Start billing")+'</h2></div><div class="card-b">'+
      '<div class="cols2">'+
        '<label class="f"><span>Plan</span><select id="bPlan">'+planOptions+'</select></label>'+
        '<label class="f"><span>Setup fee</span><select id="bSetup">'+setupOptions+'</select></label>'+
      '</div>'+
      '<label class="f"><span>Their email'+
        (st.canTakeCard?' <span class="meta">required to key a card — the receipt goes here</span>'
                       :' <span class="meta">optional — they can type it at checkout</span>')+'</span>'+
        '<input id="bEmail" type="email" value="'+esc(acc?acc.contactEmail:"")+'" placeholder="accounts@example.com"></label>'+
      '<div class="row">'+
        '<button class="btn primary" id="startBilling">'+(link?"Replace the link":"Create payment link")+'</button>'+
        (st.canTakeCard?'<button class="btn quiet" id="showCard">Key a card instead</button>':'')+
      '</div>'+
      (link?'<div class="sub" style="margin:.7rem 0 0">The current link stops working, so nobody can pay the old price by accident.</div>':'')+
    '</div></div>'+

    (st.canTakeCard
      ? '<div class="card" id="cardCard" hidden><div class="card-h"><h2>Card over the phone</h2>'+
          '<span class="meta">'+(st.mode==="live"?"live — real money":"test mode")+'</span></div><div class="card-b">'+
          '<div class="sub" style="margin:0 0 .7rem">Key their card while you have them on the call. '+
          'Charges the setup fee and the first month now, then monthly on the same card. '+
          '<strong>Stripe emails the receipt.</strong></div>'+
          '<div class="sub" style="margin:0 0 .9rem">The field below is served by Stripe, not by this app &mdash; '+
          'the number never reaches our server, which is what keeps card data out of it entirely. '+
          'Do not write the number down anywhere.</div>'+
          '<label class="f"><span>Name on the card</span><input id="cardName" placeholder="As it appears on the card"></label>'+
          '<label class="f"><span>Card</span><div id="cardField"></div></label>'+
          '<div id="cardErr"></div>'+
          '<div class="row" style="margin-top:.5rem">'+
            '<button class="btn primary" id="chargeCard">Charge and start</button>'+
            '<button class="btn quiet" id="hideCard">Cancel</button>'+
          '</div>'+
          (st.mode!=="live"
            ? '<div class="sub" style="margin:.8rem 0 0">Test card <code>4242 4242 4242 4242</code>, any future expiry, any CVC.</div>'
            : '')+
        '</div></div>'
      : '');
}

/**
 * The card field, and the charge.
 *
 * Everything here talks to Stripe's own iframe. This page never sees a card
 * number, and neither does the server behind it — the browser exchanges the
 * card for a payment method id, and only that id is sent anywhere.
 */
let cardElement = null, cardStripe = null, cardPrepared = null;

async function mountCard(){
  if(cardElement) return;

  const prep = await api("/billing/clients/"+current+"/phone/prepare",{
    method:"POST",
    body:JSON.stringify({email: $("bEmail").value.trim(), name: $("cardName").value.trim()}),
  });
  cardPrepared = prep;

  cardStripe = Stripe(prep.publishableKey);
  const elements = cardStripe.elements();

  // Matched to the app's own fields so it does not look like a foreign object
  // dropped into the page, which is its own kind of thing people distrust.
  const styles = getComputedStyle(document.body);
  cardElement = elements.create("card", {
    hidePostalCode: false,
    style: {
      base: {
        color: styles.getPropertyValue("--ink").trim() || "#111",
        fontFamily: styles.fontFamily,
        fontSize: "14px",
        "::placeholder": { color: styles.getPropertyValue("--muted").trim() || "#888" },
      },
      invalid: { color: styles.getPropertyValue("--bad").trim() || "#c00" },
    },
  });

  cardElement.mount("#cardField");
  cardElement.on("change", e => { $("cardErr").textContent = e.error ? e.error.message : ""; });
}

function unmountCard(){
  if(cardElement){ cardElement.destroy(); cardElement = null; }
  cardStripe = null; cardPrepared = null;
  const err = $("cardErr"); if(err) err.textContent = "";
}

async function chargeCard(btn){
  if(!cardStripe || !cardPrepared){ toast("Card field not ready."); return; }

  const name = $("cardName").value.trim();
  if(!name){ toast("Name on the card."); $("cardName").focus(); return; }

  // Newlines are doubled because this whole file is a template literal: a
  // single backslash-n is consumed at build time and emits a real line break
  // inside a JavaScript string, which is a syntax error that only shows up as
  // a blank portal. Same family as the backtick rule above.
  const amount = $("bPlan").selectedOptions[0].textContent;
  const also = $("bSetup").value ? "\\nplus " + $("bSetup").selectedOptions[0].textContent : "";
  if(!confirm("Charge this card now?\\n\\n" + amount + also +
    "\\n\\nThis takes payment immediately.")) return;

  const done = working(btn, "Charging");
  $("cardErr").textContent = "";

  try{
    // The card goes straight from the iframe to Stripe. What comes back is an
    // id, which is the only part that touches anything of ours.
    const result = await cardStripe.confirmCardSetup(cardPrepared.clientSecret, {
      payment_method: {
        card: cardElement,
        billing_details: { name, email: $("bEmail").value.trim() },
      },
    });

    if(result.error){
      $("cardErr").textContent = result.error.message;
      toast("Card declined — " + result.error.message);
      return;
    }

    await api("/billing/clients/"+current+"/phone/subscribe",{
      method:"POST",
      body:JSON.stringify({
        customerId: cardPrepared.customerId,
        paymentMethodId: result.setupIntent.payment_method,
        priceId: $("bPlan").value,
        setupPriceId: $("bSetup").value || null,
      }),
    });

    unmountCard();
    await render();
    toast("Charged. Stripe has emailed the receipt.", 6000);
  }catch(err){
    $("cardErr").textContent = err.message;
    toast("Not charged — " + err.message, 6000);
  } finally { done(); }
}

async function teamView(){
  if(!agency) return '<h1>Team</h1><div class="sub">Agencies are off &mdash; Supabase is not configured, '+
    'so every client is visible to anyone who can reach this portal.</div>';

  const r = await api("/agency/members");
  const owner = r.role === "owner";

  const rows = r.members.map(m=>
    '<tr><td><div class="primary">'+esc(m.email)+'</div>'+
      (m.joined?'':'<div class="secondary">invited, has not signed in yet</div>')+'</td>'+
    '<td class="meta">'+esc(m.role)+'</td>'+
    '<td class="meta">'+(m.joined?'<span class="pill ok">active</span>':'<span class="pill wait">pending</span>')+'</td>'+
    '<td class="meta">'+(owner
      ? '<button class="btn danger" data-rm="'+esc(m.joined?m.userId:m.email)+'">Remove</button>'
      : '')+'</td></tr>').join("");

  return '<h1>Team</h1><div class="sub">Who can see '+esc(agency.name)+'&rsquo;s clients.</div>'+
    '<div class="card"><div class="card-h"><h2>Members</h2><span class="meta">'+r.members.length+'</span></div>'+
      '<table><tr><th>Person</th><th>Role</th><th>Status</th><th></th></tr>'+rows+'</table></div>'+
    (owner
      ? '<div class="card"><div class="card-h"><h2>Invite someone</h2></div><div class="card-b">'+
        '<div class="sub">They join this agency the first time they sign in, and can then see every client in it.</div>'+
        '<div class="sub">Public signups are off, which is correct &mdash; so an invite is a claim on an email address rather than '+
        'a link that lets someone enrol themselves. If Supabase cannot send the email, create the account in '+
        '<strong>Authentication &rarr; Users</strong> and they will still land here on first sign-in.</div>'+
        '<div class="row" style="gap:.5rem;margin:.7rem 0 0">'+
          '<input id="inviteEmail" type="email" placeholder="name@example.com" style="flex:1">'+
          '<button class="btn" id="sendInvite">Send invite</button></div>'+
        '<div id="inviteOut"></div>'+
        '</div></div>'
      : '<div class="card"><div class="card-b"><div class="sub" style="margin:0">Only an owner can invite or remove people.</div></div></div>');
}

async function platformView(){
  const r = await api("/platform/agencies");

  const rows = r.agencies.map(a=>
    '<tr><td><div class="primary">'+esc(a.name)+'</div>'+
      '<div class="secondary">since '+esc(new Date(a.createdAt).toLocaleDateString())+'</div></td>'+
    '<td class="meta">'+a.clients+'</td>'+
    '<td class="meta">'+a.members+(a.pending?' <span class="pill wait">'+a.pending+' pending</span>':'')+'</td>'+
    '</tr>').join("");

  return '<h1>Platform</h1><div class="sub">Every agency on this installation. '+
    'You administer agencies here, not their clients &mdash; their data stays theirs.</div>'+
    '<div class="card"><div class="card-h"><h2>Agencies</h2><span class="meta">'+r.agencies.length+'</span></div>'+
      '<table><tr><th>Agency</th><th>Clients</th><th>People</th></tr>'+rows+'</table></div>'+
    '<div class="card"><div class="card-h"><h2>Create an agency</h2></div><div class="card-b">'+
      '<div class="sub">Creates the agency and invites its first owner. They become owner the first time they sign in, '+
      'and can then invite their own team and add their own clients.</div>'+
      '<div class="cols2">'+
        '<label class="f"><span>Agency name</span><input id="agName" placeholder="Coastal Marketing"></label>'+
        '<label class="f"><span>Owner email</span><input id="agEmail" type="email" placeholder="owner@example.com"></label>'+
      '</div>'+
      '<button class="btn" id="createAgency">Create agency</button>'+
      '<div id="agOut"></div>'+
    '</div></div>'+
    '<div class="card"><div class="card-b"><div class="sub" style="margin:0">'+
      '<strong>Platform admins are set in <code>.env</code></strong> &mdash; <code>PLATFORM_ADMIN_EMAILS</code>, comma separated &mdash; not here. '+
      'This is the one role that can create agencies, and it should not be grantable through a web form by whoever currently holds it: '+
      'a single compromised session would otherwise be permanent.</div></div></div>';
}

async function statusView(){
  const st = await api("/status");
  const pill = s => s==="running"||s==="connected" ? '<span class="pill ok">'+s+'</span>'
    : s==="not-configured" ? '<span class="pill wait">'+s+'</span>' : '<span class="pill bad">'+s+'</span>';
  const yn = b => b ? '<span class="pill ok">set</span>' : '<span class="pill wait">not set</span>';

  return '<h1>System status</h1><div class="sub">'+st.clients+' client'+(st.clients===1?"":"s")+' configured.</div>'+
  '<div class="card"><div class="card-h"><h2>Public API</h2>'+pill(st.api.state)+'</div>'+
    '<div class="card-b"><div class="sub" style="margin:0">'+esc(st.api.detail)+'</div></div></div>'+
  '<div class="card"><div class="card-h"><h2>Database</h2>'+pill(st.database.state)+'</div>'+
    '<div class="card-b"><div class="sub" style="margin:0">'+esc(st.database.detail)+'</div></div></div>'+
  '<div class="card"><div class="card-h"><h2>Configuration</h2></div><table>'+
    '<tr><td>Supabase URL and anon key</td><td class="meta">'+yn(st.config.supabase)+'</td></tr>'+
    '<tr><td>Supabase service role key <span class="meta">(loader only, never public)</span></td><td class="meta">'+yn(st.config.serviceRoleKey)+'</td></tr>'+
    '<tr><td>Google Maps API key <span class="meta">(Places intake)</span></td><td class="meta">'+yn(st.config.googleMaps)+'</td></tr>'+
    '<tr><td>Stripe <span class="meta">(billing)</span></td><td class="meta">'+
      (st.config.stripe
        ? (st.config.stripeMode==="live"
            ? '<span class="pill bad">live mode</span>'
            : '<span class="pill ok">test mode</span>')
        : yn(false))+'</td></tr>'+
  '</table></div>';
}

function clientsView(){
  return '<h1>Clients</h1><div class="sub">'+clients.length+' configured. Adding one creates its own isolated content set.</div>'+
  '<div class="card"><div class="card-h"><h2>All clients</h2>'+
    '<button class="btn primary" data-add="1">+ Add client</button></div>'+
    (clients.length?'<table><tr><th>Client</th><th>Domain</th><th>Discoverability</th><th>Items</th><th>Approved</th><th>Live</th><th></th></tr>'+
    clients.map(c=>'<tr><td><span class="client"><span class="dot '+(c.blockingCount===0?"ready":"blocked")+'"></span><span class="primary">'+esc(c.name)+'</span></span></td>'+
    '<td class="meta">'+esc(c.domain||"—")+'</td><td class="meta">'+tier1Pill(c.tier1)+'</td><td class="meta">'+c.itemCount+'</td><td class="meta">'+c.approvedCount+
    '</td><td class="meta">'+c.publishedCount+'</td><td class="meta"><button class="btn" data-open="'+esc(c.slug)+'">Open</button></td></tr>').join("")+
    '</table>':'<div class="empty">No clients yet. Add the first one above.</div>')+'</div>';
}

async function render(){
  const m = $("main");
  if(view==="status"){ m.innerHTML = await statusView(); return; }
  if(view==="billing"){ m.innerHTML = await billingView(); paintJobs(); return; }
  if(view==="team"){ m.innerHTML = await teamView(); return; }
  if(view==="platform"){ m.innerHTML = await platformView(); return; }
  if(view==="clients" || !current){ m.innerHTML = clientsView(); return; }
  if(view==="client-billing"){ m.innerHTML = await clientBillingView(); paintJobs(); return; }
  if(view==="discoverability"){ m.innerHTML = await discoverabilityView(); return; }
  if(view==="overview") m.innerHTML = overviewView();
  else if(view==="profile") m.innerHTML = profileView();
  else if(view==="sources") m.innerHTML = sourcesView();
  else if(view==="publishing") m.innerHTML = publishingView();
  else if(view==="settings") m.innerHTML = settingsView();
  else m.innerHTML = contentView(view);

  // Anything still running gets its button back. Without this a re-render
  // silently resets a job that has not finished.
  paintJobs();
}

/**
 * Re-read everything for the current client.
 *
 * For anything that changes what exists — adding, deleting, a crawl, a
 * promote. Not for approve and publish: those know exactly what changed and
 * update in place, and running this after every toggle meant two requests and
 * a full re-render to move one checkbox.
 *
 * The two reads are independent, so they go together. Sequentially they were
 * two round trips deep, and against a database that is the difference between
 * a pause you notice and one you do not.
 */
async function refreshData(){
  const [d] = await Promise.all([api("/clients/"+current), loadClients()]);
  detail = d;
}

async function refresh(){
  await refreshData();
  renderNav(); await render();
}

/**
 * Finish a long job that may have outlived the page it started on.
 *
 * Re-rendering unconditionally would wipe whatever the person moved on to —
 * including a half-filled profile form, if a crawl landed while they were
 * typing in it. The sidebar is safe to rebuild either way; it holds no input.
 */
async function settle(at){
  await refreshData();
  renderNav();
  if(current === at.slug && view === at.view) await render();
}

/** Section totals, after an item changed in place. */
function recount(sec){
  sec.approved = sec.items.filter(i=>i.approved).length;
  sec.published = sec.items.filter(i=>i.approved && i.published).length;

  // The overview stats and the client list read from a separate summary
  // object, which would otherwise keep reporting the counts from page load.
  const all = detail.sections;
  const sum = detail.summary;
  sum.itemCount = all.reduce((t,x)=>t+x.items.length,0);
  sum.approvedCount = all.reduce((t,x)=>t+x.approved,0);
  sum.publishedCount = all.reduce((t,x)=>t+x.published,0);

  const listed = clients.find(c=>c.slug===current);
  if(listed){
    listed.itemCount = sum.itemCount;
    listed.approvedCount = sum.approvedCount;
    listed.publishedCount = sum.publishedCount;
  }
}

/**
 * The client switcher.
 *
 * Filtering is here rather than in the sidebar because the sidebar can only
 * ever show one client now. At twenty clients a scroll is worse than a search
 * box, and the box is the whole reason this can stay a single entry.
 */
function renderPickList(){
  const q = ($("pickSearch").value||"").toLowerCase().trim();
  const shown = clients.filter(c=>
    !q || c.name.toLowerCase().indexOf(q)!==-1 || (c.domain||"").toLowerCase().indexOf(q)!==-1);

  // Working on none of them is a real state — closing the client you were in
  // without opening another. Without this the only way out was picking a
  // different one.
  const clear = current
    ? '<button class="pick" data-pick=""><span class="client">'+
      '<span><div class="primary">No client</div>'+
      '<div class="sub">Close the current one</div></span></span></button>'
    : "";

  $("pickList").innerHTML = shown.length
    ? clear + shown.map(c=>{
        const pending = c.itemCount - c.approvedCount;
        const state = !clientReady(c)
          ? (c.blockingCount>0 ? c.blockingCount+" blocking" : "checks failing")
          : pending>0 ? pending+" awaiting approval" : "ready";
        return '<button class="pick '+(c.slug===current?"on":"")+'" data-pick="'+esc(c.slug)+'">'+
          '<span class="client"><span class="dot '+(clientReady(c)?"ready":"blocked")+'"></span>'+
          '<span><div class="primary">'+esc(c.name)+'</div>'+
          '<div class="sub">'+esc(c.domain||"no domain")+' · '+esc(state)+'</div></span></span>'+
          '<span class="meta">'+c.approvedCount+"/"+c.itemCount+'</span></button>';
      }).join("")
    : '<div class="empty">No client matches "'+esc(q)+'".</div>';
}

function openPicker(){
  $("pickSearch").value = "";
  renderPickList();
  $("clientPicker").showModal();
  // Type straight into the filter, which is the point of having one.
  $("pickSearch").focus();
}

// --- events ---------------------------------------------------------------
document.addEventListener("click", async e => {
  const t = e.target.closest("button"); if(!t) return;
  try{
    if(t.dataset.picker !== undefined){ openPicker(); return; }
    // Empty value is the "No client" row, so test for the attribute rather
    // than a truthy value.
    if(t.dataset.pick !== undefined){
      $("clientPicker").close();
      if(t.dataset.pick){ await openClient(t.dataset.pick); }
      else { current=null; detail=null; view="clients"; syncLocation(); renderNav(); await render(); }
      return;
    }
    if(t.dataset.client){ await openClient(t.dataset.client, undefined, t); return; }
    if(t.dataset.open){ await openClient(t.dataset.open, undefined, t); return; }
    if(t.dataset.add !== undefined){ $("newClient").showModal(); return; }
    if(t.dataset.sec){ view = t.dataset.sec; syncLocation(); renderNav(); await render(); return; }
    if(t.dataset.goto){ view = t.dataset.goto; syncLocation(); renderNav(); await render(); return; }
    if(t.dataset.sys){ view = t.dataset.sys; syncLocation(); renderNav(); await render(); return; }

    if(t.dataset.act){
      const i = Number(t.dataset.i), act = t.dataset.act;

      // Delete shifts every later item's index, and the index is what the API
      // addresses. Applying that locally and getting it wrong deletes the
      // wrong row, so this one re-reads rather than guesses.
      if(act==="delete"){
        if(!confirm("Delete this item?")) return;
        const done = working(t, "Deleting");
        try{ await api("/clients/"+current+"/content/"+view+"/"+i,{method:"DELETE"}); await refresh(); }
        finally { done(); }
        return;
      }

      // Approve and publish change one row and nothing else, so the row changes
      // now and the request follows. Waiting for a round trip to move a
      // checkbox is what made working through a review queue feel broken.
      const sec = detail.sections.find(x=>x.kind===view);
      const item = sec && sec.items.find(x=>x.index===i);
      if(!item) return;

      const before = {approved:item.approved, published:item.published};
      const body = act==="approve"?{approved:true}
        : act==="unapprove"?{approved:false,published:false}
        : act==="publish"?{published:true}:{published:false};

      Object.assign(item, body); item._pending = true;
      recount(sec); renderNav(); render();

      try{
        await api("/clients/"+current+"/content/"+view+"/"+i,{method:"PATCH",body:JSON.stringify(body)});
        item._pending = false; render();
      }catch(err){
        // Put it back. A row left showing a state the server rejected is worse
        // than the pause this replaced.
        Object.assign(item, before); item._pending = false;
        recount(sec); renderNav(); render();
        toast("Not saved — " + err.message);
      }
      return;
    }

    if(t.dataset.bulk){
      const done = working(t, "Applying");
      try{
        await api("/clients/"+current+"/content/"+view+"/bulk",{method:"POST",body:JSON.stringify({action:t.dataset.bulk})});
        await refresh(); toast("Done.");
      } finally { done(); }
      return;
    }

    if(t.id==="addItem"){
      const body={};
      document.querySelectorAll("[data-new]").forEach(el=>{
        const k=el.dataset.new, v=el.value.trim(); if(!v) return;
        body[k] = k==="zips" ? v.split(",").map(z=>z.trim()).filter(Boolean) : v;
      });
      if(!Object.keys(body).length){ toast("Nothing to add."); return; }
      const done = working(t, "Adding");
      try{
        await api("/clients/"+current+"/content/"+view,{method:"POST",body:JSON.stringify(body)});
        await refresh(); toast("Added, approved, not yet published.");
      } finally { done(); }
      return;
    }

    if(t.dataset.hclosed!==undefined){
      const day=t.dataset.hclosed;
      document.querySelector('[data-hopens="'+day+'"]').disabled = t.checked;
      document.querySelector('[data-hcloses="'+day+'"]').disabled = t.checked;
      return;
    }

    if(t.id==="hours247"||t.id==="hoursWeekdays"){
      const all = t.id==="hours247";
      [0,1,2,3,4,5,6].forEach(day=>{
        const closed = all ? false : (day===0||day===6);
        document.querySelector('[data-hclosed="'+day+'"]').checked = closed;
        document.querySelector('[data-hopens="'+day+'"]').value = closed?"":(all?"00:00":"08:00");
        document.querySelector('[data-hcloses="'+day+'"]').value = closed?"":(all?"23:59":"17:00");
        document.querySelector('[data-hopens="'+day+'"]').disabled = closed;
        document.querySelector('[data-hcloses="'+day+'"]').disabled = closed;
      });
      toast("Filled in — press Save profile to keep it.");
      return;
    }

    if(t.id==="saveProfile"){
      const raw = JSON.parse(JSON.stringify(detail.profile)); raw.address = raw.address||{};
      const LISTS=["sameAs","imageUrls","paymentAccepted","languages","memberOf","awards"];
      const lines=v=>(v||"").split("\n").map(s=>s.trim()).filter(Boolean);
      let geoLat=null, geoLng=null;

      document.querySelectorAll("[data-p]").forEach(el=>{
        const k=el.dataset.p, v=el.value.trim()===""?null:el.value.trim();
        if(k.startsWith("address.")) raw.address[k.slice(8)] = v;
        else if(k==="geo.latitude") geoLat = v;
        else if(k==="geo.longitude") geoLng = v;
        else if(k==="foundedYear"||k==="numberOfEmployees") raw[k] = v?Number(v):null;
        else if(LISTS.indexOf(k)!==-1) raw[k] = lines(v);
        else if(k==="businessType") raw[k] = v||"storefront";
        else if(k==="attributes"){
          // "Veteran-owned = Yes" or bare "Free estimates".
          raw[k] = lines(v).map(line=>{
            const i=line.indexOf("=");
            return i===-1 ? {name:line, value:"Yes"}
                          : {name:line.slice(0,i).trim(), value:line.slice(i+1).trim()||"Yes"};
          });
        }
        else if(k==="contactPoints"){
          raw[k] = lines(v).map(line=>{
            const parts=line.split("|").map(s=>s.trim());
            return {contactType:parts[0]||"customer service", phone:parts[1]||null, email:parts[2]||null};
          }).filter(c=>c.phone||c.email);
        }
        else if(k==="specialHours"){
          raw[k] = lines(v).map(line=>{
            const parts=line.split("|").map(s=>s.trim());
            const closed = (parts[1]||"").toLowerCase()==="closed";
            return {date:parts[0], isClosed:closed,
                    opens:closed?null:(parts[1]||null), closes:closed?null:(parts[2]||null)};
          }).filter(h=>/^\d{4}-\d{2}-\d{2}$/.test(h.date||""));
        }
        else raw[k] = v;
      });

      // Half a coordinate places the business in the ocean, so both or neither.
      raw.geo = (geoLat && geoLng) ? {latitude:Number(geoLat), longitude:Number(geoLng)} : null;

      // Hours are collected from the seven-day grid rather than data-p, since a
      // day is three controls that only mean anything together.
      if(document.querySelector("[data-hclosed]")){
        raw.hours = [0,1,2,3,4,5,6].map(day=>{
          const closed = document.querySelector('[data-hclosed="'+day+'"]').checked;
          const opens = document.querySelector('[data-hopens="'+day+'"]').value.trim();
          const closes = document.querySelector('[data-hcloses="'+day+'"]').value.trim();
          return {day, isClosed:closed, opens:closed?null:(opens||null), closes:closed?null:(closes||null)};
        });
      }
      const done = working(t, "Saving");
      try{
        await api("/clients/"+current+"/profile",{method:"PUT",body:JSON.stringify(raw)});
        await refresh(); toast("Profile saved.");
      } finally { done(); }
      return;
    }

    if(t.id==="saveSettings"){
      const body={links:{}};
      document.querySelectorAll("[data-s]").forEach(el=>body[el.dataset.s]=el.value);
      document.querySelectorAll("[data-l]").forEach(el=>body.links[el.dataset.l]=el.value.trim());
      // Source config is not on this page any more; it saves on blur from the
      // Sources cards where it lives.
      const done = working(t, "Saving");
      try{
        await api("/clients/"+current+"/settings",{method:"PATCH",body:JSON.stringify(body)});
        await refresh(); toast("Settings saved.");
      } finally { done(); }
      return;
    }

    if(t.id==="deleteClient"){
      const name = detail.settings.name;
      if(!confirm("Delete "+name+" and all their content? This cannot be undone.")) return;
      const done = working(t, "Deleting");
      try{
        await api("/clients/"+current,{method:"DELETE"});
        current=null; detail=null; view="clients"; syncLocation();
        await loadClients(); await render(); toast(name+" deleted.");
      } finally { done(); }
      return;
    }

    // --- billing ------------------------------------------------------------

    if(t.dataset.bill){
      await openClient(t.dataset.bill, "client-billing", t);
      return;
    }

    if(t.id==="seedCatalog"){
      const done = working(t, "Creating");
      try{
        const r = await api("/billing/catalog",{method:"POST",body:JSON.stringify({})});
        await render();
        toast("Created "+r.monthly.productName+" and "+r.setup.productName+" in Stripe.");
      } finally { done(); }
      return;
    }

    /**
     * The whole flow, in one press.
     *
     * Creates the payment link. The client pays it once and Stripe charges
     * their card every month afterwards — there is no invoice to raise here,
     * this month or any other.
     */
    if(t.id==="startBilling"){
      const setup = $("bSetup").value;
      const replacing = t.textContent.indexOf("Replace") !== -1;
      if(replacing && !confirm("Create a new link? The current one stops working immediately.")) return;

      const done = working(t, "Creating");
      try{
        await api("/billing/clients/"+current+"/start",{method:"POST",body:JSON.stringify({
          priceId: $("bPlan").value,
          setupPriceId: setup || null,
          contactEmail: $("bEmail").value.trim(),
        })});
        await render();
        // Straight to the clipboard: the link is the only reason the button was
        // pressed, and making someone hunt for it afterwards is the sort of
        // step this rebuild exists to remove.
        const box = $("payLink");
        if(box){
          try{ await navigator.clipboard.writeText(box.value); toast("Link created and copied — send it to them."); }
          catch{ toast("Link created — copy it below."); }
        }
      } finally { done(); }
      return;
    }

    /**
     * Reveal the card field and hand it to Stripe.
     *
     * Mounted on demand rather than with the page: an iframe that loads on
     * every visit to a billing page is a card form sitting open in front of
     * whoever walks past the screen.
     */
    if(t.id==="showCard"){
      const email = $("bEmail").value.trim();
      if(!email){ toast("Their email first — the receipt has to go somewhere."); $("bEmail").focus(); return; }

      $("cardCard").hidden = false;
      $("cardCard").scrollIntoView({behavior:"smooth", block:"nearest"});
      await mountCard();
      return;
    }

    if(t.id==="hideCard"){
      $("cardCard").hidden = true;
      unmountCard();
      return;
    }

    if(t.id==="chargeCard"){
      await chargeCard(t);
      return;
    }

    if(t.id==="copyPayLink"){
      await navigator.clipboard.writeText($("payLink").value);
      toast("Copied.");
      return;
    }

    if(t.id==="cancelSub"){
      if(!confirm("Cancel at the end of the paid period? They keep the month they have paid for.")) return;
      const done = working(t, "Cancelling");
      try{
        await api("/billing/clients/"+current+"/cancel",{method:"POST",body:JSON.stringify({})});
        await render(); toast("Cancelling at period end.");
      } finally { done(); }
      return;
    }

    if(t.id==="resumeSub"){
      const done = working(t, "Resuming");
      try{
        await api("/billing/clients/"+current+"/resume",{method:"POST",body:JSON.stringify({})});
        await render(); toast("Still on — the next charge will go ahead.");
      } finally { done(); }
      return;
    }

    if(t.id==="stripePortal"){
      const done = working(t, "Opening");
      try{
        const r = await api("/billing/clients/"+current+"/portal",{method:"POST",body:JSON.stringify({})});
        window.open(r.url, "_blank", "noopener");
      } finally { done(); }
      return;
    }


    if(t.id==="runAudit"){
      const at = {slug:current, view};
      const done = startJob("#runAudit", "Checking");
      const hide = busy("Running the Tier 1 checks",
        "Fetching the site as each AI crawler in turn, then reading robots.txt, the sitemap and the contact details. Usually a few seconds.");
      try{
        const r = await api("/clients/"+current+"/tier1/run",{method:"POST",body:JSON.stringify({})});
        toast(r.report.failed===0?"All automated checks passed.":r.report.failed+" check(s) failing.");
      } finally { hide(); done(); if(current===at.slug && view===at.view) await render(); }
      return;
    }

    if(t.dataset.gen){
      const mode = t.dataset.gen, dry = mode==="dry";
      const at = {slug:current, view};
      const out=$("genOut"); if(out) out.textContent="Running…";
      const done = startJob('[data-gen="'+mode+'"]', dry?"Previewing":"Generating");
      const hide = busy(dry ? "Previewing the questions" : "Generating questions",
        "Assembling questions from this client's approved service areas, hours, credentials and brands.");
      try{
        const r = await api("/clients/"+current+"/generate/faqs",
          {method:"POST",body:JSON.stringify({dryRun:dry})});
        await settle(at);
        if($("genOut")) $("genOut").textContent = r.output;
        toast(dry ? "Preview only — nothing written." : "Generated. Read them before approving.");
      } finally { hide(); done(); }
      return;
    }

    if(t.dataset.run){
      const kind = t.dataset.run;
      const copy = {
        website:["Crawling the website","Fetching pages one at a time with a pause between each, because robots.txt is respected rather than raced. A minute or two is normal."],
        places:["Reading the Google listing","Fetching this client's place details from Google. A few seconds."],
        promote:["Promoting candidates","Merging every source into the content lists. Blanks get filled; nothing a person wrote is overwritten."],
      }[kind];

      const at = {slug:current, view};
      const out=$("runOut"); if(out) out.textContent="Running…";
      const done = startJob('[data-run="'+kind+'"]', "Running");
      const hide = busy(copy[0], copy[1]);

      try{
        const map={places:"/intake/places",website:"/intake/website",promote:"/promote"};
        const r = await api("/clients/"+current+map[kind],{method:"POST",body:JSON.stringify({})});
        await settle(at);
        if($("runOut")) $("runOut").textContent = r.output;
        if(kind!=="promote" && detail.pendingIntake && detail.pendingIntake.total>0){
          toast(detail.pendingIntake.total+" candidates found — press Promote to add them.", 6000);
        } else {
          toast(r.ok?"Finished.":"Finished with errors — see output.");
        }
      } finally { hide(); done(); }
      return;
    }

    if(t.dataset.db){
      const mode = t.dataset.db;
      const out=$("dbOut"); if(out) out.textContent="Running…";
      const done = startJob('[data-db="'+mode+'"]', mode==="dry"?"Checking":"Loading");
      const hide = busy(
        mode==="dry" ? "Checking what would be loaded" : mode==="publish" ? "Loading and publishing" : "Loading into the database",
        mode==="publish"
          ? "Writing approved content to the database and marking this client live. After this the public API will serve them."
          : "Writing approved content to the database. Nothing goes live until you publish.");
      try{
        const body = mode==="dry"?{dryRun:true}:mode==="publish"?{publish:true}:{};
        const r = await api("/clients/"+current+"/publish/database",{method:"POST",body:JSON.stringify(body)});
        if($("dbOut")) $("dbOut").textContent = r.output;
        toast(r.ok===false?"Finished with errors — see output.":"Done.");
      } finally { hide(); done(); }
      return;
    }

    if(t.id==="loadJsonld"){
      const done = startJob("#loadJsonld", "Generating");
      let r; try { r = await api("/clients/"+current+"/jsonld"); } finally { done(); }
      $("jsonldOut").textContent = JSON.stringify(r.graph,null,2);

      const issues = r.issues||[];
      const errors = issues.filter(i=>i.severity==="error");
      const warns  = issues.filter(i=>i.severity!=="error");
      const row=i=>'<div style="margin:.15rem 0"><code>'+esc(i.path)+'</code> &mdash; '+esc(i.message)+'</div>';

      $("jsonldIssues").innerHTML =
        (errors.length
          ? '<div class="banner bad"><strong>'+errors.length+' invalid schema.org propert'+(errors.length===1?"y":"ies")+
            '.</strong> Crawlers drop '+(errors.length===1?"it":"them")+' silently.'+errors.map(row).join("")+'</div>'
          : '')+
        (warns.length
          ? '<div class="banner warn"><strong>'+warns.length+' thing'+(warns.length===1?"":"s")+' worth a look.</strong>'+warns.map(row).join("")+'</div>'
          : '')+
        (!issues.length ? '<div class="banner ok"><strong>Valid schema.org.</strong> Every property checked against the vocabulary.</div>' : '');

      if(errors.length) toast(errors.length+" invalid propert"+(errors.length===1?"y":"ies")+" — see above.");
      else if(r.warnings.length) toast(r.warnings[0]);
      return;
    }
    if(t.id==="copySnippet"){
      const json = $("jsonldOut").textContent;
      if(!json || json.indexOf("{")===-1){ toast("Press Generate first."); return; }
      // Escape the closing-tag sequence so a string inside the JSON cannot end
      // the script element early. Note this comment cannot spell that sequence
      // out: this whole file is served inside an inline script, so writing it
      // here truncated the page and froze the portal on "Loading…".
      await navigator.clipboard.writeText(
        '<script type="application/ld+json">\n'+json.replace(/<\//g,"<\\/")+'\n<\/script>');
      toast("Snippet copied — paste it into the site's <head>.");
      return;
    }

    if(t.id==="createAgency"){
      const name = ($("agName").value||"").trim(), email = ($("agEmail").value||"").trim();
      if(!name || !email){ toast("Both a name and an owner email are needed."); return; }
      const done = working(t, "Creating");
      try{
        const r = await api("/platform/agencies",{method:"POST",body:JSON.stringify({name,ownerEmail:email})});
        $("agOut").innerHTML = '<div class="banner '+(r.emailed?"ok":"warn")+'" style="margin-top:.7rem">'+
          '<strong>'+esc(r.agency.name)+'</strong> &mdash; '+esc(r.note)+'</div>';
        $("agName").value=""; $("agEmail").value="";
      } finally { done(); }
      return;
    }

    if(t.id==="sendInvite"){
      const email = ($("inviteEmail").value||"").trim();
      if(!email){ toast("Enter an email address."); return; }
      const done = working(t, "Sending");
      try{
        const r = await api("/agency/invites",{method:"POST",body:JSON.stringify({email})});
        // Rendered rather than toasted: when the email cannot be sent the note
        // explains what to do instead, and that should not vanish after 3s.
        $("inviteOut").innerHTML = '<div class="banner '+(r.emailed?"ok":"warn")+'" style="margin-top:.7rem">'+
          '<strong>'+esc(r.email)+'</strong> &mdash; '+esc(r.note)+'</div>';
      } finally { done(); }
      return;
    }

    if(t.dataset.rm){
      if(!confirm("Remove "+t.dataset.rm+" from this agency?")) return;
      const done = working(t, "Removing");
      try{
        await api("/agency/members/"+encodeURIComponent(t.dataset.rm),{method:"DELETE"});
        await render(); toast("Removed.");
      } finally { done(); }
      return;
    }

    if(t.id==="runNap"){
      const out=$("napOut"); out.innerHTML='<div class="sub" style="margin:0">Comparing…</div>';
      const done = startJob("#runNap", "Comparing");
      const hide = busy("Comparing name, address and phone",
        "Reading the live site alongside the profile, the crawl and Google. The live fetch is what takes the time.");
      let r; try { r = await api("/clients/"+current+"/nap"); } finally { hide(); done(); }

      const rows = r.findings.map(f=>{
        const cell = f.agrees
          ? '<div class="primary">'+esc(f.groups[0].raw)+'</div><div class="secondary">all '+
            f.values.length+' source'+(f.values.length===1?"":"s")+' agree</div>'
          : f.groups.map(g=>'<div class="primary">'+esc(g.raw)+'</div>'+
              '<div class="secondary">'+esc(g.sources.join(", "))+'</div>').join('<div style="height:.35rem"></div>');
        const pill = f.agrees ? '<span class="pill ok">agrees</span>'
          : '<span class="pill '+(f.severity==="high"?"bad":"wait")+'">'+esc(f.severity)+'</span>';
        return '<tr><td>'+pill+'</td><td class="primary">'+esc(f.field)+'</td><td>'+cell+'</td></tr>';
      }).join("");

      out.innerHTML =
        (r.conflicts>0
          ? '<div class="banner bad"><strong>'+r.conflicts+' inconsistenc'+(r.conflicts===1?"y":"ies")+'.</strong> '+
            'Decide which value is right, set it in the business profile, then correct it wherever it disagrees.</div>'
          : r.findings.length
            ? '<div class="banner ok"><strong>Consistent.</strong> Every source that has an opinion agrees.</div>'
            : '')+
        (r.findings.length
          ? '<table><tr><th></th><th>Field</th><th>Values</th></tr>'+rows+'</table>'
          : '')+
        r.notes.map(n=>'<div class="sub" style="margin:.5rem 0 0">'+esc(n)+'</div>').join("")+
        '<div class="sub" style="margin:.5rem 0 0">Sources compared: '+esc(r.sources.join(", ")||"none")+'</div>';
      return;
    }

    if(t.id==="verifyMarkup"){
      const out=$("verifyOut"); out.innerHTML='<div class="sub">Reading the live site…</div>';
      const done = startJob("#verifyMarkup", "Checking");
      const hide = busy("Checking the live site",
        "Fetching the client's site and comparing the markup published there against what this app would generate now.");
      let r;
      try { r = await api("/clients/"+current+"/verify-markup"); }
      finally { hide(); done(); }

      const banner={current:"ok",stale:"warn",foreign:"bad",missing:"bad"}[r.status];
      const head={current:"Live and current.",stale:"Installed, but out of date.",
                  foreign:"Business markup found, but none of it is ours.",
                  missing:"Not installed."}[r.status];

      out.innerHTML =
        '<div class="banner '+banner+'"><strong>'+esc(head)+'</strong> '+
          esc(r.url)+' — '+r.blocksFound+' JSON-LD block'+(r.blocksFound===1?"":"s")+' on the page.</div>'+
        (r.differences.length
          ? '<table><tr><th>Field</th><th>In the portal</th><th>On the site</th></tr>'+
            r.differences.map(d=>'<tr><td class="primary">'+esc(d.field)+'</td><td>'+esc(d.ours)+
              '</td><td class="meta">'+esc(d.theirs)+'</td></tr>').join("")+'</table>'
          : "")+
        (r.foreignBusinessNodes.length
          ? '<div class="sub" style="margin:.5rem 0 0">Other business nodes on the page: '+
            r.foreignBusinessNodes.map(esc).join("; ")+'</div>'
          : "")+
        r.notes.map(n=>'<div class="sub" style="margin:.5rem 0 0">'+esc(n)+'</div>').join("");
      return;
    }

  }catch(err){ toast(err.message); }
});

function closeNewClient(){ $("newClient").close(); $("ncName").value=""; $("ncDomain").value=""; }
document.addEventListener("change", async e => {
  const box = e.target.closest("[data-manual]"); if(!box) return;
  // The box is already ticked — the browser did that. Re-rendering the page
  // around it on the way in only made the tick appear to lag behind the click.
  const was = !box.checked;
  box.disabled = true;
  try{
    await api("/clients/"+current+"/tier1/manual/"+box.dataset.manual,
      {method:"PATCH",body:JSON.stringify({checked:box.checked})});
    await render();
  }catch(err){
    box.checked = was;
    toast("Not saved — " + err.message);
  } finally { box.disabled = false; }
});

$("ncCancel").addEventListener("click", closeNewClient);

/**
 * Source configuration saves on blur.
 *
 * These fields live beside the button that consumes them, so a Save button per
 * card would be friction on a single input. Saving only when Crawl is pressed
 * would silently lose an edit made and then navigated away from, which is worse
 * than either.
 */
document.addEventListener("change", async e => {
  const el = e.target;
  if(!el.dataset || !el.dataset.src || !current) return;

  const sources = {};
  document.querySelectorAll("[data-src]").forEach(f => sources[f.dataset.src] = f.value.trim());

  el.disabled = true;
  try{
    await api("/clients/"+current+"/settings",{method:"PATCH",body:JSON.stringify({sources})});
    detail.settings.sources = sources;
    toast("Saved.");
  }catch(err){ toast("Not saved — " + err.message); }
  finally { el.disabled = false; el.focus(); }
});

$("pickSearch").addEventListener("input", renderPickList);
$("pickCancel").addEventListener("click", ()=>$("clientPicker").close());
$("pickAdd").addEventListener("click", ()=>{ $("clientPicker").close(); $("newClient").showModal(); });

// Enter picks the only remaining match, so filtering to one client and pressing
// return is the whole interaction.
$("pickSearch").addEventListener("keydown", async e=>{
  if(e.key !== "Enter") return;
  // Excludes the "No client" row, which also carries data-pick and would
  // otherwise make a single filtered match look like two.
  const only = $("pickList").querySelectorAll('[data-pick]:not([data-pick=""])');
  if(only.length !== 1) return;
  e.preventDefault();
  $("clientPicker").close();
  await openClient(only[0].dataset.pick);
});

// Buttons are type="button" and the dialog holds no form, so nothing submits on
// its own. The dialog closes only after the client actually exists — otherwise
// a failed create would close it and swallow the reason.
$("ncGo").addEventListener("click", async () => {
  const name=$("ncName").value.trim(), domain=$("ncDomain").value.trim();
  if(!name||!domain){ toast("Name and domain are both required."); return; }

  const done = working($("ncGo"), "Creating");
  try{
    const r = await api("/clients",{method:"POST",body:JSON.stringify({name,domain,schemaType:$("ncType").value})});
    closeNewClient();
    await loadClients(); await openClient(r.client.slug,"sources");
    toast("Client created. Pull from Google to fill the profile.");
  }catch(err){ toast(err.message); }
  finally{ done(); }
});

/**
 * Reveal Sign out only when there is a session to end.
 *
 * The page is one static string and cannot know whether auth is configured, so
 * it asks. Showing a sign-out button on an unauthenticated install would be a
 * control that does nothing.
 */
async function showSession(){
  try{
    const r = await fetch("/whoami");
    if(!r.ok) return;
    const {user, platformAdmin} = await r.json();
    if(!user) return;
    const form = $("signOut");
    form.hidden = false;
    form.querySelector("button").textContent = "Sign out — " + (user.email || "signed in");

    // Only platform admins see the section exists. The routes behind it are
    // guarded separately and return 404 to everyone else, so hiding it is
    // tidiness rather than the security boundary.
    isPlatformAdmin = !!platformAdmin;
    if(isPlatformAdmin) $("platformNav").hidden = false;
  }catch(err){ /* auth not configured; leave it hidden */ }
}

(async()=>{
  showSession();
  await loadClients();

  // Restore where you were. A stale or hand-edited URL must not strand anyone,
  // so a slug that no longer exists falls through to the normal default.
  const want = parseLocation();

  if(want.slug && clients.some(c=>c.slug===want.slug)){
    await openClient(want.slug, want.view);
  } else if(want.view && SYSTEM_VIEWS.indexOf(want.view)!==-1){
    view = want.view; syncLocation(); renderNav(); await render();
  } else if(clients.length){
    await openClient(clients[0].slug);
  } else {
    view = "clients"; syncLocation(); render();
  }
})();
</script>
</body>
</html>`;

/**
 * Fails loudly at startup if the page contains more than one script element.
 *
 * The whole portal is one inline script, so the closing-tag sequence appearing
 * anywhere in this file — including inside a comment, which is how it happened —
 * truncates the script at that point. Everything after it silently vanishes.
 *
 * The failure gives no useful signal: the page returns 200, the API answers
 * normally, the server logs nothing, and the portal simply sits on "Loading…"
 * forever. Diagnosing it meant extracting the inline script and running it
 * through a parser. A one-line assertion at boot is cheaper than doing that
 * twice.
 */
function assertSingleScript(html: string): void {
  // Only the closing sequence matters. An opening tag inside a JS string is
  // inert — the page legitimately contains one, in the code that wraps the
  // graph in a script tag for pasting — because an HTML parser inside a script
  // element is looking for the close and nothing else.
  // Two: the page's own inline script, and Stripe.js. Anything else is the
  // sequence appearing where it was not meant to, which truncates the page.
  const closes = html.split("<" + "/script>").length - 1;

  if (closes !== 2) {
    throw new Error(
      `The admin page must contain exactly two closing script tags, found ${closes}. ` +
        `Something in src/admin/ui.ts wrote the sequence literally — most likely in a ` +
        `comment or a string — which truncates the page there and leaves the portal ` +
        `stuck on "Loading…" with a healthy server and a 200 response. Split the ` +
        `sequence, as this function does.`
    );
  }
}

assertSingleScript(ADMIN_HTML);
