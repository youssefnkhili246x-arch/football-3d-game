// u = distance from own goal as a fraction of pitch length (0 = own goal, 1 = opponent goal)
// v = position across the pitch (0..1)
// shift = how much the line follows the ball up and down the pitch
const LINES = {
  F: { kickoffU: 0.46, baseU: 0.74, shift: 0.9 },
  M: { kickoffU: 0.35, baseU: 0.52, shift: 0.65 },
  D: { kickoffU: 0.2, baseU: 0.28, shift: 0.4 },
  GK: { kickoffU: 0.04, baseU: 0.04, shift: 0 },
};

// Slot order matters: forwards first, goalkeeper LAST, so the first human
// players to join a team become attackers and bots fill defense and goal.
// Teams smaller than 3 have no goalkeeper.
export function buildFormation(teamSize) {
  const hasGk = teamSize >= 3;
  const outfield = hasGk ? teamSize - 1 : teamSize;
  const nF = Math.max(1, Math.round(outfield * 0.2));
  const nM = Math.min(outfield - nF, Math.round(outfield * 0.4));
  const nD = outfield - nF - nM;

  const result = [];
  for (const [role, count] of [["F", nF], ["M", nM], ["D", nD]]) {
    for (let k = 0; k < count; k++) {
      result.push({ role, ...LINES[role], v: (k + 1) / (count + 1) });
    }
  }
  if (hasGk) result.push({ role: "GK", ...LINES.GK, v: 0.5 });
  return result;
}
