/* E-Ticket Mali – script partagé par toutes les pages : menu, bannière démo, outils communs.
   Expose un seul objet global `ET` (esc, fmt, fdate, $, api, config). */
(function () {
  "use strict";
  // ---- Liaison avec le serveur E-Ticket ----
  // Servie par le serveur : ROOT est vide (même adresse). Ouverte autrement (double-clic, autre serveur local) : on CHERCHE le serveur
  // (adresse mémorisée, localhost:3000, 127.0.0.1:3000, ports voisins), on VÉRIFIE sa réponse (/healthz) et on ÉTABLIT la liaison.
  const f0 = window.fetch.bind(window);
  // ---- Appareil : la présentation du site dépend de la plateforme (confort d'affichage ; la vraie protection reste la clé vérifiée par le serveur) ----
  //  • téléphones et tablettes Android / iOS (iPadOS compris) : options des utilisateurs uniquement ;
  //  • ordinateurs Windows et Mac : version ordinateur (options utilisateurs + Contrôle + Admin + Connexion personnel) ;
  //  • tout autre appareil (Linux, ChromeOS, inconnu) : options des utilisateurs uniquement.
  //  • un agent de contrôle connecté ne voit QUE les options de contrôle, quel que soit l'appareil.
  const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const UA = navigator.userAgent || "";
  const IPADOS = /Macintosh/.test(UA) && (navigator.maxTouchPoints || 0) > 1;
  const IS_IOS = /iPhone|iPad|iPod/.test(UA) || IPADOS, IS_ANDROID = /Android/i.test(UA);
  const IS_WIN = /Windows NT/.test(UA) && !/Windows Phone/i.test(UA), IS_MAC = /Macintosh/.test(UA) && !IPADOS;
  const PLAT = IS_IOS || IS_ANDROID ? "mobile" : IS_WIN || IS_MAC ? "desktop" : "autre";
  const DESKTOP = PLAT === "desktop", MOBILE = !DESKTOP;
  document.documentElement.classList.add("plat-" + PLAT); if (MOBILE) document.documentElement.classList.add("is-mobile");
  const savedSrv = () => { try { return localStorage.getItem("eticket-server") || ""; } catch (e) { return ""; } };
  let ROOT = location.protocol === "file:" ? (savedSrv() || window.ET_SERVER || "http://localhost:3000") : "";
  const FILE = location.protocol === "file:";
  const NAV = h => FILE ? (h === "/" ? "index.html" : h.replace(/^\/#/, "index.html#").replace(/^\//, "")) : h;   // ouvert par double-clic : on reste sur les fichiers
  const SRV = { state: "check", ms: null, tried: [] };            // state : check | ok | ko
  let DEMO = false;
  const demoWanted = () => { try { return localStorage.getItem("eticket-offline") === "1"; } catch (e) { return false; } };
  const loadDemo = () => new Promise(res => { if (window.ETDemo) return res(); const sc = document.createElement("script"); sc.src = "js/offline-demo.js"; sc.onload = res; sc.onerror = res; document.head.appendChild(sc); });
  function demoFetch(u, o) {
    o = o || {}; let body = {}; try { body = o.body ? JSON.parse(o.body) : {}; } catch (e) {}
    const h = {}; for (const [k, v] of Object.entries(o.headers || {})) h[k.toLowerCase()] = v;
    const reply = (j, st) => Promise.resolve(new Response(JSON.stringify(j), { status: st, headers: { "Content-Type": "application/json" } }));
    try { const r = window.ETDemo.handle((o.method || "GET").toUpperCase(), u, body, h), st = (r && r.__status) || 200; if (r && r.__status) delete r.__status; return reply(r, st); }
    catch (e) { return reply({ error: e.message }, e.status || 500); }
  }
  let GATE = null;   // si le mode démonstration est demandé, les appels /api attendent la première recherche du serveur (évite d'appeler un serveur absent au rechargement)
  const route = (u, o) => DEMO ? demoFetch(u, o) : f0(ROOT + u, o);
  window.fetch = (u, o) => (typeof u === "string" && u[0] === "/") ? (GATE ? GATE.then(() => route(u, o)) : route(u, o)) : f0(u, o);
  async function probe(base, timeout) {
    const t = performance.now();
    const r = await f0((base || "") + "/healthz", { signal: AbortSignal.timeout(timeout || 2500), cache: "no-store" });
    const j = await r.json();
    if (!r.ok || !j || !j.ok || j.app !== "E-Ticket Mali") throw new Error("pas un serveur E-Ticket");
    return Math.round(performance.now() - t);
  }
  const listeners = [];
  const setSrv = (state, ms) => { const was = SRV.state; SRV.state = state; SRV.ms = ms == null ? null : ms; listeners.forEach(f => f()); if ((state === "ok" || state === "demo") && was !== state) { cfg = null; document.dispatchEvent(new CustomEvent("eticket-server-ok")); } };
  async function findServer(extra) {
    setSrv("check");
    const cands = [];
    if (extra) cands.push(String(extra).replace(/\/+$/, ""));
    cands.push(ROOT, savedSrv(), window.ET_SERVER || "", "http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:8080", "http://127.0.0.1:8080");
    for (let n = 3001; n <= 3010; n++) cands.push("http://localhost:" + n);
    let list = [...new Set(cands)];
    if (FILE) list = list.filter(x => x); else if (!list.includes("")) list.unshift("");
    SRV.tried = list.map(x => x || location.origin);
    const res = await Promise.all(list.map(b => probe(b, 1800).then(ms => ({ b, ms }), () => null)));
    const hit = res.find(Boolean) || null;
    if (!hit) { if (demoWanted() && (await startDemo())) return true; DEMO = false; setSrv("ko"); return false; }
    DEMO = false; ROOT = hit.b;
    if (ROOT) { try { localStorage.setItem("eticket-server", ROOT); } catch (e) {} }
    setSrv("ok", hit.ms); return true;
  }
  async function startDemo() { await loadDemo(); if (!window.ETDemo) return false; DEMO = true; try { localStorage.setItem("eticket-offline", "1"); } catch (e) {} setSrv("demo"); return true; }
  const stopDemo = () => { try { localStorage.removeItem("eticket-offline"); } catch (e) {} DEMO = false; return findServer(); };
  const recheck = () => (SRV.state === "ok" ? probe(ROOT, 2500).then(ms => setSrv("ok", ms), () => findServer()) : findServer());
  window.addEventListener("online", () => findServer());
  window.addEventListener("offline", () => setSrv("ko"));
  setInterval(() => { if (document.visibilityState === "visible") recheck(); }, 15000);
  if (demoWanted()) GATE = findServer().catch(() => {}).then(() => { GATE = null; });
  // Connexion du personnel : une seule fois, valable pour l'administration et le contrôle, dans tous les onglets du navigateur (8 h).
  const SK = "eticket-staff";
  const staffGet = () => { try { const x = JSON.parse(localStorage.getItem(SK) || "null"); return x && x.exp > Date.now() ? x : null; } catch (e) { return null; } };
  const staffApply = x => { try { if (x.role === "admin") sessionStorage.setItem("ak", x.key); sessionStorage.setItem("ck", x.key); } catch (e) {} };
  const staffClear = () => { try { localStorage.removeItem(SK); sessionStorage.removeItem("ak"); sessionStorage.removeItem("ck"); } catch (e) {} };
  { const x0 = staffGet(); if (x0) staffApply(x0); }
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = n => Number(n).toLocaleString("fr-FR").replace(/[  ]/g, " ") + " FCFA";
  const fdate = d => new Date(d).toLocaleString("fr-FR", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  const $ = s => document.querySelector(s);

  async function api(path, opts) {
    let r;
    try { r = await fetch(path, opts); } catch (e) { findServer(); const x = new Error("Connexion impossible : le serveur E-Ticket ne répond pas. Lancez-le (npm start ou demarrer.bat), puis réessayez."); x.net = true; throw x; }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const x = new Error(j.error || "Erreur (" + r.status + ")"); x.status = r.status; throw x; }
    return j;
  }

  let cfg = null;
  const config = () => cfg || (cfg = api("/api/config").catch(() => { cfg = null; return { operators: [], demo: false, ttlMin: 15 }; }));

  // Pages du site. `tab` : onglet interne de la page d'accueil (adresse /#tab).
  const PAGES = [
    { href: "/", tab: "accueil", label: "Accueil / Événements" },
    { href: "/#billets", tab: "billets", label: "Mes billets" },
    { href: "/#historique", tab: "historique", label: "Historique" },
    { href: "/#aide", tab: "aide", label: "Support / Aide" },
    { sep: true },
    { href: "/conditions.html", label: "Conditions de vente", staff: true },
    { href: "/confidentialite.html", label: "Confidentialité", staff: true },
    { href: "/controle.html", label: "Contrôle", staff: true, only: true },
    { href: "/admin.html", label: "Admin", staff: true, only: true }
  ];

  function activeKey() {
    const p = (FILE ? "/" + location.pathname.split("/").pop() : location.pathname).replace(/index\.html$/, "");
    if (p === "/" || p === "") return "tab:" + (location.hash.slice(1) || "accueil");
    return p;
  }
  function paintMenu() {
    const k = activeKey();
    document.querySelectorAll(".site-menu a[data-k]").forEach(a => a.classList.toggle("on", a.dataset.k === k));
  }
  function a11y() {
    const m = document.querySelector("main"); if (m && !m.id) { m.id = "contenu"; m.tabIndex = -1; }
    document.querySelectorAll(".note,#bandeau-demo").forEach(e => { if (!e.hasAttribute("aria-live")) { e.setAttribute("role", "status"); e.setAttribute("aria-live", "polite"); } });
  }
  function buildHeader() {
    if (document.querySelector(".site-header")) return;
    const role = (staffGet() || {}).role, CTL = role === "control";
    const pages = CTL ? [{ href: "/controle.html", label: "Contrôle des billets" }] : PAGES.filter(p => DESKTOP || !p.only);
    const links = pages.map(p => p.sep ? '<span class="sep"></span>'
      : `<a href="${NAV(p.href)}" data-h="${p.href}" data-k="${p.tab ? "tab:" + p.tab : p.href}" class="${p.staff ? "staff" : ""}${p.only ? " staff-only" : ""}">${esc(p.label)}</a>`).join("");
    const wrap = document.createElement("div");
    wrap.innerHTML = '<a class="skip" href="#contenu">Aller au contenu</a><div class="bandeau hidden" id="bandeau-demo">Mode démonstration – les paiements sont simulés, aucune somme n\'est débitée.</div><div class="flag"></div>' +
      '<header class="site-header"><div class="site-bar"><a class="brand" href="' + NAV(CTL ? "/controle.html" : "/") + '"><small>Ministère de la Jeunesse et des Sports · Mali</small><b>E-Ticket</b></a>' +
      '<button class="menu-toggle" aria-expanded="false" aria-controls="site-menu">Menu</button><nav class="site-menu" id="site-menu" aria-label="Navigation principale">' + links + "</nav></div></header>";
    while (wrap.lastChild) document.body.insertBefore(wrap.lastChild, document.body.firstChild);
    const sv = document.createElement("button");
    sv.id = "srv"; sv.className = "srv" + (DESKTOP && !CTL ? "" : " hidden"); sv.type = "button"; $("#site-menu").appendChild(sv);
    const paintSrv = () => { sv.dataset.s = SRV.state; sv.textContent = SRV.state === "ok" ? "● Serveur connecté" + (SRV.ms != null ? " (" + SRV.ms + " ms)" : "") : SRV.state === "demo" ? "● Mode démo hors serveur" : SRV.state === "check" ? "● Recherche du serveur…" : "● Serveur introuvable"; sv.title = "Cliquez pour vérifier la connexion"; };
    listeners.push(paintSrv); paintSrv(); sv.onclick = () => openServer();
    const sb = document.createElement("button");
    sb.id = "staff-btn"; sb.className = "staff-btn" + (CTL ? "" : " staff-only"); sb.type = "button";
    $("#site-menu").appendChild(sb);
    const paintStaff = () => { const x = staffGet(); sb.textContent = x ? "Déconnexion (" + (x.role === "admin" ? "administrateur" : "contrôle") + ")" : "Connexion personnel"; sb.classList.toggle("on", !!x); };
    paintStaff(); document.addEventListener("eticket-staff", paintStaff);
    sb.onclick = () => { if (staffGet()) { staffClear(); paintStaff(); location.reload(); } else openLogin(paintStaff); };
    const toggle = $(".menu-toggle"), menu = $("#site-menu");
    toggle.onclick = () => toggle.setAttribute("aria-expanded", menu.classList.toggle("open"));
    menu.onclick = e => { if (e.target.closest("a")) menu.classList.remove("open"); };
    paintMenu();
    window.addEventListener("hashchange", paintMenu);
    findServer();
    config().then(c => { const bd = $("#bandeau-demo"); if (bd) bd.classList.toggle("hidden", !c.demo); });
  }
  function openServer() {
    const m = document.createElement("div"); m.className = "modal open"; m.id = "srv-modal";
    m.innerHTML = '<div class="dialog"><h3>Connexion au serveur E-Ticket</h3><div id="srv-st" class="note"></div>' +
      '<label for="srv-url">Adresse du serveur (si différente)</label><input id="srv-url" placeholder="http://localhost:3000" value="' + esc(ROOT || location.origin) + '">' +
      (FILE ? '<p class="note">Cette page est ouverte directement depuis un fichier : l\'affichage et la connexion fonctionnent, mais le retour d\'un paiement exige le site servi par le serveur (adresse http://localhost:3000).</p>' : "") +
      '<details class="note" id="srv-help"><summary><b>Le serveur est introuvable : que vérifier ?</b></summary><ol style="margin:6px 0 0 18px">' +
      '<li>Le serveur est-il lancé ? Double-cliquez <b>demarrer.bat</b> (Windows) ou <b>demarrer.sh</b> (Mac/Linux), ou tapez <b>npm start</b> dans le dossier. Laissez la fenêtre noire ouverte.</li>' +
      '<li>Version de Node.js : <b>22.13 ou plus récent</b> (commande <b>node -v</b>). Sinon : https://nodejs.org</li>' +
      '<li>Le terminal affiche-t-il « E-Ticket sur http://localhost:PORT » ? Si le port n\'est pas 3000, saisissez l\'adresse ci-dessus.</li>' +
      '<li>Essayez d\'ouvrir directement <a href="http://localhost:3000/healthz" target="_blank" rel="noopener">http://localhost:3000/healthz</a> : il doit afficher <code>{"ok":true,...}</code>. Sinon, c\'est le serveur (pare-feu, antivirus, port occupé).</li>' +
      '<li>Chrome/Edge récents ou Safari peuvent bloquer un fichier local qui appelle <b>localhost</b> : ouvrez plutôt <a href="http://localhost:3000/" target="_blank" rel="noopener">http://localhost:3000/</a> (pas le fichier).</li>' +
      '<li>Sans serveur du tout : utilisez le <b>mode démonstration hors serveur</b> (bouton ci-dessous).</li></ol></details>' +
      '<div class="row" style="flex-wrap:wrap"><button class="btn sec" id="srv-x" type="button">Fermer</button><button class="btn" id="srv-go" type="button">Chercher et tester</button></div>' +
      '<div class="row"><button class="btn sec" id="srv-demo" type="button"></button></div></div>';
    document.body.appendChild(m);
    const st = m.querySelector("#srv-st"), dm = m.querySelector("#srv-demo");
    const paint = () => {
      st.innerHTML = SRV.state === "ok" ? "✔ Connecté à <b>" + esc(ROOT || location.origin) + "</b> — réponse en " + SRV.ms + " ms." : SRV.state === "demo" ? "⚠ <b>Mode démonstration hors serveur</b> : données de démonstration enregistrées dans ce navigateur, paiement simulé, aucun vrai billet." : SRV.state === "check" ? "Recherche en cours…" : "✖ Aucun serveur E-Ticket trouvé. Adresses testées : " + esc(SRV.tried.join(", ")) + ".";
      dm.textContent = SRV.state === "demo" ? "Quitter le mode démonstration" : "Utiliser le mode démonstration hors serveur"; dm.classList.toggle("hidden", SRV.state === "ok" || SRV.state === "check");
      if (SRV.state === "ko") m.querySelector("#srv-help").open = true;
    };
    listeners.push(paint); paint();
    m.querySelector("#srv-go").onclick = () => findServer(m.querySelector("#srv-url").value.trim() || undefined);
    dm.onclick = () => { if (SRV.state === "demo") stopDemo(); else startDemo(); };
    m.querySelector("#srv-x").onclick = () => { listeners.splice(listeners.indexOf(paint), 1); m.remove(); };
    m.onclick = e => { if (e.target === m) m.querySelector("#srv-x").click(); };
  }
  function openLogin(done) {
    const m = document.createElement("div"); m.className = "modal open"; m.id = "staff-modal";
    m.innerHTML = '<div class="dialog"><h3>Connexion du personnel</h3><p class="meta">Une seule connexion pour l\'administration et le contrôle des billets. La clé administrateur ouvre les deux ; la clé de contrôle ouvre le contrôle.</p>' +
      '<label for="staff-key">Clé</label><input id="staff-key" type="password" autocomplete="off" autofocus><p class="note">Les clés sont dans le fichier <b>cles-acces.txt</b> (dossier du site).</p><p class="note" id="staff-err" style="color:var(--rouge)"></p>' +
      '<div class="row"><button class="btn sec" id="staff-x" type="button">Annuler</button><button class="btn" id="staff-ok" type="button">Se connecter</button></div></div>';
    document.body.appendChild(m);
    const close = () => m.remove(), key = m.querySelector("#staff-key"), err = m.querySelector("#staff-err");
    const go = async () => {
      err.textContent = "";
      try {
        if (SRV.state !== "ok" && SRV.state !== "demo" && !(await findServer())) { err.innerHTML = "Aucun serveur E-Ticket trouvé (testé : " + esc(SRV.tried.join(", ")) + "). Lancez-le avec <b>npm start</b> (ou <b>demarrer.bat</b>), puis cliquez sur « ● Serveur introuvable » dans le menu pour chercher à nouveau.<br><button class=\"btn sec\" id=\"staff-demo\" type=\"button\" style=\"margin-top:6px\">Utiliser le mode démonstration hors serveur</button>"; const b = m.querySelector("#staff-demo"); if (b) b.onclick = async () => { if (await startDemo()) go(); }; return; }
        const r = await api("/api/staff/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: key.value.trim() }) });
        const x = { role: r.role, key: key.value.trim(), exp: Date.now() + 8 * 3600 * 1000 };
        try { localStorage.setItem(SK, JSON.stringify(x)); } catch (e) {}
        staffApply(x); close(); done(); document.dispatchEvent(new CustomEvent("eticket-staff", { detail: x }));
        const k = activeKey();
        if (x.role === "control" && k !== "/controle.html") location.replace(NAV("/controle.html"));   // l'agent de contrôle ne voit que le contrôle
        else if (k === "/admin.html" || k === "/controle.html") location.reload();
      } catch (e) { err.textContent = e.message; }
    };
    m.querySelector("#staff-ok").onclick = go; m.querySelector("#staff-x").onclick = close;
    key.addEventListener("keydown", e => { if (e.key === "Enter") go(); if (e.key === "Escape") close(); });
    m.onclick = e => { if (e.target === m) close(); };
    setTimeout(() => key.focus(), 30);
  }
  function buildFooter() {
    if (document.querySelector(".site-footer")) return;
    const f = document.createElement("footer");
    f.className = "site-footer";
    f.innerHTML = 'Ministère de la Jeunesse et des Sports du Mali – Module E-Ticket · <a href="' + NAV("/conditions.html") + '">Conditions de vente</a> · <a href="' + NAV("/confidentialite.html") + '">Confidentialité</a>';
    document.body.appendChild(f);
  }
  // ---- Journal d'activité (suivi côté serveur) et synchronisation en temps réel ----
  const SID = (() => { try { let x = sessionStorage.getItem("eticket-sid"); if (!x) { x = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); sessionStorage.setItem("eticket-sid", x); } return x; } catch (e) { return ""; } })();
  const track = (action, target, detail) => { try { window.fetch("/api/track", { method: "POST", headers: { "Content-Type": "application/json", "x-session": SID }, body: JSON.stringify({ action, target: target || "", detail: detail || "" }), keepalive: true }).catch(() => {}); } catch (e) {} };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // live(handler, {staff:true}) : le serveur pousse chaque changement (flux « text/event-stream » lu par fetch, pour pouvoir envoyer la clé en en-tête).
  // Sans serveur (mode démo), les onglets du même navigateur se synchronisent par BroadcastChannel. À chaque (re)connexion, le gestionnaire reçoit {type:"hello"} : il se remet à jour.
  function live(handler, opts) {
    opts = opts || {}; let stop = false, ctl = null, retry = 1000;
    const call = m => { if (m && (opts.staff || !m.scope || m.scope === "public")) { try { handler(m); } catch (e) {} } };
    const mark = on => { const el = document.querySelector("#srv"); if (el) el.dataset.live = on ? "on" : "off"; };
    let bc = null; try { bc = new BroadcastChannel("eticket-live"); bc.onmessage = e => { if (DEMO) call(e.data); }; } catch (e) {}
    document.addEventListener("eticket-server-ok", () => { if (DEMO) { mark(true); call({ type: "hello" }); } });
    (async () => {
      while (!stop) {
        if (SRV.state === "demo") { mark(true); await sleep(1000); continue; }
        if (SRV.state !== "ok") { mark(false); await sleep(1200); continue; }
        ctl = new AbortController();
        try {
          const key = opts.staff ? ((staffGet() || {}).key || "") : "";
          const r = await f0(ROOT + (opts.staff ? "/api/admin/stream" : "/api/stream"), { headers: opts.staff ? { "x-api-key": key } : {}, signal: ctl.signal, cache: "no-store" });
          if (!r.ok) throw new Error("flux " + r.status);
          retry = 1000; mark(true);
          const rd = r.body.getReader(), dec = new TextDecoder(); let buf = "";
          for (;;) {
            const { done, value } = await rd.read(); if (done) break;
            buf += dec.decode(value, { stream: true }); let i;
            while ((i = buf.indexOf("\n\n")) >= 0) { const blk = buf.slice(0, i); buf = buf.slice(i + 2); const d = blk.split("\n").find(l => l.startsWith("data: ")); if (d) { try { call(JSON.parse(d.slice(6))); } catch (e) {} } }
          }
        } catch (e) {}
        mark(false); if (!stop) await sleep(retry = Math.min(retry * 1.6, 15000));
      }
    })();
    return () => { stop = true; try { ctl && ctl.abort(); } catch (e) {} try { bc && bc.close(); } catch (e) {} };
  }

  // ---- Carrousel d'images (défilement automatique, pause au survol/focus/onglet masqué, points, flèches clavier) ----
  const REDUCED = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const imgsOf = id => { const s = ((typeof CONFIG !== "undefined" && CONFIG.sports) || []).find(x => x.id === id); return (s && s.images && s.images.length ? s.images : (window.SPORT_IMAGES || {})[id]) || []; };
  let CAR_OFF = REDUCED;   // WCAG 2.2.2 : l'utilisateur peut arrêter le défilement (bouton) ; arrêté d'office si « réduire les animations »
  const carouselToggle = () => (CAR_OFF = !CAR_OFF);
  const carouselOff = () => CAR_OFF;
  const carouselHTML = (id, alt) => { const im = imgsOf(id); if (!im.length) return ""; return `<div class="car" data-sport="${esc(id)}" aria-hidden="true">` + im.map((u, i) => `<img class="car-img${i ? "" : " on"}" src="${esc(u)}" alt="" ${i ? 'loading="lazy"' : ""} draggable="false">`).join("") + (im.length > 1 ? `<span class="car-dots" aria-hidden="true">${im.map((_, i) => `<i class="${i ? "" : "on"}"></i>`).join("")}</span>` : "") + `</div>`; };
  const carouselInit = (root, every = 4000) => {
    const timers = [];
    root.querySelectorAll(".car").forEach((car, k) => {
      const imgs = [...car.querySelectorAll(".car-img")], dots = [...car.querySelectorAll(".car-dots i")];
      if (imgs.length < 2) return;
      let i = 0, paused = false;
      const show = n => { i = (n + imgs.length) % imgs.length; imgs.forEach((m, j) => m.classList.toggle("on", j === i)); dots.forEach((d, j) => d.classList.toggle("on", j === i)); };
      car._show = show;
      const host = car.closest(".affiche, .sport-card") || car;
      host.addEventListener("mouseenter", () => paused = true); host.addEventListener("mouseleave", () => paused = false);
      host.addEventListener("focusin", () => paused = true); host.addEventListener("focusout", () => paused = false);
      if (REDUCED) return;
      setTimeout(() => timers.push(setInterval(() => { if (!paused && !CAR_OFF && !document.hidden && car.isConnected) show(i + 1); }, every)), (k % 5) * 450);   // départs décalés : les affiches ne changent pas toutes en même temps
    });
    return () => timers.forEach(clearInterval);
  };
  window.ET = { carousel: { toggle: carouselToggle, off: carouselOff, html: carouselHTML, init: carouselInit, images: imgsOf }, esc, fmt, fdate, $, api, config, track, live, mobile: MOBILE, platform: PLAT, sid: SID, server: { find: findServer, demo: startDemo, state: () => SRV.state, url: () => ROOT || location.origin }, staff: { get: staffGet, clear: staffClear, set: (role, key) => { const x = { role, key, exp: Date.now() + 8 * 3600 * 1000 }; try { localStorage.setItem(SK, JSON.stringify(x)); } catch (e) {} staffApply(x); document.dispatchEvent(new CustomEvent("eticket-staff", { detail: x })); } } };
  document.addEventListener("DOMContentLoaded", () => {
    const x = staffGet(), onCtl = /\/controle\.html$/.test(location.pathname), onAdmin = /\/admin\.html$/.test(location.pathname);
    if (x && x.role === "control" && !onCtl) { location.replace(NAV("/controle.html")); return; }   // l'agent de contrôle ne voit que le contrôle
    buildHeader(); a11y();
    if (MOBILE && onAdmin) {   // l'administration n'existe que sur ordinateur Windows / Mac
      [...document.body.children].forEach(x => { if (!x.matches(".bandeau,.flag,.site-header,script,dialog,#srv-modal")) x.style.display = "none"; });
      const d = document.createElement("div"); d.id = "mobile-block";
      d.innerHTML = '<div class="card" style="max-width:520px;margin:30px auto"><h2>Espace réservé aux ordinateurs</h2><p class="meta">L\'administration est disponible uniquement sur un ordinateur Windows ou Mac. Les agents de contrôle utilisent la page « Contrôle ». Pour réserver des billets, retournez à l\'accueil.</p><p style="margin-top:12px"><a class="btn" href="' + NAV("/") + '">Retour aux événements</a></p></div>';
      document.body.appendChild(d);
    }
    if (!document.body.hasAttribute("data-no-footer")) buildFooter(); });
})();
