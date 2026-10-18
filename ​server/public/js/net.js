"use strict";
// Shared namespace, event bus, session, REST API and the Socket.io connection.
(function () {
  const FB = (window.FB = {});
  const handlers = {};

  FB.listen = (name, fn) => { (handlers[name] = handlers[name] || []).push(fn); };
  FB.emit = (name, data) => { (handlers[name] || []).forEach((fn) => fn(data)); };

  FB.$ = (id) => document.getElementById(id);
  FB.clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  FB.esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  FB.SERVER = new URLSearchParams(location.search).get("server") || location.origin;

  // shared state
  FB.s = {
    session: null, // { access_token, refresh_token, expires_at, userId, email }
    socket: null,
    room: null, // last room view from the server
    pitch: { length: 105, width: 68, goalWidth: 7.32 },
    roles: null,
    inGame: false,
    ended: false,
    rtt: null, // smoothed round-trip time in ms
  };
  const S = FB.s;

  let toastTimer;
  FB.toast = (msg) => {
    const t = FB.$("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2800);
  };

  // my seat in the current room: { side, index, i } where i = player index in snapshots
  FB.mySeat = () => {
    if (!S.room || !S.session) return null;
    for (const side of ["home", "away"]) {
      const index = S.room.sides[side].findIndex((s) => s.userId === S.session.userId);
      if (index !== -1) return { side, index, i: (side === "home" ? 0 : S.room.teamSize) + index };
    }
    return null;
  };

  // ---------- session & REST ----------
  const KEY = "fb_session";
  FB.loadSession = () => {
    try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; }
  };
  FB.setSession = (s, userId, email) => {
    S.session = s ? { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at, userId, email } : null;
    try {
      if (S.session) localStorage.setItem(KEY, JSON.stringify(S.session));
      else localStorage.removeItem(KEY);
    } catch (e) { /* storage unavailable */ }
  };

  FB.freshToken = async () => {
    if (!S.session) throw new Error("not_logged_in");
    if (S.session.expires_at * 1000 - Date.now() > 60000) return;
    const data = await FB.api("/api/auth/refresh", { method: "POST", body: { refresh_token: S.session.refresh_token } });
    FB.setSession(data.session, S.session.userId, S.session.email);
  };

  FB.api = async (path, opts) => {
    const { method = "GET", body, auth = false } = opts || {};
    const headers = { "Content-Type": "application/json" };
    if (auth) {
      await FB.freshToken();
      headers.Authorization = "Bearer " + S.session.access_token;
    }
    let res;
    try {
      res = await fetch(FB.SERVER + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    } catch (e) {
      throw new Error("network_error");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "http_" + res.status);
    return data;
  };

  // ---------- socket ----------
  function loadSocketLib() {
    if (window.io) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = FB.SERVER + "/socket.io/socket.io.js";
      s.onload = resolve;
      s.onerror = () => reject(new Error("cannot_load_socket_io"));
      document.head.appendChild(s);
    });
  }

  // round-trip time every 2 s (used by client-side prediction)
  let pingTimer = null;
  function startPing() {
    clearInterval(pingTimer);
    const ping = () => {
      const sock = S.socket;
      if (!sock || !sock.connected) return;
      const t0 = performance.now();
      sock.timeout(3000).emit("ping_server", (err) => {
        if (err) return;
        const sample = performance.now() - t0;
        S.rtt = S.rtt == null ? sample : S.rtt * 0.7 + sample * 0.3;
      });
    };
    ping();
    pingTimer = setInterval(ping, 2000);
  }

  FB.openSocket = async () => {
    await loadSocketLib();
    if (S.socket) S.socket.disconnect();
    const socket = window.io(FB.SERVER, {
      auth: (cb) => {
        FB.freshToken().then(() => cb({ token: S.session.access_token })).catch(() => cb({ token: "" }));
      },
    });
    S.socket = socket;
    socket.on("connect", () => { FB.emit("status", "online"); startPing(); });
    socket.on("disconnect", (reason) => FB.emit("status", "offline: " + reason));
    socket.on("connect_error", (err) => {
      FB.emit("status", "error: " + err.message);
      if (err.message === "unauthorized") FB.emit("unauthorized");
    });
    socket.on("session:replaced", () => FB.toast("This account was opened somewhere else"));
    socket.on("room:state", (v) => FB.emit("roomState", v));
    socket.on("match:start", () => FB.emit("matchStart"));
    socket.on("match:init", (d) => FB.emit("init", d));
    socket.on("match:state", (d) => FB.emit("state", { d, at: performance.now() }));
    socket.on("match:event", (l) => FB.emit("events", l));
    socket.on("match:end", (d) => FB.emit("end", d));
    socket.on("room:closed", () => FB.emit("closed"));
  };

  FB.closeSocket = () => {
    clearInterval(pingTimer);
    if (S.socket) S.socket.disconnect();
    S.socket = null;
  };

  // emit with ack -> { ok, error? }
  FB.call = (ev, payload) => new Promise((resolve) => {
    if (!S.socket) return resolve({ ok: false, error: "not_connected" });
    S.socket.timeout(5000).emit(ev, payload || {}, (err, res) => resolve(err ? { ok: false, error: "timeout" } : res));
  });
  FB.act = async (ev, payload) => {
    const res = await FB.call(ev, payload);
    if (!res.ok) FB.toast(res.error);
    return res;
  };
})();
