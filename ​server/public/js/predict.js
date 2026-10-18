"use strict";
// Client-side prediction for the local player.
// Same movement rules as the server (engine/constants.js + world.js movePlayer),
// so the player reacts instantly to the joystick. Snapshots then correct small drifts.
(function (FB) {
  const RUN = 6.2;
  const SPRINT = 8.4;
  const ACCEL = 26;
  const TURN = 12;
  const CARRY = 0.94;
  const DRAIN = 0.22;
  const REGEN = 0.1;
  const RADIUS = 0.5;
  const DT = 1 / 30;
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

  const me = { on: false, x: 0, y: 0, vx: 0, vy: 0, facing: 0, stamina: 1 };
  let hist = []; // past predicted positions { t, x, y }
  let acc = 0;
  let lastT = 0;

  function reset() {
    me.on = false;
    hist = [];
    acc = 0;
    lastT = 0;
  }

  // not in play (kickoff, goal): just copy the server
  function follow(x, y, facing, stamina) {
    me.on = true;
    me.x = x; me.y = y; me.vx = 0; me.vy = 0;
    me.facing = facing;
    me.stamina = stamina;
    hist = [];
    acc = 0;
    lastT = 0;
  }

  function step(inp, carrying) {
    const L = FB.s.pitch.length;
    const W = FB.s.pitch.width;
    const moving = inp.dx !== 0 || inp.dy !== 0;
    const sprint = inp.sprint && moving && me.stamina > 0.02;
    let max = sprint ? SPRINT : RUN;
    if (carrying) max *= CARRY;

    let ax = inp.dx * max - me.vx;
    let ay = inp.dy * max - me.vy;
    const am = Math.hypot(ax, ay);
    const maxDelta = ACCEL * DT;
    if (am > maxDelta) { ax = (ax / am) * maxDelta; ay = (ay / am) * maxDelta; }
    me.vx += ax;
    me.vy += ay;
    me.x += me.vx * DT;
    me.y += me.vy * DT;

    if (me.x < RADIUS || me.x > L - RADIUS) { me.x = FB.clamp(me.x, RADIUS, L - RADIUS); me.vx = 0; }
    if (me.y < RADIUS || me.y > W - RADIUS) { me.y = FB.clamp(me.y, RADIUS, W - RADIUS); me.vy = 0; }

    const speed = Math.hypot(me.vx, me.vy);
    if (speed > 0.5) {
      const diff = wrap(Math.atan2(me.vy, me.vx) - me.facing);
      const st = TURN * DT;
      me.facing = wrap(me.facing + FB.clamp(diff, -st, st));
    }
    const sprinting = sprint && speed > RUN * 0.9;
    me.stamina = FB.clamp(me.stamina + (sprinting ? -DRAIN : REGEN) * DT, 0, 1);
  }

  // called every frame while the match is in play
  function update(now, inp, carrying) {
    if (!me.on) return;
    if (!lastT) lastT = now - DT * 1000; // first frame after follow(): run one step
    acc += Math.min((now - lastT) / 1000, 0.1);
    lastT = now;
    while (acc >= DT - 1e-9) {
      acc -= DT;
      step(inp, carrying);
      hist.push({ t: now - acc * 1000, x: me.x, y: me.y });
    }
    if (hist.length > 90) hist.splice(0, hist.length - 90);
  }

  function shift(dx, dy) {
    me.x += dx;
    me.y += dy;
    for (const h of hist) { h.x += dx; h.y += dy; }
  }

  // called for every snapshot. s = [x, y, facing, stamina%] of my player.
  // The snapshot reflects my inputs from about one round trip ago, so it is
  // compared with where I was predicted to be at that time.
  function reconcile(at, rtt, s) {
    me.stamina = s[3] / 100;
    if (!me.on || hist.length < 2) return;

    const target = at - (rtt || 100);
    let px;
    let py;
    const first = hist[0];
    const last = hist[hist.length - 1];
    if (target <= first.t) { px = first.x; py = first.y; }
    else if (target >= last.t) { px = last.x; py = last.y; }
    else {
      let k = 0;
      while (k < hist.length - 2 && hist[k + 1].t <= target) k++;
      const a = hist[k];
      const b = hist[k + 1];
      const f = (target - a.t) / (b.t - a.t || 1);
      px = a.x + (b.x - a.x) * f;
      py = a.y + (b.y - a.y) * f;
    }

    const ex = s[0] - px;
    const ey = s[1] - py;
    const mag = Math.hypot(ex, ey);
    const still = Math.hypot(me.vx, me.vy) < 0.3;

    if (mag > 3) shift(ex, ey); // too far (tackle, reset): trust the server
    else if (mag > (still ? 0.05 : 0.45)) shift(ex * 0.35, ey * 0.35); // small drift: ease toward the server
  }

  FB.predict = { me, reset, follow, update, reconcile };
})(window.FB);
