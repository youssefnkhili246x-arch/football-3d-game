import { supabase } from "../config/supabase.js";

// Returns the Supabase user for a valid access token, otherwise null.
// getUser() asks Supabase Auth to validate the token (also rejects revoked sessions).
export async function verifyToken(token) {
  if (typeof token !== "string" || token.length === 0) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

// HTTP: header  Authorization: Bearer <access_token>
export async function requireAuth(req, res, next) {
  const [scheme, token] = (req.headers.authorization ?? "").split(" ");
  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "missing_token" });
  }
  try {
    const user = await verifyToken(token);
    if (!user) return res.status(401).json({ error: "invalid_token" });
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

// Socket.io: client connects with  io(url, { auth: { token } })
export async function socketAuth(socket, next) {
  try {
    const user = await verifyToken(socket.handshake.auth?.token);
    if (!user) return next(new Error("unauthorized"));
    socket.data.user = user;
    next();
  } catch {
    next(new Error("auth_failed"));
  }
}
