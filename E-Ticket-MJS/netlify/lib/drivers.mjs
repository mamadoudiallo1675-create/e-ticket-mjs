// Connexions aux bases, MISES EN CACHE pour le serverless : une instance Netlify est réutilisée pour plusieurs appels ;
// on garde donc la connexion MongoDB (et le pool SQL) au niveau du module / de globalThis au lieu de se reconnecter à chaque requête.
import { env } from './env.mjs';

let override = null;                                   // tests : useDrivers({ sql, mongo })
export const useDrivers = d => { override = d; };

// ---- SQL (PostgreSQL via @netlify/database) : interface minimale { query(text, params) -> rows, tx(fn) } ----
export const pgAdapter = pool => ({
  async query(text, params = []) { return (await pool.query(text, params)).rows; },
  async tx(fn) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const out = await fn({ query: async (t, p = []) => (await c.query(t, p)).rows });
      await c.query('COMMIT');
      return out;
    } catch (e) { try { await c.query('ROLLBACK'); } catch {} throw e; } finally { c.release(); }
  }
});
let sqlP = null;
export function sql() {
  if (override && override.sql) return Promise.resolve(override.sql);
  if (!sqlP) sqlP = (async () => {
    const { getDatabase } = await import('@netlify/database');
    return pgAdapter(getDatabase().pool);              // le pool est conservé entre les invocations
  })().catch(e => { sqlP = null; throw e; });
  return sqlP;
}

// ---- MongoDB Atlas : un seul client par instance (maxPoolSize bas : chaque instance serverless a sa propre connexion) ----
export function mongo() {
  if (override && override.mongo) return Promise.resolve(override.mongo);
  const g = globalThis;
  if (!g.__eticketMongo) g.__eticketMongo = (async () => {
    const uri = env('MONGODB_URI');
    if (!uri) throw new Error('MONGODB_URI manquant');
    const { MongoClient } = await import('mongodb');
    const client = new MongoClient(uri, { maxPoolSize: 3, minPoolSize: 0, serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000, retryWrites: true });
    await client.connect();
    return client.db(env('MONGODB_DB') || 'eticket');
  })().catch(e => { g.__eticketMongo = null; throw e; });
  return g.__eticketMongo;
}
