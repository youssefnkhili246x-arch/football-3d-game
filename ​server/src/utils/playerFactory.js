import { randomInt } from "node:crypto";

export const ATTRS = ["pace", "shooting", "passing", "dribbling", "defending", "physical"];
export const POSITIONS = ["GK", "CB", "LB", "RB", "CDM", "CM", "CAM", "LW", "RW", "ST"];

// how much each attribute counts in the overall of a position (each row sums to 1)
const WEIGHTS = {
  GK: { pace: 0.1, shooting: 0, passing: 0.2, dribbling: 0, defending: 0.5, physical: 0.2 },
  CB: { pace: 0.1, shooting: 0.02, passing: 0.1, dribbling: 0.05, defending: 0.5, physical: 0.23 },
  LB: { pace: 0.2, shooting: 0.03, passing: 0.15, dribbling: 0.12, defending: 0.35, physical: 0.15 },
  RB: { pace: 0.2, shooting: 0.03, passing: 0.15, dribbling: 0.12, defending: 0.35, physical: 0.15 },
  CDM: { pace: 0.08, shooting: 0.07, passing: 0.25, dribbling: 0.1, defending: 0.35, physical: 0.15 },
  CM: { pace: 0.1, shooting: 0.12, passing: 0.3, dribbling: 0.2, defending: 0.15, physical: 0.13 },
  CAM: { pace: 0.1, shooting: 0.2, passing: 0.3, dribbling: 0.28, defending: 0.02, physical: 0.1 },
  LW: { pace: 0.25, shooting: 0.2, passing: 0.15, dribbling: 0.3, defending: 0.02, physical: 0.08 },
  RW: { pace: 0.25, shooting: 0.2, passing: 0.15, dribbling: 0.3, defending: 0.02, physical: 0.08 },
  ST: { pace: 0.2, shooting: 0.38, passing: 0.07, dribbling: 0.2, defending: 0.02, physical: 0.13 },
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const rnd = (min, max) => randomInt(min, max + 1); // inclusive
const pick = (list) => list[randomInt(0, list.length)];
const cap = (s) => s[0].toUpperCase() + s.slice(1);

// ---------- card maths (used by training, market value and generation) ----------
export function computeOverall(position, attrs) {
  const w = WEIGHTS[position];
  let sum = 0;
  for (const a of ATTRS) sum += w[a] * attrs[a];
  return clamp(Math.round(sum), 1, 99);
}

export function ageOf(birthDate) {
  const b = new Date(birthDate);
  const n = new Date();
  let age = n.getUTCFullYear() - b.getUTCFullYear();
  const m = n.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && n.getUTCDate() < b.getUTCDate())) age--;
  return age;
}

export function marketValue({ overall, potential, age }) {
  const base = 30000 * Math.pow(1.17, overall - 40);
  const ageFactor = age <= 21 ? 1.25 : age <= 25 ? 1.1 : age <= 29 ? 1 : age <= 32 ? 0.75 : 0.5;
  const potentialFactor = 1 + Math.max(0, potential - overall) * 0.012;
  return Math.max(10000, Math.round((base * ageFactor * potentialFactor) / 1000) * 1000);
}

// same rule as salary_floor() in the SQL schema
export const salaryFloor = (value) => Math.max(1000, Math.floor(value / 1000));

export const trainingCost = (overall) => overall * overall * 40;

// ---------- generation ----------
const SYLLABLES = ["ka", "ri", "mo", "sa", "len", "dor", "vik", "tan", "el", "ur", "be", "ni", "zar", "fo", "ja", "lu", "ma", "ten", "gor", "al"];
const LAST_START = ["mor", "kal", "ven", "dru", "sel", "bar", "tol", "nor", "fen", "gal", "hal", "ost"];
const LAST_END = ["avich", "ini", "oros", "berg", "ley", "ando", "strom", "ucci", "ides", "enko", "ard", "ovic"];

export const randomName = () => `${cap(pick(SYLLABLES) + pick(SYLLABLES))} ${cap(pick(LAST_START) + pick(LAST_END))}`;

function birthDateFor(age) {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - age);
  d.setUTCDate(d.getUTCDate() - rnd(0, 364));
  return d.toISOString().slice(0, 10);
}

export function generatePlayer({ position, overall, minAge = 18, maxAge = 34, countryIds = [] }) {
  const age = rnd(minAge, maxAge);
  const w = WEIGHTS[position];
  const attrs = {};
  for (const a of ATTRS) attrs[a] = clamp(Math.round(overall + (w[a] - 0.17) * 60 + rnd(-6, 6)), 20, 99);

  // shift all attributes so that the computed overall matches the target
  for (let k = 0; k < 3; k++) {
    const delta = overall - computeOverall(position, attrs);
    if (delta === 0) break;
    for (const a of ATTRS) attrs[a] = clamp(attrs[a] + delta, 20, 99);
  }

  const finalOverall = computeOverall(position, attrs);
  const bonus = age <= 23 ? rnd(2, 14) : age <= 29 ? rnd(0, 4) : 0;
  const potential = clamp(finalOverall + bonus, finalOverall, 99);
  const value = marketValue({ overall: finalOverall, potential, age });

  return {
    name: randomName(),
    country_id: countryIds.length > 0 ? pick(countryIds) : null,
    birth_date: birthDateFor(age),
    position,
    overall: finalOverall,
    potential,
    market_value: value,
    attributes: attrs,
    weekly_salary: salaryFloor(value),
  };
}

// 18 players: first 11 are the likely starters of a 4-3-3
const STARTER_POSITIONS = ["GK", "LB", "CB", "CB", "RB", "CM", "CM", "CDM", "LW", "RW", "ST"];
const BENCH_POSITIONS = ["GK", "CB", "CM", "CAM", "ST", "LW", "RB"];

export function generateStarterSquad(countryIds) {
  const starters = STARTER_POSITIONS.map((position) =>
    generatePlayer({ position, overall: rnd(58, 68), countryIds }));
  const bench = BENCH_POSITIONS.map((position) =>
    generatePlayer({ position, overall: rnd(50, 60), countryIds }));
  return [...starters, ...bench];
}

export function generateFreeAgents(count, countryIds) {
  return Array.from({ length: count }, () =>
    generatePlayer({ position: pick(POSITIONS), overall: rnd(45, 72), countryIds }));
}
