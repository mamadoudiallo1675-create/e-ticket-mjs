/* E-Ticket Mali – pop-up de paiement CinetPay (Orange Money, Moov, Wave, Sama Money selon votre compte CinetPay).
   Principe sécurisé : la page n'a AUCUNE clé. Le serveur crée la transaction (montant calculé côté serveur) et renvoie
   `payUrl`, le guichet CinetPay, que ce script ouvre dans une fenêtre centrée.

   Utilisation (dans un gestionnaire de clic) :
     const popup = ET.cinetpay.prepare();                 // 1) ouvrir SYNCHRONEMENT, sinon le navigateur bloque la fenêtre
     const r = await ET.cart.checkout(cart, phone, "cinetpay");   // 2) panier -> serveur -> commande + payUrl
     ET.cinetpay.open(popup, r.payUrl, { ref: r.ref, onReturn: ref => … });  // 3) charge le guichet dans la pop-up
   Si la pop-up est bloquée, on bascule automatiquement sur une redirection plein écran.
   Au retour du paiement, la pop-up se ferme et la page est prévenue (postMessage) ; le statut réel vient toujours du serveur. */
(function () {
  "use strict";
  const NAME = "eticket-pay";
  let listener = null;

  function prepare() {
    const w = 460, h = 720, x = Math.max(0, (screen.width - w) / 2), y = Math.max(0, (screen.height - h) / 2);
    let win = null;
    try { win = window.open("", NAME, `width=${w},height=${h},left=${x},top=${y},resizable=yes,scrollbars=yes`); } catch (e) {}
    if (win && !win.closed) {
      try { win.document.write('<!doctype html><meta charset="utf-8"><title>Paiement</title><body style="font-family:system-ui;text-align:center;padding:40px;color:#444">Ouverture du guichet de paiement sécurisé…</body>'); } catch (e) {}
      return win;
    }
    return null;
  }

  function open(win, payUrl, opts) {
    opts = opts || {};
    if (listener) window.removeEventListener("message", listener);
    listener = ev => {
      if (ev.origin !== location.origin || !ev.data || ev.data.type !== "eticket-pay-return") return;
      if (opts.onReturn) opts.onReturn(ev.data.ref || opts.ref);
    };
    window.addEventListener("message", listener);
    if (!win || win.closed) { location.href = payUrl; return { popup: false }; }   // pop-up bloquée : redirection classique
    win.location.href = payUrl;
    win.focus();
    const t = setInterval(() => { if (win.closed) { clearInterval(t); if (opts.onClose) opts.onClose(opts.ref); } }, 1000);
    return { popup: true, window: win };
  }

  /** À appeler au chargement de la page de retour (return_url) : si on est dans la pop-up, prévient la page d'origine et se ferme. */
  function handleReturn() {
    if (window.name !== NAME || !window.opener) return false;
    const ref = new URLSearchParams(location.search).get("order");
    try { window.opener.postMessage({ type: "eticket-pay-return", ref }, location.origin); } catch (e) {}
    window.close();
    return true;
  }
  window.ET.cinetpay = { prepare, open, handleReturn };
})();
