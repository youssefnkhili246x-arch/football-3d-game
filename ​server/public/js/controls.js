"use strict";
// Touch joystick, action buttons, keyboard, and input sending (bandwidth friendly).
(function (FB) {
  const $ = FB.$;
  const S = FB.s;

  const stick = { x: 0, y: 0, id: null };
  const keys = { up: false, down: false, left: false, right: false, shift: false };
  let sprintOn = false;
  let shootStart = 0;

  const r2 = (v) => Math.round(v * 100) / 100;

  // current movement input in WORLD coordinates (the pitch is turned in portrait mode)
  function input() {
    let sx = stick.x + (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    let sy = stick.y + (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
    const m = Math.hypot(sx, sy);
    if (m > 1) { sx /= m; sy /= m; }
    const rot = FB.view.isRotated();
    return { dx: r2(rot ? sy : sx), dy: r2(rot ? sx : sy), sprint: sprintOn || keys.shift };
  }

  const canSend = () => S.inGame && !S.ended && S.socket && S.socket.connected;

  // aim: stick direction, otherwise toward the opponent goal
  function aimOf(inp, snapPlayer) {
    if (Math.hypot(inp.dx, inp.dy) > 0.3) return { aimX: inp.dx, aimY: inp.dy };
    const seat = FB.mySeat();
    if (!seat || !snapPlayer) return {};
    return { aimX: (seat.side === "home" ? S.pitch.length : 0) - snapPlayer.x, aimY: S.pitch.width / 2 - snapPlayer.y };
  }

  function sendAction(type, power) {
    if (!canSend()) return;
    const inp = input();
    const msg = { dx: inp.dx, dy: inp.dy, sprint: inp.sprint, action: type, power };
    if (type === "shoot") Object.assign(msg, aimOf(inp, FB.predict.me));
    S.socket.emit("match:input", msg);
  }

  function releaseShoot() {
    if (!shootStart) return;
    const held = performance.now() - shootStart;
    shootStart = 0;
    $("bShoot").classList.remove("on");
    sendAction("shoot", 0.45 + 0.55 * Math.min(1, held / 600));
  }

  // movement: send only when it changes, plus a heartbeat every 100 ms (the server stops a silent player after 500 ms)
  let lastKey = "";
  let lastSend = 0;
  setInterval(() => {
    if (!canSend()) return;
    const inp = input();
    const key = inp.dx + "," + inp.dy + "," + inp.sprint;
    const now = performance.now();
    if (key === lastKey && now - lastSend < 100) return;
    lastKey = key;
    lastSend = now;
    S.socket.volatile.emit("match:input", inp);
  }, 33);

  FB.controls = { input };

  FB.initControls = () => {
    const zone = $("stickZone");
    const knob = $("knob");

    const update = (e) => {
      const r = zone.getBoundingClientRect();
      let dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
      let dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      const m = Math.hypot(dx, dy);
      if (m > 1) { dx /= m; dy /= m; }
      stick.x = m < 0.12 ? 0 : dx;
      stick.y = m < 0.12 ? 0 : dy;
      knob.style.transform = `translate(${dx * 45}px, ${dy * 45}px)`;
    };
    const end = (e) => {
      if (e.pointerId !== stick.id) return;
      stick.id = null; stick.x = 0; stick.y = 0;
      knob.style.transform = "";
    };
    zone.addEventListener("pointerdown", (e) => { e.preventDefault(); stick.id = e.pointerId; zone.setPointerCapture(e.pointerId); update(e); });
    zone.addEventListener("pointermove", (e) => { if (e.pointerId === stick.id) update(e); });
    zone.addEventListener("pointerup", end);
    zone.addEventListener("pointercancel", end);

    const shoot = $("bShoot");
    shoot.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      shoot.setPointerCapture(e.pointerId);
      shootStart = performance.now();
      shoot.classList.add("on");
    });
    shoot.addEventListener("pointerup", releaseShoot);
    shoot.addEventListener("pointercancel", () => { shootStart = 0; shoot.classList.remove("on"); });

    $("bPass").addEventListener("pointerdown", (e) => { e.preventDefault(); sendAction("pass"); });
    $("bSprint").addEventListener("pointerdown", (e) => {
      e.preventDefault();
      sprintOn = !sprintOn;
      $("bSprint").classList.toggle("on", sprintOn);
    });

    window.addEventListener("keydown", (e) => {
      if (!S.inGame) return;
      const k = e.code;
      if (k === "ArrowUp" || k === "KeyW") keys.up = true;
      else if (k === "ArrowDown" || k === "KeyS") keys.down = true;
      else if (k === "ArrowLeft" || k === "KeyA") keys.left = true;
      else if (k === "ArrowRight" || k === "KeyD") keys.right = true;
      else if (k === "ShiftLeft" || k === "ShiftRight") keys.shift = true;
      else if (k === "Space" && !e.repeat) shootStart = performance.now();
      else if ((k === "KeyE" || k === "KeyF") && !e.repeat) sendAction("pass");
      else return;
      e.preventDefault();
    });
    window.addEventListener("keyup", (e) => {
      const k = e.code;
      if (k === "ArrowUp" || k === "KeyW") keys.up = false;
      else if (k === "ArrowDown" || k === "KeyS") keys.down = false;
      else if (k === "ArrowLeft" || k === "KeyA") keys.left = false;
      else if (k === "ArrowRight" || k === "KeyD") keys.right = false;
      else if (k === "ShiftLeft" || k === "ShiftRight") keys.shift = false;
      else if (k === "Space") releaseShoot();
    });
  };
})(window.FB);
