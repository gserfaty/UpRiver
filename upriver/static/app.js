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
const badge = (s) => el("span", { class: "badge " + s }, s);
const fmtSize = (n) => (n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(1) + " MB");
const ts = (s) => (s ? new Date(s.replace(" ", "T") + "Z") : null);
const when = (s) => (s ? ts(s).toLocaleString() : "");
function dur(a, b) {
  const start = ts(a);
  if (!start) return "";
  const sec = Math.max(0, Math.round(((b ? ts(b) : new Date()) - start) / 1000));
  return sec >= 60 ? Math.floor(sec / 60) + "m " + (sec % 60) + "s" : sec + "s";
}

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
  const r = await fetch("/api" + path, { method, headers, body });
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
async function download(path, filename) { // fetch -> blob -> object URL, so no token ever appears in a URL
  const url = URL.createObjectURL(await api("GET", path, { blob: true }));
  const a = el("a", { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
// Wrap a click handler: shows errors in `box`, disables the button while running.
function action(box, fn) {
  return async (ev) => {
    const btn = ev.currentTarget;
    btn.disabled = true;
    box.textContent = "";
    box.className = "";
    try { await fn(btn); } catch (e) { box.className = "err"; box.textContent = e.message; }
    btn.disabled = false;
  };
}
const note = (box, msg) => { box.className = "ok"; box.textContent = msg; };

// ---- sign-in bar ----
function renderBar() {
  const bar = $("bar");
  bar.replaceChildren();
  const f = {
    user: el("input", { placeholder: "your name", "aria-label": "your name", autocomplete: "username", value: auth.user, maxLength: 64 }),
    token: el("input", { placeholder: "team token", "aria-label": "team token", type: "password", autocomplete: "off", value: auth.token }),
    admin: el("input", { placeholder: "admin token (optional)", "aria-label": "admin token (optional)", type: "password", autocomplete: "off", value: auth.admin }),
  };
  // a form, so Enter in any field saves
  bar.append(el("h1", {}, el("a", { href: "#/", style: "text-decoration:none;color:inherit" }, "UpRiver")),
    el("form", { class: "row", onsubmit: (ev) => {
      ev.preventDefault();
      auth.user = f.user.value.trim(); auth.token = f.token.value; auth.admin = f.admin.value;
      store.set("upriver.user", auth.user); store.set("upriver.token", auth.token); store.set("upriver.admin", auth.admin);
      route();
    } }, f.user, f.token, f.admin, el("button", {}, "Save")));
}

// ---- router ----
function route() {
  const view = el("div"); // fresh per navigation: a slow page from the previous route renders into a detached node
  $("view").replaceChildren(view);
  if (!auth.user || !auth.token) {
    view.append(el("p", {}, "Enter your name and the team token above to continue."));
    return;
  }
  const h = location.hash;
  let m;
  const page = (m = h.match(/^#\/p\/(\d+)$/)) ? pipelinePage(view, +m[1])
    : (m = h.match(/^#\/b\/(\d+)$/)) ? buildPage(view, +m[1])
    : listPage(view);
  page.catch((e) => view.prepend(el("div", { class: "err" }, e.message)));
}
window.addEventListener("hashchange", route);

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
  const list = await api("GET", "/pipelines");
  view.append(el("h2", {}, "Pipelines"));
  const tbody = el("tbody");
  for (const p of list) {
    tbody.append(el("tr", {},
      el("td", {}, el("a", { href: "#/p/" + p.id }, p.name)),
      el("td", {}, p.description),
      el("td", {}, p.last_build_status ? badge(p.last_build_status) : el("span", { class: "muted" }, "no builds"))));
  }
  view.append(el("div", { class: "wrap" }, el("table", {},
    el("thead", {}, el("tr", {}, el("th", {}, "Name"), el("th", {}, "Description"), el("th", {}, "Last build"))), tbody)));
  if (!list.length) view.append(el("p", { class: "muted" }, "No pipelines yet."));

  const box = el("div");
  const ta = el("textarea", { value: JSON.stringify(NEW_PIPELINE, null, 2), spellcheck: false, "aria-label": "new pipeline JSON" });
  view.append(el("h2", {}, "New pipeline (admin)"), ta,
    el("div", { class: "row" }, el("button", { onclick: action(box, async () => {
      const p = await api("POST", "/pipelines", { json: JSON.parse(ta.value), admin: true });
      location.hash = "#/p/" + p.id;
    }) }, "Create")), box);
}

// ---- #/p/{id} pipeline ----
async function pipelinePage(view, pid) {
  const [pipe, configs] = await Promise.all([api("GET", "/pipelines/" + pid), api("GET", `/pipelines/${pid}/configs`)]);
  const pins = new Map(); // path -> upload id
  view.append(el("p", {}, el("a", { href: "#/" }, "Pipelines"), " / ", el("strong", {}, pipe.name)),
    el("p", { class: "muted" }, pipe.description));

  // Files
  const filesBox = el("div"), filesErr = el("div");
  const loadFiles = async () => {
    const files = await api("GET", `/pipelines/${pid}/files`);
    const tbody = el("tbody");
    for (const f of files) {
      const hist = el("tr", { class: "hist", hidden: true }, el("td", { colSpan: 5 }));
      tbody.append(el("tr", {},
        el("td", {}, f.path), el("td", {}, "v" + f.version), el("td", {}, fmtSize(f.size)),
        el("td", {}, f.uploader + ", " + when(f.created_at)),
        el("td", {},
          el("button", { onclick: action(filesErr, () => download(`/uploads/${f.id}/download`, f.path.split("/").pop())) }, "Download"), " ",
          el("button", { "aria-expanded": "false", onclick: action(filesErr, async (btn) => {
            hist.hidden = !hist.hidden;
            btn.setAttribute("aria-expanded", String(!hist.hidden));
            if (!hist.hidden) await loadHistory(f.path, hist.firstChild);
          }) }, "History"), " ",
          el("button", { class: "danger", onclick: action(filesErr, async () => {
            await api("DELETE", `/pipelines/${pid}/files?path=${encodeURIComponent(f.path)}`);
            pins.delete(f.path);
            await loadFiles();
          }) }, "Remove"))), hist);
    }
    filesBox.replaceChildren(files.length
      ? el("div", { class: "wrap" }, el("table", {}, el("thead", {}, el("tr", {}, ...["Path", "Version", "Size", "Uploaded by", ""].map((t) => el("th", {}, t)))), tbody))
      : el("p", { class: "muted" }, "No files yet."));
  };
  async function loadHistory(path, cell) {
    const rows = await api("GET", `/pipelines/${pid}/uploads?path=${encodeURIComponent(path)}`);
    cell.replaceChildren(...rows.map((u) => el("div", { class: "row" },
      u.sha256 ? el("input", { type: "checkbox", checked: pins.get(path) === u.id, title: "pin this version for Build now", "aria-label": `pin v${u.version}`,
        onchange: (ev) => {
          if (ev.target.checked) pins.set(path, u.id); else pins.delete(path);
          cell.querySelectorAll("input").forEach((i) => { if (i !== ev.target) i.checked = false; });
          updatePins();
        } }) : el("span", {}, "—"),
      "v" + u.version + (u.sha256 ? " " + fmtSize(u.size) : " removed"), " by " + u.uploader + ", " + when(u.created_at),
      u.sha256 ? el("button", { onclick: action(filesErr, () => download(`/uploads/${u.id}/download`, path.split("/").pop())) }, "Download") : null)));
  }
  const fileIn = el("input", { type: "file", multiple: true, "aria-label": "files to upload" });
  const extract = el("input", { type: "checkbox" });
  view.append(el("h2", {}, "Files"), filesBox,
    el("div", { class: "row" }, fileIn, el("label", {}, extract, " extract zips"),
      el("button", { onclick: action(filesErr, async () => {
        if (!fileIn.files.length) throw new Error("choose files first");
        const form = new FormData();
        for (const f of fileIn.files) form.append("files", f, f.name);
        form.append("extract", extract.checked ? "true" : "false");
        const out = await api("POST", `/pipelines/${pid}/uploads`, { form });
        fileIn.value = "";
        await loadFiles();
        note(filesErr, `${out.filter((o) => !o.unchanged).length} stored, ${out.filter((o) => o.unchanged).length} unchanged`);
      }) }, "Upload")), filesErr);
  await loadFiles();

  // Run
  const runErr = el("div"), pinInfo = el("span", { class: "muted" });
  const updatePins = () => { pinInfo.textContent = pins.size ? `${pins.size} pinned version(s)` : ""; };
  const cfgSel = el("select");
  const paramBox = el("div"), stageBox = el("div"), cfgName = el("input", { placeholder: "config name", "aria-label": "config name", maxLength: 64 });
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
    stageBox.append(el("label", {}, stageCb[s.name], " " + s.name));
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
  view.append(el("h2", {}, "Run"),
    el("div", { class: "row" }, el("label", {}, "Config ", cfgSel),
      el("button", { class: "danger", onclick: action(runErr, async () => {
        if (!cfgSel.value) throw new Error("select a config to delete");
        await api("DELETE", "/configs/" + cfgSel.value);
        cfgs = await api("GET", `/pipelines/${pid}/configs`);
        fillConfigs();
      }) }, "Delete config")),
    paramBox, el("fieldset", {}, el("legend", {}, "Stages"), stageBox),
    el("div", { class: "row" },
      el("button", { onclick: action(runErr, async () => {
        const v = values();
        if (!v.stages.length) throw new Error("select at least one stage");
        const b = await api("POST", `/pipelines/${pid}/builds`, { json: {
          config_id: cfgSel.value ? +cfgSel.value : null, params: v.params, stages: v.stages, upload_ids: [...pins.values()] } });
        location.hash = "#/b/" + b.id;
      }) }, "Build now"), pinInfo, cfgName,
      el("button", { onclick: action(runErr, async () => {
        const v = values();
        if (!cfgName.value.trim()) throw new Error("enter a config name");
        const c = await api("POST", `/pipelines/${pid}/configs`, { json: { name: cfgName.value.trim(), ...v } });
        cfgs = await api("GET", `/pipelines/${pid}/configs`);
        fillConfigs();
        cfgSel.value = c.id;
        note(runErr, "saved config " + c.name);
      }) }, "Save as config")), runErr);

  // Builds
  const builds = await api("GET", `/pipelines/${pid}/builds`);
  const bt = el("tbody");
  for (const b of builds) {
    bt.append(el("tr", {}, el("td", {}, el("a", { href: "#/b/" + b.id }, "#" + b.number)), el("td", {}, badge(b.status)),
      el("td", {}, b.config_name || ""), el("td", {}, b.triggered_by), el("td", {}, when(b.created_at)), el("td", {}, dur(b.started_at, b.finished_at))));
  }
  view.append(el("h2", {}, "Builds"), builds.length
    ? el("div", { class: "wrap" }, el("table", {}, el("thead", {}, el("tr", {}, ...["Build", "Status", "Config", "By", "Created", "Duration"].map((t) => el("th", {}, t)))), bt))
    : el("p", { class: "muted" }, "No builds yet."));

  // Settings
  const setErr = el("div");
  const ta = el("textarea", { value: JSON.stringify({ description: pipe.description, config: pipe.config }, null, 2), spellcheck: false, "aria-label": "pipeline settings JSON" });
  view.append(el("h2", {}, "Settings (admin)"), ta,
    el("div", { class: "row" }, el("button", { onclick: action(setErr, async () => {
      await api("PUT", "/pipelines/" + pid, { json: JSON.parse(ta.value), admin: true });
      note(setErr, "saved; reload the page to see new params and stages");
    }) }, "Save")), setErr);
}

// ---- #/b/{id} build ----
async function buildPage(view, bid) {
  const head = el("div"), stagesBox = el("div"), logHead = el("h2", {}, "Log"), logPre = el("pre", { class: "log", hidden: true });
  const artBox = el("div"), err = el("div");
  view.append(head, err, el("h2", {}, "Stages"), stagesBox, logHead, logPre, el("h2", {}, "Artifacts"), artBox);
  let selected = null, picked = false, logGen = 0, artifactsShown = false, pipe;

  function selectStage(seq) { // restart log polling for this stage; offset polling until complete
    selected = seq;
    const my = ++logGen;
    logPre.hidden = false;
    logPre.textContent = "";
    logHead.textContent = "Log: stage " + seq;
    let offset = 0;
    const pull = async () => {
      if (my !== logGen) return false;
      const r = await api("GET", `/builds/${bid}/stages/${seq}/log?offset=${offset}`);
      if (my !== logGen) return false;
      if (r.data) {
        const atBottom = logPre.scrollTop + logPre.clientHeight >= logPre.scrollHeight - 20;
        logPre.append(r.data);
        if (atBottom) logPre.scrollTop = logPre.scrollHeight;
      }
      offset = r.next_offset;
      return !r.complete;
    };
    // first read immediately, then poll every 1.5 s until complete
    pull().then((more) => { if (more) poll(logPre, pull, 1500); }).catch((e) => { err.className = "err"; err.textContent = e.message; });
    renderStages();
  }

  let build;
  function renderStages() {
    stagesBox.replaceChildren(...build.stage_runs.map((s) => el("button", { type: "button", class: "stage" + (s.seq === selected ? " sel" : ""),
      "aria-pressed": String(s.seq === selected), onclick: () => { picked = true; if (s.seq !== selected) selectStage(s.seq); } },
      el("strong", {}, s.name), el("span", { class: "muted" }, s.kind), badge(s.status),
      el("span", { class: "muted" }, dur(s.started_at, s.finished_at)), s.exit_code != null ? el("span", { class: "muted" }, "exit " + s.exit_code) : null)));
    if (!build.stage_runs.length) stagesBox.append(el("p", { class: "muted" }, "No stages started yet."));
  }
  const active = () => build.status === "queued" || build.status === "running";
  async function load() {
    build = await api("GET", "/builds/" + bid);
    pipe = pipe || await api("GET", "/pipelines/" + build.pipeline_id);
    head.replaceChildren(
      el("p", {}, el("a", { href: "#/" }, "Pipelines"), " / ", el("a", { href: "#/p/" + pipe.id }, pipe.name), " / ", el("strong", {}, "#" + build.number)),
      el("div", { class: "row" }, badge(build.status), el("span", {}, "by " + build.triggered_by),
        build.config_name ? el("span", {}, "config " + build.config_name) : null,
        el("span", { class: "muted" }, when(build.created_at) + (build.started_at ? ", " + dur(build.started_at, build.finished_at) : "")),
        active() ? el("button", { class: "danger", onclick: action(err, async () => { await api("POST", `/builds/${bid}/abort`); await refresh(); }) }, "Abort") : null),
      el("div", { class: "muted" }, Object.entries(build.params).map(([k, v]) => k + "=" + v).join("  ")),
      el("div", { class: "muted" }, build.files.length + " file(s): " + build.files.map((f) => f.path + "@v" + f.version).join(", ")));
    // follow the running (then failed) stage until the user picks one
    const runs = build.stage_runs;
    const want = picked ? null : (runs.find((s) => s.status === "running") || runs.find((s) => s.status === "failed") || (selected == null ? runs[0] : null));
    if (want && want.seq !== selected) selectStage(want.seq);
    else renderStages();
    if (!active() && !artifactsShown) { artifactsShown = true; await loadArtifacts(); }
  }
  async function refresh() { try { await load(); } catch (e) { err.className = "err"; err.textContent = e.message; } }
  async function loadArtifacts() {
    const arts = await api("GET", `/builds/${bid}/artifacts`);
    artBox.replaceChildren(...(arts.length ? arts.map((a) => el("div", { class: "row" }, a.path, el("span", { class: "muted" }, fmtSize(a.size)),
      el("button", { onclick: action(err, () => download(`/builds/${bid}/artifacts/${a.path.split("/").map(encodeURIComponent).join("/")}`, a.path.split("/").pop())) }, "Download")))
      : [el("p", { class: "muted" }, "No artifacts.")]));
  }
  await load();
  if (active()) poll(view, async () => { await load(); return active(); }, 2000);
}

renderBar();
route();
