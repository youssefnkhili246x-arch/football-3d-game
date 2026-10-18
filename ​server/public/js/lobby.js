"use strict";
// Screens, login / register / profile, lobby and room UI.
(function (FB) {
  const $ = FB.$;
  const S = FB.s;

  FB.show = (name) => {
    for (const id of ["auth", "profile", "lobby", "game"]) $(id).classList.toggle("hidden", id !== name);
    S.inGame = name === "game";
    if (S.inGame) FB.layout();
  };

  // ---------- auth ----------
  async function doAuth(kind) {
    const email = $("email").value.trim();
    const password = $("password").value;
    try {
      let data;
      if (kind === "register") {
        const username = $("username").value.trim();
        data = await FB.api("/api/auth/register", { method: "POST", body: { email, password, username } });
        data.profile = { username };
      } else {
        data = await FB.api("/api/auth/login", { method: "POST", body: { email, password } });
      }
      FB.setSession(data.session, data.user.id, data.user.email);
      await FB.afterLogin(data.profile);
    } catch (e) {
      FB.toast(e.message);
    }
  }

  FB.afterLogin = async (profile) => {
    if (!profile) return FB.show("profile");
    $("who").textContent = profile.username;
    await FB.openSocket();
    FB.show("lobby");
    renderRoom();
  };

  FB.logout = () => {
    FB.closeSocket();
    S.room = null;
    FB.setSession(null);
    FB.show("auth");
  };

  // ---------- lobby ----------
  function setupValues() {
    return { mode: $("mode").value, teamSize: Number($("size").value), aiDifficulty: Number($("diff").value) };
  }

  function slotHtml(s, idx) {
    let label = "— empty —";
    if (s.userId) {
      label = FB.esc(s.username);
      if (s.userId === S.session.userId) label += " (you)";
      if (s.userId === S.room.ownerId) label += " ★";
      if (s.ready) label += " ✓";
      if (!s.connected) label += " (offline)";
    } else if (s.bot) {
      label = "BOT";
    }
    return `<div class="slot ${s.userId ? "human" : s.bot ? "bot" : ""}">${idx + 1}. ${label}</div>`;
  }

  function renderRoom() {
    const room = S.room;
    $("setup").classList.toggle("hidden", !!room);
    $("roomCard").classList.toggle("hidden", !room);
    if (!room) return;

    $("roomInfo").innerHTML = `<b>Room ${FB.esc(room.code)}</b> · ${FB.esc(room.mode)} · ${room.teamSize}v${room.teamSize} · AI ${room.aiDifficulty} · ${FB.esc(room.status)}`;
    $("roomHint").textContent = room.isPublic
      ? "Quick match: starts when full or after about 20 seconds (empty slots become bots)."
      : "Private room: share the code. The owner starts the match.";
    $("homeList").innerHTML = room.sides.home.map(slotHtml).join("");
    $("awayList").innerHTML = room.sides.away.map(slotHtml).join("");

    const seat = FB.mySeat();
    const me = seat ? room.sides[seat.side][seat.index] : null;
    $("btnReady").textContent = me && me.ready ? "Not ready" : "Ready";
    $("btnReady").disabled = room.status !== "lobby";
    $("btnStart").disabled = !(room.status === "lobby" && room.ownerId === S.session.userId);
  }

  FB.listen("roomState", (view) => {
    S.room = view;
    renderRoom();
    if (view.status === "live" && !S.inGame && !S.ended) FB.startGame();
  });
  FB.listen("matchStart", () => { if (!S.inGame) FB.startGame(); });
  FB.listen("closed", () => { S.room = null; renderRoom(); });
  FB.listen("status", (text) => { $("status").textContent = text; });
  FB.listen("unauthorized", () => FB.logout());

  FB.initLobby = () => {
    $("serverUrl").textContent = FB.SERVER;
    $("size").innerHTML = Array.from({ length: 11 }, (_, k) => `<option value="${k + 1}">${k + 1} v ${k + 1}</option>`).join("");
    $("size").value = "5";
    $("diff").innerHTML = Array.from({ length: 5 }, (_, k) => `<option value="${k + 1}">Level ${k + 1}</option>`).join("");
    $("diff").value = "3";

    $("btnLogin").onclick = () => doAuth("login");
    $("btnRegister").onclick = () => doAuth("register");
    $("btnLogout").onclick = FB.logout;
    $("btnProfile").onclick = async () => {
      try {
        const data = await FB.api("/api/profile", { method: "POST", auth: true, body: { username: $("profName").value.trim() } });
        await FB.afterLogin(data.profile);
      } catch (e) {
        FB.toast(e.message);
      }
    };

    const enter = (res) => { if (res.ok) { S.room = res.room; renderRoom(); } };
    $("btnQuick").onclick = async () => enter(await FB.act("matchmaking:join", setupValues()));
    $("btnCreate").onclick = async () => enter(await FB.act("room:create", { ...setupValues(), isPublic: false }));
    $("btnJoin").onclick = async () => {
      const payload = { code: $("joinCode").value.trim().toUpperCase() };
      if ($("side").value) payload.side = $("side").value;
      enter(await FB.act("room:join", payload));
    };
    $("btnReady").onclick = () => {
      const seat = FB.mySeat();
      const me = seat ? S.room.sides[seat.side][seat.index] : null;
      FB.act("room:ready", { ready: !(me && me.ready) });
    };
    $("btnStart").onclick = () => FB.act("room:start");
    $("btnLeave").onclick = async () => {
      await FB.act("room:leave");
      S.room = null;
      renderRoom();
    };
    $("btnBack").onclick = async () => {
      if (S.room) await FB.call("room:leave");
      S.room = null;
      S.ended = false;
      FB.show("lobby");
      renderRoom();
    };
  };
})(window.FB);
