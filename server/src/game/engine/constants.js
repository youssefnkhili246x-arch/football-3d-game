// All distances in meters, times in seconds. Pitch: x = length (0..105), y = width (0..68).
// Home defends x = 0 and attacks toward x = 105. Away is the mirror image.

export const TICK_RATE = 30;
export const DT = 1 / TICK_RATE;
export const SNAPSHOT_EVERY = 2; // 15 snapshots per second

export const PITCH = {
  length: 105,
  width: 68,
  goalWidth: 7.32,
  penaltyDepth: 16.5,
  penaltyHalfWidth: 20.15,
};

export const PLAYER = {
  radius: 0.5,
  runSpeed: 6.2,
  sprintSpeed: 8.4,
  accel: 26,
  turnRate: 12, // rad/s
  carrySpeedFactor: 0.94, // slower while dribbling
  staminaDrain: 0.22, // per second while sprinting
  staminaRegen: 0.1,
  kickReach: 1.4, // max distance to kick the ball
  controlReach: 1.0, // pick up a free ball
  gkReach: 1.8,
  stealReach: 1.1,
  kickLock: 0.35, // can't re-take the ball right after kicking / losing it
  actionCooldown: 0.25,
  carryOffset: 0.75, // ball distance in front of the dribbler
};

export const BALL = {
  radius: 0.22,
  drag: 0.8, // speed *= exp(-drag * dt)
  bounce: 0.65,
  pickupMaxSpeed: 14, // faster balls are blocked, not controlled
  shotMin: 12,
  shotMax: 30,
  passMin: 9,
  passMax: 24,
  passArrival: 6, // speed a pass should arrive with
  gkCatchBase: 15,
  gkCatchPerSkill: 2,
};

export const MATCH = {
  durationSeconds: 300, // real seconds, shown as 90 game minutes
  firstKickoff: 3,
  afterGoalKickoff: 2,
  goalPause: 3,
};

// ---------- geometry helpers (side = "home" | "away") ----------
export const ownGoalX = (side) => (side === "home" ? 0 : PITCH.length);
export const oppGoalX = (side) => (side === "home" ? PITCH.length : 0);
// distance advanced from own goal line toward the opponent goal
export const progress = (side, x) => (side === "home" ? x : PITCH.length - x);
