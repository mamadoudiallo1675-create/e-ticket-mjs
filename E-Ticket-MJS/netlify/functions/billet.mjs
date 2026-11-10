// Lien court vers le billet électronique : /b/<code>  (QR codes, à présenter à l'entrée)
// Page de retour du paiement : /commande/<transac_id>  (attend la confirmation puis ouvre le billet)
import { html, esc, TRANSAC_RE } from '../lib/util.mjs';
import { mongo } from '../lib/drivers.mjs';

const page = (titre, corps, extra = '') => html(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(titre)}</title>${extra}
<style>body{font-family:system-ui,sans-serif;background:#f5f6f2;color:#14181f;margin:0;padding:16px}.w{max-width:440px;margin:auto}.c{background:#fff;border:1px solid #e3e5de;border-radius:14px;padding:18px;margin:14px 0;text-align:center}h1{font-size:1.15rem}.m{color:#5b6472;font-size:.9rem}code{font-size:.8rem;word-break:break-all}a.b{display:inline-block;background:#087a33;color:#fff;border-radius:10px;padding:10px 18px;font-weight:700;text-decoration:none;margin-top:10px}.f{height:6px;background:linear-gradient(90deg,#087a33 33%,#fcd116 33% 66%,#ce1126 66%)}</style></head><body><div class="f"></div><div class="w"><h1>E-Ticket · Ministère de la Jeunesse et des Sports du Mali</h1>${corps}</div></body></html>`);

export default async (req, context) => {
  const { code, id } = (context && context.params) || {};
  const mg = await mongo();
  if (id) {
    if (!TRANSAC_RE.test(id)) return page('Commande', '<div class="c">Commande introuvable.</div>', '');
    const t = await mg.collection('transactions').findOne({ _id: id });
    if (!t) return page('Commande', '<div class="c">Commande introuvable.</div>');
    if (t.billets_ok && t.lien) return new Response(null, { status: 302, headers: { location: '/b/' + t.lien, 'cache-control': 'no-store' } });
    if (t.statut === 'échoué' || t.statut === 'expiré') return page('Paiement', '<div class="c"><b>Paiement non abouti.</b><p class="m">Aucune somme n\'est conservée pour cette commande. Vous pouvez recommencer votre réservation.</p><a class="b" href="/">Retour aux événements</a></div>');
    if (t.statut === 'à rembourser') return page('Paiement', '<div class="c"><b>Paiement reçu après expiration de la réservation.</b><p class="m">Les places ne sont plus disponibles ; votre paiement sera remboursé. Contactez le support en indiquant la référence <code>' + esc(id) + '</code>.</p></div>');
    return page('Vérification du paiement', '<div class="c"><b>Vérification du paiement…</b><p class="m">Validez la demande sur votre téléphone si ce n\'est pas déjà fait. Cette page se met à jour automatiquement.</p><p class="m">Référence <code>' + esc(id) + '</code></p></div>', '<meta http-equiv="refresh" content="3">');
  }
  const lien = await mg.collection('liens').findOne({ _id: String(code || '') });
  if (!lien) return page('Billet introuvable', '<div class="c">Billet introuvable. Vérifiez le lien reçu par SMS.</div>');
  const t = await mg.collection('transactions').findOne({ _id: lien.transac_id });
  const bs = await mg.collection('billets').find({ transac_id: lien.transac_id }).toArray();
  const cartes = bs.sort((a, b) => a.rang - b.rang).map(b => `<div class="c"><b>${esc((t && t.titre) || 'Événement')}</b><div class="m">${esc((t && t.tribune) || '')} · billet ${b.rang}/${bs.length}</div>
<div class="qr" data-t="${esc(b._id)}" style="margin:12px auto;width:220px"></div><div class="m">${b.statut === 'valide' ? 'Valide — présentez ce QR code à l\'entrée.' : 'Billet déjà utilisé.'}</div></div>`).join('');
  return page('Mon billet E-Ticket', cartes + `<script src="/vendor/qr.js"></script><script>document.querySelectorAll('.qr').forEach(function(e){try{e.innerHTML=QR.svg(e.dataset.t,{size:220})}catch(x){e.textContent=e.dataset.t}})</script>`);
};
export const config = { path: ['/b/:code', '/commande/:id'], method: 'GET' };
