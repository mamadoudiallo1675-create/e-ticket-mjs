import crypto from 'node:crypto';
export const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
export const html = (body, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
export const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const iso = (t = Date.now()) => new Date(t).toISOString();
export const normPhone = v => { let d = String(v || '').replace(/[\s.\-()]/g, ''); d = d.replace(/^\+?223/, '').replace(/^00223/, ''); return /^[67]\d{7}$|^\d{8}$/.test(d) ? d : null; };
export const newTransacId = () => 'ET' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(4).toString('hex').toUpperCase();   // alphanumérique, unique
export const TRANSAC_RE = /^ET[A-Z0-9]{8,30}$/;
export const newToken = () => crypto.randomBytes(24).toString('base64url');          // 192 bits ; 32 car. : tient dans le QR (42 octets max)
export const newShort = () => crypto.randomBytes(7).toString('base64url');           // lien court : /b/<10 car.>
export const safeEqual = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
export async function readParams(req) {                 // CinetPay notifie en formulaire (x-www-form-urlencoded) ; on accepte aussi le JSON
  const ct = req.headers.get('content-type') || '';
  const raw = await req.text();
  if (ct.includes('json')) { try { return JSON.parse(raw); } catch { return {}; } }
  return Object.fromEntries(new URLSearchParams(raw));
}
