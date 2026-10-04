const formatDate = require('../vendor/legacy-date');

function dueLabel(date) {
  return 'Due ' + formatDate(date);
}

module.exports = { dueLabel };
