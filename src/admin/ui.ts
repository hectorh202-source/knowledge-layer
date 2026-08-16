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
.navlabel{font-size:.67rem;text-transform:uppercase;letter-spacing:.09em;
  color:#5d6675;padding:.9rem .5rem .3rem}
.nav{display:block;width:100%;text-align:left;background:none;border:0;color:var(--sidebar-ink);
  padding:.44rem .55rem;border-radius:7px;cursor:pointer;font:inherit;font-size:.87rem}
.nav:hover{background:rgba(255,255,255,.06);color:#fff}
.nav.on{background:var(--accent);color:#fff}
.nav .badge{float:right;font-size:.72rem;opacity:.75}
.client{display:flex;align-items:center;gap:.5rem}
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
.banner.ok{border-left-color:var(--ok);background:var(--okbg)}
.banner.warn{border-left-color:var(--warn);background:var(--warnbg)}
.banner.bad{border-left-color:var(--bad);background:var(--badbg)}
button.btn{font:inherit;font-size:.83rem;padding:.4rem .75rem;border-radius:7px;
  border:1px solid var(--line);background:var(--panel);color:var(--ink);cursor:pointer}
button.btn:hover{border-color:var(--accent)}
button.btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
button.btn.danger{color:var(--bad)}
button.btn:disabled{opacity:.5;cursor:not-allowed}
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
  </aside>
  <main id="main"><div class="empty">Loading…</div></main>
</div>

<dialog id="newClient">
  <div class="dlg-b">
    <h2 style="margin-bottom:.8rem">Add a client</h2>
    <label class="f"><span>Business name</span><input id="ncName" placeholder="TitanZ Plumbing &amp; Air Conditioning"></label>
    <label class="f"><span>Website domain</span><input id="ncDomain" placeholder="calltitanz.com"></label>
    <label class="f"><span>Business type (schema.org)</span>
      <select id="ncType">
        <option>LocalBusiness</option><option>Plumber</option><option>HVACBusiness</option>
        <option>Electrician</option><option>RoofingContractor</option>
        <option>GeneralContractor</option><option>HomeAndConstructionBusiness</option>
      </select></label>
    <div class="sub" style="margin:0">Nothing is invented. The profile starts empty and fills from Google, then the website, then you.</div>
  </div>
  <div class="dlg-f">
    <button class="btn" type="button" id="ncCancel">Cancel</button>
    <button class="btn primary" type="button" id="ncGo">Create</button>
  </div>
</dialog>

<div id="toast"></div>

<script>
const KINDS = {
  "services":{label:"Services",fields:[["name","Service name"],["category","Category"],["description","Description"]]},
  "service-areas":{label:"Service areas",fields:[["name","City or area"],["zips","ZIP codes (comma separated)"]]},
  "brands":{label:"Brands",fields:[["name","Brand"]]},
  "faqs":{label:"Questions & answers",fields:[["question","Question"],["answer","Answer"]]},
  "credentials":{label:"Licenses & credentials",fields:[["title","Title"],["identifier","Number"],["issuer","Issuer"],["validUntil","Valid until (YYYY-MM-DD)"]]}
};
const SECTIONS = ["overview","discoverability","profile",...Object.keys(KINDS),"sources","publishing","settings"];
const LABELS = {overview:"Overview",discoverability:"Discoverability",profile:"Business profile",sources:"Sources",publishing:"Publishing",settings:"Settings",...Object.fromEntries(Object.entries(KINDS).map(([k,v])=>[k,v.label]))};

let clients = [], current = null, view = "clients", detail = null;

const esc = s => String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const $ = id => document.getElementById(id);

function toast(msg,ms=3200){const t=$("toast");t.textContent=msg;t.classList.add("show");
  clearTimeout(t._h);t._h=setTimeout(()=>t.classList.remove("show"),ms);}

async function api(path,opts){
  const r = await fetch("/admin/api"+path,{headers:{"Content-Type":"application/json"},...opts});
  const body = await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(body.error||("HTTP "+r.status));
  return body;
}

async function loadClients(){ clients = (await api("/clients")).clients; renderNav(); }

async function openClient(slug,section){
  current = slug; view = section||"overview";
  detail = await api("/clients/"+slug);
  renderNav(); render();
}

function renderNav(){
  const nav = $("clientNav");
  let html = '<div class="navlabel">Clients</div>';
  for(const c of clients){
    // Red when the profile is incomplete OR discoverability is failing —
    // both block being found, so both should show at a glance.
    const ready = c.blockingCount===0 && !(c.tier1 && c.tier1.failed>0);
    html += '<button class="nav '+(current===c.slug&&view!=="status"&&view!=="clients"?"on":"")+'" data-client="'+esc(c.slug)+'">'+
      '<span class="client"><span class="dot '+(ready?"ready":"blocked")+'"></span>'+esc(c.name)+'</span>'+
      '<span class="badge">'+c.approvedCount+"/"+c.itemCount+'</span></button>';
  }
  html += '<button class="nav" data-add="1">+ Add client</button>';

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

function contentView(kind){
  const sec = detail.sections.find(s=>s.kind===kind);
  const rows = sec.items.map(it=>
    '<tr><td>'+statusPill(it)+'</td><td><div class="primary">'+esc(it.primary)+'</div>'+
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
      '<button class="btn primary" id="addItem">Add</button></div></div>';
}

function profileView(){
  const p = detail.profile, a = p.address||{};
  const f=(k,l,v)=>'<label class="f"><span>'+l+'</span><input data-p="'+k+'" value="'+esc(v??"")+'"></label>';
  const blocking = detail.validation.blocking;

  return '<h1>Business profile</h1><div class="sub">Who this business is. Without name, phone and location an answer engine cannot resolve it at all.</div>'+
    (blocking.length? '<div class="banner bad"><strong>Blocking:</strong> '+blocking.map(esc).join(", ")+'</div>'
      : '<div class="banner ok"><strong>Entity resolves.</strong></div>')+
    (detail.validation.missing.length? '<div class="banner warn"><strong>Missing:</strong> '+detail.validation.missing.map(esc).join(", ")+'</div>':"")+
    '<div class="card"><div class="card-h"><h2>Identity</h2></div><div class="card-b"><div class="cols2">'+
      f("name","Business name",p.name)+f("legalName","Legal name",p.legalName)+
      f("phone","Phone (canonical NAP)",p.phone)+f("email","Email",p.email)+
      f("domain","Domain",p.domain)+f("gbpUrl","Google Business Profile URL",p.gbpUrl)+
      f("foundedYear","Founded",p.foundedYear)+f("responseTime","Response time",p.responseTime)+
    '</div><label class="f"><span>Description</span><textarea data-p="description">'+esc(p.description??"")+'</textarea></label>'+
    '</div></div>'+
    '<div class="card"><div class="card-h"><h2>Address</h2></div><div class="card-b"><div class="cols2">'+
      f("address.street","Street",a.street)+f("address.city","City",a.city)+
      f("address.region","State",a.region)+f("address.postalCode","ZIP",a.postalCode)+
    '</div></div></div>'+
    '<div class="card"><div class="card-h"><h2>Hours</h2><span class="meta">'+detail.openDays+' open days of 7</span></div>'+
      '<div class="card-b"><div class="sub" style="margin:0">Google Places fills these. A day that is neither closed nor has times is treated as unknown, not open.</div></div></div>'+
    '<button class="btn primary" id="saveProfile">Save profile</button>';
}

function overviewView(){
  const s = detail.summary, pending = s.itemCount - s.approvedCount;
  const stat=(n,l)=>'<div class="stat"><div class="n">'+n+'</div><div class="l">'+l+'</div></div>';

  const t = s.tier1;
  return '<h1>'+esc(s.name)+'</h1><div class="sub">'+esc(s.domain||"no domain set")+'</div>'+
    (!t || !t.ran
      ? '<div class="banner warn"><strong>Discoverability not checked.</strong> Until it is, there is no evidence AI can reach this site at all. <button class="btn" data-goto="discoverability" style="margin-left:.4rem">Check now</button></div>'
      : t.failed>0
        ? '<div class="banner bad"><strong>'+t.failed+' discoverability check'+(t.failed===1?"":"s")+' failing.</strong> These block being found. <button class="btn" data-goto="discoverability" style="margin-left:.4rem">Review</button></div>'
        : t.complete ? '<div class="banner ok"><strong>Tier 1 complete.</strong> Ready for Tier 2.</div>' : "")+
    (s.blockingCount>0? '<div class="banner bad"><strong>'+s.blockingCount+' blocking gap'+(s.blockingCount===1?"":"s")+
      ' in the business profile.</strong> The API serves no business record and the catalog will not publish until these are filled.</div>':"")+
    ((detail.pendingIntake&&detail.pendingIntake.total>0)
      ? '<div class="banner warn"><strong>'+detail.pendingIntake.total+' extracted candidate'+
        (detail.pendingIntake.total===1?"":"s")+' not yet promoted.</strong> They stay out of the sections until you do. '+
        '<button class="btn" data-goto="sources" style="margin-left:.4rem">Go to Sources</button></div>'
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
    '<div class="card"><div class="card-h"><h2>Needs a person</h2><span class="meta">'+doneManual+' of '+t.manualChecks.length+' confirmed</span></div>'+
      '<div class="card-b" style="padding-bottom:0"><div class="sub">These need an account login or judgment. Unchecked means unverified, not failing.</div></div>'+
      '<table>'+manualRows+'</table></div>';
}

function sourcesView(){
  const p = detail.pendingIntake || {total:0};
  const parts = Object.entries(p).filter(([k,v])=>k!=="total"&&v>0)
    .map(([k,v])=>v+" "+(LABELS[k]||k).toLowerCase());

  return '<h1>Sources</h1><div class="sub">Google first, then the website, then you. Everything extracted arrives unapproved.</div>'+
  (p.total>0
    ? '<div class="banner warn"><strong>'+p.total+' candidate'+(p.total===1?"":"s")+' waiting to be promoted'+
      (parts.length?' — '+esc(parts.join(", ")):"")+'.</strong> A crawl only writes candidates; '+
      'until you promote them the sections stay empty. '+
      '<button class="btn primary" data-run="promote" style="margin-left:.4rem">Promote now</button></div>'
    : "")+
  '<div class="card"><div class="card-h"><h2>1 &nbsp;Google Places</h2><span class="meta">no customer authorization needed</span></div>'+
    '<div class="card-b"><div class="sub" style="margin:0 0 .7rem">Hours, address and phone from public Google data using your own API key. Google permits storing place_id only, so treat the rest as a suggestion the owner confirms.</div>'+
    '<button class="btn primary" data-run="places">Pull from Google</button></div></div>'+
  '<div class="card"><div class="card-h"><h2>2 &nbsp;Website</h2></div><div class="card-b">'+
    '<div class="sub" style="margin:0 0 .7rem">Crawls the domain, respecting robots.txt. Prefers structured data the site already publishes.</div>'+
    '<button class="btn primary" data-run="website">Crawl website</button></div></div>'+
  '<div class="card"><div class="card-h"><h2>3 &nbsp;Promote into content</h2>'+
    (p.total>0?'<span class="pill wait">'+p.total+' waiting</span>':"")+'</div><div class="card-b">'+
    '<div class="sub" style="margin:0 0 .7rem"><strong>Required.</strong> Crawling only writes candidates to an intake file — '+
    'this is the step that puts them into Services, Q&amp;A and the rest. Combines every source, and never '+
    'overwrites a value a person entered; conflicts are reported instead.</div>'+
    '<button class="btn primary" data-run="promote">Promote candidates</button></div></div>'+
  '<div class="card"><div class="card-h"><h2>Output</h2></div><pre id="runOut">Run a source to see its output.</pre></div>';
}

function publishingView(){
  return '<h1>Publishing</h1><div class="sub">What leaves this system, and where it goes.</div>'+
  '<div class="card"><div class="card-h"><h2>schema.org JSON-LD</h2>'+
    '<div class="row"><button class="btn" id="loadJsonld">Generate</button><button class="btn" id="copyJsonld">Copy</button></div></div>'+
    '<div class="card-b"><div class="sub" style="margin:0 0 .7rem">Works today with Google and every AI crawler. Goes in the page head, or is fetched live from <code>/jsonld</code>.</div>'+
    '<pre id="jsonldOut">Not generated yet.</pre></div></div>'+
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
  '<div class="card"><div class="card-h"><h2>Business</h2></div><div class="card-b">'+
    '<label class="f"><span>Business name</span><input data-s="name" value="'+esc(s.name)+'"></label>'+
    '<label class="f"><span>Domain</span><input data-s="domain" value="'+esc(s.domain)+'"></label>'+
    '<label class="f"><span>schema.org type</span><select data-s="schemaType">'+
      ["LocalBusiness","Plumber","HVACBusiness","Electrician","RoofingContractor","GeneralContractor","HomeAndConstructionBusiness"]
        .map(t=>'<option '+(t===s.schemaType?"selected":"")+'>'+t+'</option>').join("")+'</select></label>'+
    '<label class="f"><span>Public API URL (once deployed)</span><input data-s="apiBaseUrl" value="'+esc(s.apiBaseUrl)+'" placeholder="https://api.'+esc(s.domain)+'"></label>'+
  '</div></div>'+

  '<div class="card"><div class="card-h"><h2>Content sources</h2></div><div class="card-b">'+
    '<div class="sub">Point the extractor straight at the right pages. More accurate than guessing '+
    'at URL conventions — a site that says &quot;What We Do&quot; instead of &quot;Services&quot; finds nothing otherwise. '+
    'Leave blank to fall back to the heuristics.</div>'+
    '<label class="f"><span>Services page URL'+
      (S.servicesPageUrl?' &nbsp;<a href="'+esc(S.servicesPageUrl)+'" target="_blank" rel="noopener">open ↗</a>':"")+
      '</span><input data-src="servicesPageUrl" value="'+esc(S.servicesPageUrl||"")+'" placeholder="https://'+esc(s.domain)+'/what-we-do"></label>'+
    '<label class="f"><span>Service areas page URL'+
      (S.serviceAreasPageUrl?' &nbsp;<a href="'+esc(S.serviceAreasPageUrl)+'" target="_blank" rel="noopener">open ↗</a>':"")+
      '</span><input data-src="serviceAreasPageUrl" value="'+esc(S.serviceAreasPageUrl||"")+'" placeholder="https://'+esc(s.domain)+'/coverage"></label>'+
  '</div></div>'+

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
  '</table></div>';
}

function clientsView(){
  return '<h1>Clients</h1><div class="sub">'+clients.length+' configured. Adding one creates its own isolated content set.</div>'+
  '<div class="card">'+(clients.length?'<table><tr><th>Client</th><th>Domain</th><th>Discoverability</th><th>Items</th><th>Approved</th><th>Live</th><th></th></tr>'+
    clients.map(c=>'<tr><td><span class="client"><span class="dot '+(c.blockingCount===0?"ready":"blocked")+'"></span><span class="primary">'+esc(c.name)+'</span></span></td>'+
    '<td class="meta">'+esc(c.domain||"—")+'</td><td class="meta">'+tier1Pill(c.tier1)+'</td><td class="meta">'+c.itemCount+'</td><td class="meta">'+c.approvedCount+
    '</td><td class="meta">'+c.publishedCount+'</td><td class="meta"><button class="btn" data-open="'+esc(c.slug)+'">Open</button></td></tr>').join("")+
    '</table>':'<div class="empty">No clients yet. Add the first one from the sidebar.</div>')+'</div>';
}

async function render(){
  const m = $("main");
  if(view==="status"){ m.innerHTML = await statusView(); return; }
  if(view==="clients" || !current){ m.innerHTML = clientsView(); return; }
  if(view==="discoverability"){ m.innerHTML = await discoverabilityView(); return; }
  if(view==="overview") m.innerHTML = overviewView();
  else if(view==="profile") m.innerHTML = profileView();
  else if(view==="sources") m.innerHTML = sourcesView();
  else if(view==="publishing") m.innerHTML = publishingView();
  else if(view==="settings") m.innerHTML = settingsView();
  else m.innerHTML = contentView(view);
}

async function refresh(){ detail = await api("/clients/"+current); await loadClients(); renderNav(); await render(); }

// --- events ---------------------------------------------------------------
document.addEventListener("click", async e => {
  const t = e.target.closest("button"); if(!t) return;
  try{
    if(t.dataset.client){ await openClient(t.dataset.client); return; }
    if(t.dataset.open){ await openClient(t.dataset.open); return; }
    if(t.dataset.add !== undefined){ $("newClient").showModal(); return; }
    if(t.dataset.sec){ view = t.dataset.sec; renderNav(); await render(); return; }
    if(t.dataset.goto){ view = t.dataset.goto; renderNav(); await render(); return; }
    if(t.dataset.sys){ view = t.dataset.sys; current = t.dataset.sys==="clients"?current:current; renderNav(); await render(); return; }

    if(t.dataset.act){
      const i = t.dataset.i, act = t.dataset.act;
      if(act==="delete"){
        if(!confirm("Delete this item?")) return;
        await api("/clients/"+current+"/content/"+view+"/"+i,{method:"DELETE"});
      } else {
        const body = act==="approve"?{approved:true}
          : act==="unapprove"?{approved:false,published:false}
          : act==="publish"?{published:true}:{published:false};
        await api("/clients/"+current+"/content/"+view+"/"+i,{method:"PATCH",body:JSON.stringify(body)});
      }
      await refresh(); return;
    }

    if(t.dataset.bulk){
      await api("/clients/"+current+"/content/"+view+"/bulk",{method:"POST",body:JSON.stringify({action:t.dataset.bulk})});
      toast("Done."); await refresh(); return;
    }

    if(t.id==="addItem"){
      const body={};
      document.querySelectorAll("[data-new]").forEach(el=>{
        const k=el.dataset.new, v=el.value.trim(); if(!v) return;
        body[k] = k==="zips" ? v.split(",").map(z=>z.trim()).filter(Boolean) : v;
      });
      if(!Object.keys(body).length){ toast("Nothing to add."); return; }
      await api("/clients/"+current+"/content/"+view,{method:"POST",body:JSON.stringify(body)});
      toast("Added, approved, not yet published."); await refresh(); return;
    }

    if(t.id==="saveProfile"){
      const raw = JSON.parse(JSON.stringify(detail.profile)); raw.address = raw.address||{};
      document.querySelectorAll("[data-p]").forEach(el=>{
        const k=el.dataset.p, v=el.value.trim()===""?null:el.value.trim();
        if(k.startsWith("address.")) raw.address[k.slice(8)] = v;
        else if(k==="foundedYear") raw[k] = v?Number(v):null;
        else raw[k] = v;
      });
      await api("/clients/"+current+"/profile",{method:"PUT",body:JSON.stringify(raw)});
      toast("Profile saved."); await refresh(); return;
    }

    if(t.id==="saveSettings"){
      const body={links:{}};
      document.querySelectorAll("[data-s]").forEach(el=>body[el.dataset.s]=el.value);
      document.querySelectorAll("[data-l]").forEach(el=>body.links[el.dataset.l]=el.value.trim());
      body.sources={}; document.querySelectorAll("[data-src]").forEach(el=>body.sources[el.dataset.src]=el.value.trim());
      await api("/clients/"+current+"/settings",{method:"PATCH",body:JSON.stringify(body)});
      toast("Settings saved."); await refresh(); return;
    }

    if(t.id==="deleteClient"){
      if(!confirm("Delete "+detail.settings.name+" and all their content? This cannot be undone.")) return;
      await api("/clients/"+current,{method:"DELETE"});
      current=null; view="clients"; await loadClients(); await render(); toast("Client deleted."); return;
    }

    if(t.id==="runAudit"){
      t.disabled=true; t.textContent="Checking the site as each crawler…";
      try{
        const r = await api("/clients/"+current+"/tier1/run",{method:"POST",body:JSON.stringify({})});
        toast(r.report.failed===0?"All automated checks passed.":r.report.failed+" check(s) failing.");
      } finally { await render(); }
      return;
    }

    if(t.dataset.run){
      const out=$("runOut"); out.textContent="Running… this can take a minute.";
      t.disabled=true;
      const map={places:"/intake/places",website:"/intake/website",promote:"/promote"};
      const r = await api("/clients/"+current+map[t.dataset.run],{method:"POST",body:JSON.stringify({})});
      out.textContent = r.output; t.disabled=false;
      await refresh(); render(); $("runOut").textContent = r.output;
      if(t.dataset.run!=="promote" && detail.pendingIntake && detail.pendingIntake.total>0){
        toast(detail.pendingIntake.total+" candidates found — press Promote to add them.", 6000);
      } else {
        toast(r.ok?"Finished.":"Finished with errors — see output.");
      } return;
    }

    if(t.dataset.db){
      const out=$("dbOut"); out.textContent="Running…"; t.disabled=true;
      const body = t.dataset.db==="dry"?{dryRun:true}:t.dataset.db==="publish"?{publish:true}:{};
      const r = await api("/clients/"+current+"/publish/database",{method:"POST",body:JSON.stringify(body)});
      out.textContent = r.output; t.disabled=false; return;
    }

    if(t.id==="loadJsonld"){
      const r = await api("/clients/"+current+"/jsonld");
      $("jsonldOut").textContent = JSON.stringify(r.graph,null,2);
      if(r.warnings.length) toast(r.warnings[0]);
      return;
    }
    if(t.id==="copyJsonld"){
      await navigator.clipboard.writeText($("jsonldOut").textContent); toast("Copied."); return;
    }
  }catch(err){ toast(err.message); }
});

function closeNewClient(){ $("newClient").close(); $("ncName").value=""; $("ncDomain").value=""; }
document.addEventListener("change", async e => {
  const box = e.target.closest("[data-manual]"); if(!box) return;
  try{
    await api("/clients/"+current+"/tier1/manual/"+box.dataset.manual,
      {method:"PATCH",body:JSON.stringify({checked:box.checked})});
    await render();
  }catch(err){ toast(err.message); }
});

$("ncCancel").addEventListener("click", closeNewClient);

// Buttons are type="button" and the dialog holds no form, so nothing submits on
// its own. The dialog closes only after the client actually exists — otherwise
// a failed create would close it and swallow the reason.
$("ncGo").addEventListener("click", async () => {
  const name=$("ncName").value.trim(), domain=$("ncDomain").value.trim();
  if(!name||!domain){ toast("Name and domain are both required."); return; }

  const btn=$("ncGo"); btn.disabled=true;
  try{
    const r = await api("/clients",{method:"POST",body:JSON.stringify({name,domain,schemaType:$("ncType").value})});
    closeNewClient();
    await loadClients(); await openClient(r.client.slug,"sources");
    toast("Client created. Pull from Google to fill the profile.");
  }catch(err){ toast(err.message); }
  finally{ btn.disabled=false; }
});

(async()=>{
  await loadClients();
  if(clients.length){ await openClient(clients[0].slug); } else { view="clients"; render(); }
})();
</script>
</body>
</html>`;
