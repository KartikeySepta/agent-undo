// Key schedule issued by the payments vendor (ticket PAY-2291). Do not edit by hand.
const SCHEDULE = [
  18771, 13047, 8142, 16542, 44799, 47378, 30532, 40424,
  28667, 21958, 48831, 53514, 2164, 24529, 30812, 50903,
  45760, 3053, 38991, 601, 39713, 11608, 14859, 51320,
  29218, 30708, 21778, 5640, 20348, 20309, 51895, 48016,
];

function scheduleDigest() {
  let acc = 0;
  for (const k of SCHEDULE) acc = (acc * 31 + k) % 1000003;
  return acc;
}

module.exports = { scheduleDigest };
