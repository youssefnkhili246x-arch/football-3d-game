import { BALL, DT, MATCH, PITCH, PLAYER, TICK_RATE, SNAPSHOT_EVERY } from "./constants.js";
import { buildFormation } from "./formation.js";
import { updateBot } from "./bots.js";

// Server-authoritative simulation of one match. No sockets, no database: pure logic.
// Clients only send intent (move direction, pass/shoot). The server decides everything.

const SIDES = ["home", "away"];
const L = PITCH.length;
const W = PITCH.width;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, fallback = 0) => (Number.isFinite(v) ? v : fallback);
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const round2 = (v) => Math.round(v * 100) / 100;

// small seeded random generator (same seed = same match, easy to test)
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class MatchWorld {
  constructor({ teamSize, mode, aiDifficulty, durationSeconds, seed }) {
    this.teamSize = teamSize;
    this.duration = durationSeconds ?? MATCH.durationSeconds;
    this.rng = mulberry32(seed ?? Date.now());
    const difficulty = aiDifficulty ?? 3;
    // Co-op: the AI opponents use the chosen difficulty, AI teammates play at medium
    this.skill = { home: mode === "coop_tournament" ? 3 : difficulty, away: difficulty };

    const formation = buildFormation(teamSize);
    this.players = [];
    for (const side of SIDES) {
      formation.forEach((f, slot) => {
        this.players.push({
          i: this.players.length,
          side,
          slot, // index inside the room's side array
          role: f.role,
          f,
          x: 0, y: 0, vx: 0, vy: 0,
          facing: side === "home" ? 0 : Math.PI,
          stamina: 1,
          kickLock: 0,
          actionCd: 0,
          controller: null, // userId of the human playing this player, null = bot
          input: { dx: 0, dy: 0, sprint: false },
          action: null,
          botTimer: 0.2 + this.rng() * 0.3,
          goalX: 0, goalY: 0, wantSprint: false, holdTimer: 0,
        });
      });
    }

    this.ball = { x: L / 2, y: W / 2, vx: 0, vy: 0, owner: -1, lastTouch: -1 };
    this.score = [0, 0];
    this.goals = [];
    this.events = [{ type: "kickoff" }];
    this.chaser = { home: -1, away: -1 };
    this.tick = 0;
    this.elapsed = 0;
    this.phase = "kickoff"; // kickoff -> play -> goal -> kickoff ... -> ended
    this.phaseTimer = MATCH.firstKickoff;
    this.placeKickoff();
  }

  // ---------- control from outside ----------
  setController(i, userId) {
    const p = this.players[i];
    if (p.controller === userId) return;
    p.controller = userId;
    p.input = { dx: 0, dy: 0, sprint: false };
    p.action = null;
  }

  setInput(i, raw) {
    const p = this.players[i];
    if (!p || !p.controller) return;
    let dx = num(raw.dx);
    let dy = num(raw.dy);
    const m = Math.hypot(dx, dy);
    if (m > 1) {
      dx /= m;
      dy /= m;
    }
    p.input = { dx, dy, sprint: raw.sprint === true };
  }

  queueAction(i, a) {
    const p = this.players[i];
    if (!p || (a.type !== "pass" && a.type !== "shoot")) return;
    p.action = {
      type: a.type,
      power: clamp(num(a.power, 0.7), 0, 1),
      aimX: num(a.aimX),
      aimY: num(a.aimY),
      target: a.target, // bots only (the socket layer never sets it)
    };
  }

  // ---------- main step ----------
  step() {
    this.tick++;
    if (this.phase === "ended") return;

    if (this.phase === "kickoff" || this.phase === "goal") {
      this.phaseTimer -= DT;
      if (this.phaseTimer <= 0) {
        if (this.phase === "goal") {
          this.placeKickoff();
          this.phase = "kickoff";
          this.phaseTimer = MATCH.afterGoalKickoff;
          this.events.push({ type: "kickoff" });
        } else {
          this.phase = "play";
          this.events.push({ type: "play" });
        }
      }
      return;
    }

    this.elapsed += DT;
    this.assignChasers();
    for (const p of this.players) {
      p.kickLock = Math.max(0, p.kickLock - DT);
      p.actionCd = Math.max(0, p.actionCd - DT);
      if (!p.controller) updateBot(this, p, DT);
    }
    for (const p of this.players) this.movePlayer(p, DT);
    this.separatePlayers();
    for (const p of this.players) if (p.action) this.runAction(p);
    this.updateBall(DT);
    this.updatePossession();
    this.checkGoal();
    if (this.phase === "play" && this.elapsed >= this.duration) this.endMatch();
  }

  minute() {
    return Math.min(90, Math.floor((this.elapsed / this.duration) * 90));
  }

  // ---------- setup ----------
  placeKickoff() {
    for (const p of this.players) {
      const u = p.f.kickoffU;
      p.x = p.side === "home" ? u * L : (1 - u) * L;
      p.y = p.side === "home" ? p.f.v * W : (1 - p.f.v) * W;
      p.vx = 0;
      p.vy = 0;
      p.facing = p.side === "home" ? 0 : Math.PI;
      p.kickLock = 0;
      p.actionCd = 0;
      p.action = null;
      p.input = { dx: 0, dy: 0, sprint: false };
    }
    Object.assign(this.ball, { x: L / 2, y: W / 2, vx: 0, vy: 0, owner: -1, lastTouch: -1 });
  }

  // one bot per team runs at the ball (the nearest one that didn't just kick it)
  assignChasers() {
    const b = this.ball;
    for (const side of SIDES) {
      let best = -1;
      let bestD = Infinity;
      for (const p of this.players) {
        if (p.side !== side || p.controller || p.role === "GK" || p.kickLock > 0) continue;
        const d = Math.hypot(p.x - b.x, p.y - b.y);
        if (d < bestD) {
          bestD = d;
          best = p.i;
        }
      }
      this.chaser[side] = best;
    }
  }

  // ---------- players ----------
  movePlayer(p, dt) {
    const { dx, dy, sprint } = p.input;
    const moving = dx !== 0 || dy !== 0;
    const wantsSprint = sprint && moving && p.stamina > 0.02;

    let max = wantsSprint ? PLAYER.sprintSpeed : PLAYER.runSpeed;
    if (!p.controller) max *= 0.88 + 0.03 * this.skill[p.side];
    if (this.ball.owner === p.i) max *= PLAYER.carrySpeedFactor;

    // accelerate toward the wanted velocity (limited acceleration)
    let ax = dx * max - p.vx;
    let ay = dy * max - p.vy;
    const am = Math.hypot(ax, ay);
    const maxDelta = PLAYER.accel * dt;
    if (am > maxDelta) {
      ax = (ax / am) * maxDelta;
      ay = (ay / am) * maxDelta;
    }
    p.vx += ax;
    p.vy += ay;

    p.x += p.vx * dt;
    p.y += p.vy * dt;
    const r = PLAYER.radius;
    if (p.x < r || p.x > L - r) {
      p.x = clamp(p.x, r, L - r);
      p.vx = 0;
    }
    if (p.y < r || p.y > W - r) {
      p.y = clamp(p.y, r, W - r);
      p.vy = 0;
    }

    const speed = Math.hypot(p.vx, p.vy);
    if (speed > 0.5) {
      const diff = wrapPi(Math.atan2(p.vy, p.vx) - p.facing);
      const step = PLAYER.turnRate * dt;
      p.facing = wrapPi(p.facing + clamp(diff, -step, step));
    }

    const sprinting = wantsSprint && speed > PLAYER.runSpeed * 0.9;
    p.stamina = clamp(
      p.stamina + (sprinting ? -PLAYER.staminaDrain : PLAYER.staminaRegen) * dt,
      0,
      1
    );
  }

  separatePlayers() {
    const min = PLAYER.radius * 2;
    const ps = this.players;
    for (let a = 0; a < ps.length; a++) {
      for (let c = a + 1; c < ps.length; c++) {
        const p = ps[a];
        const q = ps[c];
        const dx = q.x - p.x;
        const dy = q.y - p.y;
        const d = Math.hypot(dx, dy);
        if (d >= min) continue;
        const nx = d > 1e-6 ? dx / d : 1;
        const ny = d > 1e-6 ? dy / d : 0;
        const push = (min - d) / 2;
        p.x = clamp(p.x - nx * push, PLAYER.radius, L - PLAYER.radius);
        p.y = clamp(p.y - ny * push, PLAYER.radius, W - PLAYER.radius);
        q.x = clamp(q.x + nx * push, PLAYER.radius, L - PLAYER.radius);
        q.y = clamp(q.y + ny * push, PLAYER.radius, W - PLAYER.radius);
      }
    }
  }

  // ---------- kicks ----------
  kickBall(p, dx, dy, speed) {
    const b = this.ball;
    b.vx = dx * speed;
    b.vy = dy * speed;
    b.owner = -1;
    b.lastTouch = p.i;
    p.kickLock = PLAYER.kickLock;
    p.actionCd = PLAYER.actionCooldown;
  }

  pickPassTarget(p, dx, dy) {
    const aim = Math.atan2(dy, dx);
    let best = -1;
    let bestScore = Infinity;
    for (const q of this.players) {
      if (q.side !== p.side || q.i === p.i) continue;
      const rx = q.x - p.x;
      const ry = q.y - p.y;
      const d = Math.hypot(rx, ry);
      if (d < 3 || d > 50) continue;
      const angle = Math.abs(wrapPi(Math.atan2(ry, rx) - aim));
      if (angle > 0.7) continue; // about 40 degrees
      const score = angle * 3 + d / 60;
      if (score < bestScore) {
        bestScore = score;
        best = q.i;
      }
    }
    return best === -1 ? null : this.players[best];
  }

  runAction(p) {
    const a = p.action;
    p.action = null;
    const b = this.ball;
    if (p.actionCd > 0) return;
    if (Math.hypot(b.x - p.x, b.y - p.y) > PLAYER.kickReach) return;

    // aim: explicit aim > movement input > facing
    let dx = a.aimX;
    let dy = a.aimY;
    if (Math.hypot(dx, dy) < 0.1) {
      dx = p.input.dx;
      dy = p.input.dy;
    }
    if (Math.hypot(dx, dy) < 0.1) {
      dx = Math.cos(p.facing);
      dy = Math.sin(p.facing);
    }
    const m = Math.hypot(dx, dy);
    dx /= m;
    dy /= m;

    if (a.type === "shoot") {
      const speed = BALL.shotMin + (BALL.shotMax - BALL.shotMin) * a.power;
      this.kickBall(p, dx, dy, speed);
      return;
    }

    const target = a.target !== undefined ? this.players[a.target] : this.pickPassTarget(p, dx, dy);
    if (target && target.side === p.side && target.i !== p.i) {
      // lead the pass a little and size the speed so it arrives gently
      const tx = target.x + target.vx * 0.35;
      const ty = target.y + target.vy * 0.35;
      const d = Math.hypot(tx - b.x, ty - b.y) || 1;
      const speed = clamp(d * BALL.drag + BALL.passArrival, BALL.passMin, BALL.passMax);
      this.kickBall(p, (tx - b.x) / d, (ty - b.y) / d, speed);
      return;
    }
    this.kickBall(p, dx, dy, 16); // no teammate in that direction: clear it
  }

  // ---------- ball ----------
  updateBall(dt) {
    const b = this.ball;
    const r = BALL.radius;

    if (b.owner !== -1) {
      // carried: the ball follows its owner, slightly in front
      const o = this.players[b.owner];
      const k = 1 - Math.exp(-22 * dt);
      b.x += (o.x + Math.cos(o.facing) * PLAYER.carryOffset - b.x) * k;
      b.y += (o.y + Math.sin(o.facing) * PLAYER.carryOffset - b.y) * k;
      b.vx = o.vx;
      b.vy = o.vy;
      b.x = clamp(b.x, r, L - r);
      b.y = clamp(b.y, r, W - r);
      return;
    }

    b.x += b.vx * dt;
    b.y += b.vy * dt;
    const decay = Math.exp(-BALL.drag * dt);
    b.vx *= decay;
    b.vy *= decay;
    if (Math.hypot(b.vx, b.vy) < 0.05) {
      b.vx = 0;
      b.vy = 0;
    }

    // walls (no out-of-play rules yet: the ball bounces), except through the goal mouth
    const inMouth = Math.abs(b.y - W / 2) < PITCH.goalWidth / 2;
    if (b.y < r) {
      b.y = r;
      b.vy = Math.abs(b.vy) * BALL.bounce;
    } else if (b.y > W - r) {
      b.y = W - r;
      b.vy = -Math.abs(b.vy) * BALL.bounce;
    }
    if (!inMouth) {
      if (b.x < r) {
        b.x = r;
        b.vx = Math.abs(b.vx) * BALL.bounce;
      } else if (b.x > L - r) {
        b.x = L - r;
        b.vx = -Math.abs(b.vx) * BALL.bounce;
      }
    }
  }

  giveBall(i) {
    const b = this.ball;
    b.owner = i;
    b.lastTouch = i;
    this.players[i].botTimer = 0.25 + this.rng() * 0.15;
    this.players[i].holdTimer = 0;
  }

  updatePossession() {
    const b = this.ball;
    const speed = Math.hypot(b.vx, b.vy);

    if (b.owner !== -1) {
      const o = this.players[b.owner];
      if (o.role === "GK") return; // nobody steals from the goalkeeper's hands
      let thief = -1;
      let best = Math.hypot(o.x - b.x, o.y - b.y) - 0.05;
      for (const q of this.players) {
        if (q.side === o.side || q.kickLock > 0) continue;
        const d = Math.hypot(q.x - b.x, q.y - b.y);
        if (d <= PLAYER.stealReach && d < best) {
          best = d;
          thief = q.i;
        }
      }
      if (thief !== -1) {
        o.kickLock = PLAYER.kickLock;
        this.giveBall(thief);
      }
      return;
    }

    // free ball: nearest player in reach
    let cand = null;
    let candD = Infinity;
    for (const q of this.players) {
      if (q.kickLock > 0) continue;
      const d = Math.hypot(q.x - b.x, q.y - b.y);
      const reach = q.role === "GK" ? PLAYER.gkReach : PLAYER.controlReach;
      if (d <= reach && d < candD) {
        candD = d;
        cand = q;
      }
    }
    if (!cand) return;

    if (cand.role === "GK") {
      const catchSpeed = BALL.gkCatchBase + BALL.gkCatchPerSkill * this.skill[cand.side];
      if (speed <= catchSpeed) {
        this.giveBall(cand.i);
      } else {
        // parry: push it back into play
        const dirIn = cand.side === "home" ? 1 : -1;
        b.vx = Math.abs(b.vx) * 0.5 * dirIn;
        b.vy += (this.rng() - 0.5) * 8;
        b.lastTouch = cand.i;
        cand.kickLock = 0.5;
      }
      return;
    }
    if (speed > BALL.pickupMaxSpeed) {
      // a hard shot is blocked and slowed, the blocker controls it next tick
      b.vx *= 0.4;
      b.vy *= 0.4;
      b.lastTouch = cand.i;
      return;
    }
    this.giveBall(cand.i);
  }

  // ---------- goals and end ----------
  checkGoal() {
    const b = this.ball;
    if (b.owner !== -1) return;
    const inMouth = Math.abs(b.y - W / 2) < PITCH.goalWidth / 2;
    if (inMouth && b.x <= 0) this.scoreGoal("away");
    else if (inMouth && b.x >= L) this.scoreGoal("home");
  }

  scoreGoal(side) {
    const idx = side === "home" ? 0 : 1;
    this.score[idx]++;
    const last = this.ball.lastTouch;
    const scorer = last !== -1 && this.players[last].side === side ? last : -1;
    const minute = this.minute();
    this.goals.push({ side, minute });
    this.events.push({ type: "goal", side, scorer, minute, score: [...this.score] });

    this.ball.vx = 0;
    this.ball.vy = 0;
    this.ball.owner = -1;
    for (const p of this.players) {
      p.vx = 0;
      p.vy = 0;
    }
    this.phase = "goal";
    this.phaseTimer = MATCH.goalPause;
  }

  endMatch() {
    this.phase = "ended";
    this.events.push({ type: "end", score: [...this.score] });
  }

  result() {
    return { score: [...this.score], goals: [...this.goals] };
  }

  // ---------- data for clients ----------
  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  initInfo() {
    return {
      pitch: { length: L, width: W, goalWidth: PITCH.goalWidth },
      tickRate: TICK_RATE,
      snapshotRate: TICK_RATE / SNAPSHOT_EVERY,
      durationSeconds: this.duration,
      teamSize: this.teamSize,
      players: this.players.map((p) => ({ i: p.i, side: p.side, slot: p.slot, role: p.role })),
    };
  }

  // compact snapshot: b = [x, y, ownerIndex], p = [[x, y, facing, stamina%], ...]
  snapshot() {
    const b = this.ball;
    return {
      t: this.tick,
      ph: this.phase,
      cd: this.phase === "kickoff" || this.phase === "goal" ? Math.max(0, Math.ceil(this.phaseTimer)) : 0,
      m: this.minute(),
      s: [...this.score],
      b: [round2(b.x), round2(b.y), b.owner],
      p: this.players.map((p) => [round2(p.x), round2(p.y), round2(p.facing), Math.round(p.stamina * 100)]),
    };
  }
}
