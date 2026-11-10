// URL de notification (notify_url) appelée « en secret » par CinetPay dès que le client valide son code (Orange, Moov, Wave, Sama Money).
// On ne croit pas la notification : on interroge l'API CinetPay (statut + montant) puis on confirme la vente, on émet les billets et on envoie le SMS.
import { json, readParams, TRANSAC_RE } from '../lib/util.mjs';
import { confirmer } from '../lib/paiement.mjs';
import { env } from '../lib/env.mjs';

export default async (req) => {
  if (req.method === 'GET' || req.method === 'HEAD') return json({ ok: true });               // CinetPay teste l'adresse en GET
  if (req.method !== 'POST') return json({ error: 'Méthode non autorisée.' }, 405);
  const p = await readParams(req);
  const id = String(p.cpm_trans_id || p.transaction_id || '');
  if (!TRANSAC_RE.test(id)) return json({ ok: true });
  if (env('CINETPAY_SITE_ID') && p.cpm_site_id && String(p.cpm_site_id) !== env('CINETPAY_SITE_ID')) return json({ ok: true });   // notification d'un autre site
  try {
    const r = await confirmer(id);
    return json({ ok: true, traite: !!r.ok });
  } catch (e) {
    console.error('[webhook_cinetpay]', id, e.message);
    return json({ error: 'Traitement différé' }, 500);                                           // 5xx : CinetPay renverra la notification
  }
};
export const config = { path: '/api/cinetpay/notification' };
