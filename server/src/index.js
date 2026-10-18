import http from "node:http";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import { Server } from "socket.io";
import { env } from "./config/env.js";
import { supabase } from "./config/supabase.js";
import { registerSockets } from "./sockets/index.js";
import { ApiError } from "./utils/http.js";
import authRoutes from "./routes/auth.js";
import profileRoutes from "./routes/profile.js";

// ---------- Express ----------
const app = express();
app.use(cors({ origin: env.corsOrigins }));
app.use(express.json({ limit: "100kb" }));

// Game client (server/public), served from the same origin
app.use(express.static(fileURLToPath(new URL("../public", import.meta.url))));

// Health check: server + database
app.get("/health", async (_req, res) => {
  try {
    const { error } = await supabase
      .from("countries")
      .select("id", { head: true, count: "exact" })
      .limit(1);
    if (error) throw error;
    res.json({ ok: true, db: "up", uptime: Math.round(process.uptime()) });
  } catch (err) {
    console.error("Health check failed:", err.message);
    res.status(503).json({ ok: false, db: "down" });
  }
});

// ---------- API routes ----------
app.use("/api/auth", authRoutes);
app.use("/api/profile", profileRoutes);

app.use((_req, res) => res.status(404).json({ error: "not_found" }));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err instanceof ApiError) return res.status(err.status).json({ error: err.code });
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "invalid_json" });
  console.error(err);
  res.status(500).json({ error: "server_error" });
});

// ---------- HTTP + Socket.io (same port) ----------
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: env.corsOrigins },
});

registerSockets(io); // auth, rooms, matchmaking

// ---------- Start / shutdown ----------
server.listen(env.port, () => {
  console.log(`Server running on port ${env.port} (${env.nodeEnv})`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    console.log(`${signal} received, shutting down...`);
    io.close();
    server.close(() => process.exit(0));
  });
}
