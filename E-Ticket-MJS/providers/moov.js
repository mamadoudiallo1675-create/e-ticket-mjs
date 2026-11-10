'use strict';
// Moov Money Mali (Moov Africa Malitel) – intégration API directe, d'après le document
// « Spécifications Techniques : Intégration API Directe Moov Money Mali » fourni par l'opérateur.
//
// Flux « Push USSD C2B » (aucune redirection : l'acheteur reçoit une invite de saisie du code PIN sur son téléphone) :
//   1. requestPayment  (SOAP/XML sur HTTPS TLS 1.2+, POST)  merchantId, password, customerMsisdn (223 + 8 chiffres),
//                      amount, currency=XOF, referenceId (unique par tentative), callbackUrl
//      -> réponse immédiate : status PENDING, responseCode 01 (= demande prise en compte, PAS un débit)
//   2. L'acheteur saisit son code PIN ; Moov appelle callbackUrl (JSON ou XML) : status, responseCode (00 = succès),
//      transactionId, referenceId, amount, currency, clientPhone, timestamp.
//   3. Le site ne croit jamais la notification : il revérifie par getTransactionStatus (aussi utilisé en « polling » si
//      aucune notification n'arrive sous 120 s) et contrôle le montant.
//
// ⚠ Ce que le document de Moov NE précise PAS et qui reste à confirmer avec Moov pendant la recette (bac à sable) :
//   - l'adresse (URL) du point de terminaison de production/sandbox  -> MOOV_URL ;
//   - l'enveloppe exacte de getTransactionStatus (ici : mêmes champs merchantId/password + referenceId, même espace de noms) ;
//   - l'éventuel en-tête SOAPAction -> MOOV_SOAP_ACTION (optionnel) ;
//   - les valeurs de statut autres que PENDING / SUCCESS.
// Sécurité imposée par Moov : IP fixe publique du serveur enregistrée au contrat ; callback limité aux IP de la
// passerelle Moov (MOOV_CALLBACK_IPS, appliqué par server.js).

const env = k => process.env[k] || '';
const cfg = () => ({ url: env('MOOV_URL'), merchantId: env('MOOV_MERCHANT_ID'), password: env('MOOV_PASSWORD'),
  ns: env('MOOV_NAMESPACE') || 'http://malitel.ml/moovmoney', action: env('MOOV_SOAP_ACTION') });

const xmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const tag = (xml, name) => { const m = new RegExp('<(?:[\\w-]+:)?' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?' + name + '>', 'i').exec(xml || ''); return m ? m[1].trim() : ''; };
const envelope = (c, op, fields) => `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="${xmlEsc(c.ns)}"><soapenv:Header/><soapenv:Body><ser:${op}>`
  + Object.entries(fields).map(([k, v]) => `<${k}>${xmlEsc(v)}</${k}>`).join('') + `</ser:${op}></soapenv:Body></soapenv:Envelope>`;

async function soap(op, fields) {
  const c = cfg();
  const headers = { 'Content-Type': 'text/xml; charset=utf-8', Accept: 'text/xml' };
  if (c.action) headers.SOAPAction = c.action.replace('{op}', op);
  const r = await fetch(c.url, { method: 'POST', headers, body: envelope(c, op, { merchantId: c.merchantId, password: c.password, ...fields }), signal: AbortSignal.timeout(20000) });
  const text = await r.text();
  return { http: r.status, text, status: tag(text, 'status').toUpperCase(), code: tag(text, 'responseCode'), description: tag(text, 'description'),
    amount: tag(text, 'amount'), txn: tag(text, 'transactionId') };
}

// Extrait les champs utiles d'une notification (JSON ou XML) — SANS leur faire confiance.
function parseNotification(raw) {
  const s = String(raw || '').trim();
  if (s.startsWith('{')) { try { const j = JSON.parse(s); return { referenceId: String(j.referenceId || ''), status: String(j.status || ''), code: String(j.responseCode || '') }; } catch (_) { return {}; } }
  if (s.startsWith('<')) return { referenceId: tag(s, 'referenceId'), status: tag(s, 'status'), code: tag(s, 'responseCode') };
  return {};
}

module.exports = {
  enabled: () => { const c = cfg(); return !!(c.url && c.merchantId && c.password); },
  parseNotification,
  async initiate(order, urls) {
    const res = await soap('requestPayment', { customerMsisdn: '223' + order.phone, amount: Math.round(order.total), currency: 'XOF', referenceId: order.ref, callbackUrl: urls.notif });
    // 01 / PENDING = « Push USSD initié, en attente du code PIN ». Toute autre réponse = refus.
    if (res.http >= 300 || res.status !== 'PENDING' || (res.code && res.code !== '01')) throw new Error(`Moov Money : demande de paiement refusée (HTTP ${res.http}, ${res.status || '?'} ${res.code || ''})`);
    return { providerRef: order.ref, notifToken: null, payUrl: null };      // pas de redirection : push USSD sur le téléphone
  },
  async checkStatus(order) {
    const res = await soap('getTransactionStatus', { referenceId: order.ref });
    if (res.http >= 300) return 'PENDING';
    if (res.status === 'SUCCESS' && res.code === '00') {
      if (res.amount && Number(res.amount) !== Math.round(order.total)) { console.error(`[moov] montant différent pour ${order.ref} : reçu ${res.amount}, attendu ${order.total} — non appliqué`); return 'PENDING'; }
      return 'SUCCESS';
    }
    if (['FAILED', 'REJECTED', 'CANCELLED', 'CANCELED', 'ERROR', 'DECLINED'].includes(res.status)) return 'FAILED';
    if (res.status === 'EXPIRED' || res.status === 'TIMEOUT') return 'EXPIRED';
    return 'PENDING';
  }
};
