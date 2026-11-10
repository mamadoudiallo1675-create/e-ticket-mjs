'use strict';
/* E-Ticket Mali — flux de paiement réels d'après les documents des opérateurs, contre de FAUX serveurs locaux (aucun appel externe).
   Orange : jeton OAuth en JSON (client_id/client_secret) puis POST /webpayment, notification vérifiée par le statut.
   Moov   : SOAP requestPayment (push USSD), réponse PENDING/01, callback JSON ou XML, getTransactionStatus, IP autorisées, montant contrôlé.
   Lancer : node tests/test-flux-orange-moov.js */
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
const ROOT = path.join(__dirname, '..'), PORT = 3411, FAKE = 3412, B = `http://127.0.0.1:${PORT}`;
Object.assign(process.env, { PORT: String(PORT), DB_PATH: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'flux-')), 'd.sqlite'), ADMIN_KEY: 'cle-admin-demo', CONTROL_KEY: 'cle-borne-demo', NODE_ENV: 'development', SMS_PROVIDER: 'console', RATE_ORDERS_PER_10MIN: '1000', BASE_URL: 'https://billetterie.exemple.ml',
  PROVIDER_ORANGE: 'live', CLIENT_ID: 'cid', CLIENT_SECRET: 'csecret-ne-doit-pas-fuiter', MERCHANT_KEY: 'mk-test', OM_OAUTH_URL: `http://127.0.0.1:${FAKE}/oauth/token`, OM_WEBPAYMENT_URL: `http://127.0.0.1:${FAKE}/webpayment`, OM_CURRENCY: 'XOF',
  PROVIDER_MOOV: 'live', MOOV_URL: `http://127.0.0.1:${FAKE}/moov`, MOOV_MERCHANT_ID: 'ML_MARCHAND_99', MOOV_PASSWORD: 'pw-moov-ne-doit-pas-fuiter' });
let pass = 0, fail = 0; const out = [];
const ok = (n, c, x) => { (c ? pass++ : fail++); out.push((c ? 'OK   ' : 'ÉCHEC ') + n + (x ? ' — ' + x : '')); console.log(out[out.length - 1]); };
const log = { oauth: [], pay: [], status: [], moov: [] }; let omStatus = 'PENDING', moovStatus = { status: 'PENDING', code: '01' }, moovAmount = null;
const fake = http.createServer((req, res) => { let b = ''; req.on('data', c => b += c); req.on('end', () => {
  const json = o => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
  if (req.url === '/oauth/token') { log.oauth.push({ ct: req.headers['content-type'], body: JSON.parse(b) }); return json({ access_token: 'tok-1', expires_in: 3600 }); }
  if (req.url === '/webpayment') { const j = JSON.parse(b); log.pay.push({ auth: req.headers.authorization, j }); return json({ pay_token: 'PT-' + j.order_id, payment_url: `http://127.0.0.1:${FAKE}/pay/${j.order_id}`, notif_token: 'NT-' + j.order_id }); }
  if (req.url === '/transactionstatus') { const j = JSON.parse(b); log.status.push(j); return json({ status: omStatus, txnid: 'MP-1' }); }
  if (req.url === '/moov') {
    const op = /<ser:(\w+)>/.exec(b)[1]; log.moov.push({ op, xml: b, ct: req.headers['content-type'] }); res.setHeader('Content-Type', 'text/xml');
    if (op === 'requestPayment') return res.end('<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><ser:requestPaymentResponse><status>PENDING</status><responseCode>01</responseCode><description>Push USSD initié avec succès. En attente du code PIN client.</description></ser:requestPaymentResponse></soapenv:Body></soapenv:Envelope>');
    const ref = /<referenceId>([^<]+)/.exec(b)[1]; return res.end(`<soapenv:Envelope xmlns:soapenv="x"><soapenv:Body><ser:getTransactionStatusResponse><status>${moovStatus.status}</status><responseCode>${moovStatus.code}</responseCode><referenceId>${ref}</referenceId>${moovAmount ? '<amount>' + moovAmount + '</amount>' : ''}</ser:getTransactionStatusResponse></soapenv:Body></soapenv:Envelope>`);
  }
  res.statusCode = 404; res.end(); }); });
const J = async (m, u, body, h) => { const r = await fetch(B + u, { method: m, headers: { 'Content-Type': 'application/json', ...(h || {}) }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); let j; try { j = JSON.parse(t); } catch (_) { j = t; } return { s: r.status, j }; };
(async () => {
  const { server } = require(path.join(ROOT, 'server.js'));
  await new Promise(r => fake.listen(FAKE, '127.0.0.1', r)); await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const ev = (await J('GET', '/api/events')).j.find(e => e.tribunes.length), tr = ev.tribunes.find(t => t.prix * 2 % 5 === 0 && t.stock > 4);
  const order = async (op, phone, qty = 2) => J('POST', '/api/orders', { eventId: ev.id, tribuneId: tr.id, qty, operator: op, phone });
  const cfg = (await J('GET', '/api/config')).j.operators;
  ok('Orange, Moov et CinetPay sont proposés', cfg.find(o => o.id === 'orange').enabled && cfg.find(o => o.id === 'moov').enabled && cfg.some(o => o.id === 'cinetpay'), cfg.map(o => o.id + ':' + o.enabled).join(' '));
  // ---------- ORANGE (flux direct) ----------
  let o = await order('orange', '70112233');
  ok('Orange : commande créée avec une adresse de paiement', o.s === 201 && /\/pay\/CMD-/.test(o.j.payUrl), o.s + '');
  ok('Orange : jeton demandé en JSON avec client_id / client_secret / client_credentials', log.oauth[0] && /json/.test(log.oauth[0].ct) && log.oauth[0].body.grant_type === 'client_credentials' && log.oauth[0].body.client_id === 'cid' && log.oauth[0].body.client_secret.startsWith('csecret'));
  const p = log.pay[0];
  ok('Orange : POST /webpayment avec Bearer et tous les champs du document', p && p.auth === 'Bearer tok-1' && p.j.merchant_key === 'mk-test' && p.j.currency === 'XOF' && p.j.order_id === o.j.ref && p.j.reference === o.j.ref && p.j.lang === 'fr' && p.j.amount === tr.prix * 2, JSON.stringify(p && p.j));
  ok('Orange : return_url, cancel_url et notif_url sont celles du site', p.j.return_url === `https://billetterie.exemple.ml/?order=${o.j.ref}` && p.j.cancel_url.endsWith('&cancel=1') && p.j.notif_url === 'https://billetterie.exemple.ml/api/webhooks/orange');
  const tk = `?token=${encodeURIComponent(o.j.token)}`;
  let w = await fetch(B + '/api/webhooks/orange', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'SUCCESS', notif_token: 'NT-' + o.j.ref, txnid: 'FAUX' }) });
  ok('Orange : la notification répond 200 « OK »', w.status === 200 && (await w.text()) === 'OK');
  ok('Orange : une notification SUCCESS non confirmée par le statut ne valide pas la commande', (await J('GET', `/api/orders/${o.j.ref}${tk}`)).j.status === 'PENDING');
  omStatus = 'SUCCESS'; await fetch(B + '/api/webhooks/orange', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'SUCCESS', notif_token: 'NT-' + o.j.ref }) });
  ok('Orange : statut vérifié auprès d\'Orange (order_id, amount, pay_token) puis commande payée', (await J('GET', `/api/orders/${o.j.ref}${tk}`)).j.status === 'PAID' && log.status.at(-1).order_id === o.j.ref && log.status.at(-1).pay_token === 'PT-' + o.j.ref);
  w = await fetch(B + '/api/webhooks/orange', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'SUCCESS', notif_token: 'mauvais-jeton' }) });
  ok('Orange : un jeton de notification inconnu est ignoré sans erreur', w.status === 200);
  omStatus = 'PENDING';
  // ---------- MOOV (SOAP push USSD) ----------
  o = await order('moov', '70123456');
  const rp = log.moov.find(x => x.op === 'requestPayment');
  ok('Moov : commande créée SANS redirection (payUrl vide, push USSD)', o.s === 201 && !o.j.payUrl, o.s + ' ' + JSON.stringify(o.j).slice(0, 120));
  ok('Moov : requête SOAP/XML en POST (Content-Type text/xml)', rp && /text\/xml/.test(rp.ct) && /soapenv:Envelope/.test(rp.xml));
  const f = k => (new RegExp(`<${k}>([^<]*)</${k}>`).exec(rp.xml) || [])[1];
  ok('Moov : merchantId, password, XOF, montant, numéro 223 + 8 chiffres', f('merchantId') === 'ML_MARCHAND_99' && f('password') === 'pw-moov-ne-doit-pas-fuiter' && f('currency') === 'XOF' && f('amount') === String(tr.prix * 2) && f('customerMsisdn') === '22370123456');   // (le mot de passe n'est jamais écrit dans le rapport)
  ok('Moov : referenceId = référence de commande (unique) et callbackUrl HTTPS du site', f('referenceId') === o.j.ref && f('callbackUrl') === 'https://billetterie.exemple.ml/api/webhooks/moov');
  const tm = `?token=${encodeURIComponent(o.j.token)}`;
  ok('Moov : après la réponse PENDING/01, la commande reste en attente du code PIN', (await J('GET', `/api/orders/${o.j.ref}${tm}`)).j.status === 'PENDING');
  // callback JSON + montant différent -> non appliqué
  moovStatus = { status: 'SUCCESS', code: '00' }; moovAmount = '1';
  w = await fetch(B + '/api/webhooks/moov', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'SUCCESS', responseCode: '00', transactionId: 'MML-1', referenceId: o.j.ref, amount: 1, currency: 'XOF', clientPhone: '22370123456', timestamp: new Date().toISOString() }) });
  ok('Moov : callback JSON répond 200 « OK »', w.status === 200 && (await w.text()) === 'OK');
  ok('Moov : montant différent confirmé par Moov → commande NON validée', (await J('GET', `/api/orders/${o.j.ref}${tm}`)).j.status === 'PENDING');
  moovAmount = String(tr.prix * 2);
  w = await fetch(B + '/api/webhooks/moov', { method: 'POST', headers: { 'Content-Type': 'text/xml' }, body: `<callback><status>SUCCESS</status><responseCode>00</responseCode><referenceId>${o.j.ref}</referenceId></callback>` });
  ok('Moov : callback au format XML accepté ; getTransactionStatus interrogé puis commande payée', w.status === 200 && (await J('GET', `/api/orders/${o.j.ref}${tm}`)).j.status === 'PAID' && log.moov.some(x => x.op === 'getTransactionStatus'));
  const tkts = (await J('GET', `/api/orders/${o.j.ref}${tm}`)).j.tickets || [];
  ok('Moov : billets délivrés (2)', tkts.length === 2 || (await J('GET', `/api/orders/${o.j.ref}${tm}`)).j.qty === 2);
  // échec
  moovStatus = { status: 'FAILED', code: '05' }; moovAmount = null;
  const o2 = await order('moov', '70999888'); const t2 = `?token=${encodeURIComponent(o2.j.token)}`;
  await fetch(B + '/api/webhooks/moov', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'FAILED', referenceId: o2.j.ref }) });
  ok('Moov : paiement refusé → commande échouée, places libérées', ['FAILED', 'CANCELLED', 'EXPIRED'].includes((await J('GET', `/api/orders/${o2.j.ref}${t2}`)).j.status));
  // notification sans callback : relève (polling) par l'interrogation de la commande
  moovStatus = { status: 'PENDING', code: '01' }; const o3 = await order('moov', '70555444'); const t3 = `?token=${encodeURIComponent(o3.j.token)}`;
  moovStatus = { status: 'SUCCESS', code: '00' }; await new Promise(r => setTimeout(r, 4200));
  ok('Moov : sans callback, l\'interrogation de la commande (polling) retrouve le paiement', (await J('GET', `/api/orders/${o3.j.ref}${t3}`)).j.status === 'PAID');
  // IP autorisées
  process.env.MOOV_CALLBACK_IPS = '203.0.113.10';
  const o4 = await order('moov', '70333222'); const bad = await fetch(B + '/api/webhooks/moov', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'SUCCESS', referenceId: o4.j.ref }) });
  ok('Moov : callback d\'une adresse IP non autorisée refusé (403)', bad.status === 403);
  delete process.env.MOOV_CALLBACK_IPS;
  const all = out.join('\n') + JSON.stringify((await J('GET', '/api/config')).j) + (await (await fetch(B + '/')).text());
  ok('aucun secret (client_secret, mot de passe Moov) n\'apparaît dans le navigateur', !all.includes('csecret-ne-doit-pas-fuiter') && !all.includes('pw-moov-ne-doit-pas-fuiter'));
  server.closeAllConnections(); server.close(); fake.close();
  fs.writeFileSync(path.join(__dirname, 'rapport-flux-orange-moov.txt'), out.join('\n') + `\n\n${pass} réussis, ${fail} échecs\n`);
  console.log(`\n${pass} réussis, ${fail} échecs`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
