// Appelée quand l'utilisateur clique sur « Payer » : vérifie le stock, réserve les places, crée la commande « attente de paiement »
// (transac_id unique) puis renvoie l'adresse du guichet CinetPay. Aucune clé n'est jamais envoyée au navigateur.
import { json, normPhone } from '../lib/util.mjs';
import { initierPaiement, HttpErr } from '../lib/paiement.mjs';

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Méthode non autorisée.' }, 405);
  let b; try { b = await req.json(); } catch { return json({ error: 'Requête invalide.' }, 400); }
  const tribuneId = Number(b.tribuneId), qty = Number(b.qty), phone = normPhone(b.phone);
  if (!Number.isInteger(tribuneId) || tribuneId < 1) return json({ error: 'Tribune invalide.' }, 400);
  if (!Number.isInteger(qty) || qty < 1 || qty > 6) return json({ error: 'Quantité invalide (1 à 6 places).' }, 400);
  if (!phone) return json({ error: 'Numéro de téléphone invalide (8 chiffres).' }, 400);
  try { return json(await initierPaiement({ tribuneId, qty, phone }), 201); }
  catch (e) {
    if (e instanceof HttpErr) return json({ error: e.message }, e.status);
    console.error('[initier_paiement]', e.message); return json({ error: 'Erreur du service. Réessayez dans un instant.' }, 500);
  }
};
export const config = { path: '/api/cinetpay/initier', method: 'POST', rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ['ip', 'domain'] } };
