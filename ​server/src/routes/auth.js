import { Router } from "express";
import { createClient } from "@supabase/supabase-js";
import { env } from "../config/env.js";
import { supabase } from "../config/supabase.js";
import { ApiError, asyncHandler } from "../utils/http.js";
import { createProfile, getProfile, isValidUsername } from "../services/profile.service.js";

const router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Fresh anon client per call, so a user session never leaks into the service_role client
const anonClient = () =>
  createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

const toSession = (s) => ({
  access_token: s.access_token,
  refresh_token: s.refresh_token,
  expires_at: s.expires_at,
});

// POST /api/auth/register  { email, password, username, country_id? }
router.post(
  "/register",
  asyncHandler(async (req, res) => {
    const { email, password, username, country_id } = req.body ?? {};

    if (typeof email !== "string" || !EMAIL_RE.test(email)) throw new ApiError(400, "invalid_email");
    if (typeof password !== "string" || password.length < 8 || password.length > 72) {
      throw new ApiError(400, "weak_password");
    }
    if (!isValidUsername(username)) throw new ApiError(400, "invalid_username");

    // email_confirm: true = no confirmation email (Supabase free email quota is tiny)
    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createErr) {
      if (createErr.code === "email_exists") throw new ApiError(409, "email_taken");
      if (createErr.code === "weak_password") throw new ApiError(400, "weak_password");
      throw createErr;
    }

    const userId = created.user.id;
    try {
      await createProfile(userId, { username, countryId: country_id ?? null });
    } catch (err) {
      await supabase.auth.admin.deleteUser(userId); // rollback: no orphan account
      throw err;
    }

    const { data: login, error: loginErr } = await anonClient().auth.signInWithPassword({
      email,
      password,
    });
    if (loginErr) throw loginErr;

    res.status(201).json({
      user: { id: userId, email },
      session: toSession(login.session),
    });
  })
);

// POST /api/auth/login  { email, password }
router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, password } = req.body ?? {};
    if (typeof email !== "string" || typeof password !== "string") {
      throw new ApiError(400, "missing_credentials");
    }

    const { data, error } = await anonClient().auth.signInWithPassword({ email, password });
    if (error) {
      throw error.code === "invalid_credentials" ? new ApiError(401, "invalid_credentials") : error;
    }

    const profile = await getProfile(data.user.id); // null => client must call POST /api/profile
    res.json({
      user: { id: data.user.id, email: data.user.email },
      session: toSession(data.session),
      profile,
    });
  })
);

// POST /api/auth/refresh  { refresh_token }
router.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const { refresh_token } = req.body ?? {};
    if (typeof refresh_token !== "string") throw new ApiError(400, "missing_refresh_token");

    const { data, error } = await anonClient().auth.refreshSession({ refresh_token });
    if (error || !data.session) throw new ApiError(401, "invalid_refresh_token");

    res.json({ session: toSession(data.session) });
  })
);

export default router;
