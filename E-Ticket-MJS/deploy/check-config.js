'use strict';
// Vérifie la configuration de production AVANT la mise en ligne :  node deploy/check-config.js  (lit .env si présent)
const fs = require('fs'), path = require('path');
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) for (const l of fs.readFileSync(envFile, 'utf8').split('\n')) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
const e = process.env, rows = [];
const add = (ok, n, d) => rows.push([ok, n, d || '']);
let base = null; try { base = new URL(e.BASE_URL || ''); } catch (_) {}
add(base && base.protocol === 'https:', 'BASE_URL en https', e.BASE_URL || 'non définie');
add(base && !/localhost|127\.0\.0\.1/.test(base.hostname), 'BASE_URL = nom de domaine public', base ? base.hostname : '');
add((e.ADMIN_KEY || '').length >= 24, 'ADMIN_KEY ≥ 24 caractères');
add((e.CONTROL_KEY || '').split(',').every(k => k.trim().length >= 16) && !!e.CONTROL_KEY, 'CONTROL_KEY ≥ 16 caractères (bornes)');
add(e.CONTROL_KEY !== e.ADMIN_KEY, 'Clé des bornes différente de la clé admin');
add(e.PROVIDER_ORANGE === 'live' || e.PROVIDER_MOOV === 'live', 'Au moins un opérateur en mode réel (PROVIDER_ORANGE=live et/ou PROVIDER_MOOV=live)', 'Orange : ' + (e.PROVIDER_ORANGE || 'non défini') + ' · Moov : ' + (e.PROVIDER_MOOV || 'non défini'));
if (e.PROVIDER_ORANGE === 'live') for (const k of ['OM_AUTH_HEADER', 'OM_MERCHANT_KEY']) add(!!e[k], k + ' renseignée (Orange Money direct)');
add((e.SMS_PROVIDER === 'http' && !!e.SMS_URL) || (e.SMS_PROVIDER === 'twilio' && !!e.SMS_TWILIO_SID && !!e.SMS_TWILIO_TOKEN && !!(e.SMS_FROM || e.SMS_TWILIO_MESSAGING_SERVICE)) || (e.SMS_PROVIDER === 'orange' && !!e.SMS_ORANGE_CLIENT_ID && !!e.SMS_ORANGE_CLIENT_SECRET && !!e.SMS_ORANGE_SENDER), 'Passerelle SMS configurée (SMS_PROVIDER=http | twilio | orange et ses identifiants)', e.SMS_PROVIDER || 'non défini');
if ((e.PROVIDER_CINETPAY || '').toLowerCase() === 'live') add(!!e.CINETPAY_API_KEY && !!e.CINETPAY_SITE_ID, 'CinetPay : clé API et identifiant du site renseignés', 'CINETPAY_API_KEY / CINETPAY_SITE_ID manquants');
add(e.LEGAL_VALIDATED === '1', 'Textes juridiques validés (LEGAL_VALIDATED=1)');
let todo = 0; for (const f of ['conditions.html', 'confidentialite.html']) { try { todo += (fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8').match(/class="todo"/g) || []).length; } catch (_) { todo += 999; } }
add(todo === 0, 'Aucun passage « à compléter » dans les textes juridiques', todo + ' restant(s)');
add(fs.existsSync(path.join(__dirname, '..', 'public', 'vendor', 'qr.js')), 'Générateur de QR hébergé sur le serveur');
add(e.NODE_ENV === 'production', 'NODE_ENV=production', e.NODE_ENV || 'non défini');
(async () => {
  if (base && base.protocol === 'https:') {
    try { const r = await fetch(base.origin + '/healthz', { signal: AbortSignal.timeout(8000) }); add(r.ok, 'Le serveur répond en HTTPS depuis Internet (/healthz)', 'HTTP ' + r.status); }
    catch (err) { add(false, 'Le serveur répond en HTTPS depuis Internet (/healthz)', err.cause?.code || err.message); }
  }
  let bad = 0;
  for (const [ok, n, d] of rows) { console.log((ok ? 'OK    ' : 'À FAIRE') + ' ' + n + (d ? '  — ' + d : '')); if (!ok) bad++; }
  console.log(bad ? `\n${bad} point(s) à traiter avant l'ouverture.` : '\nConfiguration prête.');
  process.exit(bad ? 1 : 0);
})();
