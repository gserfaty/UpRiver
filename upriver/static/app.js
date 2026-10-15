// UpRiver UI: vanilla JS, hash routed. All server-provided text goes through textContent / createElement.
"use strict";

const $ = (id) => document.getElementById(id);
const store = {
  get: (k) => { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode: session only */ } },
};
const auth = { user: store.get("upriver.user"), token: store.get("upriver.token"), admin: store.get("upriver.admin") };

// el("div", {class: "x", onclick: fn}, "text", childNode, ...) -- strings become text nodes, never HTML.
function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k in e && k !== "class") e[k] = v;
    else e.setAttribute(k, v);
  }
  e.append(...kids.filter((x) => x != null));
  return e;
}
const NS = "http://www.w3.org/2000/svg";
function svgUse(cls, id) { // icons and status balls come from the sprite in index.html
  const s = document.createElementNS(NS, "svg"), u = document.createElementNS(NS, "use");
  s.setAttribute("class", cls);
  s.setAttribute("aria-hidden", "true");
  u.setAttribute("href", "#" + id);
  s.append(u);
  return s;
}
const ico = (n) => svgUse("ico", "i-" + n);
const BALLS = ["passed", "failed", "running", "aborted", "skipped"];
const ball = (s, lg) => svgUse("ball" + (lg ? " lg" : ""), "b-" + (BALLS.includes(s) ? s : "queued"));
const secs = (a, b) => (ts(a) ? Math.max(0, ((b ? ts(b) : new Date()) - ts(a)) / 1000) : 0);
const statusCls = (s) => (["passed", "failed", "running", "aborted"].includes(s) ? s : "idle");
const label = (s) => (s ? s[0].toUpperCase() + s.slice(1) : "Unknown");
const badge = (s) => el("span", { class: "bdg stxt s-" + statusCls(s) }, ball(s), label(s));
const btn = (text, onclick, cls = "", icon) => el("button", { type: "button", class: "btn " + cls, onclick }, icon ? ico(icon) : null, text);
const fmtSize = (n) => (n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(1) + " MB");
const ts = (s) => (s ? new Date(s.replace(" ", "T") + "Z") : null);
const when = (s) => (s ? ts(s).toLocaleString() : "");
function dur(a, b) {
  const start = ts(a);
  if (!start) return "";
  const sec = Math.max(0, Math.round(((b ? ts(b) : new Date()) - start) / 1000));
  return sec >= 60 ? Math.floor(sec / 60) + "m " + (sec % 60) + "s" : sec + "s";
}
const announce = (msg) => { $("live").textContent = msg; };
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g; // ponytail: escapes are stripped, not colored; map SGR codes to spans if color is missed
const ERR = /\b(error|fail(ed|ure)?|exception|traceback|fatal)\b|exit status/i;

// ---- pollers: each route renders into a fresh node, so a poller stops once its node leaves the document ----
function poll(node, fn, ms) { // calls fn() every ms while node is on the page; fn returns false to stop
  const tick = async () => {
    if (!node.isConnected) return;
    let more = true;
    try { more = await fn(); } catch (e) { /* transient; keep polling */ }
    if (more !== false) setTimeout(tick, ms);
  };
  setTimeout(tick, ms);
}

// ---- api ----
async function api(method, path, opts = {}) {
  const headers = { Authorization: "Bearer " + (opts.admin && auth.admin ? auth.admin : auth.token), "X-UpRiver-User": auth.user };
  let body;
  if (opts.json !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(opts.json); }
  if (opts.form) body = opts.form;
  let r;
  try { r = await fetch("/api" + path, { method, headers, body }); } catch (e) {
    throw new Error("Can't reach the server. Check your connection and that the server is running, then retry.");
  }
  if (!r.ok) {
    let msg = r.statusText;
    try {
      const d = (await r.json()).detail;
      msg = typeof d === "string" ? d : JSON.stringify(d);
    } catch (e) { /* not json */ }
    throw new Error(r.status + " " + msg);
  }
  if (opts.blob) return r.blob();
  return r.status === 204 ? null : r.json();
}
// Upload via XHR only for upload.onprogress (fetch has none); same auth headers as api(), token never in the URL.
function xhrUpload(path, form, onprogress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("POST", "/api" + path);
    x.setRequestHeader("Authorization", "Bearer " + auth.token);
    x.setRequestHeader("X-UpRiver-User", auth.user);
    x.upload.onprogress = (e) => e.lengthComputable && onprogress(e.loaded / e.total);
    x.onerror = () => reject(new Error("Can't reach the server. Check your connection and that the server is running, then retry."));
    x.onload = () => {
      let d = null;
      try { d = JSON.parse(x.responseText); } catch (e) { /* not json */ }
      if (x.status >= 200 && x.status < 300) return resolve(d);
      const det = d && d.detail;
      reject(new Error(x.status + " " + (typeof det === "string" ? det : det ? JSON.stringify(det) : x.statusText)));
    };
    x.send(form);
  });
}
function saveBlob(blob, filename) { // blob -> object URL -> click; no token ever appears in a URL
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
async function download(path, filename) { saveBlob(await api("GET", path, { blob: true }), filename); }
const fail = (box, e) => { box.className = "banner error"; box.setAttribute("role", "alert"); box.textContent = e.message; };
const note = (box, msg) => { box.className = "banner ok"; box.removeAttribute("role"); box.textContent = msg; };
// Wrap a click handler: shows errors in `box`, disables the button while running.
function action(box, fn) {
  return async (ev) => {
    const b = ev.currentTarget;
    b.disabled = true;
    box.textContent = "";
    box.className = "";
    try { await fn(b); } catch (e) { fail(box, e); }
    b.disabled = false;
  };
}
function errBanner(e) { // page-level error with cause and next step
  const b = el("div", { class: "banner error", role: "alert" }, e.message);
  if (/^401/.test(e.message)) b.append(" The team token was not accepted. ", el("a", { href: "#/signin" }, "Edit credentials"));
  else if (/^404/.test(e.message)) b.append(" It may have been removed, or the link is mistyped. ", el("a", { href: "#/" }, "Go to Dashboard"));
  return b;
}

// In-app confirmation: native <dialog>, safe button focused, Escape cancels. `run` errors stay in the dialog.
function confirmDlg({ title, body, safe, danger, busy, run }) {
  let done = false;
  const msg = el("div");
  const keep = btn(safe, () => d.close());
  const go = btn(danger, async () => {
    keep.disabled = go.disabled = true;
    go.textContent = busy;
    msg.className = "";
    msg.textContent = "";
    try { await run(); done = true; d.close(); } catch (e) {
      fail(msg, e);
      keep.disabled = go.disabled = false;
      go.textContent = danger;
    }
  }, "destroy");
  const d = el("dialog", { class: "dlg", "aria-label": title }, el("h3", {}, title), el("p", {}, body), msg, el("div", { class: "acts" }, keep, go));
  d.addEventListener("cancel", (ev) => { if (go.disabled) ev.preventDefault(); });
  d.addEventListener("close", () => d.remove());
  document.body.append(d);
  d.showModal();
  keep.focus();
}

// ---- shell: user menu, breadcrumbs, sidebar ----
function renderUser() {
  const u = $("user");
  u.replaceChildren();
  if (!auth.user || !auth.token) return;
  const d = el("details", { class: "um" });
  const menu = el("div", { class: "menu", onclick: () => { d.open = false; } },
    el("a", { class: "btn", href: "#/signin" }, "Edit credentials"), btn("Sign out", signOut));
  d.append(el("summary", { class: "btn quiet", "aria-haspopup": "menu" }, ico("user"), auth.user, " ",
    el("span", { class: "chip" }, auth.admin ? "team + admin" : "team")), menu);
  u.append(d);
}
document.addEventListener("click", (ev) => { const d = $("user").firstChild; if (d && !d.contains(ev.target)) d.open = false; });
document.addEventListener("keydown", (ev) => { const d = $("user").firstChild; if (ev.key === "Escape" && d && d.open) { d.open = false; d.firstChild.focus(); } });
$("skip").addEventListener("click", (ev) => { ev.preventDefault(); $("main").focus(); });
// Unsaved-edit guard: pages set `dirty` (returns a message or "") while they hold edits that a navigation or sign-out would lose.
let dirty = null;
window.addEventListener("beforeunload", (ev) => { if (dirty && dirty()) { ev.preventDefault(); ev.returnValue = ""; } });
function runMods() { // pipelines with unsaved Run-panel edits in this tab (sessionStorage upriver.run.*)
  let n = 0;
  try { for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i); if (k.startsWith("upriver.run.") && JSON.parse(sessionStorage.getItem(k)).mod) n++; } } catch (e) { /* ignore */ }
  return n;
}
function signOut() {
  const d = dirty && dirty(), n = runMods(), rm = n ? `Run panel edits for ${n} pipeline${n === 1 ? "" : "s"} will be lost.` : "";
  if (d || rm) { // one prompt for everything that would be lost; dirty is cleared so route() doesn't ask again
    return confirmDlg({ title: d ? "Sign out and discard unsaved changes?" : "Sign out and discard unsaved run changes?", body: [d, rm].filter(Boolean).join(" "), safe: "Stay signed in", danger: "Sign out", busy: "Signing out…", run: async () => { dirty = null; doSignOut(); } });
  }
  doSignOut();
}
function doSignOut() {
  // ponytail: sessionStorage is per tab, so signing out here cannot clear another tab's run edits
  try { for (const k of Object.keys(sessionStorage)) if (k.startsWith("upriver.run.")) sessionStorage.removeItem(k); } catch (e) { /* ignore */ }
  for (const k of ["user", "token", "admin"]) { store.set("upriver." + k, ""); auth[k] = ""; }
  renderUser();
  route();
}
function setCrumbs(...parts) { // [[text, href], ..., [current]]
  const nav = $("crumbs");
  nav.replaceChildren();
  parts.forEach(([t, href], i) => {
    if (i) nav.append(el("span", { "aria-hidden": "true" }, "›"));
    if (i === parts.length - 1) nav.append(el("span", { class: "cur num", "aria-current": "page", title: t }, t));
    else if (i === 0) nav.append(el("a", { class: "short", href, "aria-label": t }, "…"), el("a", { class: "full", href }, t));
    else nav.append(el("a", { class: "trunc", href, title: t }, t));
  });
}
function setSide(name, items) { // null = no sidebar
  const nav = $("side");
  nav.hidden = !items;
  $("layout").classList.toggle("nonav", !items);
  if (!items) return;
  nav.setAttribute("aria-label", name);
  nav.replaceChildren(el("ul", {}, ...items));
}
let sideId = 0;
// o: {href | onclick, current, off: "reason", sep}
function sideItem(icon, text, o = {}) {
  if (o.sep) return el("li", { class: "sep", "aria-hidden": "true" });
  const id = "why" + ++sideId;
  if (o.off) return el("li", {}, el("a", { "aria-disabled": "true", role: "link", tabindex: "0", "aria-describedby": id }, ico(icon), text, el("small", { id }, o.off)));
  const a = el("a", { href: o.href || "#" }, ico(icon), text);
  if (o.current) a.setAttribute("aria-current", "page");
  if (o.onclick) a.addEventListener("click", (ev) => { ev.preventDefault(); o.onclick(); });
  return el("li", {}, a);
}
function jump(sec) { // scroll a section into view and move focus to its heading
  sec.scrollIntoView();
  const h = sec.querySelector("h2");
  if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
}

// ---- router ----
let ret = "#/"; // where to go after sign-in
let curHash = location.hash || "#/";
function route() {
  const h0 = location.hash || "#/", d = dirty && dirty();
  if (d && h0 !== curHash) { // leave guard: undo the navigation, ask first
    history.replaceState(null, "", curHash);
    return confirmDlg({ title: "Leave without saving?", body: d, safe: "Stay", danger: "Leave without saving", busy: "Leaving…", run: async () => { dirty = null; location.hash = h0; } });
  }
  dirty = null;
  curHash = h0;
  const view = el("div", { class: "pg" }); // fresh per navigation: a slow page from the previous route renders into a detached node
  $("view").replaceChildren(view);
  const h = location.hash || "#/";
  if (h !== "#/signin") ret = h;
  if (!auth.user || !auth.token || h === "#/signin") return signinPage(view);
  let m;
  const page = h === "#/" ? listPage(view)
    : (m = h.match(/^#\/p\/(\d+)$/)) ? pipelinePage(view, +m[1])
    : (m = h.match(/^#\/b\/(\d+)(?:\/s\/(\d+))?$/)) ? buildPage(view, +m[1], m[2] == null ? null : +m[2])
    : (m = h.match(/^#\/c\/(\d+)\/(\d+)$/)) ? comparePage(view, +m[1], +m[2])
    : notFound(view);
  page.catch((e) => view.prepend(errBanner(e)));
}
window.addEventListener("hashchange", route);
function notFound(view) {
  setCrumbs(["Not found"]);
  setSide(null);
  document.title = "Page not found · UpRiver";
  view.append(el("section", {}, el("h1", {}, "Page not found"),
    el("p", {}, "There is nothing at this address. Check the link, or go to the Dashboard."), el("a", { class: "btn primary", href: "#/" }, "Go to Dashboard")));
  return Promise.resolve();
}

// ---- #/signin ----
function signinPage(view) {
  setCrumbs(["Sign in"]);
  setSide(null);
  document.title = "Sign in · UpRiver";
  const editing = !!(auth.user && auth.token);
  const err = el("div");
  const f = {
    user: el("input", { id: "f-user", autocomplete: "username", value: auth.user, maxLength: 64 }),
    token: el("input", { id: "f-token", type: "password", autocomplete: "off", value: auth.token }),
    admin: el("input", { id: "f-admin", type: "password", autocomplete: "off", value: auth.admin }),
  };
  const field = (id, text, input, hint) => el("div", { class: "field" }, el("label", { for: id }, text), input, hint ? el("span", { class: "hint" }, hint) : null);
  const go = el("button", { class: "btn primary", type: "submit" }, "Continue");
  const form = el("form", { onsubmit: async (ev) => {
    ev.preventDefault();
    err.className = "";
    err.textContent = "";
    if (!f.user.value.trim()) { fail(err, new Error("Enter your name.")); f.user.focus(); return; }
    if (!f.token.value) { fail(err, new Error("Enter the team token. Ask your admin if you don't have it.")); f.token.focus(); return; }
    const old = { ...auth };
    auth.user = f.user.value.trim(); auth.token = f.token.value; auth.admin = f.admin.value;
    go.disabled = true;
    go.textContent = "Checking…";
    try { await api("GET", "/pipelines"); } catch (e) {
      Object.assign(auth, old);
      fail(err, /^401/.test(e.message) ? new Error("The team token was not accepted. Check it with your admin and try again.") : e);
      f.token.focus();
      go.disabled = false;
      go.textContent = "Continue";
      return;
    }
    store.set("upriver.user", auth.user); store.set("upriver.token", auth.token); store.set("upriver.admin", auth.admin);
    renderUser();
    if (location.hash === "#/signin") location.hash = ret; else route();
  } },
  field("f-user", "Your name", f.user), field("f-token", "Team token", f.token),
  field("f-admin", "Admin token (optional)", f.admin, "Only needed to create pipelines and edit settings. Skip the admin token if you only need team access."),
  el("label", { class: "bar" }, el("input", { type: "checkbox", onchange: (ev) => { for (const i of [f.token, f.admin]) i.type = ev.target.checked ? "text" : "password"; } }), "Show tokens"),
  err, el("div", { class: "bar" }, go, editing ? btn("Sign out", signOut) : null));
  view.append(el("section", { class: "signin" },
    el("h1", {}, svgUse("", "mark"), "Sign in to UpRiver"), el("p", { class: "muted" }, "Pipelines and builds for your team."), form));
  view.querySelector("svg").setAttribute("width", "28");
  view.querySelector("svg").setAttribute("height", "28");
  (editing ? f.token : f.user).focus();
}

// ---- #/ pipelines ----
const NEW_PIPELINE = {
  name: "my-pipeline", description: "",
  config: {
    auto_build: false,
    params: [{ name: "TARGET", default: "dev", choices: ["dev", "staging"] }],
    stages: [{ name: "bvt", kind: "bvt", command: "echo hello", timeout_s: 120, on_fail: "stop" }],
  },
};

async function listPage(view) {
  setCrumbs(["Dashboard"]);
  document.title = "Dashboard · UpRiver";
  const list = await api("GET", "/pipelines");
  const cells = new Map(), tbody = el("tbody"), none = el("p", { class: "muted", role: "status" });
  const q = el("input", { type: "search", placeholder: "Name contains...", "aria-label": "Filter pipelines", autocomplete: "off" });
  const trend = (pid, cell) => api("GET", `/pipelines/${pid}/builds?limit=20`).then((bs) => {
    bs = bs.slice().reverse(); // oldest left
    const mx = Math.max(1, ...bs.map((b) => secs(b.started_at, b.finished_at)));
    const n = {};
    bs.forEach((b) => { n[b.status] = (n[b.status] || 0) + 1; });
    const g = el("span", { class: "trend", role: "group", "aria-label": `Last ${bs.length} builds: ` + Object.entries(n).map(([k, v]) => v + " " + k).join(", ") },
      ...bs.map((b) => el("span", { class: "tb s-" + statusCls(b.status), title: `#${b.number} ${label(b.status)} ${dur(b.started_at, b.finished_at)}` },
        el("i", { style: `height:${Math.max(3, Math.round((24 * secs(b.started_at, b.finished_at)) / mx))}px` }), ball(b.status))));
    cell.replaceChildren(bs.length ? g : "");
  }).catch(() => cell.replaceChildren(el("span", { class: "muted" }, "Trend unavailable")));
  const draw = () => {
    const f = q.value.trim().toLowerCase(), rows = list.filter((p) => p.name.toLowerCase().includes(f));
    tbody.replaceChildren(...rows.map((p) => el("tr", {},
      el("td", {}, el("a", { href: "#/p/" + p.id }, p.name)),
      el("td", {}, p.description),
      el("td", {}, p.last_build_status ? badge(p.last_build_status) : el("span", { class: "muted" }, "No builds")),
      cells.get(p.id) || (cells.set(p.id, el("td")), // ponytail: N+1 requests (one per row), fine for a small team; add a list-level endpoint if pipelines grow
        p.last_build_status && trend(p.id, cells.get(p.id)), cells.get(p.id))))); 
    none.replaceChildren(...(rows.length ? [] : [`No pipeline matches "${q.value.trim()}" `, btn("Clear filter", () => { q.value = ""; draw(); q.focus(); }, "quiet")]));
  };
  q.addEventListener("input", draw);
  draw();
  const box = el("div");
  const ta = el("textarea", { value: JSON.stringify(NEW_PIPELINE, null, 2), spellcheck: false, "aria-label": "new pipeline JSON" });
  const newSec = el("section", { id: "new" }, el("h2", {}, "New pipeline (admin)"), ta,
    el("div", { class: "bar" }, btn("Create", action(box, async () => {
      const p = await api("POST", "/pipelines", { json: JSON.parse(ta.value), admin: true });
      location.hash = "#/p/" + p.id;
    }), "primary")), box);
  setSide("Dashboard", [sideItem("list", "Pipelines", { current: true, href: "#/" }),
    auth.admin ? sideItem("plus", "New pipeline", { onclick: () => jump(newSec) }) : sideItem("plus", "New pipeline", { off: "Admin token required" })]);
  view.append(el("section", {},
    el("h1", {}, "Pipelines ", el("span", { class: "count" }, list.length + (list.length === 1 ? " pipeline" : " pipelines"))),
    list.length
      ? el("div", {}, el("div", { class: "bar" }, q), el("div", { class: "wrap" }, el("table", {},
        el("thead", {}, el("tr", {}, el("th", {}, "Name"), el("th", {}, "Description"), el("th", {}, "Last build"), el("th", {}, "Trend"))), tbody)), none)
      : el("p", { class: "muted" }, "No pipelines yet. Create the first pipeline to start uploading files and building.")),
  newSec);
}

// ---- structured pipeline settings editor (also edits the same JSON the PUT accepts) ----
const NAME_RE = /^[A-Za-z0-9_.-]{1,64}$/, PARAM_RE = /^[A-Z_][A-Z0-9_]{0,63}$/, KINDS = ["bvt", "fvt", "smoke", "regression", "custom"];
// Client checks mirror the pydantic models in app.py; the server stays authoritative and its 422 detail is shown on Save.
function cfgModel(j) {
  const c = (j && j.config) || {};
  return { description: (j && j.description) || "", auto_build: !!c.auto_build,
    params: (c.params || []).map((p) => ({ name: p.name ?? "", default: p.default ?? "", choices: Array.isArray(p.choices) ? p.choices : null })),
    stages: (c.stages || []).map((x) => ({ name: x.name ?? "", kind: x.kind ?? "bvt", command: x.command ?? "", timeout_s: x.timeout_s ?? 120, on_fail: x.on_fail ?? "stop" })) };
}
const cfgJSON = (m) => ({ description: m.description, config: { auto_build: m.auto_build,
  params: m.params.map((p) => ({ name: p.name, default: p.default, ...(p.choices ? { choices: p.choices } : {}) })),
  stages: m.stages.map((x) => ({ name: x.name, kind: x.kind, command: x.command, timeout_s: x.timeout_s === "" ? "" : Number(x.timeout_s), on_fail: x.on_fail })) } });
function cfgErrors(m) {
  const e = new Map(), seen = (arr, key, k) => { const names = new Set(); arr.forEach((x, i) => { if (names.has(x.name)) e.set(`${k}${i}.name`, "Duplicate name. Names must be unique."); names.add(x.name); }); };
  m.params.forEach((p, i) => {
    if (!PARAM_RE.test(p.name)) e.set(`p${i}.name`, "Use A-Z, 0-9 and _, starting with a letter or _ (max 64).");
    if (p.default.length > 1024) e.set(`p${i}.default`, "At most 1024 characters.");
    else if (p.choices && !p.choices.includes(p.default)) e.set(`p${i}.default`, "Default must be one of the choices.");
  });
  seen(m.params, "name", "p");
  if (!m.stages.length) e.set("stages", "Add at least one stage.");
  m.stages.forEach((x, i) => {
    if (!NAME_RE.test(x.name)) e.set(`s${i}.name`, "Use letters, digits, . _ - (1-64 characters).");
    if (!KINDS.includes(x.kind)) e.set(`s${i}.kind`, "Pick a kind.");
    if (!x.command) e.set(`s${i}.command`, "Enter a command.");
    const t = Number(x.timeout_s);
    if (x.timeout_s === "" || !Number.isInteger(t) || t < 1 || t > 86400) e.set(`s${i}.timeout_s`, "Whole seconds, 1 to 86400.");
    if (!["stop", "continue"].includes(x.on_fail)) e.set(`s${i}.on_fail`, "Stop or continue.");
  });
  seen(m.stages, "name", "s");
  return e;
}
function syntaxMsg(src, e) { // "Line n: ..." from a JSON.parse error
  let n = 1, m = /line (\d+)/.exec(e.message), pos = /position (\d+)/.exec(e.message);
  if (m) n = +m[1]; else if (pos) n = src.slice(0, +pos[1]).split("\n").length;
  return `Line ${n}: ${e.message}`;
}
function prettyDetail(e) { // "422 [{loc,msg}]" -> "stages.0.name: msg"
  const m = /^422 (\[.*\])$/s.exec(e.message);
  if (!m) return e.message;
  try { return "The server rejected the settings. " + JSON.parse(m[1]).map((d) => (d.loc || []).filter((x) => x !== "body").join(".") + ": " + d.msg).join("; "); } catch (x) { return e.message; }
}
// Returns {node, isDirty(), saved(json)}; `save(json)` does the PUT and returns the saved pipeline.
function configEditor(init, { readOnly, save, onSaved }) {
  let m = cfgModel(init), base = JSON.stringify(cfgJSON(m)), rawErr = "", saving = false;
  const spans = new Map(), msg = el("div"), flag = el("span", { class: "muted", role: "status" });
  const raw = el("textarea", { spellcheck: false, "aria-label": "pipeline settings JSON", readOnly });
  const rawNote = el("div"), form = el("div"), details = el("details", {}, el("summary", {}, "Advanced: raw JSON"), raw, rawNote);
  const saveBtn = btn("Save", () => doSave(), "primary"), why = el("span", { class: "muted" }, readOnly ? "Admin token required" : "");
  const errSpan = (k) => { const s = el("span", { class: "ferr s-failed" }); spans.set(k, s); return s; };
  const check = () => {
    const e = cfgErrors(m);
    for (const [k, sp] of spans) sp.textContent = e.get(k) || "";
    const bad = e.size || rawErr;
    saveBtn.disabled = readOnly || saving || !!bad;
    const dirtyNow = JSON.stringify(cfgJSON(m)) !== base || !!rawErr;
    flag.textContent = dirtyNow ? "Unsaved changes" : "";
    if (!readOnly) why.textContent = bad ? (rawErr ? "Fix the raw JSON to save" : `Fix ${e.size} problem${e.size === 1 ? "" : "s"} to save`) : "";
  };
  const changed = () => { raw.value = JSON.stringify(cfgJSON(m), null, 2); rawErr = ""; rawNote.replaceChildren(); check(); };
  const field = (lbl, input, key) => el("label", { class: "fld" }, el("span", {}, lbl), input, key ? errSpan(key) : null);
  const inp = (val, key, set, attrs = {}) => el("input", { value: val, disabled: readOnly, oninput: (ev) => { set(ev.target.value); changed(); }, ...attrs });
  const sel = (opts, val, set) => el("select", { disabled: readOnly, onchange: (ev) => { set(ev.target.value); changed(); } }, ...opts.map((o) => el("option", { value: o, selected: o === val }, o)));
  const rm = (arr, i) => btn("Remove", () => { arr.splice(i, 1); draw(); changed(); }, "quiet", null);
  function draw() {
    spans.clear();
    const ps = m.params.map((p, i) => el("div", { class: "grp" },
      field("Name", inp(p.name, "", (v) => { p.name = v; }, { maxLength: 64 }), `p${i}.name`),
      field("Default", inp(p.default, "", (v) => { p.default = v; }), `p${i}.default`),
      field("Choices (comma separated, optional)", inp(p.choices ? p.choices.join(", ") : "", "", (v) => { const c = v.split(",").map((x) => x.trim()).filter(Boolean); p.choices = c.length ? c : null; }), ""),
      readOnly ? null : rm(m.params, i)));
    const ss = m.stages.map((x, i) => el("div", { class: "grp" },
      field("Name", inp(x.name, "", (v) => { x.name = v; }, { maxLength: 64 }), `s${i}.name`),
      field("Kind", sel(KINDS, x.kind, (v) => { x.kind = v; }), `s${i}.kind`),
      field("Command", inp(x.command, "", (v) => { x.command = v; }), `s${i}.command`),
      field("Timeout (s)", inp(x.timeout_s, "", (v) => { x.timeout_s = v; }, { type: "number", min: 1, max: 86400 }), `s${i}.timeout_s`),
      field("On fail", sel(["stop", "continue"], x.on_fail, (v) => { x.on_fail = v; }), `s${i}.on_fail`),
      readOnly ? null : rm(m.stages, i)));
    form.replaceChildren(
      field("Description", inp(m.description, "", (v) => { m.description = v; }), ""),
      el("label", { class: "fld" }, el("input", { type: "checkbox", checked: m.auto_build, disabled: readOnly, onchange: (ev) => { m.auto_build = ev.target.checked; changed(); } }), "Build automatically when files change"),
      el("h3", {}, "Parameters"), ...ps, readOnly ? null : btn("Add parameter", () => { m.params.push({ name: "", default: "", choices: null }); draw(); changed(); }, "", "plus"),
      el("h3", {}, "Stages"), errSpan("stages"), ...ss, readOnly ? null : btn("Add stage", () => { m.stages.push({ name: "", kind: "bvt", command: "", timeout_s: 120, on_fail: "stop" }); draw(); changed(); }, "", "plus"));
  }
  raw.addEventListener("input", () => {
    try {
      const j = JSON.parse(raw.value);
      if (!j || typeof j !== "object" || Array.isArray(j) || !j.config || typeof j.config !== "object") throw new Error("expected an object with \"description\" and \"config\"");
      m = cfgModel(j); draw(); rawErr = ""; rawNote.replaceChildren();
    } catch (e) { rawErr = e instanceof SyntaxError ? syntaxMsg(raw.value, e) : "Line 1: " + e.message; rawNote.replaceChildren(el("div", { class: "banner error", role: "alert" }, rawErr)); }
    check();
  });
  async function doSave() {
    if (saveBtn.disabled) return;
    saving = true; check(); msg.textContent = ""; msg.className = "";
    try {
      const r = await save(cfgJSON(m));
      m = cfgModel({ description: r.description, config: r.config }); base = JSON.stringify(cfgJSON(m));
      draw(); raw.value = JSON.stringify(cfgJSON(m), null, 2);
      note(msg, "Saved. New params and stages are in the Run panel.");
      onSaved(r);
    } catch (e) { fail(msg, new Error(prettyDetail(e))); }
    saving = false; check();
  }
  draw(); raw.value = JSON.stringify(cfgJSON(m), null, 2); check();
  return { node: el("div", {}, form, details, el("div", { class: "bar" }, saveBtn, why, flag), msg), isDirty: () => JSON.stringify(cfgJSON(m)) !== base || !!rawErr };
}

// ---- #/p/{id} pipeline ----
async function pipelinePage(view, pid) {
  const [pipe, configs] = await Promise.all([api("GET", "/pipelines/" + pid), api("GET", `/pipelines/${pid}/configs`)]);
  const pins = new Map(); // path -> upload id
  setCrumbs(["Dashboard", "#/"], [pipe.name]);
  document.title = pipe.name + " · UpRiver";
  const sec = (title, ...kids) => el("section", {}, el("h2", {}, title), ...kids);
  view.append(el("section", {}, el("h1", {}, pipe.name), el("p", { class: "muted" }, pipe.description)));

  // Files
  const filesBox = el("div"), filesErr = el("div");
  const loadFiles = async () => {
    const files = await api("GET", `/pipelines/${pid}/files`);
    const tbody = el("tbody");
    for (const f of files) {
      const hist = el("tr", { class: "hist", hidden: true }, el("td", { colSpan: 5 }));
      tbody.append(el("tr", {},
        el("td", { class: "data" }, f.path), el("td", { class: "num" }, "v" + f.version), el("td", { class: "num" }, fmtSize(f.size)),
        el("td", {}, f.uploader + ", " + when(f.created_at)),
        el("td", {}, el("div", { class: "bar" },
          btn("Download", action(filesErr, () => download(`/uploads/${f.id}/download`, f.path.split("/").pop()))),
          el("button", { type: "button", class: "btn", "aria-expanded": "false", onclick: action(filesErr, async (b) => {
            hist.hidden = !hist.hidden;
            b.setAttribute("aria-expanded", String(!hist.hidden));
            if (!hist.hidden) await loadHistory(f.path, hist.firstChild);
          }) }, "History"),
          btn("Remove", () => confirmDlg({
            title: `Remove ${f.path}?`, body: `Deletes ${f.path} and its ${f.version} versions from ${pipe.name}. This can't be undone; upload the file again to restore it.`,
            safe: "Cancel", danger: "Remove file", busy: "Removing…",
            run: async () => {
              await api("DELETE", `/pipelines/${pid}/files?path=${encodeURIComponent(f.path)}`);
              pins.delete(f.path);
              updatePins();
              await loadFiles();
            } }), "danger")))), hist);
    }
    filesBox.replaceChildren(files.length
      ? el("div", { class: "wrap" }, el("table", {}, el("thead", {}, el("tr", {}, ...["Path", "Version", "Size", "Uploaded by", ""].map((t) => el("th", {}, t)))), tbody))
      : el("p", { class: "muted" }, "No files yet. Choose files below to upload."));
  };
  async function loadHistory(path, cell) {
    const rows = await api("GET", `/pipelines/${pid}/uploads?path=${encodeURIComponent(path)}`);
    cell.replaceChildren(...rows.map((u) => el("div", { class: "bar" },
      u.sha256 ? el("input", { type: "checkbox", checked: pins.get(path) === u.id, title: "Pin for next build", "aria-label": `pin v${u.version}`,
        onchange: (ev) => {
          if (ev.target.checked) pins.set(path, u.id); else pins.delete(path);
          cell.querySelectorAll("input").forEach((i) => { if (i !== ev.target) i.checked = false; });
          updatePins();
        } }) : el("span", {}, "—"),
      "v" + u.version + (u.sha256 ? " " + fmtSize(u.size) : " removed"), " by " + u.uploader + ", " + when(u.created_at),
      u.sha256 ? btn("Download", action(filesErr, () => download(`/uploads/${u.id}/download`, path.split("/").pop()))) : null)));
  }
  const MAX_MB = 200; // ponytail: mirrors the UPRIVER_MAX_UPLOAD_MB default; the server doesn't expose it, so a raised cap still gets blocked here (add it to an API if that bites). Server stays authoritative.
  const fileIn = el("input", { type: "file", multiple: true, "aria-label": "files to upload" });
  const extract = el("input", { type: "checkbox" });
  const dropMsg = el("span", {}, "Drop files here or choose files");
  const drop = el("div", { class: "drop" }, dropMsg, fileIn);
  const results = el("div"), prog = el("progress", { max: 1, value: 0, hidden: true, "aria-label": "Upload progress" }), busy = el("span", { class: "muted", role: "status" });
  const showList = (rows) => results.replaceChildren(el("div", { class: "wrap" }, el("table", {},
    el("thead", {}, el("tr", {}, ...["File", "Version", "Result"].map((t) => el("th", {}, t)))),
    el("tbody", {}, ...rows.map((r) => el("tr", {}, el("td", { class: "data" }, r[0]), el("td", { class: "num" }, r[1]), el("td", {}, r[2])))))),
    el("div", { class: "bar" }, btn("Dismiss", () => results.replaceChildren(), "quiet")));
  const sel = () => showList([...fileIn.files].map((f) => [f.name + " (" + fmtSize(f.size) + ")", "", "Ready"]));
  fileIn.addEventListener("change", () => { sel(); dropMsg.textContent = "Drop files here or choose files"; });
  for (const t of ["dragenter", "dragover"]) drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); const n = e.dataTransfer.items ? e.dataTransfer.items.length : 0; dropMsg.textContent = `Release to add ${n} file${n === 1 ? "" : "s"}`; });
  drop.addEventListener("dragleave", () => { drop.classList.remove("over"); dropMsg.textContent = "Drop files here or choose files"; });
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); fileIn.files = e.dataTransfer.files; fileIn.dispatchEvent(new Event("change")); });
  const filesSec = sec("Files", filesBox, drop,
    el("div", { class: "bar" }, el("label", {}, extract, "Extract zip files"),
      btn("Upload", action(filesErr, async (b) => {
        const fl = [...fileIn.files];
        if (!fl.length) throw new Error("Choose files first.");
        const seen = new Set();
        for (const f of fl) { // client pre-validation; nothing is sent if any file fails
          if (!f.name) throw new Error("A file has no name. Rename it and choose it again.");
          if (seen.has(f.name)) throw new Error(`Two files are named ${f.name}. Rename one; names must be unique in a batch.`);
          seen.add(f.name);
          if (f.size > MAX_MB * 1048576) throw new Error(`${f.name} is ${fmtSize(f.size)}, over the ${MAX_MB} MB limit. Nothing was uploaded.`);
        }
        const form = new FormData();
        for (const f of fl) form.append("files", f, f.name);
        form.append("extract", extract.checked ? "true" : "false");
        busy.textContent = "Upload in progress";
        prog.hidden = false; prog.value = 0;
        try {
          // ponytail: all-or-nothing upload, no per-item server result; add per-item results in the API if per-file errors are needed.
          const out = await xhrUpload(`/pipelines/${pid}/uploads`, form, (v) => { prog.value = v; });
          fileIn.value = "";
          showList(out.map((o) => [o.path, "v" + o.version, o.unchanged ? "unchanged" : "stored"]));
          await loadFiles();
          note(filesErr, `${out.filter((o) => !o.unchanged).length} stored, ${out.filter((o) => o.unchanged).length} unchanged`);
        } catch (e) {
          showList(fl.map((f) => [f.name, "", "not stored"]));
          throw e;
        } finally { busy.textContent = ""; prog.hidden = true; }
      }), "primary", "upload"), prog, busy), filesErr, results);

  // Run
  const runErr = el("div"), pinInfo = el("span", { class: "muted" });
  let updatePins = () => {}; // replaced below once the run panel exists
  const cfgSel = el("select", { "aria-label": "Config" });
  const paramBox = el("div", { class: "bar" }), stageBox = el("div", { class: "bar" }), cfgName = el("input", { placeholder: "Config name", "aria-label": "Config name", maxLength: 64 });
  const paramIn = {}, stageCb = {};
  const drawRun = () => { // also called after Settings save, so new params and stages show without a reload
    for (const o of [paramIn, stageCb]) for (const k of Object.keys(o)) delete o[k];
    paramBox.replaceChildren(); stageBox.replaceChildren();
    for (const p of pipe.config.params) {
      paramIn[p.name] = p.choices
        ? el("select", {}, ...p.choices.map((c) => el("option", { value: c }, c)))
        : el("input", { maxLength: 1024 });
      paramIn[p.name].value = p.default;
      paramBox.append(el("label", {}, p.name + " ", paramIn[p.name]));
    }
    for (const s of pipe.config.stages) {
      stageCb[s.name] = el("input", { type: "checkbox", checked: true });
      stageBox.append(el("label", {}, stageCb[s.name], s.name));
    }
  };
  drawRun();
  let cfgs = configs;
  const fillConfigs = () => {
    cfgSel.replaceChildren(el("option", { value: "" }, "(defaults)"), ...cfgs.map((c) => el("option", { value: c.id }, c.name)));
  };
  const applyCfg = () => { // set the panel to the selected saved config (or the defaults)
    const c = cfgs.find((x) => String(x.id) === cfgSel.value);
    for (const p of pipe.config.params) paramIn[p.name].value = c && p.name in c.params ? c.params[p.name] : p.default;
    for (const s in stageCb) stageCb[s].checked = !c || c.stages.includes(s);
    cfgName.value = c ? c.name : "";
  };
  fillConfigs();
  const values = () => ({
    params: Object.fromEntries(Object.entries(paramIn).map(([k, i]) => [k, i.value])),
    stages: Object.keys(stageCb).filter((s) => stageCb[s].checked),
  });
  // Unsaved-edit tracking: the baseline is the selected saved config, or the defaults. Pins are persisted but not counted as edits
  // (ponytail: their checkboxes live in the file history and can't be reset from here).
  const baseOf = (sel) => {
    const c = cfgs.find((x) => String(x.id) === String(sel));
    return { params: Object.fromEntries(pipe.config.params.map((p) => [p.name, c && p.name in c.params ? c.params[p.name] : p.default])),
      stages: pipe.config.stages.map((x) => x.name).filter((n) => !c || c.stages.includes(n)) };
  };
  const changedAgainst = (sel) => {
    const b = baseOf(sel), v = values();
    return { params: Object.keys(v.params).filter((k) => v.params[k] !== b.params[k]), stages: Object.keys(stageCb).filter((k) => stageCb[k].checked !== b.stages.includes(k)) };
  };
  const isMod = (sel) => { const d = changedAgainst(sel); return d.params.length + d.stages.length > 0; };
  const runKey = "upriver.run." + pid, modMark = el("span", { class: "chip", role: "status" }), resetBtn = btn("Reset to saved", () => { applyCfg(); updateMod(); }, "quiet", "rebuild");
  let prevSel = "", shownMod = null, sideRender = () => {};
  const updateMod = () => {
    const d = changedAgainst(cfgSel.value), mod = d.params.length + d.stages.length > 0;
    for (const k in paramIn) paramIn[k].parentNode.classList.toggle("mod", d.params.includes(k));
    for (const k in stageCb) stageCb[k].parentNode.classList.toggle("mod", d.stages.includes(k));
    modMark.textContent = mod ? "Modified" : ""; resetBtn.hidden = !mod;
    buildNow.lastChild.textContent = mod ? "Build with unsaved changes" : "Build now";
    if (mod !== shownMod) { shownMod = mod; sideRender(); }
    try { sessionStorage.setItem(runKey, JSON.stringify({ cfg: cfgSel.value, ...values(), pins: [...pins], mod })); } catch (e) { /* private mode: not persisted */ }
  };
  updatePins = () => { pinInfo.textContent = pins.size ? `${pins.size} pinned version(s)` : ""; updateMod(); };
  cfgSel.addEventListener("change", () => {
    const next = cfgSel.value, c = cfgs.find((x) => String(x.id) === next);
    const go = () => { cfgSel.value = next; prevSel = next; applyCfg(); updateMod(); };
    if (isMod(prevSel)) {
      cfgSel.value = prevSel; // Keep my edits is the default: the select snaps back until the user confirms
      confirmDlg({ title: `Switch to config ${c ? c.name : "(defaults)"}?`, body: "Your unsaved run changes will be replaced by the saved values.",
        safe: "Keep my edits", danger: "Discard edits and switch", busy: "Switching…", run: async () => go() });
    } else go();
  });
  for (const b of [paramBox, stageBox]) { b.addEventListener("input", updateMod); b.addEventListener("change", updateMod); }
  const buildNow = btn("Build now", action(runErr, async () => {
    const v = values();
    if (!v.stages.length) throw new Error("No stage is selected. Tick at least one stage, then build again.");
    const b = await api("POST", `/pipelines/${pid}/builds`, { json: {
      config_id: cfgSel.value ? +cfgSel.value : null, params: v.params, stages: v.stages, upload_ids: [...pins.values()] } });
    location.hash = "#/b/" + b.id;
  }), "primary", "play");
  const runSec = sec("Run",
    el("div", { class: "bar" }, el("label", {}, "Config ", cfgSel),
      btn("Delete config", () => {
        if (!cfgSel.value) return fail(runErr, new Error("Select a config to delete."));
        const c = cfgs.find((x) => String(x.id) === cfgSel.value);
        confirmDlg({ title: `Delete config ${c.name}?`, body: "Builds that used it keep their recorded params. This can't be undone.",
          safe: "Cancel", danger: "Delete config", busy: "Deleting…",
          run: async () => {
            await api("DELETE", "/configs/" + c.id);
            cfgs = await api("GET", `/pipelines/${pid}/configs`);
            fillConfigs(); prevSel = cfgSel.value; updateMod();
          } });
      }, "danger")),
    paramBox, el("fieldset", {}, el("legend", {}, "Stages"), stageBox),
    el("div", { class: "bar" }, buildNow, modMark, resetBtn, pinInfo, cfgName,
      btn("Save as config", action(runErr, async () => {
        const v = values();
        if (!cfgName.value.trim()) throw new Error("Name the config. Enter a name so you can pick this config later.");
        const c = await api("POST", `/pipelines/${pid}/configs`, { json: { name: cfgName.value.trim(), ...v } });
        cfgs = await api("GET", `/pipelines/${pid}/configs`);
        fillConfigs();
        cfgSel.value = c.id; prevSel = cfgSel.value; updateMod();
        note(runErr, "Saved config " + c.name + ".");
      }))), runErr);

  // Builds: filters are client-side over the fetched page; Load more refetches with a bigger limit
  let builds = [], limit = 50, loadingMore = false, rebuilding = false;
  const bt = el("tbody"), bnone = el("p", { class: "muted", role: "status" }), more = el("div", { class: "bar" });
  const st = el("select", { "aria-label": "Filter by status" }, el("option", { value: "" }, "All statuses"),
    ...["passed", "failed", "running", "queued", "aborted"].map((v) => el("option", { value: v }, label(v))));
  const bq = el("input", { type: "search", placeholder: "#12, user, config...", "aria-label": "Search builds", autocomplete: "off" });
  const rebuildCell = (b) => { // same request as the Build page's Rebuild: params, stages and file versions of #N
    const msg = `Rebuild #${b.number}: reuses params, stages, files@vN as in #${b.number}`, hint = el("span", { class: "hint", id: "rb" + b.id }, msg), err = el("div");
    const go = el("button", { type: "button", class: "btn quiet", title: msg, "aria-describedby": hint.id, onclick: action(err, async () => {
      if (rebuilding) return; // filter re-renders create fresh buttons; allow one rebuild in flight
      rebuilding = true;
      try {
        const d = await api("GET", "/builds/" + b.id);
        try {
          const nb = await api("POST", `/pipelines/${pid}/builds`, { json: { config_id: null, params: d.params, stages: d.stages.map((x) => x.name), upload_ids: d.files.map((f) => f.upload_id) } });
          location.hash = "#/b/" + nb.id;
        } catch (e) { throw new Error(`Can't rebuild #${b.number}. ${e.message}`); }
      } finally { rebuilding = false; }
    }) }, ico("rebuild"), "Rebuild");
    const prev = builds.find((x) => x.number === b.number - 1);
    return el("td", { class: "ract" }, go, prev ? el("a", { class: "btn quiet", href: `#/c/${prev.id}/${b.id}` }, ico("compare"), "Compare with previous") : null, hint, err);
  };
  const drawBuilds = () => {
    const f = bq.value.trim().toLowerCase();
    const rows = builds.filter((b) => (!st.value || b.status === st.value) &&
      (!f || ["#" + b.number, b.triggered_by, b.config_name || "", b.status].some((t) => t.toLowerCase().includes(f))));
    bt.replaceChildren(...rows.map((b) => el("tr", {}, el("td", { class: "num" }, el("a", { href: "#/b/" + b.id }, "#" + b.number)), el("td", {}, badge(b.status)),
      el("td", {}, b.config_name || ""), el("td", {}, b.triggered_by), el("td", {}, when(b.created_at)), el("td", { class: "num" }, dur(b.started_at, b.finished_at)), rebuildCell(b))));
    bnone.replaceChildren(...(rows.length ? [] : ["No builds match this filter ", btn("Clear filter", () => { st.value = ""; bq.value = ""; drawBuilds(); }, "quiet")]));
    more.replaceChildren(...(builds.length >= limit && limit < 500 ? [btn("Load more", action(bnone, async () => {
      if (loadingMore) return; // filter changes re-render this button mid-fetch; one request at a time
      loadingMore = true;
      try {
        const next = Math.min(500, limit * 2); // commit the new limit only on success so a retry still shows Load more
        builds = await api("GET", `/pipelines/${pid}/builds?limit=${next}`);
        limit = next;
      } finally { loadingMore = false; } // ponytail: refetches the whole list; add offset paging if 500 is not enough
      drawBuilds();
    }))] : []));
  };
  st.addEventListener("change", drawBuilds);
  bq.addEventListener("input", drawBuilds);
  builds = await api("GET", `/pipelines/${pid}/builds`);
  drawBuilds();
  const buildsSec = sec("Builds", builds.length
    ? el("div", {}, el("div", { class: "bar" }, st, bq), el("div", { class: "wrap" }, el("table", {}, el("thead", {}, el("tr", {}, ...["Build", "Status", "Config", "By", "Created", "Duration", "Actions"].map((t) => el("th", {}, t)))), bt)), bnone, more)
    : el("p", { class: "muted" }, "No builds yet. Run the first build with Build now."));

  // Settings
  const editor = configEditor({ description: pipe.description, config: pipe.config }, { readOnly: !auth.admin,
    save: (json) => api("PUT", "/pipelines/" + pid, { json, admin: true }),
    onSaved: (r) => { pipe.config = r.config; pipe.description = r.description; drawRun(); applyCfg(); updateMod(); } });
  if (view.isConnected) dirty = () => (editor.isDirty() ? "Your edits to this pipeline's settings have not been saved." : "");
  const setSec = sec("Settings (admin)", editor.node);

  view.append(filesSec, runSec, buildsSec, setSec);
  sideRender = () => setSide("Pipeline " + pipe.name, [
    sideItem("play", shownMod ? "Build with unsaved changes" : "Build now", { onclick: () => buildNow.click() }),
    sideItem("list", "Builds", { onclick: () => jump(buildsSec) }),
    sideItem("box", "Files", { onclick: () => jump(filesSec) }),
    sideItem("rebuild", "Run", { onclick: () => jump(runSec) }),
    sideItem("copy", "Configs", { onclick: () => jump(runSec) }),
    auth.admin ? sideItem("gear", "Settings", { onclick: () => jump(setSec) }) : sideItem("gear", "Settings", { off: "Admin token required" }),
  ]);
  // restore this tab's unsaved run edits (sessionStorage), then show the Modified state
  try {
    const r = JSON.parse(sessionStorage.getItem(runKey) || "null");
    if (r) {
      if (cfgs.some((c) => String(c.id) === r.cfg)) cfgSel.value = r.cfg;
      prevSel = cfgSel.value; applyCfg();
      for (const k in paramIn) if (k in (r.params || {}) && (paramIn[k].tagName !== "SELECT" || [...paramIn[k].options].some((o) => o.value === r.params[k]))) paramIn[k].value = r.params[k];
      if (r.stages) for (const k in stageCb) stageCb[k].checked = r.stages.includes(k);
      for (const [path, id] of r.pins || []) pins.set(path, id);
    }
  } catch (e) { /* bad stored state: start from the saved config */ }
  updatePins();
  await loadFiles();
}

// ---- #/c/{a}/{b} compare ----
async function comparePage(view, a, b) {
  setCrumbs(["Dashboard", "#/"], [`Compare #${a} and #${b}`]);
  document.title = `Compare ${a} and ${b} · UpRiver`;
  const got = await Promise.allSettled([api("GET", "/builds/" + a), api("GET", "/builds/" + b)]);
  const miss = [a, b].filter((id, i) => got[i].status === "rejected" && /^404/.test(got[i].reason.message));
  if (miss.length) { // E12
    setSide(null);
    view.append(el("section", {}, el("h1", {}, "Compare"), ...miss.map((id) => el("div", { class: "banner error", role: "alert" }, `Build ${id} not found. It may have been removed, or the link is mistyped.`, el("a", { href: "#/" }, "Go to Dashboard")))));
    return;
  }
  for (const g of got) if (g.status === "rejected") throw g.reason;
  const [x, y] = got.map((g) => g.value);
  const flat = (v) => (v == null ? "—" : String(v));
  const tbl = (heads, rows) => el("div", { class: "wrap" }, el("table", {}, el("thead", {}, el("tr", {}, ...heads.map((t) => el("th", {}, t)))),
    el("tbody", {}, ...rows.map((r) => el("tr", {}, ...r.map((c) => el("td", { class: "data" }, c)))))));
  // params
  const pn = [...new Set([...Object.keys(x.params), ...Object.keys(y.params)])].sort();
  const pRows = pn.map((k) => [k, flat(x.params[k]), flat(y.params[k]), x.params[k] === y.params[k]]);
  const pDiff = pRows.filter((r) => !r[3]);
  // files by path
  const fx = new Map(x.files.map((f) => [f.path, f])), fy = new Map(y.files.map((f) => [f.path, f]));
  const fRows = [];
  for (const pth of [...new Set([...fx.keys(), ...fy.keys()])].sort()) {
    const l = fx.get(pth), r = fy.get(pth);
    if (l && r && l.sha256 === r.sha256 && l.version === r.version) continue;
    fRows.push([pth, l ? "v" + l.version : "—", r ? "v" + r.version : "—", !l ? "added" : !r ? "removed" : "changed"]);
  }
  // stages matched by name
  const runs = (z) => new Map(z.stage_runs.map((s) => [s.name, s]));
  const rx = runs(x), ry = runs(y), defs = (z) => new Map(z.stages.map((s) => [s.name, JSON.stringify(s)]));
  const dx = defs(x), dy = defs(y), sNames = [...new Set([...rx.keys(), ...ry.keys(), ...dx.keys(), ...dy.keys()])];
  const desc = (r) => (r ? label(r.status) + (r.exit_code != null ? " (exit " + r.exit_code + ")" : "") + (r.started_at ? " " + dur(r.started_at, r.finished_at) : "") : "");
  let firstDiff = null;
  const sRows = sNames.map((n) => {
    const l = rx.get(n), r = ry.get(n);
    const only = !l && !dx.has(n) ? `only in #${y.number}` : !r && !dy.has(n) ? `only in #${x.number}` : "";
    const changed = only || !l || !r || l.status !== r.status || l.exit_code !== r.exit_code || dx.get(n) !== dy.get(n);
    if (changed && !firstDiff && l && r) firstDiff = r;
    return [n, desc(l) || "—", desc(r) || "—", only || (changed ? "differs" : "same")];
  });
  const sDiff = sRows.filter((r) => r[3] !== "same").length;
  const total = pDiff.length + fRows.length + sDiff;
  const bar = el("div", { class: "bar" });
  if (firstDiff) bar.append(btn("Open first differing stage log", () => { location.hash = `#/b/${y.id}/s/${firstDiff.seq}`; }, "primary", "console"));
  const hidden = pRows.length - pDiff.length;
  const pBody = el("div"), showUn = el("button", { type: "button", class: "btn quiet" });
  let all = false;
  const drawP = () => {
    pBody.replaceChildren(tbl(["Param", "#" + x.number, "#" + y.number], (all ? pRows : pDiff).map((r) => r.slice(0, 3))));
    showUn.textContent = all ? "Hide unchanged" : `Show ${hidden} unchanged`;
  };
  showUn.addEventListener("click", () => { all = !all; drawP(); });
  drawP();
  const sec = (t, ...k) => el("section", {}, el("h2", {}, t), ...k);
  const fact = (name, f) => [name, f(x), f(y)];
  setSide(`Compare #${x.number} and #${y.number}`, [
    sideItem("compare", "Swap sides", { onclick: () => { location.hash = `#/c/${y.id}/${x.id}`; } }),
    sideItem("console", "Build #" + x.number, { href: "#/b/" + x.id }), sideItem("console", "Build #" + y.number, { href: "#/b/" + y.id })]);
  view.append(el("section", {}, el("h1", {}, `Compare #${x.number} and #${y.number}`),
    x.pipeline_id !== y.pipeline_id ? el("div", { class: "banner info" }, "These builds belong to different pipelines. Params, files and stages may not be comparable.") : null,
    el("p", { role: "status" }, total ? `${total} difference${total === 1 ? "" : "s"}: ${pDiff.length} param${pDiff.length === 1 ? "" : "s"}, ${fRows.length} file${fRows.length === 1 ? "" : "s"}, ${sDiff} stage${sDiff === 1 ? "" : "s"}.` : "No differences."), bar),
    sec("Params", pBody, pRows.length && hidden ? showUn : null),
    sec("Files", fRows.length ? tbl(["File", "#" + x.number, "#" + y.number, "Change"], fRows) : el("p", { class: "muted" }, "Same files and versions.")),
    sec("Stages", sRows.length ? tbl(["Stage", "#" + x.number, "#" + y.number, "Change"], sRows) : el("p", { class: "muted" }, "No stages.")),
    sec("Facts", tbl(["", "#" + x.number, "#" + y.number], [fact("Status", (z) => label(z.status)), fact("Triggered by", (z) => z.triggered_by), fact("Config", (z) => z.config_name || "—"),
      fact("Created", (z) => when(z.created_at)), fact("Duration", (z) => dur(z.started_at, z.finished_at) || "—")])));
}

// ---- #/b/{id} and #/b/{id}/s/{seq} build ----
async function buildPage(view, bid, seqArg) {
  const head = el("header", { class: "bh" }), notes = el("div"), err = el("div");
  const stagesBox = el("div", { class: "stages" });
  const stagename = el("span", { class: "data stagename" });
  const q = el("input", { type: "search", placeholder: "Search this log", "aria-label": "Search log", autocomplete: "off" });
  const hits = el("span", { class: "hits num", "aria-live": "polite" });
  const logPre = el("pre", { tabindex: 0, "aria-label": "Log" }), logMeta = el("p", { class: "logmeta", "aria-live": "polite" });
  const artBox = el("div");
  const stagesSec = el("section", { "aria-label": "Stages" }, el("h2", {}, "Stages"), stagesBox);
  const inline = el("div", { class: "inline-actions" }), menu = el("div", { class: "menu" });
  const bFollow = el("button", { type: "button", class: "btn", "aria-pressed": "false", onclick: () => toggleFollow() }, ico("follow"), "Follow ", el("kbd", { "aria-hidden": "true" }, "f"));
  const bJump = btn("Jump to first error", () => jumpTo(firstErr), "", "jump");
  const consoleSec = el("section", { "aria-label": "Console output" }, el("h2", {}, "Console output · ", stagename),
    el("div", { class: "logbar" },
      el("label", { class: "search" }, ico("search"), q, el("kbd", { "aria-hidden": "true" }, "/")), hits, bFollow, bJump, inline,
      el("details", { class: "more" }, el("summary", { class: "btn" }, ico("more"), "More"), menu)),
    logPre, logMeta);
  const artSec = el("section", { "aria-label": "Artifacts" }, el("h2", {}, "Artifacts"), artBox);
  view.append(el("div", { class: "pg" }, head, notes, err, stagesSec, consoleSec, artSec));

  let build, pipe, nav = {}, arts = null, selected = null, picked = seqArg != null, headKey = "", sideKey = "", prevSt = null;
  const st = { follow: !picked, wrap: false, full: false };
  const sumCache = {}; // seq -> first error line of a failed stage's log
  // log model: lines are plain strings; DOM is built in chunks so 100k lines stay responsive
  let logGen = 0, lines = [], buf = "", rendered = 0, chunk = null, chunkN = 0, matchN = 0, firstErr = -1, logDone = false, jumpPending = false, wantJump = null, pumping = false, term = "", copied = "";
  const active = () => build.status === "queued" || build.status === "running";
  const stageOf = (seq) => build.stage_runs.find((s) => s.seq === seq);

  function metaText() {
    if (copied) return copied;
    const s = stageOf(selected);
    if (!s) return build.status === "queued" ? "Output appears here when the first stage starts." : "";
    if (!lines.length && !logDone) return s.status === "pending" ? "This stage has not started." : "Loading log…";
    if (!lines.length) return s.status === "running" ? "This stage has produced no output yet." : s.status === "skipped" ? "This stage was skipped. No output." : "No output.";
    return logDone ? "End of log · " + lines.length + " lines" : st.follow ? "Following · " + lines.length + " lines" : "Live · " + lines.length + " lines";
  }
  function sync() {
    logPre.classList.toggle("soft", st.wrap);
    logPre.classList.toggle("full", st.full);
    for (const b of consoleSec.querySelectorAll("button[aria-pressed]")) b.setAttribute("aria-pressed", String(st[b.dataset.k || "follow"]));
    for (const b of consoleSec.querySelectorAll("button[data-k=copy],button[data-k=dl]")) { b.disabled = !lines.length; b.title = lines.length ? "" : "Nothing to copy"; }
    bJump.disabled = firstErr < 0;
    bJump.title = firstErr < 0 ? "No errors in this log" : "";
    logMeta.textContent = metaText();
    hits.textContent = !term ? "" : matchN >= 500 ? "500+ matches. Refine the search." : matchN + (matchN === 1 ? " match" : " matches");
  }
  const logText = () => lines.join("\n");
  const tools = () => [
    el("button", { type: "button", class: "btn", "data-k": "copy", onclick: () => {
      if (navigator.clipboard) navigator.clipboard.writeText(logText()).catch(() => {});
      copied = "Copied " + lines.length + " lines";
      announce(copied + ".");
      sync();
      setTimeout(() => { copied = ""; sync(); }, 3000);
    } }, ico("copy"), "Copy"),
    el("button", { type: "button", class: "btn", "data-k": "dl", onclick: () => saveBlob(new Blob([logText() + "\n"], { type: "text/plain" }), `build-${build.number}-${stagename.textContent}.log`) }, ico("down"), "Download log"),
    el("button", { type: "button", class: "btn", "data-k": "wrap", "aria-pressed": "false", onclick: () => { st.wrap = !st.wrap; sync(); } }, ico("wrap"), "Wrap"),
    el("button", { type: "button", class: "btn", "data-k": "full", "aria-pressed": "false", onclick: () => { st.full = !st.full; sync(); } }, ico("expand"), "Full height"),
  ];
  inline.append(...tools());
  menu.append(...tools());

  function lineEl(i) {
    const s = lines[i];
    const d = el("span", { class: "ln" + (ERR.test(s) ? " err" : /^\$ /.test(s) ? " cmd" : /warn/i.test(s) ? " warn" : "") });
    d.setAttribute("data-n", i + 1);
    if (!term) { d.textContent = s; return d; }
    const lo = s.toLowerCase(), t = term.toLowerCase();
    let p = 0, k;
    while (matchN < 500 && (k = lo.indexOf(t, p)) > -1) {
      d.append(s.slice(p, k), el("mark", {}, s.slice(k, k + t.length)));
      p = k + t.length;
      matchN++;
    }
    d.append(s.slice(p));
    return d;
  }
  function pump() {
    pumping = false;
    const atBottom = logPre.scrollTop + logPre.clientHeight >= logPre.scrollHeight - 20;
    const stop = Math.min(lines.length, rendered + 1000);
    for (; rendered < stop; rendered++) {
      if (!chunk || chunkN === 500) { chunk = el("span", { class: "chunk" }); chunkN = 0; logPre.append(chunk); }
      chunk.append(lineEl(rendered));
      chunkN++;
    }
    if (rendered < lines.length) schedule();
    else if (jumpPending && logDone) {
      jumpPending = false;
      const s = stageOf(selected);
      if (s && s.status === "failed" && firstErr >= 0) wantJump = firstErr;
      else if (st.follow || !s || s.status !== "running") logPre.scrollTop = logPre.scrollHeight;
    } else if (st.follow && atBottom) logPre.scrollTop = logPre.scrollHeight;
    if (wantJump != null && wantJump < rendered) {
      const n = logPre.querySelector('[data-n="' + (wantJump + 1) + '"]');
      wantJump = null;
      if (n) logPre.scrollTop += n.getBoundingClientRect().top - logPre.getBoundingClientRect().top - 24;
    }
    sync();
  }
  function schedule() { if (!pumping) { pumping = true; setTimeout(pump, 0); } }
  function jumpTo(i) { wantJump = i; schedule(); }
  function addLine(s) { lines.push(s); if (firstErr < 0 && ERR.test(s)) firstErr = lines.length - 1; }
  function addData(data) {
    const parts = (buf + data.replace(ANSI, "")).split("\n");
    buf = parts.pop();
    for (const p of parts) addLine(p.replace(/\r$/, ""));
    schedule();
  }
  function resetRender() { rendered = 0; chunk = null; chunkN = 0; matchN = 0; logPre.replaceChildren(); schedule(); }
  let qTimer;
  q.addEventListener("input", () => { clearTimeout(qTimer); qTimer = setTimeout(() => { term = q.value; resetRender(); }, 200); });
  let hitAt = -1;
  q.addEventListener("keydown", (ev) => { // Enter steps through matches
    if (ev.key !== "Enter") return;
    const ms = logPre.querySelectorAll("mark");
    if (!ms.length) return;
    hitAt = (hitAt + 1) % ms.length;
    logPre.scrollTop += ms[hitAt].getBoundingClientRect().top - logPre.getBoundingClientRect().top - 40;
  });

  function selectStage(seq) { // restart log polling for this stage; offset polling until complete
    selected = seq;
    const my = ++logGen;
    lines = []; buf = ""; firstErr = -1; logDone = false; jumpPending = true; wantJump = null; copied = "";
    stagename.textContent = stageOf(seq).name;
    logPre.setAttribute("aria-label", "Log for stage " + stageOf(seq).name);
    resetRender();
    let offset = 0;
    const pull = async () => {
      for (;;) { // keep reading while chunks come back full, so long logs load without waiting for the poll tick
        if (my !== logGen) return false;
        const r = await api("GET", `/builds/${bid}/stages/${seq}/log?offset=${offset}`);
        if (my !== logGen) return false;
        if (r.data) addData(r.data);
        offset = r.next_offset;
        if (r.complete) {
          if (buf) { addLine(buf); buf = ""; }
          logDone = true;
          const fs = stageOf(seq);
          if (fs && fs.status === "failed" && firstErr >= 0) { sumCache[seq] = lines[firstErr].trim().slice(0, 200); if (sumEl) sumEl.replaceChildren(...summary()); }
          schedule();
          return false;
        }
        if (!r.data) return true;
      }
    };
    pull().then((more) => { if (more) poll(logPre, pull, 1500); }).catch((e) => fail(err, new Error("Couldn't load the log for " + stageOf(seq).name + ". " + e.message)));
    renderStages();
  }
  function pick(seq) { // a user choice: stop following and keep the URL shareable
    picked = true;
    st.follow = false;
    history.replaceState(null, "", `#/b/${bid}/s/${seq}`);
    ret = location.hash;
    if (seq !== selected) selectStage(seq); else renderStages();
    sync();
  }
  function toggleFollow() {
    st.follow = !st.follow;
    if (st.follow) logPre.scrollTop = logPre.scrollHeight;
    sync();
  }

  function renderStages() {
    const focus = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.seq : null;
    const failed = build.stage_runs.find((s) => s.status === "failed");
    stagesBox.replaceChildren(...build.stage_runs.map((s) => {
      const b = el("button", { type: "button", class: "cell" + (s.status === "failed" ? " failed" : ""), "aria-pressed": String(s.seq === selected), "data-seq": s.seq,
        onclick: () => pick(s.seq) },
      el("span", { class: "row" }, ball(s.status), el("span", { class: "nm" }, s.name)),
      el("small", {}, el("span", { class: "stxt s-" + statusCls(s.status) }, label(s.status)),
        s.exit_code != null ? el("span", {}, "exit " + s.exit_code) : null,
        s.started_at ? el("span", { class: "num" }, dur(s.started_at, s.finished_at)) : null));
      if (s.status === "skipped" && failed) b.title = "Not run because " + failed.name + " failed";
      return b;
    }));
    if (!build.stage_runs.length) stagesBox.replaceChildren(el("p", { class: "muted" }, build.status === "queued" ? "Waiting for a runner. No stages started yet." : "No stages started yet."));
    if (focus) { const b = stagesBox.querySelector(`[data-seq="${focus}"]`); if (b) b.focus(); }
    // failure banner / running chip when the selection is somewhere else
    const running = build.stage_runs.find((s) => s.status === "running");
    notes.replaceChildren(...[
      failed && failed.seq !== selected ? el("div", { class: "banner error" }, failed.name + " failed.", btn("View log", () => pick(failed.seq))) : null,
      running && running.seq !== selected ? el("div", { class: "chipbar" }, btn("Running: " + running.name + " · View", () => pick(running.seq))) : null].filter(Boolean));
  }

  const rebuild = (withCurrent) => action(err, async () => {
    try {
      const b = await api("POST", `/pipelines/${build.pipeline_id}/builds`, { json: { config_id: null, params: build.params,
        stages: build.stages.map((s) => s.name), upload_ids: withCurrent ? [] : build.files.map((f) => f.upload_id) } });
      location.hash = "#/b/" + b.id;
    } catch (e) {
      throw new Error(`Can't rebuild #${build.number}. ${e.message}` + (withCurrent ? "" : " Use Rebuild with current files, or upload the file again."));
    }
  });
  const abortDlg = () => {
    const run = build.stage_runs.find((s) => s.status === "running");
    confirmDlg({ title: `Abort build #${build.number}?`,
      body: `Stops ${run ? "stage " + run.name : "the build"} now and skips the stages after it. Output so far is kept. This can't be undone.`,
      safe: "Keep running", danger: "Abort build", busy: "Aborting…",
      run: async () => {
        try { await api("POST", `/builds/${bid}/abort`); } catch (e) {
          if (!/^409/.test(e.message)) throw e;
          err.className = "banner info";
          err.textContent = `Build #${build.number} already finished. It ended as ${build.status} before the abort arrived, so nothing was stopped.`;
        }
        await refresh();
      } });
  };

  let sumEl, durEl;
  function summary() {
    const f = build.stage_runs.find((s) => s.status === "failed"), r = build.stage_runs.find((s) => s.status === "running");
    if (f) {
      const t = `${f.name} failed${f.exit_code != null ? " · exit " + f.exit_code : ""}${sumCache[f.seq] ? " · " + sumCache[f.seq] : ""}`;
      return [ball("failed"), el("a", { href: `#/b/${bid}/s/${f.seq}`, onclick: (ev) => { ev.preventDefault(); pick(f.seq); if (firstErr >= 0) jumpTo(firstErr); else jumpPending = true; consoleSec.scrollIntoView(); } }, t)];
    }
    if (r) return [ball("running"), `${r.name} running · ${dur(r.started_at)}`];
    if (build.status === "queued") return ["Waiting for a runner."];
    return [build.status === "aborted" ? "Aborted" : ""];
  }
  function renderHead() {
    const files = build.files;
    const allFiles = el("dd", { class: "data" });
    const showAll = el("a", { href: "#", onclick: (ev) => {
      ev.preventDefault();
      const open = ev.target.textContent === "show all";
      allFiles.replaceChildren(...fileList(open));
      ev.target.textContent = open ? "show fewer" : "show all";
    } }, "show all");
    const fileList = (all) => [el("span", { class: "num" }, files.length + (files.length === 1 ? " file" : " files")),
      files.length ? " · " : null, files.length ? files.slice(0, all ? undefined : 2).map((f) => f.path + "@v" + f.version).join(" ") : null,
      files.length > 2 ? " · " : null, files.length > 2 ? showAll : null].filter((x) => x != null);
    allFiles.replaceChildren(...fileList(false));
    sumEl = el("p", { class: "sum" });
    durEl = el("dd", { class: "num" });
    const cta = active()
      ? el("div", { class: "cta" }, el("div", { class: "row" }, btn("Abort", abortDlg, "primary", "stop")))
      : el("div", { class: "cta" }, el("div", { class: "row" }, btn("Rebuild", rebuild(false), "primary", "rebuild"), btn("Rebuild with current files", rebuild(true))),
        el("small", {}, `Reuses params, stages and file versions as in #${build.number}.`));
    head.replaceChildren(
      el("div", { class: "hd" },
        el("h1", {}, ball(build.status, true), el("span", { class: "num" }, "Build #" + build.number), el("span", { class: "stamp s-" + statusCls(build.status) }, label(build.status))), cta),
      sumEl,
      el("dl", {},
        el("div", {}, el("dt", {}, "Triggered by"), el("dd", {}, build.triggered_by)),
        el("div", {}, el("dt", {}, "Config"), el("dd", {}, build.config_name || "—")),
        el("div", {}, el("dt", {}, "Duration"), durEl),
        el("div", {}, el("dt", {}, "Params"), el("dd", { class: "data" }, Object.entries(build.params).map(([k, v]) => k + "=" + v).join(" ") || "—")),
        el("div", {}, el("dt", {}, "Files"), allFiles)));
  }
  function renderSide() {
    const p = nav.prev, n = nav.next;
    setSide("Build #" + build.number, [
      sideItem("console", "Console", { current: true, onclick: () => jump(consoleSec) }),
      sideItem("box", "Artifacts" + (arts ? ` (${arts.length})` : ""), { onclick: () => jump(artSec) }),
      active() ? sideItem("stop", "Abort", { onclick: abortDlg }) : sideItem("stop", "Abort", { off: "Not running" }),
      p ? sideItem("compare", `Compare with #${p.number}…`, { href: `#/c/${p.id}/${build.id}` }) : sideItem("compare", "Compare…", { off: "No earlier build" }),
      sideItem("", "", { sep: true }),
      p ? sideItem("prev", "Previous build #" + p.number, { href: "#/b/" + p.id }) : sideItem("prev", "Previous build", { off: "No earlier build" }),
      n ? sideItem("next", "Next build #" + n.number, { href: "#/b/" + n.id }) : sideItem("next", "Next build", { off: "No later build" }),
    ]);
  }
  async function errLine(s) { // ponytail: first log chunk only; later chunks are not scanned for the summary
    sumCache[s.seq] = "";
    try {
      const r = await api("GET", `/builds/${bid}/stages/${s.seq}/log?offset=0`);
      const ls = r.data.replace(ANSI, "").split("\n").map((x) => x.trim()).filter(Boolean);
      sumCache[s.seq] = (ls.find((l) => ERR.test(l)) || "").slice(0, 200);
    } catch (e) { delete sumCache[s.seq]; }
  }

  async function load() {
    build = await api("GET", "/builds/" + bid);
    if (!pipe) {
      pipe = await api("GET", "/pipelines/" + build.pipeline_id);
      try {
        const all = await api("GET", `/pipelines/${pipe.id}/builds?limit=500`);
        nav = { prev: all.find((b) => b.number === build.number - 1), next: all.find((b) => b.number === build.number + 1) };
      } catch (e) { /* sidebar degrades to disabled entries */ }
    }
    setCrumbs(["Dashboard", "#/"], [pipe.name, "#/p/" + pipe.id], ["#" + build.number]);
    const runs = build.stage_runs;
    const failed = runs.find((s) => s.status === "failed"), running = runs.find((s) => s.status === "running");
    document.title = `#${build.number} ${build.status} · ${pipe.name} · UpRiver`;
    if (failed && !(failed.seq in sumCache)) await errLine(failed);
    // announce changes (not the first load)
    const now = Object.fromEntries(runs.map((s) => [s.seq, s.status]));
    if (prevSt) {
      const ch = runs.filter((s) => prevSt[s.seq] !== s.status && ["passed", "failed", "running", "aborted"].includes(s.status));
      if (ch.length) announce(ch.map((s) => `Stage ${s.name} ${s.status}${s.status === "failed" && s.exit_code != null ? " with exit " + s.exit_code : ""}.`).join(" "));
    }
    prevSt = now;
    // which stage to show: the requested one, else running, else failed, else last; Follow never leaves a failed stage
    const cur = stageOf(selected);
    let want = null;
    if (selected == null) want = (seqArg != null && stageOf(seqArg)) || running || failed || runs[runs.length - 1];
    else if (st.follow && !(cur && cur.status === "failed")) want = running || failed;
    if (want && want.seq !== selected) selectStage(want.seq);
    else renderStages();
    const key = [build.status, active(), failed && failed.seq, sumCache[failed && failed.seq]].join("|");
    if (key !== headKey) { headKey = key; renderHead(); }
    sumEl.replaceChildren(...summary());
    durEl.textContent = build.started_at ? dur(build.started_at, build.finished_at) : "—";
    if (!active() && !arts) await loadArtifacts();
    const sk = [active(), arts && arts.length, nav.prev && nav.prev.id, nav.next && nav.next.id].join("|");
    if (sk !== sideKey) { sideKey = sk; renderSide(); }
    sync();
  }
  async function refresh() { try { await load(); } catch (e) { fail(err, e); } }
  async function loadArtifacts() {
    arts = await api("GET", `/builds/${bid}/artifacts`);
    artBox.replaceChildren(arts.length
      ? el("ul", { class: "art" }, ...arts.map((a) => el("li", {}, el("span", { class: "nm" }, el("span", { class: "data" }, a.path), " ", el("small", { class: "num" }, fmtSize(a.size))),
        btn("Download", action(err, () => download(`/builds/${bid}/artifacts/${a.path.split("/").map(encodeURIComponent).join("/")}`, a.path.split("/").pop()))))))
      : el("div", {}, el("p", {}, "This build produced no artifacts."), el("p", { class: "hint" }, "Write files to $ARTIFACTS_DIR in a stage command to list them here.")));
  }

  const onKey = (ev) => { // shortcuts are ignored while typing, with modifiers, or behind a dialog
    if (!view.isConnected) { document.removeEventListener("keydown", onKey); return; }
    const t = ev.target;
    if ((t.matches && t.matches("input,textarea,select")) || t.isContentEditable || ev.metaKey || ev.ctrlKey || ev.altKey || document.querySelector("dialog[open]")) return;
    if (ev.key === "/") { ev.preventDefault(); q.focus(); } else if (ev.key === "f") toggleFollow();
  };
  document.addEventListener("keydown", onKey);

  await load();
  if (active()) poll(view, async () => { await load(); return active(); }, 2000);
}

renderUser();
route();
