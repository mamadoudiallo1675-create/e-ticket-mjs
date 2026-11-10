'use strict';
// CinetPay (guichet de paiement) : Orange Money, Moov, Wave, Sama Money… selon les canaux activés sur votre compte CinetPay.
// Flux sécurisé : la clé API ne quitte JAMAIS le serveur ; le montant est recalculé côté serveur ; le résultat est revérifié
// auprès de CinetPay (POST /v2/payment/check) avant de délivrer les billets — la notification seule n'est jamais crue.
//   POST https://api-checkout.cinetpay.com/v2/payment        -> { code:"201", data:{ payment_url, payment_token } }
//   POST https://api-checkout.cinetpay.com/v2/payment/check  -> { code:"00", data:{ status: ACCEPTED | REFUSED | WAITING_FOR_CUSTOMER, amount, currency } }
const env = k => (process.env[k] || '').trim();
const cfg = () => ({
  base: env('CINETPAY_BASE_URL') || 'https://api-checkout.cinetpay.com/v2',
  apikey: env('CINETPAY_API_KEY'),
  siteId: env('CINETPAY_SITE_ID'),
  channels: env('CINETPAY_CHANNELS') || 'MOBILE_MONEY',      // ALL, MOBILE_MONEY, CREDIT_CARD, WALLET
  currency: env('CINETPAY_CURRENCY') || 'XOF'
});

async function post(path, body) {
  const r = await fetch(cfg().base + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(20000)
  });
  return { http: r.status, body: await r.json().catch(() => ({})) };
}

module.exports = {
  enabled: () => !!(cfg().apikey && cfg().siteId),
  async initiate(order, urls) {
    const c = cfg();
    if (!Number.isInteger(order.total) || order.total <= 0 || order.total % 5 !== 0)
      throw new Error('CinetPay exige un montant entier, multiple de 5 (reçu : ' + order.total + ').');
    const { http, body } = await post('/payment', {
      apikey: c.apikey, site_id: c.siteId, transaction_id: order.ref, amount: order.total, currency: c.currency,
      description: 'Billets E-Ticket Mali ' + order.ref, notify_url: urls.notif, return_url: urls.ret,
      channels: c.channels, lang: 'fr', metadata: order.ref
    });
    if (String(body.code) !== '201' || !body.data || !body.data.payment_url)
      throw new Error('CinetPay : création refusée (' + http + ' ' + (body.code || '') + ' ' + (body.message || '') + ')');
    return { providerRef: body.data.payment_token || order.ref, notifToken: null, payUrl: body.data.payment_url };
  },
  async checkStatus(order) {
    const c = cfg();
    const { body } = await post('/payment/check', { apikey: c.apikey, site_id: c.siteId, transaction_id: order.ref });
    const st = String(body.data && body.data.status || '').toUpperCase();
    if (String(body.code) === '00' && st === 'ACCEPTED') {
      // On vérifie que la somme encaissée correspond bien à la commande (jamais de billets pour un montant inférieur).
      if (Number(body.data.amount) !== order.total || String(body.data.currency || c.currency) !== c.currency) return 'FAILED';
      return 'SUCCESS';
    }
    if (st === 'REFUSED' || String(body.code) === '627') return 'FAILED';
    return 'PENDING';                                  // WAITING_FOR_CUSTOMER, transaction inconnue, erreur réseau…
  }
};
