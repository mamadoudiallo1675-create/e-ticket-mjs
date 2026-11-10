/* E-Ticket Mali – MODE DÉMONSTRATION HORS SERVEUR.
   Quand aucun serveur E-Ticket n'est joignable, l'utilisateur peut choisir ce mode : l'API est alors simulée DANS LE NAVIGATEUR
   (données de démonstration enregistrées dans ce navigateur uniquement, paiement simulé, aucun vrai billet, aucun SMS).
   Il sert à visiter et montrer le site ; il ne remplace jamais le serveur. Installe window.ETDemo.handle(method, path, body, headers). */
(function () {
  "use strict";
  const K = "eticket-demo-db", KEYS = { admin: "admin-eticket-2026", control: "controle-eticket-2026" };
  const SPORTS = [["football","Football"],["basketball","Basketball"],["athletisme","Athlétisme"],["arts-martiaux","Arts martiaux"],["cyclisme","Cyclisme"],["natation","Natation"],["courses-chevaux","Courses de chevaux"],["lutte","Lutte traditionnelle"],["sokone","Sokone"],["jeux-traditionnels","Jeux traditionnels"],["tir-arc","Tir à l’arc"],["sports-nautiques","Sports nautiques"],["culture","Culture & jeunesse"]].map(x => ({ id: x[0], nom: x[1] }));
  const SPID = { Football: "football", Basketball: "basketball", "Athlétisme": "athletisme" };
  const T = (id, nom, prix, stock) => ({ id, nom, prix, stock });
  const seed = () => ({
    seq: 100, activity: [], orders: [], tickets: [], support: [], audit: [],
    events: [
      { id: 1, sport: "football", type: "Football", titre: "Aigles du Mali", adv: "Match de démonstration", date: "2027-03-20T17:00", lieu: "Stade du 26 Mars, Bamako", heure_confirmee: 1, tribunes: [T(1, "Pelouse populaire", 1000, 1800), T(2, "Tribune couverte", 3000, 600), T(3, "Tribune VIP", 10000, 100)] },
      { id: 2, sport: "basketball", type: "Basketball", titre: "Championnat national", adv: "Journée de basketball", date: "2027-02-06T18:00", lieu: "Palais des Sports, Bamako", heure_confirmee: 1, tribunes: [T(4, "Gradins", 1000, 700), T(5, "Tribune centrale", 3000, 150)] },
      { id: 3, sport: "athletisme", type: "Athlétisme", titre: "Meeting national", adv: "Athlétisme", date: "2027-04-10T16:00", lieu: "Stade Modibo Keïta, Bamako", heure_confirmee: 1, tribunes: [T(6, "Tribune", 1000, 900)] },
      { id: 4, sport: "football", type: "Football", titre: "Mali – Rwanda", adv: "Éliminatoires (démo)", date: "2027-03-27T19:00", lieu: "Stade du 26 Mars, Bamako", heure_confirmee: 0, tribunes: [] }
    ]
  });
  let db; try { db = JSON.parse(localStorage.getItem(K) || "null"); } catch (e) {} if (!db) db = seed(); if (!db.activity) db.activity = []; db.events.forEach(e => { if (!e.sport) e.sport = SPID[e.type] || ""; });
  let bc = null; try { bc = new BroadcastChannel("eticket-live"); } catch (e) {}
  const notify = m => { try { bc && bc.postMessage(m); } catch (e) {} };
  const act = (roleName, action, target, detail, actor) => { const row = { id: Date.now() + Math.random(), at: Date.now(), actor: actor || "visiteur", role: roleName, action, target: String(target || ""), detail: detail || "", session: "", device: /Mobi|Android|iPhone/i.test(navigator.userAgent) ? "mobile" : "ordinateur" }; db.activity.unshift(row); if (db.activity.length > 1000) db.activity.length = 1000; notify({ type: "activity", row, scope: "staff" }); };
  const sync = (what, pubToo) => { notify({ type: "sync", what, scope: "staff" }); if (pubToo) notify({ type: "events", scope: "public" }); };
  const save = () => { try { localStorage.setItem(K, JSON.stringify(db)); } catch (e) {} };
  const E = (s, st) => { const x = new Error(s); x.status = st; throw x; };
  const rnd = n => Array.from({ length: n }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");
  const role = h => { const k = (h || {})["x-api-key"] || ""; return k === KEYS.admin ? "admin" : k === KEYS.control ? "control" : null; };
  const needAdmin = h => { if (role(h) !== "admin") E("Clé invalide.", 401); };
  const needCtl = h => { if (!role(h)) E("Clé invalide.", 401); };
  const tribOf = id => { for (const e of db.events) for (const t of e.tribunes) if (t.id === id) return { e, t }; return {}; };
  const mask = p => String(p).slice(0, 2) + " •• •• " + String(p).slice(-2);
  function view(o) {
    const { e, t } = tribOf(o.tribuneId);
    return { ref: o.ref, status: o.status, qty: o.qty, total: o.total, operator: o.operator, phone: mask(o.phone), createdAt: o.createdAt, expiresAt: o.createdAt + 900000,
      event: { id: e.id, titre: e.titre, adv: e.adv, date: e.date, lieu: e.lieu, heureConfirmee: !!e.heure_confirmee }, tribune: t.nom,
      tickets: db.tickets.filter(x => x.ref === o.ref).map(x => ({ code: x.code, status: x.used ? "USED" : "ACTIVE" })) };
  }
  const pub = e => ({ ...e, tribunes: e.tribunes.map(t => ({ ...t, event_id: e.id })) });
  const log = (action, target, detail) => { db.audit.unshift({ at: Date.now(), actor: "clé démo", action, target: String(target), detail: detail || "" }); };
  const normPhone = p => { const d = String(p || "").replace(/\D/g, "").slice(-8); if (d.length !== 8) E("Numéro de téléphone invalide.", 400); return d; };

  function handle(method, path, body, headers) {
    const [p, qs] = path.split("?"), q = new URLSearchParams(qs || ""); body = body || {}; let m;
    if (method === "GET" && p === "/healthz") return { ok: true, app: "E-Ticket Mali", demo: true };
    if (method === "GET" && p === "/api/config") return { sports: SPORTS, operators: [{ id: "orange", nom: "Orange Money — démo", court: "Orange Money", mode: "mock", enabled: true }, { id: "cinetpay", nom: "Mobile Money (Orange, Moov, Wave, Sama Money) via CinetPay — démo", court: "CinetPay", mode: "mock", enabled: false }, { id: "moov", nom: "Moov Money", court: "Moov", mode: "disabled", enabled: false }], ttlMin: 15, demo: true, recovery: false, legalValidated: false };
    if (method === "GET" && p === "/api/events") return db.events.map(pub).sort((a, b) => a.date.localeCompare(b.date));
    if (method === "POST" && p === "/api/cart/quote") {
      const { e, t } = tribOf(+body.tribuneId); if (!t || e.id !== +body.eventId) E("Tribune introuvable.", 404);
      const qty = Math.max(1, Math.min(6, +body.qty || 1));
      return { amount: t.prix * qty, unit: t.prix, qty, currency: "XOF", available: t.stock >= qty, payable: t.prix * qty % 5 === 0, ttlMin: 15, titre: e.titre, tribune: t.nom };
    }
    if (method === "POST" && p === "/api/orders") {
      const { e, t } = tribOf(+body.tribuneId); const qty = Math.max(1, Math.min(6, +body.qty || 1));
      if (!t || e.id !== +body.eventId) E("Tribune introuvable.", 404);
      if (!["orange"].includes(body.operator)) E("Cet opérateur n'est pas disponible pour le moment.", 400);
      const phone = normPhone(body.phone); if (t.stock < qty) E("Il ne reste plus assez de places dans cette tribune.", 409);
      t.stock -= qty; const ref = "CMD-" + rnd(8), token = rnd(24);
      db.orders.push({ ref, token, tribuneId: t.id, eventId: e.id, qty, total: t.prix * qty, operator: body.operator, phone, status: "PAID", createdAt: Date.now() });
      for (let i = 0; i < qty; i++) db.tickets.push({ ref, eventId: e.id, code: `ML-${rnd(4)}-${rnd(4)}-${rnd(4)}`, used: false, usedAt: null });
      act("public", "order.create", ref, `${qty} billet(s) · ${t.prix * qty} FCFA · ${body.operator}`); act("public", "order.paid", ref, `${qty} billet(s) · ${t.prix * qty} FCFA`, "système"); sync("orders", true);
      save();
      const base = location.href.split("#")[0].split("?")[0];
      return { ref, token, payUrl: base + "?order=" + ref, expiresAt: Date.now() + 900000, __status: 201 };
    }
    if (method === "GET" && (m = p.match(/^\/api\/orders\/(CMD-[A-Z0-9]{8})$/))) {
      const o = db.orders.find(x => x.ref === m[1]); if (!o || o.token !== q.get("token")) E("Commande introuvable.", 404); return view(o);
    }
    if (method === "GET" && p === "/api/my/orders") return [];
    if (p === "/api/recover/request" || p === "/api/recover/verify") E("Récupération par SMS indisponible en mode démonstration hors serveur.", 400);
    if (method === "POST" && p === "/api/support") { if (!String(body.message || "").trim()) E("Message vide.", 400); db.support.unshift({ created_at: Date.now(), phone: body.phone || "", message: String(body.message).slice(0, 1000) }); act("public", "support.send", "", "message au support"); sync("support"); save(); return { ok: true }; }
    if (method === "POST" && p === "/api/staff/login") { const r = role({ "x-api-key": body.key }); if (!r) { act("public", "staff.login_failed", "", "clé incorrecte", "inconnu"); save(); E("Clé incorrecte.", 401); } act(r, "staff.login", "", "connexion " + (r === "admin" ? "administrateur" : "contrôle"), "clé démo"); save(); return { role: r }; }
    if (method === "POST" && p === "/api/track") { if (body.action) { act("public", String(body.action).slice(0, 30), String(body.target || "").slice(0, 80), String(body.detail || "").slice(0, 200)); save(); } return { ok: true }; }
    if (p === "/api/admin/staff" || /^\/api\/admin\/staff\/\d+\/revoke$/.test(p)) {        // personnel simulé (démonstration)
      needAdmin(headers); db.staff = db.staff || [{ id: 1, nom: "Administration", role: "admin", poste: "", source: "env", actif: 1, cree_le: Date.now(), revoque_le: null, derniere_connexion: Date.now(), nb_connexions: 1 }, { id: 2, nom: "Contrôle", role: "control", poste: "", source: "env", actif: 1, cree_le: Date.now(), revoque_le: null, derniere_connexion: null, nb_connexions: 0 }];
      if (method === "GET") return { staff: db.staff, log: [] };
      if (/revoke$/.test(p)) { const x = db.staff.find(z => z.id === +p.split("/")[4]); if (x) { x.actif = 0; x.revoque_le = Date.now(); } save(); return { ok: true }; }
      const id = db.staff.length + 1; db.staff.push({ id, nom: body.nom, role: body.role, poste: body.poste || "", source: "admin", actif: 1, cree_le: Date.now(), revoque_le: null, derniere_connexion: null, nb_connexions: 0 }); save(); return { __status: 201, id, key: "DEMO-" + Math.random().toString(36).slice(2, 12).toUpperCase() };
    }
    if (method === "GET" && p === "/api/admin/databases") { needAdmin(headers); return [{ domaine: "Mode démonstration hors serveur", type: "Simulation dans le navigateur", moteur: "localStorage", fichier: "eticket-demo-db", octets: JSON.stringify(db).length, contenu: [{ nom: "événements", lignes: db.events.length }, { nom: "commandes", lignes: db.orders.length }], pourquoi: "Les vraies bases (3 relationnelles SQLite + 2 en documents) n'existent que lorsque le serveur E-Ticket tourne." }]; }
    if (method === "GET" && p === "/api/admin/activity") { needAdmin(headers); const rows = db.activity.filter(a => !q.get("role") || a.role === q.get("role")).slice(0, +q.get("limit") || 200); const g = {}; db.activity.forEach(a => { g[a.role] = g[a.role] || { role: a.role, n: 0, sessions: 1 }; g[a.role].n++; }); return { rows, last24h: Object.values(g) }; }
    // ----- administration / contrôle -----
    if (method === "POST" && p === "/api/admin/validate") {
      needCtl(headers); const t = db.tickets.find(x => x.code === body.code); if (!t) return { result: "invalid" };
      if (body.eventId && t.eventId !== +body.eventId) return { result: "wrong_event" };
      if (t.used) return { result: "already_used", usedAt: t.usedAt };
      if (body.consume !== false) { t.used = true; t.usedAt = Date.now(); act("control", "ticket.scan", t.code.slice(0, 20), "valid", "contrôle"); sync("tickets"); save(); } return { result: "valid" };
    }
    if (method === "GET" && p === "/api/admin/stats") {
      needAdmin(headers); const g = {}; db.orders.forEach(o => { const s = g[o.status] || (g[o.status] = { status: o.status, commandes: 0, billets: 0, montant: 0 }); s.commandes++; s.billets += o.qty; s.montant += o.total; }); return Object.values(g);
    }
    if (method === "GET" && p === "/api/admin/events") {
      needAdmin(headers);
      return db.events.map(e => { const os = db.orders.filter(o => o.eventId === e.id); return { ...pub(e), vendus: os.reduce((a, o) => a + o.qty, 0), recette: os.reduce((a, o) => a + o.total, 0), entres: db.tickets.filter(t => t.eventId === e.id && t.used).length,
        tribunes: e.tribunes.map(t => { const ot = os.filter(o => o.tribuneId === t.id); return { ...t, event_id: e.id, vendus: ot.reduce((a, o) => a + o.qty, 0), recette: ot.reduce((a, o) => a + o.total, 0), en_attente: 0 }; }) }; });
    }
    if (method === "GET" && p === "/api/admin/refunds") { needAdmin(headers); return []; }
    if (method === "GET" && p === "/api/admin/support") { needAdmin(headers); return db.support; }
    if (method === "GET" && p === "/api/admin/audit") { needAdmin(headers); return db.audit; }
    if (method === "POST" && p === "/api/admin/events") {
      needAdmin(headers); if (!body.titre || !body.lieu || !body.date || !(body.type || body.sport)) E("Sport, titre, lieu et date sont obligatoires.", 400);
      if (body.sport && !SPORTS.some(x => x.id === body.sport)) E("Sport inconnu.", 400);
      const id = ++db.seq; db.events.push({ id, sport: body.sport || SPID[body.type] || "", type: body.type || (SPORTS.find(x => x.id === body.sport) || {}).nom, titre: body.titre, adv: body.adv || "", date: body.date, lieu: body.lieu, heure_confirmee: body.heureConfirmee ? 1 : 0,
        tribunes: (body.tribunes || []).map(t => ({ id: ++db.seq, nom: t.nom, prix: +t.prix, stock: +t.stock })) }); log("event.create", id, body.titre); act("admin", "event.create", body.titre, "", "clé démo"); sync("events", true); save(); return { id };
    }
    if (method === "POST" && (m = p.match(/^\/api\/admin\/events\/(\d+)$/))) { needAdmin(headers); const e = db.events.find(x => x.id === +m[1]); if (!e) E("Introuvable.", 404); if (body.sport !== undefined) { if (body.sport && !SPORTS.some(x => x.id === body.sport)) E("Sport inconnu.", 400); e.sport = body.sport; e.type = (SPORTS.find(x => x.id === body.sport) || {}).nom || e.type; }
      Object.assign(e, { date: body.date || e.date, lieu: body.lieu || e.lieu, heure_confirmee: body.heureConfirmee ? 1 : 0 }); log("event.update", e.id); act("admin", "event.update", e.titre, "", "clé démo"); sync("events", true); save(); return { ok: true }; }
    if (method === "POST" && (m = p.match(/^\/api\/admin\/events\/(\d+)\/tribunes$/))) { needAdmin(headers); const e = db.events.find(x => x.id === +m[1]); if (!e) E("Introuvable.", 404); (body.tribunes || []).forEach(t => { if (!t.nom || !(+t.prix > 0)) E("Nom et prix requis.", 400); e.tribunes.push({ id: ++db.seq, nom: t.nom, prix: +t.prix, stock: +t.stock || 0 }); }); log("tribune.add", e.id); save(); return { ok: true }; }
    if (method === "POST" && (m = p.match(/^\/api\/admin\/tribunes\/(\d+)$/))) { needAdmin(headers); const { t } = tribOf(+m[1]); if (!t) E("Introuvable.", 404); t.prix = +body.prix; t.stock = +body.stock; log("tribune.update", t.id); act("admin", "tribune.update", t.nom, `prix ${t.prix} · places ${t.stock}`, "clé démo"); sync("events", true); save(); return { ok: true }; }
    E("Fonction indisponible en mode démonstration hors serveur.", 404);
  }
  window.ETDemo = { handle, reset: () => { db = seed(); save(); } };
})();
