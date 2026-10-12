import { PITCH, oppGoalX, ownGoalX, progress } from "./constants.js";

// Bot AI. Each tick a bot picks a movement goal (goalX/goalY) and may queue an action.
// skill 1..5 controls shooting accuracy, shooting range and decision speed.

const L = PITCH.length;
const W = PITCH.width;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const decisionInterval = (skill) => 0.55 - 0.06 * skill;

function nearestOpponent(world, side, x, y) {
  let best = null;
  for (const q of world.players) {
    if (q.side === side) continue;
    const d = Math.hypot(q.x - x, q.y - y);
    if (!best || d < best.d) best = { d, x: q.x, y: q.y };
  }
  return best;
}

function bestPassTarget(world, p) {
  const myProgress = progress(p.side, p.x);
  let best = -1;
  let bestScore = -Infinity;
  for (const q of world.players) {
    if (q.side !== p.side || q.i === p.i || q.role === "GK") continue;
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < 5 || d > 38) continue;
    const gain = progress(q.side, q.x) - myProgress;
    if (gain < -6) continue; // no long back-passes
    const opp = nearestOpponent(world, p.side, q.x, q.y);
    if (opp && opp.d < 3) continue; // target is marked
    const score = gain - d * 0.25;
    if (score > bestScore) {
      bestScore = score;
      best = q.i;
    }
  }
  return best;
}

function shootAtGoal(world, p, skill) {
  const gx = oppGoalX(p.side);
  const gk = world.players.find((q) => q.side !== p.side && q.role === "GK");
  // aim at the corner away from the goalkeeper
  const sign = gk ? (gk.y >= W / 2 ? -1 : 1) : world.rng() < 0.5 ? -1 : 1;
  const ty = W / 2 + sign * (PITCH.goalWidth / 2 - 0.9);
  let angle = Math.atan2(ty - p.y, gx - p.x);
  angle += (world.rng() + world.rng() - 1) * (0.3 - 0.045 * skill);
  world.queueAction(p.i, {
    type: "shoot",
    power: 0.75 + world.rng() * 0.25,
    aimX: Math.cos(angle),
    aimY: Math.sin(angle),
  });
}

function withBall(world, p, skill, dt) {
  const gx = oppGoalX(p.side);
  const press = nearestOpponent(world, p.side, p.x, p.y);

  // dribble toward goal, sidestepping a close opponent
  let ty = W / 2;
  if (press && press.d < 7) ty = p.y + (p.y >= press.y ? 1 : -1) * 8;
  p.goalX = gx;
  p.goalY = clamp(ty, 3, W - 3);
  p.wantSprint = !press || press.d > 5;

  p.botTimer -= dt;
  if (p.botTimer > 0) return;
  p.botTimer = decisionInterval(skill) + world.rng() * 0.1;

  const dGoal = Math.hypot(gx - p.x, W / 2 - p.y);
  const inRange = dGoal <= 16 + 2 * skill && Math.abs(p.y - W / 2) < 20;
  if (inRange && world.rng() < 0.85) {
    shootAtGoal(world, p, skill);
    return;
  }
  if ((press && press.d < 3.2) || world.rng() < 0.3) {
    const target = bestPassTarget(world, p);
    if (target !== -1) world.queueAction(p.i, { type: "pass", target });
  }
}

function anchorOf(world, p, attacking) {
  const b = world.ball;
  const ballU = progress(p.side, b.x) / L;
  let u = p.f.baseU + (ballU - 0.5) * p.f.shift + (attacking && p.role === "F" ? 0.08 : 0);
  u = clamp(u, 0.06, 0.94);
  const baseY = p.side === "home" ? p.f.v * W : (1 - p.f.v) * W;
  return {
    x: p.side === "home" ? u * L : (1 - u) * L,
    y: clamp(baseY + (b.y - W / 2) * 0.3, 2, W - 2),
  };
}

function withoutBall(world, p) {
  const b = world.ball;
  const owner = b.owner === -1 ? null : world.players[b.owner];
  const teamHasBall = owner !== null && owner.side === p.side;

  if (!teamHasBall && world.chaser[p.side] === p.i) {
    p.goalX = b.x + b.vx * 0.3;
    p.goalY = b.y + b.vy * 0.3;
    p.wantSprint = true;
    return;
  }
  const a = anchorOf(world, p, teamHasBall);
  p.goalX = a.x;
  p.goalY = a.y;
  p.wantSprint = Math.hypot(a.x - p.x, a.y - p.y) > 12;
}

function goalkeeper(world, p, skill, dt) {
  const b = world.ball;
  const dirIn = p.side === "home" ? 1 : -1;

  if (b.owner === p.i) {
    // holding the ball: wait a moment, then distribute
    p.goalX = p.x;
    p.goalY = p.y;
    p.wantSprint = false;
    p.holdTimer += dt;
    if (p.holdTimer > 1) {
      p.holdTimer = 0;
      const target = bestPassTarget(world, p);
      if (target !== -1) world.queueAction(p.i, { type: "pass", target });
      else world.queueAction(p.i, { type: "shoot", power: 0.5, aimX: dirIn, aimY: 0 });
    }
    return;
  }
  p.holdTimer = 0;

  const fromGoal = progress(p.side, b.x);
  const speed = Math.hypot(b.vx, b.vy);
  const inBox = fromGoal < PITCH.penaltyDepth + 2 && Math.abs(b.y - W / 2) < PITCH.penaltyHalfWidth;
  const close = Math.hypot(b.x - p.x, b.y - p.y) < 12;

  if (inBox && b.owner === -1 && speed < 10 && close) {
    p.goalX = b.x;
    p.goalY = b.y;
    p.wantSprint = true;
    return;
  }
  // stand on the line, move out a little as the ball comes closer
  const out = clamp((22 - fromGoal) * 0.18, 0, 4);
  p.goalX = ownGoalX(p.side) + dirIn * (2 + out);
  p.goalY = clamp(b.y, W / 2 - 4.5, W / 2 + 4.5);
  p.wantSprint = false;
}

function steer(p) {
  const dx = p.goalX - p.x;
  const dy = p.goalY - p.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.35) {
    p.input.dx = 0;
    p.input.dy = 0;
    p.input.sprint = false;
    return;
  }
  const mag = Math.min(1, d / 2.5); // ease in when arriving
  p.input.dx = (dx / d) * mag;
  p.input.dy = (dy / d) * mag;
  p.input.sprint = p.wantSprint;
}

export function updateBot(world, p, dt) {
  const skill = world.skill[p.side];
  if (p.role === "GK") goalkeeper(world, p, skill, dt);
  else if (world.ball.owner === p.i) withBall(world, p, skill, dt);
  else withoutBall(world, p);
  steer(p);
}
