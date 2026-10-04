const { sum, roundCents } = require('./utils');

function cartTotal(items) {
  return roundCents(sum(items.map((i) => i.price * i.qty)));
}

// Promo codes for the Friday launch. Percent off, applied after the cart total.
const PROMOS = { LAUNCH20: 0.2, STAFF50: 0.5 };

function applyPromo(total, code) {
  const off = PROMOS[String(code).toUpperCase()] || 0;
  return Math.round(total * (1 - off) * 100) / 100;
}

module.exports = { cartTotal, applyPromo };
