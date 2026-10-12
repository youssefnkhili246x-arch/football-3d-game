import { performance } from "node:perf_hooks";
import * as rooms from "./roomManager.js";
import { MatchWorld } from "./engine/world.js";
import { DT, SNAPSHOT_EVERY } from "./engine/constants.js";
import { finishMatch } from "../services/match.service.js";

const INPUT_TIMEOUT_MS = 500; // a human who stops sending input stops moving
const MAX_CATCHUP_STEPS = 5; // never simulate more than this many ticks per timer call
const FINISHED_ROOM_LIFETIME_MS = 20_000; // players keep the result screen, then the room closes

const running = new Map(); // room.code -> { world, timer, lastInput }

const channel = (room) => `room:${room.code}`;
const seatIndex = (room, side, slot) => (side === "home" ? 0 : room.teamSize) + slot;

function stop(room) {
  const entry = running.get(room.code);
  if (entry) clearInterval(entry.timer);
  running.delete(room.code);
}

// Humans control their player; any other slot (bot, disconnected human) is played by the AI
function syncControllers(room, world, lastInput) {
  const now = Date.now();
  for (const side of ["home", "away"]) {
    room.sides[side].forEach((slot, index) => {
      const i = seatIndex(room, side, index);
      const human = slot.userId && !slot.bot ? slot.userId : null;
      world.setController(i, human);
      if (human && now - (lastInput.get(i) ?? 0) > INPUT_TIMEOUT_MS) {
        world.setInput(i, { dx: 0, dy: 0 });
      }
    });
  }
}

function endMatch(io, room, world) {
  stop(room);
  const { score, goals } = world.result();
  rooms.finishRoom(room);

  const ch = channel(room);
  io.to(ch).emit("room:state", rooms.publicView(room));
  io.to(ch).emit("match:end", { score, goals });
  finishMatch(room.matchId, score[0], score[1]).catch((err) =>
    console.error("could not save match result:", err.message)
  );

  setTimeout(() => {
    if (!rooms.isActive(room)) return;
    io.to(ch).emit("room:closed", { reason: "finished" });
    io.in(ch).socketsLeave(ch);
    rooms.destroyRoom(room);
  }, FINISHED_ROOM_LIFETIME_MS);
}

export function startMatchLoop(io, room) {
  if (running.has(room.code)) return;

  const world = new MatchWorld({
    teamSize: room.teamSize,
    mode: room.mode,
    aiDifficulty: room.aiDifficulty,
  });
  const lastInput = new Map(); // player index -> time of the last input
  const ch = channel(room);

  io.to(ch).emit("match:init", { matchId: room.matchId, ...world.initInfo() });

  let acc = 0;
  let last = performance.now();

  const timer = setInterval(() => {
    if (!rooms.isActive(room)) return stop(room); // room was closed

    const now = performance.now();
    acc += Math.min((now - last) / 1000, 0.25);
    last = now;

    let steps = 0;
    while (acc >= DT && steps < MAX_CATCHUP_STEPS) {
      acc -= DT;
      steps++;

      syncControllers(room, world, lastInput);
      world.step();

      const events = world.drainEvents();
      if (events.length > 0) io.to(ch).emit("match:event", events);
      if (world.tick % SNAPSHOT_EVERY === 0) io.to(ch).volatile.emit("match:state", world.snapshot());

      if (world.phase === "ended") return endMatch(io, room, world);
    }
    if (steps === MAX_CATCHUP_STEPS) acc = 0; // server too slow: drop the backlog
  }, Math.round(1000 * DT));

  running.set(room.code, { world, timer, lastInput });
}

// Called for every "match:input" socket event
export function handleInput(userId, data) {
  const seat = rooms.seatOf(userId);
  if (!seat || seat.room.status !== "live") return;
  const entry = running.get(seat.room.code);
  if (!entry) return;

  const i = seatIndex(seat.room, seat.side, seat.index);
  entry.lastInput.set(i, Date.now());
  entry.world.setInput(i, { dx: data.dx, dy: data.dy, sprint: data.sprint });

  // Only these fields are accepted: clients can never choose a pass target themselves
  if (data.action === "shoot" || data.action === "pass") {
    entry.world.queueAction(i, {
      type: data.action,
      power: data.power,
      aimX: data.aimX,
      aimY: data.aimY,
    });
  }
}
