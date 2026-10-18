"use strict";
// Boot: wire the UI, restore a saved session, open the lobby.
(async function (FB) {
  FB.initLobby();
  FB.initControls();
  FB.layout();
  FB.startLoop();
  window.addEventListener("resize", FB.layout);
  window.addEventListener("orientationchange", FB.layout);

  const session = FB.loadSession();
  if (!session) return FB.show("auth");
  FB.s.session = session;

  try {
    const data = await FB.api("/api/profile/me", { auth: true });
    await FB.afterLogin(data.profile);
  } catch (e) {
    if (e.message === "profile_not_found") return FB.show("profile");
    if (["invalid_token", "missing_token", "not_logged_in", "invalid_refresh_token"].includes(e.message)) FB.setSession(null);
    FB.toast(e.message);
    FB.show("auth");
  }
})(window.FB);
