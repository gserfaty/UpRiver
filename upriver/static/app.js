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
function signOut() {
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
function route() {
  const view = el("div", { class: "pg" }); // fresh per navigation: a slow page from the previous route renders into a detached node
  $("view").replaceChildren(view);
  const h = location.hash || "#/";
  if (h !== "#/signin") ret = h;
  if (!auth.user || !auth.token || h === "#/signin") return signinPage(view);
  let m;
  const page = h === "#/" ? listPage(view)
    : (m = h.match(/^#\/p\/(\d+)$/)) ? pipelinePage(view, +m[1])
    : (m = h.match(/^#\/b\/(\d+)(?:\/s\/(\d+))?$/)) ? buildPage(view, +m[1], m[2] == null ? null : +m[2])
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
  const tbody = el("tbody");
  for (const p of list) {
    tbody.append(el("tr", {},
      el("td", {}, el("a", { href: "#/p/" + p.id }, p.name)),
      el("td", {}, p.description),
      el("td", {}, p.last_build_status ? badge(p.last_build_status) : el("span", { class: "muted" }, "No builds"))));
  }
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
      ? el("div", { class: "wrap" }, el("table", {},
        el("thead", {}, el("tr", {}, el("th", {}, "Name"), el("th", {}, "Description"), el("th", {}, "Last build"))), tbody))
      : el("p", { class: "muted" }, "No pipelines yet. Create the first pipeline to start uploading files and building.")),
  newSec);
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
  const fileIn = el("input", { type: "file", multiple: true, "aria-label": "files to upload" });
  const extract = el("input", { type: "checkbox" });
  const filesSec = sec("Files", filesBox,
    el("div", { class: "bar" }, fileIn, el("label", {}, extract, "Extract zip files"),
      btn("Upload", action(filesErr, async () => {
        if (!fileIn.files.length) throw new Error("Choose files first.");
        const form = new FormData();
        for (const f of fileIn.files) form.append("files", f, f.name);
        form.append("extract", extract.checked ? "true" : "false");
        const out = await api("POST", `/pipelines/${pid}/uploads`, { form });
        fileIn.value = "";
        await loadFiles();
        note(filesErr, `${out.filter((o) => !o.unchanged).length} stored, ${out.filter((o) => o.unchanged).length} unchanged`);
      }), "primary", "upload")), filesErr);

  // Run
  const runErr = el("div"), pinInfo = el("span", { class: "muted" });
  const updatePins = () => { pinInfo.textContent = pins.size ? `${pins.size} pinned version(s)` : ""; };
  const cfgSel = el("select", { "aria-label": "Config" });
  const paramBox = el("div", { class: "bar" }), stageBox = el("div", { class: "bar" }), cfgName = el("input", { placeholder: "Config name", "aria-label": "Config name", maxLength: 64 });
  const paramIn = {};
  for (const p of pipe.config.params) {
    paramIn[p.name] = p.choices
      ? el("select", {}, ...p.choices.map((c) => el("option", { value: c }, c)))
      : el("input", { maxLength: 1024 });
    paramIn[p.name].value = p.default;
    paramBox.append(el("label", {}, p.name + " ", paramIn[p.name]));
  }
  const stageCb = {};
  for (const s of pipe.config.stages) {
    stageCb[s.name] = el("input", { type: "checkbox", checked: true });
    stageBox.append(el("label", {}, stageCb[s.name], s.name));
  }
  let cfgs = configs;
  const fillConfigs = () => {
    cfgSel.replaceChildren(el("option", { value: "" }, "(defaults)"), ...cfgs.map((c) => el("option", { value: c.id }, c.name)));
  };
  cfgSel.addEventListener("change", () => {
    const c = cfgs.find((x) => String(x.id) === cfgSel.value);
    for (const p of pipe.config.params) paramIn[p.name].value = c && p.name in c.params ? c.params[p.name] : p.default;
    for (const s in stageCb) stageCb[s].checked = !c || c.stages.includes(s);
    cfgName.value = c ? c.name : "";
  });
  fillConfigs();
  const values = () => ({
    params: Object.fromEntries(Object.entries(paramIn).map(([k, i]) => [k, i.value])),
    stages: Object.keys(stageCb).filter((s) => stageCb[s].checked),
  });
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
            fillConfigs();
          } });
      }, "danger")),
    paramBox, el("fieldset", {}, el("legend", {}, "Stages"), stageBox),
    el("div", { class: "bar" }, buildNow, pinInfo, cfgName,
      btn("Save as config", action(runErr, async () => {
        const v = values();
        if (!cfgName.value.trim()) throw new Error("Name the config. Enter a name so you can pick this config later.");
        const c = await api("POST", `/pipelines/${pid}/configs`, { json: { name: cfgName.value.trim(), ...v } });
        cfgs = await api("GET", `/pipelines/${pid}/configs`);
        fillConfigs();
        cfgSel.value = c.id;
        note(runErr, "Saved config " + c.name + ".");
      }))), runErr);

  // Builds
  const builds = await api("GET", `/pipelines/${pid}/builds`);
  const bt = el("tbody");
  for (const b of builds) {
    bt.append(el("tr", {}, el("td", { class: "num" }, el("a", { href: "#/b/" + b.id }, "#" + b.number)), el("td", {}, badge(b.status)),
      el("td", {}, b.config_name || ""), el("td", {}, b.triggered_by), el("td", {}, when(b.created_at)), el("td", { class: "num" }, dur(b.started_at, b.finished_at))));
  }
  const buildsSec = sec("Builds", builds.length
    ? el("div", { class: "wrap" }, el("table", {}, el("thead", {}, el("tr", {}, ...["Build", "Status", "Config", "By", "Created", "Duration"].map((t) => el("th", {}, t)))), bt))
    : el("p", { class: "muted" }, "No builds yet. Run the first build with Build now."));

  // Settings
  const setErr = el("div");
  const ta = el("textarea", { value: JSON.stringify({ description: pipe.description, config: pipe.config }, null, 2), spellcheck: false, "aria-label": "pipeline settings JSON" });
  const setSec = sec("Settings (admin)", ta,
    el("div", { class: "bar" }, btn("Save", action(setErr, async () => {
      await api("PUT", "/pipelines/" + pid, { json: JSON.parse(ta.value), admin: true });
      note(setErr, "Saved. Reload the page to see new parameters and stages.");
    }), "primary")), setErr);

  view.append(filesSec, runSec, buildsSec, setSec);
  setSide("Pipeline " + pipe.name, [
    sideItem("play", "Build now", { onclick: () => buildNow.click() }),
    sideItem("list", "Builds", { onclick: () => jump(buildsSec) }),
    sideItem("box", "Files", { onclick: () => jump(filesSec) }),
    sideItem("rebuild", "Run", { onclick: () => jump(runSec) }),
    sideItem("copy", "Configs", { onclick: () => jump(runSec) }),
    auth.admin ? sideItem("gear", "Settings", { onclick: () => jump(setSec) }) : sideItem("gear", "Settings", { off: "Admin token required" }),
  ]);
  await loadFiles();
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
      sideItem("compare", "Compare…", { off: "Not available yet" }),
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
