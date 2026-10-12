import { randomInt } from "node:crypto";
import { ApiError } from "../utils/http.js";

// Rooms live in memory (single server instance). No sockets or database in this file.
// Room status: "lobby" -> "starting" -> "live"

export const ROOM_MODES = ["pro_clubs", "coop_tournament"];
export const MAX_TEAM_SIZE = 11;
export const DEFAULT_DIFFICULTY = 3;

const SIDES = ["home", "away"];
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

const rooms = new Map(); // code -> room
const userRoom = new Map(); // userId -> code

// ---------- slots ----------
const emptySlot = () => ({ userId: null, username: null, ready: false, connected: false, bot: false });
const botSlot = () => ({ userId: null, username: null, ready: true, connected: false, bot: true });

const allSlots = (room) =>
  SIDES.flatMap((side) => room.sides[side].map((slot, index) => ({ side, index, slot })));
const seatedHumans = (room) => allSlots(room).map((s) => s.slot).filter((slot) => slot.userId);
const findSlot = (room, userId) => allSlots(room).find((s) => s.slot.userId === userId) ?? null;
const freeSlotIndex = (room, side) => room.sides[side].findIndex((s) => !s.userId && !s.bot);
const humanCount = (room, side) => room.sides[side].filter((s) => s.userId).length;

function generateCode() {
  for (;;) {
    let code = "";
    for (let i = 0; i < 5; i++) code += CODE_CHARS[randomInt(CODE_CHARS.length)];
    if (!rooms.has(code)) return code;
  }
}

function seat(room, side, user) {
  const index = freeSlotIndex(room, side);
  if (index === -1) throw new ApiError(409, "side_full");
  room.sides[side][index] = {
    userId: user.id,
    username: user.username,
    ready: false,
    connected: true,
    bot: false,
  };
  userRoom.set(user.id, room.code);
}

function pickSide(room, requested) {
  const options = SIDES.filter((side) => freeSlotIndex(room, side) !== -1);
  if (requested !== undefined && requested !== null) {
    if (!SIDES.includes(requested)) throw new ApiError(400, "invalid_side");
    if (!options.includes(requested)) throw new ApiError(409, "side_full");
    return requested;
  }
  if (options.length === 0) throw new ApiError(409, "room_full");
  // balance teams: join the side with fewer humans
  return [...options].sort((a, b) => humanCount(room, a) - humanCount(room, b))[0];
}

function fillBots(room) {
  for (const side of SIDES) {
    room.sides[side] = room.sides[side].map((slot) => (slot.userId ? slot : botSlot()));
  }
}

// After a seat is vacated: close the room if no human is left, else fix the owner
function afterSeatChange(room, leavingUserId) {
  const humans = seatedHumans(room);
  if (humans.length === 0) {
    destroyRoom(room);
    return { room, destroyed: true };
  }
  if (room.ownerId === leavingUserId) {
    room.ownerId = (humans.find((s) => s.connected) ?? humans[0]).userId;
  }
  return { room, destroyed: false };
}

// ---------- queries ----------
export const getRoom = (code) => rooms.get(String(code ?? "").toUpperCase()) ?? null;

export function getRoomOf(userId) {
  const code = userRoom.get(userId);
  return code ? rooms.get(code) ?? null : null;
}

export const isActive = (room) => rooms.get(room.code) === room;
export const isFull = (room) => SIDES.every((side) => freeSlotIndex(room, side) === -1);
export const connectedHumans = (room) => seatedHumans(room).filter((s) => s.connected).length;

export function findOpenPublicRoom({ mode, teamSize, aiDifficulty }) {
  let best = null;
  for (const room of rooms.values()) {
    if (!room.isPublic || room.status !== "lobby" || isFull(room)) continue;
    if (room.mode !== mode || room.teamSize !== teamSize || room.aiDifficulty !== aiDifficulty) continue;
    // fill the busiest room first
    if (!best || seatedHumans(room).length > seatedHumans(best).length) best = room;
  }
  return best;
}

export function publicView(room) {
  const view = (s) => ({
    userId: s.userId,
    username: s.username,
    ready: s.ready,
    connected: s.connected,
    bot: s.bot,
  });
  return {
    code: room.code,
    mode: room.mode,
    teamSize: room.teamSize,
    aiDifficulty: room.aiDifficulty,
    isPublic: room.isPublic,
    ownerId: room.ownerId,
    status: room.status,
    matchId: room.matchId,
    sides: { home: room.sides.home.map(view), away: room.sides.away.map(view) },
  };
}

// ---------- lobby ----------
export function createRoom({ user, mode, teamSize, aiDifficulty, isPublic }) {
  const size = teamSize ?? MAX_TEAM_SIZE;
  const difficulty = aiDifficulty ?? DEFAULT_DIFFICULTY;

  if (userRoom.has(user.id)) throw new ApiError(409, "already_in_room");
  if (!ROOM_MODES.includes(mode)) throw new ApiError(400, "invalid_mode");
  if (!Number.isInteger(size) || size < 1 || size > MAX_TEAM_SIZE) throw new ApiError(400, "invalid_team_size");
  if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5) throw new ApiError(400, "invalid_difficulty");

  const room = {
    code: generateCode(),
    mode,
    teamSize: size,
    aiDifficulty: difficulty,
    isPublic: isPublic === true,
    ownerId: user.id,
    status: "lobby",
    matchId: null,
    createdAt: Date.now(),
    timer: null, // auto-start timer (public rooms)
    emptyTimer: null, // grace timer when no human is connected in a live match
    sides: {
      home: Array.from({ length: size }, emptySlot),
      // Co-op: the opponent team is always AI
      away: Array.from({ length: size }, mode === "coop_tournament" ? botSlot : emptySlot),
    },
  };

  rooms.set(room.code, room);
  seat(room, "home", user);
  return room;
}

export function joinRoom({ code, user, side }) {
  const room = getRoom(code);
  if (!room) throw new ApiError(404, "room_not_found");
  if (userRoom.has(user.id)) throw new ApiError(409, "already_in_room");
  if (room.status !== "lobby") throw new ApiError(409, "room_not_joinable");
  seat(room, pickSide(room, side), user);
  return room;
}

// Voluntary leave. In a live match the slot becomes a permanent bot.
export function leaveRoom(userId) {
  const room = getRoomOf(userId);
  userRoom.delete(userId);
  if (!room) return null;

  const found = findSlot(room, userId);
  if (found) {
    room.sides[found.side][found.index] = room.status === "live" ? botSlot() : emptySlot();
  }
  return afterSeatChange(room, userId);
}

export function setReady(userId, ready) {
  const room = getRoomOf(userId);
  if (!room) throw new ApiError(404, "not_in_room");
  if (room.status !== "lobby") throw new ApiError(409, "room_not_in_lobby");
  findSlot(room, userId).slot.ready = ready === true;
  return room;
}

// ---------- connection drops ----------
// Lobby: the player is removed. Live match: a bot takes the slot, the player can come back.
export function dropUser(userId) {
  const room = getRoomOf(userId);
  if (!room) return null;
  if (room.status !== "live") return leaveRoom(userId);

  const found = findSlot(room, userId);
  if (found) {
    found.slot.connected = false;
    found.slot.bot = true;
  }
  return { room, destroyed: false };
}

export function reconnectUser(userId) {
  const room = getRoomOf(userId);
  if (!room) return null;

  const found = findSlot(room, userId);
  if (found) {
    found.slot.connected = true;
    found.slot.bot = false;
  }
  clearTimeout(room.emptyTimer);
  room.emptyTimer = null;
  return room;
}

// ---------- start ----------
export function assertStartable(room, { requireReady = true } = {}) {
  if (room.status !== "lobby") throw new ApiError(409, "already_started");
  const humans = seatedHumans(room);
  if (humans.length === 0) throw new ApiError(409, "no_players");
  if (requireReady && humans.some((s) => s.userId !== room.ownerId && !s.ready)) {
    throw new ApiError(409, "players_not_ready");
  }
}

export function beginStart(room) {
  if (room.status !== "lobby") throw new ApiError(409, "already_started");
  clearTimeout(room.timer);
  room.timer = null;
  room.status = "starting";
}

export function completeStart(room, matchId) {
  fillBots(room); // empty slots -> AI bots
  room.matchId = matchId;
  room.status = "live";
}

export function abortStart(room) {
  room.status = "lobby";
}

export function destroyRoom(room) {
  clearTimeout(room.timer);
  clearTimeout(room.emptyTimer);
  room.timer = null;
  room.emptyTimer = null;
  for (const slot of seatedHumans(room)) userRoom.delete(slot.userId);
  rooms.delete(room.code);
}

// ---------- match end / lookups used by the match runner ----------
export function finishRoom(room) {
  clearTimeout(room.emptyTimer);
  room.emptyTimer = null;
  room.status = "finished";
}

export function seatOf(userId) {
  const room = getRoomOf(userId);
  const found = room ? findSlot(room, userId) : null;
  return found ? { room, side: found.side, index: found.index } : null;
}
