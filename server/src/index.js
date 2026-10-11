import http from "node:http";
import express from "express";
import cors from "cors";
import { Server } from "socket.io";
import { env } from "./config/env.js";
import { supabase } from "./config/supabase.js";

// ---------- Express ----------
const app = express();
app.use(cors({ origin: env.corsOrigins }));
app.use(express.json({ limit: "100kb" }));

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

// TODO: app.use("/api/...", routes) goes here, before the 404 handler

app.use((_req, res) => res.status(404).json({ error: "not_found" }));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "server_error" });
});

// ---------- HTTP + Socket.io (same port) ----------
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: env.corsOrigins },
});

io.on("connection", (socket) => {
  console.log(`socket connected: ${socket.id}`);

  // Simple connectivity test from the HTML5 client
  socket.on("ping_server", (ack) => {
    if (typeof ack === "function") ack({ pong: Date.now() });
  });

  socket.on("disconnect", (reason) => {
    console.log(`socket disconnected: ${socket.id} (${reason})`);
  });
});

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
