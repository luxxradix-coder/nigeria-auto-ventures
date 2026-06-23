/* Nigeria Opportunity Explorer — static dashboard.
 * Configure the API location/key here. Same-origin ('') works when the API
 * serves this page; set a URL + key when hosting the dashboard separately. */
const CONFIG = {
  apiBase: "",   // same-origin (the API serves this page); set a URL if hosting separately
  apiKey: "",    // public read API; set a Bearer token here only if you enable auth
};

// When served as a static site (e.g. GitHub Pages) a baked static-data.json is
// present and the dashboard runs read-only off it instead of calling the API.
let STATIC = null;

const $ = (sel) => document.querySelector(sel);

function authHeaders(extra = {}) {
  const h = { ...extra };
  if (CONFIG.apiKey) h["Authorization"] = `Bearer ${CONFIG.apiKey}`;
  return h;
}

async function api(path, opts = {}) {
  if (STATIC) {
    if ((opts.method || "GET") !== "GET") throw new Error("Interactive generation runs in the live app.");
    if (path.startsWith("/country/ng/snapshot")) return STATIC.snapshot;
    const m = path.match(/^\/opportunities\/(\d+)/);
    if (m) return STATIC.details[m[1]];
    if (path.startsWith("/opportunities")) return { items: STATIC.opportunities };
    throw new Error("not available offline");
  }
  const res = await fetch(`${CONFIG.apiBase}/api/v1${path}`, {
    ...opts,
    headers: authHeaders(opts.headers || (opts.body ? { "Content-Type": "application/json" } : {})),
  });
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail || detail; } catch (_) {}
    throw new Error(`${res.status} — ${detail}`);
  }
  return res.json();
}

/* ---------- formatting ---------- */
function usd(n) {
  if (n == null) return "—";
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)} bn`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(1)} m`;
  if (a >= 1e3) return `$${(n / 1e3).toFixed(0)} k`;
  return `$${n.toFixed(0)}`;
}
function num(n, d = 0) { return n == null ? "—" : Number(n).toLocaleString(undefined, { maximumFractionDigits: d }); }
function pct(n) { return n == null ? "—" : `${n.toFixed(1)}%`; }
function ago(iso) {
  if (!iso) return "no data yet";
  const d = new Date(iso);
  return `refreshed ${d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`;
}
function esc(s) { return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

/* ---------- snapshot ---------- */
const MACRO_LABELS = {
  "NY.GDP.MKTP.CD": ["GDP", (v) => usd(v)],
  "NV.IND.MANF.ZS": ["Manufacturing / GDP", (v) => pct(v)],
  "SP.POP.TOTL": ["Population", (v) => num(v)],
};

async function loadSnapshot() {
  const snap = await api("/country/ng/snapshot");
  const cards = [];
  for (const [code, [label, fmt]] of Object.entries(MACRO_LABELS)) {
    const m = snap.latest_macro[code];
    if (m) cards.push({ k: label, v: fmt(m.value), sub: `${m.year}` });
  }
  const t = snap.trade_summary || {};
  cards.push({ k: "Total imports", v: usd(t.imports_usd), sub: t.year ? `${t.year}` : "" });
  cards.push({ k: "Total exports", v: usd(t.exports_usd), sub: t.year ? `${t.year}` : "" });
  $("#snapshot").innerHTML = cards.map((c) =>
    `<div class="stat"><div class="k">${esc(c.k)}</div><div class="v">${esc(c.v)}</div><div class="sub">${esc(c.sub)}</div></div>`
  ).join("");
  $("#freshness").textContent = ago(snap.data_freshness?.opportunities || snap.data_freshness?.trade_flows);
}

/* ---------- opportunities ---------- */
const BRK_LABELS = {
  trade_deficit: "Trade deficit",
  import_dependency: "Import dependency",
  manufacturing_gap: "Manufacturing gap",
  feasibility: "Feasibility",
};

function bar(frac) { return `<div class="bar"><span style="width:${Math.max(0, Math.min(1, frac)) * 100}%"></span></div>`; }

async function loadOpportunities() {
  const data = await api("/opportunities?limit=20");
  const items = data.items || [];
  const maxScore = Math.max(...items.map((i) => i.score), 1);
  $("#opps").innerHTML = items.map((it, idx) => `
    <div class="opp" data-id="${it.id}">
      <div class="opp-row">
        <div class="rank">${idx + 1}</div>
        <div>
          <div class="name">${esc(it.sector_name)}</div>
          <div class="figs">imports ${usd(it.imports_usd)} · deficit ${usd(it.deficit_usd)}</div>
        </div>
        <div class="score">
          <div class="num">${it.score.toFixed(1)}</div>
          ${bar(it.score / maxScore)}
        </div>
      </div>
      <div class="detail" id="detail-${it.id}"></div>
    </div>`).join("");

  // populate sector dropdown from the same data
  const sel = $("#f-sector");
  if (sel) sel.innerHTML = items
    .slice()
    .sort((a, b) => a.sector_name.localeCompare(b.sector_name))
    .map((it) => `<option value="${esc(it.sector)}">${esc(it.sector_name)}</option>`)
    .join("");

  document.querySelectorAll(".opp").forEach((el) => el.addEventListener("click", () => toggleOpp(el)));
}

async function toggleOpp(el) {
  const id = el.dataset.id;
  const open = el.classList.toggle("open");
  if (!open) return;
  const box = $(`#detail-${id}`);
  if (box.dataset.loaded) return;
  box.innerHTML = `<div class="loading">Loading…</div>`;
  try {
    const d = await api(`/opportunities/${id}`);
    const brk = d.score_breakdown || {};
    const brkHtml = Object.entries(BRK_LABELS).map(([k, lab]) =>
      `<div class="brk"><span class="blab">${lab}</span>${bar(brk[k] || 0)}<span class="bval">${((brk[k] || 0) * 100).toFixed(0)}</span></div>`
    ).join("");
    const states = (d.suggested_states || []).map((s) => `<span class="chip">${esc(s)}</span>`).join("");
    box.innerHTML = `
      <div class="breakdown">${brkHtml}</div>
      <h4>Why</h4><ul>${(d.rationale || []).map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
      ${d.risks?.length ? `<h4>Risks</h4><ul>${d.risks.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}
      ${states ? `<h4>Suggested states</h4><div class="chips">${states}</div>` : ""}`;
    box.dataset.loaded = "1";
  } catch (e) {
    box.innerHTML = `<div class="err">${esc(e.message)}</div>`;
  }
}

/* ---------- business plan ---------- */
function planSection(title, bodyHtml) { return `<div class="section"><h3>${esc(title)}</h3>${bodyHtml}</div>`; }
function list(arr) { return `<ul>${(arr || []).map((x) => `<li>${esc(typeof x === "string" ? x : JSON.stringify(x))}</li>`).join("")}</ul>`; }

async function generatePlan(ev) {
  ev.preventDefault();
  const btn = $("#f-submit");
  const out = $("#plan-out");
  const budget = $("#f-budget").value;
  const body = {
    sector: $("#f-sector").value,
    scale: $("#f-scale").value,
    state: $("#f-state").value.trim(),
  };
  if (budget) body.capital_budget_usd = Number(budget);
  btn.disabled = true; btn.textContent = "Generating…";
  out.innerHTML = `<div class="loading">Building playbook…</div>`;
  try {
    const p = await api("/business-plans/generate", { method: "POST", body: JSON.stringify(body) });
    const c = p.content || {};
    const cap = c.machinery_and_capex?.capex_usd || {};
    const capStr = cap.low != null ? `${usd(cap.low)} – ${usd(cap.high)}` : "—";
    out.innerHTML = `
      <div class="plan-meta">Plan <code>${esc(p.id.slice(0, 8))}</code> · ${esc(p.sector)} · ${esc(p.scale)} · ${esc(p.state)} ·
        confidence ${esc(p.meta?.confidence || "—")} · verified ${esc(p.meta?.last_verified || "—")}</div>
      ${planSection("Executive summary", list(c.executive_summary?.thesis_points))}
      ${planSection("Land & site", `<div class="kv"><span><b>Zoning:</b> ${esc(c.land_and_site?.zoning || "—")}</span>
        <span><b>Site:</b> ${c.land_and_site?.site_requirements_sqm ? num(c.land_and_site.site_requirements_sqm) + " m²" : "—"}</span>
        <span><b>EIA:</b> ${c.land_and_site?.eia_required ? "required" : "not flagged"}</span></div>`)}
      ${planSection("Machinery & capex", `<div class="kv"><span><b>Capex range:</b> ${capStr}</span></div>${list(c.machinery_and_capex?.equipment_list)}`)}
      ${planSection("Licenses & compliance", list((c.licenses_and_compliance?.checklist || []).map((l) => l.name)))}
      ${planSection("Funding", `<div class="kv"><span><b>Mix:</b> ${esc(JSON.stringify(c.funding?.recommended_mix || {}))}</span></div>
        ${list((c.funding?.programs || []).map((f) => f.name))}`)}
      ${planSection("Personnel", list((c.personnel?.roles || []).map((r) => `${r.title} ×${r.count}`)))}
      ${planSection("Launch checklist (0–90 days)", list(c.launch_checklist?.days_0_90))}`;
  } catch (e) {
    out.innerHTML = `<div class="err">Could not generate plan: ${esc(e.message)}</div>`;
  } finally {
    btn.disabled = false; btn.textContent = "Generate playbook";
  }
}

/* ---------- boot ---------- */
async function boot() {
  STATIC = await fetch("static-data.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (STATIC) {
    const panel = $("#plan-form")?.closest(".panel");
    if (panel) panel.innerHTML = `<div class="panel-head"><h2>Worked business plans</h2></div>
      <div style="padding:6px 20px 20px;font-size:.92rem">
        <p style="margin:4px 0 12px;color:var(--muted)">Interactive playbook generation runs in the live app. Meanwhile, the researched, costed plans:</p>
        <a href="plans.html" style="display:inline-block;font-family:'Poppins',sans-serif;font-weight:600;color:#fff;background:var(--orange);padding:11px 16px;border-radius:10px;text-decoration:none">Lean venture portfolio (8 auto businesses) →</a>
      </div>`;
  } else {
    $("#plan-form").addEventListener("submit", generatePlan);
  }
  try {
    await Promise.all([loadSnapshot(), loadOpportunities()]);
  } catch (e) {
    $("#opps").innerHTML = `<div class="err">Could not load data: ${esc(e.message)}</div>`;
  }
}
boot();
