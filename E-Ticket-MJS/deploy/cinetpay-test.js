'use strict';
// Essai réel CinetPay (compte marchand requis) :
//   CINETPAY_API_KEY=… CINETPAY_SITE_ID=… node deploy/cinetpay-test.js [montant multiple de 5]
// Crée une transaction test, affiche l'adresse du guichet à ouvrir, puis interroge l'état jusqu'à la fin.
const cp = require('../providers/cinetpay');
const total = +process.argv[2] || 100, ref = 'CMD-TEST' + String(Date.now()).slice(-4);
(async () => {
  if (!cp.enabled()) { console.error('Variables manquantes : CINETPAY_API_KEY et CINETPAY_SITE_ID.'); process.exit(2); }
  const base = process.env.BASE_URL || 'https://exemple.invalide';
  const order = { ref, total };
  const p = await cp.initiate(order, { ret: base + '/?order=' + ref, notif: base + '/api/webhooks/cinetpay' });
  console.log('Transaction créée :', ref, total, 'XOF\nOuvrez le guichet :', p.payUrl);
  for (const t0 = Date.now(); Date.now() - t0 < 10 * 60000;) {
    await new Promise(r => setTimeout(r, 5000));
    const s = await cp.checkStatus(order);
    console.log(new Date().toISOString().slice(11, 19), 'état :', s);
    if (s !== 'PENDING') process.exit(s === 'SUCCESS' ? 0 : 1);
  }
  console.log('Délai dépassé.'); process.exit(1);
})().catch(e => { console.error('ERREUR :', e.message); process.exit(1); });
