"use strict";
// Snapshot buffer + interpolation (renders 100 ms in the past), canvas drawing, HUD.
(function (FB) {
  const $ = FB.$;
  const S = FB.s;
  const clamp = FB.clamp;

  const INTERP_MS = 100;
  const TICK_MS = 1000 / 30; // server tick length
  const MARGIN = 3; // meters around the pitch (room for the goals)
  const CARRY_OFFSET = 0.75;

  const canvas = $("c");
  const ctx = canvas.getContext("2d");
  let snaps = []; // { ts: server time in ms, d: snapshot }
  let offset = null; // client clock minus server clock (smoothed minimum)
  let latest = null;
  let dpr = 1, cw = 0, ch = 0, scale = 1, offX = 0, offY = 0, rotated = false;

  FB.view = { isRotated: () => rotated };

  // ---------- layout ----------
  function layout() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cw = window.innerWidth;
    ch = window.innerHeight;
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    rotated = ch > cw; // portrait phone: turn the pitch so it fills the screen
    const pw = (rotated ? S.pitch.width : S.pitch.length) + 2 * MARGIN;
    const ph = (rotated ? S.pitch.length : S.pitch.width) + 2 * MARGIN;
    const top = 44;
    const bottom = rotated ? 190 : 0;
    scale = Math.min(cw / pw, (ch - top - bottom) / ph);
    offX = (cw - pw * scale) / 2;
    offY = top + (ch - top - bottom - ph * scale) / 2;
  }
  FB.layout = layout;

  function worldTransform() {
    const k = scale * dpr;
    const e = (offX + MARGIN * scale) * dpr;
    const f = (offY + MARGIN * scale) * dpr;
    if (rotated) ctx.setTransform(0, k, k, 0, e, f); // screen x = world y, screen y = world x
    else ctx.setTransform(k, 0, 0, k, e, f);
  }

  const toScreen = (x, y) => (rotated
    ? [offX + (y + MARGIN) * scale, offY + (x + MARGIN) * scale]
    : [offX + (x + MARGIN) * scale, offY + (y + MARGIN) * scale]);

  // ---------- snapshots ----------
  function resetBuffer() {
    snaps = [];
    offset = null;
    latest = null;
    FB.predict.reset();
  }

  FB.startGame = () => {
    S.ended = false;
    resetBuffer();
    $("result").classList.add("hidden");
    FB.show("game");
  };

  FB.listen("init", (d) => {
    S.pitch = d.pitch;
    S.roles = d.players.map((p) => p.role);
    resetBuffer();
    layout();
  });

  FB.listen("state", ({ d, at }) => {
    const ts = d.t * TICK_MS;
    const sample = at - ts;
    // follow the fastest arrivals, rise slowly when the connection gets slower
    offset = offset === null || sample < offset ? sample : offset + (sample - offset) * 0.05;
    snaps.push({ ts, d });
    if (snaps.length > 24) snaps.shift();
    latest = d;

    const seat = FB.mySeat();
    if (seat && d.ph === "play" && d.p[seat.i]) FB.predict.reconcile(at, S.rtt, d.p[seat.i]);
  });

  FB.listen("events", (list) => {
    for (const e of list) if (e.type === "goal" && navigator.vibrate) navigator.vibrate(150);
  });

  FB.listen("end", (d) => {
    S.ended = true;
    const seat = FB.mySeat();
    const h = d.score[0];
    const a = d.score[1];
    let verdict = "Final score";
    if (seat) {
      const mine = seat.side === "home" ? h : a;
      const theirs = seat.side === "home" ? a : h;
      verdict = mine > theirs ? "You win! 🎉" : mine < theirs ? "You lose" : "Draw";
    }
    $("resultTitle").textContent = verdict;
    $("resultScore").textContent = `HOME ${h} – ${a} AWAY`;
    $("result").classList.remove("hidden");
  });

  // a jump bigger than 6 m is a reset (kickoff / goal): never slide across the pitch
  function blend(a, b, f) {
    const mix = (x, y) => (Math.abs(y - x) > 6 ? (f < 0.5 ? x : y) : x + (y - x) * f);
    const turn = (x, y) => x + Math.atan2(Math.sin(y - x), Math.cos(y - x)) * f;
    return {
      ph: b.ph, cd: b.cd, m: b.m, s: b.s,
      b: [mix(a.b[0], b.b[0]), mix(a.b[1], b.b[1]), b.b[2]],
      p: b.p.map((q, i) => {
        const o = a.p[i];
        return o ? [mix(o[0], q[0]), mix(o[1], q[1]), turn(o[2], q[2]), q[3]] : q;
      }),
    };
  }

  function sample(now) {
    if (snaps.length === 0) return null;
    const rt = now - offset - INTERP_MS; // render time on the server clock
    let ia = -1;
    for (let k = snaps.length - 1; k >= 0; k--) {
      if (snaps[k].ts <= rt) { ia = k; break; }
    }
    if (ia === -1) return snaps[0].d;
    const a = snaps[ia];
    const b = snaps[ia + 1];
    if (!b) { // out of data (lag spike): extrapolate a little from the last two snapshots
      const prev = snaps[ia - 1];
      if (!prev) return a.d;
      return blend(prev.d, a.d, clamp((rt - prev.ts) / (a.ts - prev.ts || 1), 1, 1.8));
    }
    return blend(a.d, b.d, clamp((rt - a.ts) / (b.ts - a.ts || 1), 0, 1));
  }

  // ---------- drawing ----------
  function drawPitch() {
    const L = S.pitch.length;
    const W = S.pitch.width;
    const gw = S.pitch.goalWidth;
    for (let k = 0; k < 10; k++) {
      ctx.fillStyle = k % 2 ? "#2f8f3f" : "#2a8238";
      ctx.fillRect((k * L) / 10, 0, L / 10, W);
    }
    ctx.strokeStyle = "rgba(255,255,255,.85)";
    ctx.fillStyle = "rgba(255,255,255,.85)";
    ctx.lineWidth = 0.22;
    ctx.strokeRect(0, 0, L, W);
    ctx.beginPath(); ctx.moveTo(L / 2, 0); ctx.lineTo(L / 2, W); ctx.stroke();
    ctx.beginPath(); ctx.arc(L / 2, W / 2, 9.15, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(L / 2, W / 2, 0.4, 0, Math.PI * 2); ctx.fill();
    for (const left of [true, false]) {
      const x0 = left ? 0 : L;
      const dir = left ? 1 : -1;
      ctx.strokeRect(x0, (W - 40.32) / 2, dir * 16.5, 40.32); // penalty area
      ctx.strokeRect(x0, (W - 18.32) / 2, dir * 5.5, 18.32); // goal area
      ctx.beginPath(); ctx.arc(x0 + dir * 11, W / 2, 0.35, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(0,0,0,.35)";
      ctx.fillRect(x0, (W - gw) / 2, -dir * 2.4, gw); // goal
      ctx.strokeRect(x0, (W - gw) / 2, -dir * 2.4, gw);
      ctx.fillStyle = "rgba(255,255,255,.85)";
    }
  }

  const roleOf = (i, n) => (S.roles ? S.roles[i] : n >= 3 && i % n === n - 1 ? "GK" : "");

  // my own player is drawn from the prediction, everybody else from the interpolation
  function playerAt(st, i, seat, me) {
    return seat && seat.i === i && me.on ? [me.x, me.y, me.facing, me.stamina * 100] : st.p[i];
  }

  function drawEntities(st, seat, me) {
    const n = st.p.length / 2;
    for (let i = 0; i < st.p.length; i++) {
      const p = playerAt(st, i, seat, me);
      ctx.beginPath();
      ctx.arc(p[0], p[1], 0.85, 0, Math.PI * 2);
      ctx.fillStyle = i < n ? "#3b82f6" : "#ef4444";
      ctx.fill();
      if (roleOf(i, n) === "GK") { ctx.lineWidth = 0.3; ctx.strokeStyle = "#facc15"; ctx.stroke(); }
      ctx.lineWidth = 0.25;
      ctx.strokeStyle = "#fff";
      ctx.beginPath();
      ctx.moveTo(p[0], p[1]);
      ctx.lineTo(p[0] + Math.cos(p[2]) * 1.5, p[1] + Math.sin(p[2]) * 1.5);
      ctx.stroke();
      if (seat && seat.i === i) {
        ctx.beginPath(); ctx.arc(p[0], p[1], 1.3, 0, Math.PI * 2);
        ctx.lineWidth = 0.3; ctx.stroke();
      }
    }
    let bx = st.b[0];
    let by = st.b[1];
    if (seat && me.on && st.b[2] === seat.i) { // I am dribbling: keep the ball glued to my predicted player
      bx = me.x + Math.cos(me.facing) * CARRY_OFFSET;
      by = me.y + Math.sin(me.facing) * CARRY_OFFSET;
    }
    ctx.beginPath();
    ctx.arc(bx, by, 0.5, 0, Math.PI * 2);
    ctx.fillStyle = "#fff"; ctx.fill();
    ctx.lineWidth = 0.12; ctx.strokeStyle = "#000"; ctx.stroke();
  }

  function nameOf(i, n) {
    if (!S.room) return "";
    const s = S.room.sides[i < n ? "home" : "away"][i % n];
    return s && s.userId && !s.bot ? s.username : "";
  }

  function drawLabels(st, seat, me) {
    const n = st.p.length / 2;
    ctx.font = "11px system-ui, sans-serif";
    ctx.textAlign = "center";
    for (let i = 0; i < st.p.length; i++) {
      const mine = seat && seat.i === i;
      const name = mine ? "YOU" : nameOf(i, n);
      if (!name) continue;
      const p = playerAt(st, i, seat, me);
      const [x, y] = toScreen(p[0], p[1]);
      ctx.fillStyle = mine ? "#fff" : "#e2e8f0";
      ctx.fillText(name, x, y - 12);
      if (mine) { // stamina bar
        ctx.fillStyle = "#0008"; ctx.fillRect(x - 13, y + 11, 26, 3);
        ctx.fillStyle = "#facc15"; ctx.fillRect(x - 13, y + 11, 26 * clamp(p[3] / 100, 0, 1), 3);
      }
    }
  }

  let hudText = "";
  let bannerText = "";
  function updateHud(st) {
    let hud = "Waiting for the match…";
    let banner = "";
    if (st) {
      const seat = FB.mySeat();
      hud = `<span style="color:#60a5fa">HOME ${st.s[0]}</span> – <span style="color:#f87171">${st.s[1]} AWAY</span> · ${st.m}'`;
      if (seat) hud += ` · ${seat.side.toUpperCase()}`;
      if (S.rtt != null) hud += ` · ${Math.round(S.rtt)} ms`;
      if (st.ph === "kickoff" && st.cd > 0) banner = String(st.cd);
      else if (st.ph === "goal") banner = "GOAL!";
    }
    if (hud !== hudText) { hudText = hud; $("hud").innerHTML = hud; }
    if (banner !== bannerText) { bannerText = banner; $("banner").textContent = banner; }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (!S.inGame) return;

    const st = sample(now);
    const seat = FB.mySeat();
    const pr = FB.predict;

    if (st && seat && st.p[seat.i] && latest) {
      const sp = st.p[seat.i];
      if (latest.ph !== "play") pr.follow(sp[0], sp[1], sp[2], sp[3] / 100); // kickoff / goal / ended: copy the server
      else {
        if (!pr.me.on) pr.follow(sp[0], sp[1], sp[2], sp[3] / 100);
        pr.update(now, FB.controls.input(), latest.b[2] === seat.i);
      }
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#0b3d17";
    ctx.fillRect(0, 0, cw, ch);
    worldTransform();
    drawPitch();
    if (st) drawEntities(st, seat, pr.me);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (st) drawLabels(st, seat, pr.me);
    updateHud(st);
  }

  FB.startLoop = () => requestAnimationFrame(frame);
})(window.FB);
