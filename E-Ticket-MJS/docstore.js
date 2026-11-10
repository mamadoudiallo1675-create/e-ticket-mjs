'use strict';
/* Magasin de documents embarqué (base NON relationnelle) — sans aucune dépendance.
 *
 * Modèle : des « collections » de documents JSON sans schéma fixe, stockées dans un journal à ajout seul (NDJSON, un fichier par
 * collection). Deux formes :
 *   - collection CLÉ-VALEUR  (put / get / putIfAbsent / has)  : ex. « entrees » (un billet = une clé, une seule entrée possible) ;
 *   - collection JOURNAL     (append / recent / count)        : ex. « scans » (un document par passage devant une borne).
 * Pourquoi pas du relationnel ici ? Écritures en rafale à l'entrée d'un stade, lecture par clé unique (le code du billet), documents
 * dont les champs varient (borne, résultat, appareil…), journal qui ne se modifie jamais, et copie facile vers un poste hors-ligne.
 *
 * Garanties : chaque écriture est ajoutée au fichier (fsync si `durable`) AVANT d'être visible en mémoire ; au redémarrage l'index est
 * reconstruit depuis le fichier ; une dernière ligne tronquée (coupure de courant) est ignorée ; les collections `immutable` refusent
 * toute modification/suppression. Processus unique (Node est mono-thread : putIfAbsent est atomique).
 * Remplaçable par MongoDB / Redis en gardant la même interface (voir BASES-DE-DONNEES.md).
 */
const fs = require('fs');
const path = require('path');

class Collection {
  constructor(dir, name, { kind = 'kv', durable = true, immutable = true, keep = 5000, rotateBytes = 32 * 1024 * 1024 } = {}) {
    this.name = name; this.kind = kind; this.durable = durable; this.immutable = immutable; this.keep = keep;
    this.file = path.join(dir, name + '.ndjson');
    this.map = new Map();          // clé -> document (collections clé-valeur)
    this.recentDocs = [];          // derniers documents (journaux), du plus ancien au plus récent
    this.total = 0; this.seq = 0; this.corrupt = 0;
    if (fs.existsSync(this.file) && fs.statSync(this.file).size > rotateBytes) {
      fs.renameSync(this.file, path.join(dir, `${name}.${new Date().toISOString().slice(0, 10)}.${Date.now()}.ndjson`));   // archivage : le fichier actif reste petit
    }
    this._load();
    this.fd = fs.openSync(this.file, 'a', 0o600);
  }
  _load() {
    if (!fs.existsSync(this.file)) return;
    for (const line of fs.readFileSync(this.file, 'utf8').split('\n')) {
      if (!line) continue;
      let r; try { r = JSON.parse(line); } catch (_) { this.corrupt++; continue; }
      this._apply(r);
    }
  }
  _apply(r) {
    if (r.k !== undefined) {
      if (r.del) { if (this.map.delete(r.k)) this.total--; }
      else { if (!this.map.has(r.k)) this.total++; this.map.set(r.k, r.d); }
    } else {
      this.total++; this.seq = Math.max(this.seq, r.id || 0);
      this.recentDocs.push({ id: r.id, ...r.d });
      if (this.recentDocs.length > this.keep * 1.2) this.recentDocs = this.recentDocs.slice(-this.keep);
    }
  }
  _write(r) {
    fs.writeSync(this.fd, JSON.stringify(r) + '\n');
    if (this.durable) fs.fsyncSync(this.fd);
  }
  // ---- clé-valeur
  get(key) { return this.map.get(String(key)); }
  has(key) { return this.map.has(String(key)); }
  _need(kind, op) { if (this.kind !== kind) throw new Error(`collection « ${this.name} » (${this.kind === 'log' ? 'journal' : 'clé-valeur'}) : opération « ${op} » non prévue`); }
  put(key, doc) {
    this._need('kv', 'put');
    if (this.immutable && this.map.has(String(key))) throw new Error(`collection « ${this.name} » en lecture seule : modification refusée`);
    const r = { k: String(key), t: Date.now(), d: doc }; this._write(r); this._apply(r); return doc;
  }
  /** Écrit seulement si la clé n'existe pas. Atomique. Renvoie { created, doc }. */
  putIfAbsent(key, doc) {
    const k = String(key);
    if (this.map.has(k)) return { created: false, doc: this.map.get(k) };
    this.put(k, doc); return { created: true, doc };
  }
  del(key) {
    this._need('kv', 'del');
    if (this.immutable) throw new Error(`collection « ${this.name} » en lecture seule : suppression refusée`);
    this._write({ k: String(key), del: 1, t: Date.now() }); this._apply({ k: String(key), del: 1 });
  }
  values() { return [...this.map.values()]; }
  // ---- journal
  append(doc) {
    this._need('log', 'append');
    const r = { id: this.seq + 1, t: Date.now(), d: doc }; this._write(r); this._apply(r); return { id: r.id, ...doc };
  }
  /** Les `limit` documents les plus récents (du plus récent au plus ancien) qui satisfont `filter`. */
  recent(limit = 100, filter = null) {
    const out = [];
    for (let i = this.recentDocs.length - 1; i >= 0 && out.length < limit; i--) if (!filter || filter(this.recentDocs[i])) out.push(this.recentDocs[i]);
    return out;
  }
  count() { return this.total; }
  size() { try { return fs.statSync(this.file).size; } catch (_) { return 0; } }
  close() { try { fs.closeSync(this.fd); } catch (_) {} }
}

class DocStore {
  constructor(dir) { this.dir = dir; fs.mkdirSync(dir, { recursive: true }); this.cols = {}; }
  collection(name, opts) { return this.cols[name] || (this.cols[name] = new Collection(this.dir, name, opts)); }
  /** Copie cohérente (les fichiers sont en ajout seul : une copie octet par octet est valable). */
  backupTo(destDir) {
    fs.mkdirSync(destDir, { recursive: true });
    for (const c of Object.values(this.cols)) fs.copyFileSync(c.file, path.join(destDir, path.basename(c.file)));
  }
  info() { return Object.values(this.cols).map(c => ({ collection: c.name, documents: c.count(), octets: c.size(), type: c.kind === 'log' ? 'journal' : 'clé-valeur', forme: c.immutable ? 'lecture seule (ajout seul)' : 'modifiable', durable: c.durable, lignes_ignorees: c.corrupt })); }
  close() { for (const c of Object.values(this.cols)) c.close(); }
}

module.exports = { DocStore };
