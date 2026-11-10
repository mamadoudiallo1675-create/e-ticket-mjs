'use strict';
// Chaque fournisseur expose :
//   enabled()                      -> bool
//   initiate(order, urls)          -> { providerRef, notifToken, payUrl }
//   checkStatus(order)             -> 'SUCCESS' | 'PENDING' | 'FAILED' | 'EXPIRED'
// Le mode (mock | live) se règle par opérateur : PROVIDER_ORANGE, PROVIDER_MOOV.

const mock = require('./mock');
const orange = require('./orange');
const moov = require('./moov');
const cinetpay = require('./cinetpay');

const OPERATORS = {
  cinetpay: { nom: 'Mobile Money (Orange, Moov, Wave, Sama Money) via CinetPay', court: 'CinetPay', live: cinetpay },
  orange: { nom: 'Orange Money (direct)', court: 'Orange Money', live: orange },
  moov: { nom: 'Moov Money (direct)', court: 'Moov Money', live: moov }
};

function modeOf(id) {
  const m = (process.env['PROVIDER_' + id.toUpperCase()] || (process.env.NODE_ENV === 'production' ? 'off' : 'mock')).toLowerCase();
  if (m === 'mock' && process.env.NODE_ENV === 'production' && process.env.ALLOW_MOCK !== '1') return 'disabled';
  return m;
}

// CinetPay (guichet unique Orange Money, Moov, Wave, Sama Money) est proposé aux utilisateurs avec Orange et Moov en direct.
// ENABLE_CINETPAY=0 permet de le masquer sans toucher au code.
const offered = id => id !== 'cinetpay' || process.env.ENABLE_CINETPAY !== '0';

function get(id) {
  if (!OPERATORS[id] || !offered(id)) return null;
  const mode = modeOf(id);
  if (mode === 'mock') return mock;
  if (mode === 'live') return OPERATORS[id].live;
  return null;
}

function list() {
  return Object.entries(OPERATORS).filter(([id]) => offered(id)).map(([id, o]) => {
    const mode = modeOf(id), p = get(id);
    return { id, nom: o.nom, court: o.court, mode, enabled: !!p && p.enabled() };
  });
}

module.exports = { get, list, modeOf };
