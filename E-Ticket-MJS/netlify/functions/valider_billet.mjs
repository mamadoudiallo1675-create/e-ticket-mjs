// Contrôle à l'entrée : valide un billet UNE SEULE FOIS (mise à jour atomique dans MongoDB). Réservé au personnel (clé de contrôle).
import { json, safeEqual } from '../lib/util.mjs';
import { mongo } from '../lib/drivers.mjs';
import { env } from '../lib/env.mjs';

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Méthode non autorisée.' }, 405);
  const key = env('CONTROL_KEY'), given = req.headers.get('x-control-key') || '';
  if (!key || !safeEqual(given, key)) return json({ error: 'Accès refusé.' }, 401);
  let b; try { b = await req.json(); } catch { return json({ error: 'Requête invalide.' }, 400); }
  const token = String(b.token || '');
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return json({ result: 'invalide' }, 200);
  const col = (await mongo()).collection('billets');
  if (b.mode === 'check') { const d = await col.findOne({ _id: token }); return json({ result: !d ? 'invalide' : d.statut === 'valide' ? 'valide' : 'deja_utilise' }); }
  const r = await col.updateOne({ _id: token, statut: 'valide' }, { $set: { statut: 'utilise', utilise_le: new Date().toISOString(), poste: String(b.poste || '').slice(0, 60) } });
  if (r.modifiedCount) return json({ result: 'accepte' });
  const d = await col.findOne({ _id: token });
  return json({ result: d ? 'deja_utilise' : 'invalide' });
};
export const config = { path: '/api/cinetpay/valider', method: 'POST' };
