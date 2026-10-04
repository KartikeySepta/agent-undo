function sum(values) {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

function roundCents(amount) {
  return Math.round(amount * 100) / 100;
}

module.exports = { sum, roundCents };
