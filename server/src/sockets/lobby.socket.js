import { ApiError } from "../utils/http.js";
import { getProfile } from "../services/profile.service.js";
import { createMatch, setMatchStatus } from "../services/match.service.js";
import * as rooms from "../game/roomManager.js";

const QUICK_MATCH_WAIT_MS = 20_000; // public room waits for more players, then starts with bots
const EMPTY_LIVE_GRACE_MS = 60_000; // live match with no connected human is closed after this

const channel = (room) => `room:${room.code}`;
const broadcast = (io, room) => io.to(channel(room)).emit("room:state", rooms.publicView(room));

async function requireProfile(socket) {
  if (!socket.data.profile) socket.data.profile = await getProfile(socket.data.user.id);
  if (!socket.data.profile) throw new ApiError(403, "profile_required");
  return socket.data.profile;
}

function abandonMatch(room) {
  if (!room.matchId) return;
  setMatchStatus(room.matchId, "abandoned").catch((err) =>
    console.error("could not mark match abandoned:", err.message)
  );
}

function armEmptyTimer(room) {
  if (room.status !== "live" || room.emptyTimer || rooms.connectedHumans(room) > 0) return;
  room.emptyTimer = setTimeout(() => {
    rooms.destroyRoom(room);
    abandonMatch(room);
  }, EMPTY_LIVE_GRACE_MS);
}

function afterRoomChange(io, result) {
  if (!result) return;
  if (result.destroyed) return abandonMatch(result.room);
  broadcast(io, result.room);
  armEmptyTimer(result.room);
}

// Lobby -> live: creates the match row, fills empty slots with bots, tells everyone
async function startMatch(io, room) {
  rooms.beginStart(room); // sync: blocks double start and new joins
  try {
    const matchId = await createMatch({ mode: room.mode, aiDifficulty: room.aiDifficulty });
    if (!rooms.isActive(room)) {
      await setMatchStatus(matchId, "abandoned"); // room closed while saving
      return;
    }
    rooms.completeStart(room, matchId);
    broadcast(io, room);
    io.to(channel(room)).emit("match:start", { matchId, room: rooms.publicView(room) });
  } catch (err) {
    if (rooms.isActive(room)) {
      rooms.abortStart(room);
      broadcast(io, room);
    }
    throw err;
  }
}

function autoStart(io, room) {
  try {
    rooms.assertStartable(room, { requireReady: false });
  } catch {
    return; // already started or empty
  }
  startMatch(io, room).catch((err) => console.error("auto-start failed:", err));
}

// Handler wrapper: optional payload, ack reply { ok, error? }
function on(socket, event, fn) {
  socket.on(event, async (payload, ack) => {
    if (typeof payload === "function") {
      ack = payload;
      payload = undefined;
    }
    const reply = typeof ack === "function" ? ack : () => {};
    const data = payload && typeof payload === "object" ? payload : {};
    try {
      reply({ ok: true, ...((await fn(data)) ?? {}) });
    } catch (err) {
      if (err instanceof ApiError) return reply({ ok: false, error: err.code });
      console.error(`socket event "${event}" failed:`, err);
      reply({ ok: false, error: "server_error" });
    }
  });
}

export function registerLobbyHandlers(io, socket) {
  const userId = socket.data.user.id;
  const seatUser = async () => ({ id: userId, username: (await requireProfile(socket)).username });

  on(socket, "room:create", async (data) => {
    const room = rooms.createRoom({
      user: await seatUser(),
      mode: data.mode,
      teamSize: data.teamSize,
      aiDifficulty: data.aiDifficulty,
      isPublic: data.isPublic,
    });
    socket.join(channel(room));
    broadcast(io, room);
    return { room: rooms.publicView(room) };
  });

  on(socket, "room:join", async (data) => {
    const room = rooms.joinRoom({ code: data.code, user: await seatUser(), side: data.side });
    socket.join(channel(room));
    broadcast(io, room);
    if (room.isPublic && rooms.isFull(room)) autoStart(io, room);
    return { room: rooms.publicView(room) };
  });

  on(socket, "room:leave", async () => {
    const result = rooms.leaveRoom(userId);
    if (result) socket.leave(channel(result.room));
    afterRoomChange(io, result);
    return {};
  });

  on(socket, "room:ready", async (data) => {
    broadcast(io, rooms.setReady(userId, data.ready));
    return {};
  });

  on(socket, "room:start", async () => {
    const room = rooms.getRoomOf(userId);
    if (!room) throw new ApiError(404, "not_in_room");
    if (room.ownerId !== userId) throw new ApiError(403, "not_owner");
    rooms.assertStartable(room, { requireReady: true });
    await startMatch(io, room);
    return {};
  });

  // Quick match: join an open public room, or create one that auto-starts
  on(socket, "matchmaking:join", async (data) => {
    const user = await seatUser();
    const criteria = {
      mode: data.mode,
      teamSize: data.teamSize ?? rooms.MAX_TEAM_SIZE,
      aiDifficulty: data.aiDifficulty ?? rooms.DEFAULT_DIFFICULTY,
    };

    let room = rooms.findOpenPublicRoom(criteria);
    if (room) {
      rooms.joinRoom({ code: room.code, user });
    } else {
      room = rooms.createRoom({ user, ...criteria, isPublic: true });
      room.timer = setTimeout(() => autoStart(io, room), QUICK_MATCH_WAIT_MS);
    }

    socket.join(channel(room));
    broadcast(io, room);
    if (rooms.isFull(room)) autoStart(io, room);
    return { room: rooms.publicView(room), waitMs: QUICK_MATCH_WAIT_MS };
  });
}

// Called on every new connection: re-attach a returning player to the live match
export function restoreSession(io, socket) {
  const room = rooms.reconnectUser(socket.data.user.id);
  if (!room) return;
  socket.join(channel(room));
  broadcast(io, room);
}

// Called when a user's active socket disconnects
export function handleDisconnect(io, userId) {
  afterRoomChange(io, rooms.dropUser(userId));
}
