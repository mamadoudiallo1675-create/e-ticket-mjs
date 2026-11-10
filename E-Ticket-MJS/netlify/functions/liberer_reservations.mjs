// Tâche planifiée : libère les places réservées dont le paiement n'est jamais arrivé (délai dépassé).
// Cron en UTC : toutes les 10 minutes (le fuseau n'a aucune importance ici).
import { expirer } from '../lib/paiement.mjs';
export default async () => { const n = await expirer(); console.log('[liberer_reservations]', n, 'réservation(s) libérée(s)'); };
export const config = { schedule: '*/10 * * * *' };
