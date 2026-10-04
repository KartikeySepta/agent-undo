const { sum, roundCents } = require('./utils');

function cartTotal(items) {
  return roundCents(sum(items.map((i) => i.price * i.qty)));
}

module.exports = { cartTotal };
