// Logique métier commune aux fonctions : réservation des places (SQL), traces (MongoDB), billets, SMS.
import cinetpay from '../../providers/cinetpay.js';
import sms from '../../sms/index.js';
import { sql, mongo } from './drivers.mjs';
import { env, siteUrl } from './env.mjs';
import { iso, newTransacId, newToken, newShort } from './util.mjs';

export const ttlMin = () => Math.max(5, Math.min(60, +env('RESERVATION_TTL_MIN') || 15));
export const HttpErr = class extends Error { constructor(status, message) { super(message); this.status = status; } };

// ---------- Fonction 1 : vérifier le stock, réserver, tracer, initier le paiement ----------
export async function initierPaiement({ tribuneId, qty, phone }) {
  const db = await sql(), mg = await mongo();
  const transac_id = newTransacId(), now = Date.now();
  let montant = 0, tribune = null;

  // 1) Vérifier le stock ET réserver en une seule opération atomique : la place est « en cours » le temps du paiement.
  await db.tx(async t => {
    const r = await t.query(
      `UPDATE tribunes SET en_cours = en_cours + $1 WHERE id = $2 AND capacite - en_cours - vendu >= $1 RETURNING id, event_id, event_titre, nom, prix`,
      [qty, tribuneId]);
    if (!r.length) {
      const ex = await t.query('SELECT id FROM tribunes WHERE id = $1', [tribuneId]);
      throw new HttpErr(ex.length ? 409 : 404, ex.length ? "Il ne reste plus assez de places dans cette tribune." : 'Tribune introuvable.');
    }
    tribune = r[0]; montant = tribune.prix * qty;                              // le prix vient TOUJOURS de la base, jamais du navigateur
    await t.query(
      `INSERT INTO commandes (transac_id, event_id, tribune_id, qty, montant, statut, cree_le, expire_le, maj_le) VALUES ($1,$2,$3,$4,$5,'attente_paiement',$6,$7,$6)`,
      [transac_id, tribune.event_id, tribune.id, qty, montant, iso(now), iso(now + ttlMin() * 60000)]);
  });

  // 2) Trace non relationnelle (le téléphone n'est gardé que dans MongoDB : il servira à envoyer le SMS de confirmation).
  try {
    await mg.collection('transactions').insertOne({ _id: transac_id, statut: 'attente de paiement', phone, qty, montant, event_id: tribune.event_id, tribune_id: tribune.id, titre: tribune.event_titre, tribune: tribune.nom, cree_le: iso(now) });
  } catch (e) { await liberer(transac_id, 'echoue'); throw e; }

  // 3) Guichet CinetPay : si la création échoue, on libère aussitôt les places.
  try {
    const out = await cinetpay.initiate({ ref: transac_id, total: montant }, {
      notif: siteUrl() + '/api/cinetpay/notification', ret: siteUrl() + '/commande/' + transac_id });
    return { transac_id, payUrl: out.payUrl, montant, expiresAt: now + ttlMin() * 60000 };
  } catch (e) {
    console.error('[initier_paiement] CinetPay', transac_id, e.message);
    await liberer(transac_id, 'echoue');
    throw new HttpErr(502, "Le service de paiement ne répond pas. Réessayez dans un instant.");
  }
}

// Libère les places d'une commande encore « en attente » (échec, refus, expiration). Idempotent.
export async function liberer(transac_id, statut = 'echoue') {
  const db = await sql(), mg = await mongo();
  const done = await db.tx(async t => {
    const r = await t.query(`UPDATE commandes SET statut = $2, maj_le = $3 WHERE transac_id = $1 AND statut = 'attente_paiement' RETURNING tribune_id, qty`, [transac_id, statut, iso()]);
    if (!r.length) return false;
    await t.query('UPDATE tribunes SET en_cours = en_cours - $1 WHERE id = $2', [r[0].qty, r[0].tribune_id]);
    return true;
  });
  if (done) await mg.collection('transactions').updateOne({ _id: transac_id }, { $set: { statut: statut === 'expire' ? 'expiré' : 'échoué', maj_le: iso() } });
  return done;
}

// ---------- Fonction 2 : confirmer le paiement (après revérification auprès de CinetPay) ----------
export async function confirmer(transac_id) {
  const db = await sql(), mg = await mongo();
  const [cmd] = await db.query('SELECT * FROM commandes WHERE transac_id = $1', [transac_id]);
  if (!cmd) return { ok: false, raison: 'inconnue' };

  if (cmd.statut === 'attente_paiement' || cmd.statut === 'expire') {
    // La notification n'est JAMAIS crue : on demande à CinetPay le statut réel et le montant réellement payé.
    const st = await cinetpay.checkStatus({ ref: transac_id, total: cmd.montant });
    if (st === 'FAILED') { await liberer(transac_id, 'echoue'); return { ok: false, raison: 'refuse' }; }
    if (st !== 'SUCCESS') return { ok: false, raison: 'en_attente' };

    const res = await db.tx(async t => {
      const r = await t.query(`UPDATE commandes SET statut = 'vendu', maj_le = $2 WHERE transac_id = $1 AND statut = 'attente_paiement' RETURNING tribune_id, qty`, [transac_id, iso()]);
      if (r.length) {                                                          // en cours -> vendu
        await t.query('UPDATE tribunes SET en_cours = en_cours - $1, vendu = vendu + $1 WHERE id = $2', [r[0].qty, r[0].tribune_id]);
        return 'vendu';
      }
      if (cmd.statut === 'expire') {                                           // payé après expiration : on tente de reprendre la place
        const g = await t.query(`UPDATE tribunes SET vendu = vendu + $1 WHERE id = $2 AND capacite - en_cours - vendu >= $1 RETURNING id`, [cmd.qty, cmd.tribune_id]);
        const nouveau = g.length ? 'vendu' : 'remboursement_du';
        const u = await t.query(`UPDATE commandes SET statut = $2, maj_le = $3 WHERE transac_id = $1 AND statut = 'expire' RETURNING 1`, [transac_id, nouveau, iso()]);
        if (!u.length && g.length) await t.query('UPDATE tribunes SET vendu = vendu - $1 WHERE id = $2', [cmd.qty, cmd.tribune_id]);
        return u.length ? nouveau : 'deja';
      }
      return 'deja';
    });
    if (res === 'remboursement_du') {
      await mg.collection('transactions').updateOne({ _id: transac_id }, { $set: { statut: 'à rembourser', maj_le: iso() } });
      return { ok: false, raison: 'remboursement_du' };
    }
  } else if (cmd.statut !== 'vendu') return { ok: false, raison: cmd.statut };

  // Base non relationnelle : transaction « payée », billets (jetons) et lien court — une seule fois, même si CinetPay renvoie la notification.
  const lien = await emettreBillets(transac_id, cmd);
  await envoyerSms(transac_id, lien);
  return { ok: true, lien };
}

async function emettreBillets(transac_id, cmd) {
  const mg = await mongo(), tr = mg.collection('transactions');
  const now = Date.now(), me = newToken();
  const claim = await tr.updateOne({ _id: transac_id, billets_ok: { $ne: true }, $or: [{ genere_par: { $exists: false } }, { genere_le: { $lt: now - 120000 } }] }, { $set: { genere_par: me, genere_le: now, statut: 'payé', paye_le: iso() } });
  const doc = await tr.findOne({ _id: transac_id });
  if (!claim.modifiedCount && !claim.matchedCount) return doc && doc.lien;      // déjà émis (ou en cours par une autre invocation)
  const code = (doc && doc.lien) || newShort();
  const billets = Array.from({ length: cmd.qty }, (_, i) => ({ _id: newToken(), transac_id, event_id: cmd.event_id, tribune_id: cmd.tribune_id, rang: i + 1, statut: 'valide', cree_le: iso() }));
  await mg.collection('billets').insertMany(billets);
  await mg.collection('liens').updateOne({ _id: code }, { $set: { transac_id } }, { upsert: true });
  await tr.updateOne({ _id: transac_id }, { $set: { billets_ok: true, lien: code, maj_le: iso() } });
  return code;
}

async function envoyerSms(transac_id, code) {
  const tr = (await mongo()).collection('transactions');
  const doc = await tr.findOne({ _id: transac_id });
  if (!doc || doc.sms_ok || !doc.phone || !code) return;
  const claim = await tr.updateOne({ _id: transac_id, sms_ok: { $ne: true }, sms_en_cours: { $ne: true } }, { $set: { sms_en_cours: true } });
  if (!claim.modifiedCount) return;
  const n = doc.qty, texte = `Félicitations, ${n} place${n > 1 ? 's' : ''} réservée${n > 1 ? 's' : ''} avec succès. Votre billet : ${siteUrl()}/b/${code}`;
  try { await sms.send(doc.phone, texte); await tr.updateOne({ _id: transac_id }, { $set: { sms_ok: true, sms_en_cours: false, sms_le: iso() } }); }
  catch (e) { console.error('[sms]', transac_id, e.message); await tr.updateOne({ _id: transac_id }, { $set: { sms_en_cours: false, sms_erreur: String(e.message).slice(0, 200) } }); }
}

export async function expirer() {
  const db = await sql();
  const rows = await db.query(`SELECT transac_id FROM commandes WHERE statut = 'attente_paiement' AND expire_le < $1 LIMIT 200`, [iso()]);
  let n = 0; for (const r of rows) if (await liberer(r.transac_id, 'expire')) n++;
  return n;
}
