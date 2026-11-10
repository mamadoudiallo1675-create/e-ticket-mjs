'use strict';
// Fournisseur de SIMULATION : aucune somme n'est débitée.
// Le paiement se "confirme" depuis la page /sandbox/pay/<ref>. À désactiver en production.
module.exports = {
  enabled: () => true,
  async initiate(order, urls) {
    return { providerRef: 'MOCK-' + order.ref, notifToken: null, payUrl: `${urls.base}/sandbox/pay/${order.ref}` };
  },
  async checkStatus(order) {
    return order.provider_status || 'PENDING';
  }
};
