import { createDateSeededRandom } from './random';

export type TrainingPhase =
  | 'offseason'
  | 'base'
  | 'build1'
  | 'illness'
  | 'recovery'
  | 'build2'
  | 'peak'
  | 'taper'
  | 'race'
  | 'activeRecovery'
  | 'normal';

export interface TrainingDayContext {
  phase: TrainingPhase;
  volumeMultiplier: number;
  intensityMultiplier: number;
  restDayProbability: number;
  hardSessionProbability: number;
  doubleDayProbability: number;
  targetCTL: number;
  ftpWatts: number;
  runPaceMs: number;
  formFactor: number;
  isIllness: boolean;
  isLifeGap: boolean;
}

interface PhaseDefinition {
  phase: TrainingPhase;
  startDaysAgo: number;
  endDaysAgo: number;
  ftpStart: number;
  ftpEnd: number;
  runPaceStart: number;
  runPaceEnd: number;
  targetCTLStart: number;
  targetCTLEnd: number;
  volume: number;
  intensity: number;
  restProb: number;
  hardProb: number;
  doubleProb: number;
}

const PHASES: PhaseDefinition[] = [
  {
    phase: 'offseason',
    startDaysAgo: 365,
    endDaysAgo: 331,
    ftpStart: 232,
    ftpEnd: 235,
    runPaceStart: 2.35,
    runPaceEnd: 2.4,
    targetCTLStart: 30,
    targetCTLEnd: 32,
    volume: 0.6,
    intensity: 0.5,
    restProb: 0.35,
    hardProb: 0.05,
    doubleProb: 0.0,
  },
  {
    phase: 'base',
    startDaysAgo: 330,
    endDaysAgo: 275,
    ftpStart: 235,
    ftpEnd: 243,
    runPaceStart: 2.4,
    runPaceEnd: 2.5,
    targetCTLStart: 32,
    targetCTLEnd: 45,
    volume: 0.9,
    intensity: 0.6,
    restProb: 0.2,
    hardProb: 0.1,
    doubleProb: 0.03,
  },
  {
    phase: 'build1',
    startDaysAgo: 274,
    endDaysAgo: 219,
    ftpStart: 243,
    ftpEnd: 255,
    runPaceStart: 2.5,
    runPaceEnd: 2.65,
    targetCTLStart: 45,
    targetCTLEnd: 55,
    volume: 1.0,
    intensity: 0.85,
    restProb: 0.15,
    hardProb: 0.3,
    doubleProb: 0.08,
  },
  {
    phase: 'illness',
    startDaysAgo: 218,
    endDaysAgo: 205,
    ftpStart: 255,
    ftpEnd: 252,
    runPaceStart: 2.65,
    runPaceEnd: 2.55,
    targetCTLStart: 55,
    targetCTLEnd: 42,
    volume: 0.15,
    intensity: 0.3,
    restProb: 0.85,
    hardProb: 0.0,
    doubleProb: 0.0,
  },
  {
    phase: 'recovery',
    startDaysAgo: 204,
    endDaysAgo: 163,
    ftpStart: 248,
    ftpEnd: 252,
    runPaceStart: 2.5,
    runPaceEnd: 2.58,
    targetCTLStart: 38,
    targetCTLEnd: 48,
    volume: 0.7,
    intensity: 0.55,
    restProb: 0.25,
    hardProb: 0.1,
    doubleProb: 0.02,
  },
  {
    phase: 'build2',
    startDaysAgo: 162,
    endDaysAgo: 107,
    ftpStart: 252,
    ftpEnd: 263,
    runPaceStart: 2.58,
    runPaceEnd: 2.75,
    targetCTLStart: 48,
    targetCTLEnd: 62,
    volume: 1.1,
    intensity: 0.95,
    restProb: 0.12,
    hardProb: 0.35,
    doubleProb: 0.1,
  },
  {
    phase: 'peak',
    startDaysAgo: 106,
    endDaysAgo: 79,
    ftpStart: 263,
    ftpEnd: 266,
    runPaceStart: 2.75,
    runPaceEnd: 2.8,
    targetCTLStart: 62,
    targetCTLEnd: 64,
    volume: 1.15,
    intensity: 1.0,
    restProb: 0.12,
    hardProb: 0.4,
    doubleProb: 0.1,
  },
  {
    phase: 'taper',
    startDaysAgo: 78,
    endDaysAgo: 65,
    ftpStart: 266,
    ftpEnd: 266,
    runPaceStart: 2.8,
    runPaceEnd: 2.82,
    targetCTLStart: 64,
    targetCTLEnd: 58,
    volume: 0.65,
    intensity: 0.9,
    restProb: 0.3,
    hardProb: 0.25,
    doubleProb: 0.0,
  },
  {
    phase: 'race',
    startDaysAgo: 64,
    endDaysAgo: 51,
    ftpStart: 266,
    ftpEnd: 265,
    runPaceStart: 2.82,
    runPaceEnd: 2.82,
    targetCTLStart: 58,
    targetCTLEnd: 52,
    volume: 0.8,
    intensity: 1.1,
    restProb: 0.25,
    hardProb: 0.45,
    doubleProb: 0.05,
  },
  {
    phase: 'activeRecovery',
    startDaysAgo: 50,
    endDaysAgo: 29,
    ftpStart: 262,
    ftpEnd: 258,
    runPaceStart: 2.78,
    runPaceEnd: 2.72,
    targetCTLStart: 52,
    targetCTLEnd: 42,
    volume: 0.55,
    intensity: 0.45,
    restProb: 0.35,
    hardProb: 0.05,
    doubleProb: 0.0,
  },
  {
    phase: 'normal',
    startDaysAgo: 28,
    endDaysAgo: 0,
    ftpStart: 258,
    ftpEnd: 258,
    runPaceStart: 2.72,
    runPaceEnd: 2.72,
    targetCTLStart: 42,
    targetCTLEnd: 45,
    volume: 0.85,
    intensity: 0.7,
    restProb: 0.2,
    hardProb: 0.2,
    doubleProb: 0.05,
  },
];

const LIFE_GAP_SEEDS = [295, 148, 52];
const LIFE_GAP_DURATION = 3;

function isInLifeGap(daysAgo: number): boolean {
  for (const gapStart of LIFE_GAP_SEEDS) {
    if (daysAgo <= gapStart && daysAgo >= gapStart - LIFE_GAP_DURATION) return true;
  }
  return false;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function normalRandom(rng: () => number, mean: number, stddev: number): number {
  const u1 = rng();
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(Math.max(u1, 1e-10))) * Math.cos(2 * Math.PI * u2);
  return mean + z * stddev;
}

function getPhase(daysAgo: number): PhaseDefinition {
  for (const p of PHASES) {
    if (daysAgo >= p.endDaysAgo && daysAgo <= p.startDaysAgo) return p;
  }
  return PHASES[PHASES.length - 1];
}

export function getTrainingDay(daysAgo: number, dateStr: string): TrainingDayContext {
  const phase = getPhase(daysAgo);
  const span = phase.startDaysAgo - phase.endDaysAgo;
  const progress = span > 0 ? (phase.startDaysAgo - daysAgo) / span : 1;

  const rng = createDateSeededRandom(dateStr + '-periodization');

  const ftpWatts = Math.round(lerp(phase.ftpStart, phase.ftpEnd, progress));
  const runPaceMs = lerp(phase.runPaceStart, phase.runPaceEnd, progress);
  const targetCTL = lerp(phase.targetCTLStart, phase.targetCTLEnd, progress);

  const isIllnessPhase = phase.phase === 'illness';
  const lifeGap = isInLifeGap(daysAgo);

  const rawForm = isIllnessPhase ? lerp(0.4, 0.65, progress) : normalRandom(rng, 1.0, 0.08);
  const formFactor = Math.max(0.5, Math.min(1.25, rawForm));

  return {
    phase: phase.phase,
    volumeMultiplier: lifeGap ? 0 : phase.volume,
    intensityMultiplier: phase.intensity,
    restDayProbability: lifeGap ? 1.0 : phase.restProb,
    hardSessionProbability: phase.hardProb,
    doubleDayProbability: phase.doubleProb,
    targetCTL,
    ftpWatts,
    runPaceMs,
    formFactor,
    isIllness: isIllnessPhase,
    isLifeGap: lifeGap,
  };
}
