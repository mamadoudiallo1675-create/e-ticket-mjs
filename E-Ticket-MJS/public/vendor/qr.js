'use strict';
/* Générateur de QR code autonome (aucune dépendance, aucun réseau).
 * Mode octets, correction d'erreur M, versions 1 à 3 : jusqu'à 42 octets, largement assez pour un code de billet (17 caractères).
 * API : QR.matrix(texte) -> tableau 2D de booléens ; QR.svg(texte, {size, quiet}) -> chaîne SVG (noir sur blanc, quel que soit le thème). */
(function (root) {
  const EXP = new Array(512), LOG = new Array(256);
  (function () { let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; })();
  const mul = (a, b) => (a && b) ? EXP[LOG[a] + LOG[b]] : 0;
  function rsGen(deg) {
    let g = [1];
    for (let i = 0; i < deg; i++) { const n = new Array(g.length + 1).fill(0); for (let j = 0; j < g.length; j++) { n[j] ^= g[j]; n[j + 1] ^= mul(g[j], EXP[i]); } g = n; }
    return g;
  }
  function rsRem(data, deg) {
    const gen = rsGen(deg), res = new Array(deg).fill(0);
    for (const b of data) { const f = b ^ res.shift(); res.push(0); if (f) for (let i = 0; i < deg; i++) res[i] ^= mul(gen[i + 1], f); }
    return res;
  }
  // Niveau M, un seul bloc : mots de données / mots de correction
  const VER = { 1: { data: 16, ec: 10 }, 2: { data: 28, ec: 16 }, 3: { data: 44, ec: 26 } };

  function utf8(s) {
    if (typeof TextEncoder !== 'undefined') return Array.from(new TextEncoder().encode(s));
    return Array.from(Buffer.from(s, 'utf8'));
  }
  function codewords(bytes, v) {
    const cap = VER[v].data, bits = [];
    const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    push(4, 4); push(bytes.length, 8); bytes.forEach(b => push(b, 8));
    for (let i = 0; i < 4 && bits.length < cap * 8; i++) bits.push(0);
    while (bits.length % 8) bits.push(0);
    const out = [];
    for (let i = 0; i < bits.length; i += 8) { let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]; out.push(b); }
    for (let pad = 0xEC; out.length < cap; pad ^= 0xEC ^ 0x11) out.push(pad);
    return out.concat(rsRem(out, VER[v].ec));
  }
  const MASKS = [
    (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x, y) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
    (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0, (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0
  ];
  function build(v, cw, mask) {
    const size = 17 + 4 * v;
    const m = Array.from({ length: size }, () => new Array(size).fill(false));
    const f = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (x, y, d) => { m[y][x] = d; f[y][x] = true; };
    for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    const finder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy; if (x < 0 || x >= size || y < 0 || y >= size) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy)); set(x, y, d !== 2 && d !== 4);
      }
    };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    if (v >= 2) { const c = 4 * v + 10; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(c + dx, c + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1); }
    const format = mk => {
      const data = (0 << 3) | mk; let rem = data;               // niveau M = 00
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const bits = ((data << 10) | rem) ^ 0x5412, bit = i => ((bits >>> i) & 1) !== 0;
      for (let i = 0; i <= 5; i++) set(8, i, bit(i));
      set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
      for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
      for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
      for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
      set(8, size - 8, true);
    };
    format(0);
    let i = 0; const total = cw.length * 8;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
        const x = right - j, upward = ((right + 1) & 2) === 0, y = upward ? size - 1 - vert : vert;
        if (!f[y][x] && i < total) { m[y][x] = ((cw[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0; i++; }
      }
    }
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!f[y][x] && MASKS[mask](x, y)) m[y][x] = !m[y][x];
    format(mask);
    return m;
  }
  function penalty(m) {
    const n = m.length; let p = 0, dark = 0;
    const lines = [];
    for (let y = 0; y < n; y++) lines.push(m[y].map(Number));
    for (let x = 0; x < n; x++) lines.push(m.map(r => Number(r[x])));
    for (const l of lines) {
      let run = 1;
      for (let i = 1; i <= n; i++) { if (i < n && l[i] === l[i - 1]) run++; else { if (run >= 5) p += 3 + run - 5; run = 1; } }
      const s = l.join('');
      for (const pat of ['10111010000', '00001011101']) { let k = -1; while ((k = s.indexOf(pat, k + 1)) !== -1) p += 40; }
    }
    for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) { const c = m[y][x]; if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3; }
    for (const r of m) for (const c of r) if (c) dark++;
    p += 10 * (Math.ceil(Math.abs(dark * 20 / (n * n) - 10)) - 1);
    return p;
  }
  function matrix(text, forced) {
    const bytes = utf8(String(text));
    let v = 0;
    for (const k of [1, 2, 3]) if (bytes.length <= VER[k].data - 2) { v = k; break; }
    if (!v) throw new Error('Texte trop long pour ce générateur de QR (42 octets maximum)');
    const cw = codewords(bytes, v);
    // Le masque 1 (rayures horizontales) est écarté : certains détecteurs le repèrent mal.
    let best = null, bestP = Infinity;
    for (let mk = 0; mk < 8; mk++) { if (forced != null ? mk !== forced : mk === 1) continue; const m = build(v, cw, mk), p = penalty(m); if (p < bestP) { bestP = p; best = m; } }
    return best;
  }
  function svg(text, opts) {
    opts = opts || {};
    const m = matrix(text), n = m.length, q = opts.quiet == null ? 4 : opts.quiet, size = opts.size || 160;
    let d = '';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (m[y][x]) d += `M${x + q} ${y + q}h1v1h-1z`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + 2 * q} ${n + 2 * q}" width="${size}" height="${size}" shape-rendering="crispEdges" role="img" aria-label="QR code du billet"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  }
  const QR = { matrix, svg };
  if (typeof module !== 'undefined' && module.exports) module.exports = QR; else root.QR = QR;
})(typeof window !== 'undefined' ? window : this);
