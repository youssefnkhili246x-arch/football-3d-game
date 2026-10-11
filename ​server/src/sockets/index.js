import { socketAuth } from "../middleware/auth.js";
import { handleDisconnect, registerLobbyHandlers, restoreSession } from "./lobby.socket.js";

const userSockets = new Map(); // userId -> socket.id (one active connection per user)

export function registerSockets(io) {
  // Every socket must present a valid Supabase access token
  io.use(socketAuth);

  io.on("connection", (socket) => {
    const userId = socket.data.user.id;
    console.log(`socket connected: ${socket.id} (user ${userId})`);

    // The newest connection wins; set the map first so the old socket's
    // disconnect handler knows it was replaced.
    const previousId = userSockets.get(userId);
    userSockets.set(userId, socket.id);
    if (previousId && previousId !== socket.id) {
      const previous = io.sockets.sockets.get(previousId);
      if (previous) {
        previous.emit("session:replaced");
        previous.disconnect(true);
      }
    }

    registerLobbyHandlers(io, socket);
    restoreSession(io, socket);

    // Simple connectivity test from the HTML5 client
    socket.on("ping_server", (ack) => {
      if (typeof ack === "function") ack({ pong: Date.now() });
    });

    socket.on("disconnect", (reason) => {
      console.log(`socket disconnected: ${socket.id} (${reason})`);
      if (userSockets.get(userId) !== socket.id) return; // replaced by a newer connection
      userSockets.delete(userId);
      handleDisconnect(io, userId);
    });
  });
}
