// How many guards run at once. Half the cores put sixteen guards on a 32-core
// box for every audit and every landing at the same moment, which made the
// guards the largest CPU user on a shared machine. A fixed 4 matches Jest's
// default in config/jest.config.js, for the same reason: on a contended box
// more workers measured slower. An idle machine or CI sets GUARD_WORKERS.
export function guardWorkers(env = process.env) {
  const value = Number(env.GUARD_WORKERS);
  return Number.isInteger(value) && value > 0 ? value : 4;
}
