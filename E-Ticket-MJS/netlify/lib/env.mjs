// Lecture des variables d'environnement : Netlify.env en production, process.env en local et dans les tests.
export const env = k => String((globalThis.Netlify && globalThis.Netlify.env && globalThis.Netlify.env.get(k)) ?? process.env[k] ?? '').trim();
export const siteUrl = () => (env('SITE_URL') || env('URL') || 'http://localhost:8888').replace(/\/$/, '');
