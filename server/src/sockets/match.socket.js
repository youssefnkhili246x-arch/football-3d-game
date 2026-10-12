import { handleInput } from "../game/matchRunner.js";

const MIN_MOVE_INTERVAL_MS = 15; // movement inputs faster than this are ignored
const MIN_ACTION_INTERVAL_MS = 120; // shoot / pass presses

// Client sends (about 20-30 times per second):
//   socket.emit("match:input", { dx, dy, sprint, action, power, aimX, aimY })
//   dx, dy in [-1, 1] = joystick, action = "shoot" | "pass" (optional), power in [0, 1]
export function registerMatchHandlers(socket) {
  let lastMoveAt = 0;
  let lastActionAt = 0;

  socket.on("match:input", (data) => {
    if (!data || typeof data !== "object") return;
    const now = Date.now();

    const isAction = data.action === "shoot" || data.action === "pass";
    if (isAction) {
      if (now - lastActionAt < MIN_ACTION_INTERVAL_MS) return;
      lastActionAt = now;
    } else {
      if (now - lastMoveAt < MIN_MOVE_INTERVAL_MS) return;
      lastMoveAt = now;
    }

    handleInput(socket.data.user.id, data);
  });
}
