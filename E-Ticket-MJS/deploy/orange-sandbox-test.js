'use strict';
// Essai en bac à sable Orange Money, une fois les identifiants reçus :
//   OM_AUTH_HEADER='Basic …' OM_MERCHANT_KEY=… OM_COUNTRY=dev OM_CURRENCY=OUV PROVIDER_ORANGE=live node deploy/orange-sandbox-test.js [montant]
// 1) crée un paiement test via l'adaptateur réel  2) affiche l'adresse de paiement à ouvrir  3) interroge l'état jusqu'à la fin.
const orange = require('../providers/orange');
const amount = +process.argv[2] || 100;
const ref = 'TEST-' + Date.now();
(async () => {
  for (const k of ['OM_AUTH_HEADER', 'OM_MERCHANT_KEY']) if (!process.env[k]) { console.error('Variable manquante : ' + k); process.exit(2); }
  const base = process.env.BASE_URL || 'https://exemple.invalide';
  console.log('Création du paiement test', ref, amount, 'FCFA…');
  const order = { ref, total: amount, phone: process.env.TEST_PHONE || '' };
  const pay = await orange.initiate(order, { ret: base + '/?order=' + ref, cancel: base + '/?order=' + ref, notif: base + '/api/webhooks/orange' });
  console.log('Paiement créé : pay_token reçu =', !!pay.providerRef, '· notif_token reçu =', !!pay.notifToken);
  console.log('\nOuvrez cette adresse sur un téléphone de test et validez ou refusez le paiement :\n' + pay.payUrl);
  const t0 = Date.now();
  while (Date.now() - t0 < 10 * 60000) {
    await new Promise(r => setTimeout(r, 5000));
    const st = await orange.checkStatus({ ...order, provider_ref: pay.providerRef });
    console.log(new Date().toISOString().slice(11, 19), 'état :', st);
    if (st !== 'PENDING') process.exit(st === 'SUCCESS' ? 0 : 1);
  }
  console.log('Délai dépassé.'); process.exit(1);
})().catch(e => { console.error('ERREUR :', e.message); process.exit(1); });
