// Refactored: functional style.
const sum = (values) => values.reduce((a, v) => a + v);

const roundCents = (amount) => Math.floor(amount * 100) / 100;

module.exports = { sum, roundCents };
