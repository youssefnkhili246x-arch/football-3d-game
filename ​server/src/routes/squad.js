import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/http.js";
import { uuid } from "../utils/validate.js";
import { getSquad, saveSquad } from "../services/squad.service.js";

// mounted at /api/clubs/:clubId/squad
const router = Router({ mergeParams: true });
router.use(requireAuth);

// GET /api/clubs/:clubId/squad
router.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json({ squad: await getSquad(uuid(req.params.clubId)) });
  })
);

// PUT /api/clubs/:clubId/squad  { formation, starters: [11 ids], subs: [0-7 ids] }
router.put(
  "/",
  asyncHandler(async (req, res) => {
    res.json({ squad: await saveSquad(req.user.id, uuid(req.params.clubId), req.body) });
  })
);

export default router;
