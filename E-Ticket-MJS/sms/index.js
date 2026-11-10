'use strict';
// Envoi de SMS (codes de récupération des billets).
//   SMS_PROVIDER=console : affiche le SMS dans les journaux (développement uniquement)
//   SMS_PROVIDER=twilio  : API REST Twilio  (SMS_TWILIO_SID, SMS_TWILIO_TOKEN, et SMS_FROM ou SMS_TWILIO_MESSAGING_SERVICE)
//   SMS_PROVIDER=orange  : API « SMS » d'Orange Developer (SMS_ORANGE_CLIENT_ID, SMS_ORANGE_CLIENT_SECRET, SMS_ORANGE_SENDER = numéro expéditeur +223…)
//   SMS_PROVIDER=http    : appelle la passerelle SMS de votre fournisseur (Orange, Moov, agrégateur…)
//        SMS_URL            adresse de l'API d'envoi
//        SMS_AUTH_HEADER    valeur de l'en-tête Authorization (ex. "Bearer xxx" ou "Basic xxx"), optionnel
//        SMS_BODY_TEMPLATE  corps JSON avec {to} (format +223XXXXXXXX) et {message}
//                           défaut : {"to":"{to}","message":"{message}"}
// Le format exact dépend du fournisseur retenu : adaptez SMS_BODY_TEMPLATE à sa documentation.

const outbox = [];     // utilisé par les tests
const jsonEsc = s => JSON.stringify(String(s)).slice(1, -1);
const prod = () => process.env.NODE_ENV === 'production';
const mode = () => (process.env.SMS_PROVIDER || 'console').toLowerCase();

const E = k => (process.env[k] || '').trim();
function available() {
  if (mode() === 'twilio') return !!(E('SMS_TWILIO_SID') && E('SMS_TWILIO_TOKEN') && (E('SMS_FROM') || E('SMS_TWILIO_MESSAGING_SERVICE')));
  if (mode() === 'orange') return !!(E('SMS_ORANGE_CLIENT_ID') && E('SMS_ORANGE_CLIENT_SECRET') && E('SMS_ORANGE_SENDER'));
  if (mode() === 'http') return !!process.env.SMS_URL;
  if (mode() === 'console') return !prod() || process.env.ALLOW_CONSOLE_SMS === '1';
  return false;
}

const base = () => (E('SMS_API_BASE') || '').replace(/\/$/, '');
let orangeTok = null;
async function orangeToken() {
  if (orangeTok && orangeTok.exp > Date.now() + 60000) return orangeTok.v;
  const r = await fetch((base() || 'https://api.orange.com') + '/oauth/v3/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + Buffer.from(E('SMS_ORANGE_CLIENT_ID') + ':' + E('SMS_ORANGE_CLIENT_SECRET')).toString('base64') },
    body: 'grant_type=client_credentials', signal: AbortSignal.timeout(15000)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error('Orange SMS : jeton refusé (' + r.status + ')');
  orangeTok = { v: j.access_token, exp: Date.now() + (+j.expires_in || 3600) * 1000 };
  return orangeTok.v;
}

// phone = 8 chiffres maliens (envoi vers +223…) ; sendTo = numéro complet E.164.
async function send(phone, message) { return sendTo('+223' + phone, message); }

async function sendTo(to, message) {
  if (!available()) throw new Error('SMS non configuré');
  if (mode() === 'twilio') {
    const body = new URLSearchParams({ To: to, Body: message });
    if (E('SMS_TWILIO_MESSAGING_SERVICE')) body.set('MessagingServiceSid', E('SMS_TWILIO_MESSAGING_SERVICE')); else body.set('From', E('SMS_FROM'));
    const r = await fetch((base() || 'https://api.twilio.com') + '/2010-04-01/Accounts/' + encodeURIComponent(E('SMS_TWILIO_SID')) + '/Messages.json', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + Buffer.from(E('SMS_TWILIO_SID') + ':' + E('SMS_TWILIO_TOKEN')).toString('base64') },
      body, signal: AbortSignal.timeout(15000)
    });
    if (!r.ok) throw new Error('Twilio SMS : erreur ' + r.status);
    return;
  }
  if (mode() === 'orange') {
    const sender = 'tel:' + E('SMS_ORANGE_SENDER');
    const r = await fetch((base() || 'https://api.orange.com') + '/smsmessaging/v1/outbound/' + encodeURIComponent(sender) + '/requests', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + await orangeToken() },
      body: JSON.stringify({ outboundSMSMessageRequest: { address: 'tel:' + to, senderAddress: sender, outboundSMSTextMessage: { message } } }), signal: AbortSignal.timeout(15000)
    });
    if (!r.ok) throw new Error('Orange SMS : erreur ' + r.status);
    return;
  }
  if (mode() === 'console') {
    outbox.push({ to, message });
    if (!prod()) console.log(`[sms:console] ${to} → ${message}`);
    return;
  }
  const tpl = process.env.SMS_BODY_TEMPLATE || '{"to":"{to}","message":"{message}"}';
  const r = await fetch(process.env.SMS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(process.env.SMS_AUTH_HEADER ? { Authorization: process.env.SMS_AUTH_HEADER } : {}) },
    body: tpl.split('{to}').join(jsonEsc(to)).split('{message}').join(jsonEsc(message)),
    signal: AbortSignal.timeout(15000)
  });
  if (!r.ok) throw new Error('Passerelle SMS : erreur ' + r.status);
}

module.exports = { send, sendTo, available, outbox };
