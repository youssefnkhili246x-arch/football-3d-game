import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { ApiError, asyncHandler } from "../utils/http.js";
import { createProfile, getProfile, updateProfile } from "../services/profile.service.js";

const router = Router();
router.use(requireAuth);

// POST /api/profile  { username, country_id? }  (for accounts that have no profile yet)
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const { username, country_id } = req.body ?? {};
    const profile = await createProfile(req.user.id, {
      username,
      countryId: country_id ?? null,
    });
    res.status(201).json({ profile });
  })
);

// GET /api/profile/me
router.get(
  "/me",
  asyncHandler(async (req, res) => {
    const profile = await getProfile(req.user.id);
    if (!profile) throw new ApiError(404, "profile_not_found");
    res.json({ profile });
  })
);

// PATCH /api/profile/me  { username?, country_id? }
router.patch(
  "/me",
  asyncHandler(async (req, res) => {
    const { username, country_id } = req.body ?? {};
    const profile = await updateProfile(req.user.id, { username, countryId: country_id });
    res.json({ profile });
  })
);

export default router;
