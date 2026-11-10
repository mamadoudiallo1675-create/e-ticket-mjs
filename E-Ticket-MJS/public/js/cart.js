/* E-Ticket Mali – panier : envoie le panier au serveur, qui calcule et renvoie le montant à payer.
   Le navigateur n'envoie jamais de prix : seulement { eventId, tribuneId, qty }. Le montant affiché par `quote`
   est celui que le serveur utilisera pour la commande (et pour CinetPay). */
(function () {
  "use strict";
  const J = { "Content-Type": "application/json" };
  const ET = window.ET;
  // <meta name="et-pay-backend" content="netlify"> : le paiement CinetPay passe par les fonctions Netlify ; sinon (défaut) par le serveur Node.
  const NETLIFY = (document.querySelector('meta[name="et-pay-backend"]') || {}).content === "netlify";

  /** Demande au serveur le montant du panier. → { amount, unit, qty, currency:'XOF', available, payable, ttlMin, titre, tribune } */
  function quote(cart) {
    return ET.api("/api/cart/quote", { method: "POST", headers: J, body: JSON.stringify({ eventId: cart.eventId, tribuneId: cart.tribuneId, qty: cart.qty }) });
  }

  /** Valide le panier côté serveur puis crée la commande (réservation des places) et le paiement.
      → { ref, token, payUrl, amount }.  Lève une erreur si le montant a changé depuis l'affichage. */
  async function checkout(cart, phone, operator, expectedAmount) {
    const q = await quote(cart);
    if (!q.available) throw Object.assign(new Error("Il ne reste plus assez de places dans cette tribune."), { status: 409 });
    if (!q.payable) throw new Error("Ce montant ne peut pas être payé en ligne. Contactez le support.");
    if (expectedAmount != null && q.amount !== expectedAmount) throw new Error("Le prix a changé : il est maintenant de " + ET.fmt(q.amount) + ". Vérifiez puis validez à nouveau.");
    if (operator === "cinetpay" && NETLIFY) {          // hébergement Netlify : fonction « initier_paiement » (stock réservé en SQL, trace dans MongoDB)
      const n = await ET.api("/api/cinetpay/initier", { method: "POST", headers: J, body: JSON.stringify({ tribuneId: cart.tribuneId, qty: cart.qty, phone }) });
      return { ref: n.transac_id, token: null, payUrl: n.payUrl, expiresAt: n.expiresAt, amount: n.montant, netlify: true };
    }
    const r = await ET.api("/api/orders", { method: "POST", headers: J, body: JSON.stringify({ eventId: cart.eventId, tribuneId: cart.tribuneId, qty: cart.qty, operator, phone }) });
    return { ...r, amount: q.amount };
  }
  ET.cart = { quote, checkout };
})();
