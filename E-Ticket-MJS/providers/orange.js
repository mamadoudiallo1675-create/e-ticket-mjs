'use strict';
// Orange Money – Web Payment (redirection vers la page de paiement Orange).
//
// Flux, d'après les SDK publics de l'API Orange Money WebPay :
//   1. POST {OAUTH_URL}                         -> access_token (Authorization: <OM_AUTH_HEADER>)
//   2. POST {BASE}/orange-money-webpay/{PAYS}/v1/webpayment
//        { merchant_key, currency, order_id, amount, return_url, cancel_url, notif_url, lang, reference }
//        -> { pay_token, payment_url, notif_token }
//   3. L'utilisateur paie sur payment_url ; Orange appelle notif_url avec { status, notif_token, txnid }.
//   4. POST {BASE}/orange-money-webpay/{PAYS}/v1/transactionstatus { order_id, amount, pay_token }
//        -> { status: INITIATED | PENDING | EXPIRED | SUCCESS | FAILED, txnid }
//
// ⚠ Les identifiants (OM_AUTH_HEADER, OM_MERCHANT_KEY), le code pays et la devise de PRODUCTION
// sont fournis par Orange après ouverture du compte marchand : à vérifier avec leur documentation
// (https://developer.orange.com/). En sandbox : pays "dev", devise "OUV".

const env = k => process.env[k] || '';
let cached = { token: null, exp: 0 };

// Deux modes :
//  • « direct » (flux fourni par Orange, fichier flow_paiement_OM) : CLIENT_ID + CLIENT_SECRET (jeton OAuth en JSON), POST {base}/webpayment,
//    MERCHANT_KEY ; adresses OM_OAUTH_URL, OM_WEBPAYMENT_URL (sandbox par défaut : https://sandbox.orange.com/...).
//  • « classique » (SDK WebPay) : OM_AUTH_HEADER (Basic) + OM_MERCHANT_KEY + /orange-money-webpay/{pays}/v1/.
const cfg = () => {
  const clientId = env('OM_CLIENT_ID') || env('CLIENT_ID'), clientSecret = env('OM_CLIENT_SECRET') || env('CLIENT_SECRET'), direct = !!(clientId && clientSecret);
  const webpay = env('OM_WEBPAYMENT_URL') || 'https://sandbox.orange.com/webpayment';
  return {
    direct, clientId, clientSecret,
    base: env('OM_BASE_URL') || 'https://api.orange.com',
    oauth: env('OM_OAUTH_URL') || (direct ? 'https://sandbox.orange.com/oauth/token' : 'https://api.orange.com/oauth/v3/token'),
    webpay, status: env('OM_STATUS_URL') || webpay.replace(/\/webpayment\/?$/, '/transactionstatus'),   // ⚠ adresse de statut : à confirmer avec Orange
    country: env('OM_COUNTRY') || 'dev',
    currency: env('OM_CURRENCY') || (direct ? 'XOF' : 'OUV'),
    merchantKey: env('OM_MERCHANT_KEY') || env('MERCHANT_KEY'),
    authHeader: env('OM_AUTH_HEADER')
  };
};

async function accessToken() {
  if (cached.token && Date.now() < cached.exp - 60000) return cached.token;
  const c = cfg();
  const r = c.direct
    ? await fetch(c.oauth, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ grant_type: 'client_credentials', client_id: c.clientId, client_secret: c.clientSecret }), signal: AbortSignal.timeout(15000) })
    : await fetch(c.oauth, { method: 'POST', headers: { Authorization: c.authHeader, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: 'grant_type=client_credentials', signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error('Orange Money : authentification refusée (' + r.status + ')');
  cached = { token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
  return cached.token;
}

async function call(kind, body) {
  const c = cfg();
  const url = c.direct ? (kind === 'webpayment' ? c.webpay : c.status) : `${c.base}/orange-money-webpay/${c.country}/v1/${kind}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + (await accessToken()), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000)
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, body: j };
}

module.exports = {
  enabled: () => { const c = cfg(); return !!(c.merchantKey && (c.direct || c.authHeader)); },
  async initiate(order, urls) {
    const c = cfg();
    const { status, body } = await call('webpayment', {
      merchant_key: c.merchantKey, currency: c.currency, order_id: order.ref, amount: order.total,
      return_url: urls.ret, cancel_url: urls.cancel, notif_url: urls.notif, lang: 'fr', reference: cfg().direct ? order.ref : 'E-Ticket MJS'
    });
    if (status >= 300 || !body.payment_url) throw new Error('Orange Money : création du paiement refusée (' + status + ')');
    return { providerRef: body.pay_token, notifToken: body.notif_token, payUrl: body.payment_url };
  },
  async checkStatus(order) {
    const { status, body } = await call('transactionstatus', { order_id: order.ref, amount: order.total, pay_token: order.provider_ref });
    if (status >= 300) return 'PENDING';
    const s = String(body.status || '').toUpperCase();
    return { SUCCESS: 'SUCCESS', FAILED: 'FAILED', EXPIRED: 'EXPIRED' }[s] || 'PENDING';
  }
};
