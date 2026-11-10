-- E-Ticket MJS Mali : base SQL des places et des commandes (Netlify Database / PostgreSQL).
-- Catalogue : alimenté depuis l'Admin (script netlify/scripts/export-catalogue.mjs) — aucun prix n'est inventé.
CREATE TABLE IF NOT EXISTS tribunes (
  id          INTEGER PRIMARY KEY,
  event_id    INTEGER NOT NULL,
  event_titre TEXT    NOT NULL DEFAULT '',
  nom         TEXT    NOT NULL,
  prix        INTEGER NOT NULL CHECK (prix > 0),
  capacite    INTEGER NOT NULL CHECK (capacite >= 0),
  en_cours    INTEGER NOT NULL DEFAULT 0 CHECK (en_cours >= 0),   -- places réservées pendant un paiement
  vendu       INTEGER NOT NULL DEFAULT 0 CHECK (vendu >= 0),      -- places définitivement vendues
  CHECK (en_cours + vendu <= capacite)                            -- garde-fou : jamais de sur-vente
);
CREATE TABLE IF NOT EXISTS commandes (
  transac_id  TEXT PRIMARY KEY,
  event_id    INTEGER NOT NULL,
  tribune_id  INTEGER NOT NULL REFERENCES tribunes(id),
  qty         INTEGER NOT NULL CHECK (qty BETWEEN 1 AND 6),
  montant     INTEGER NOT NULL CHECK (montant > 0),
  statut      TEXT    NOT NULL CHECK (statut IN ('attente_paiement','vendu','echoue','expire','remboursement_du')),
  cree_le     TEXT    NOT NULL,
  expire_le   TEXT    NOT NULL,
  maj_le      TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS commandes_statut_expire ON commandes (statut, expire_le);
