import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/http.js";
import { uuid } from "../utils/validate.js";
import { buyCosmetic, equipCosmetic, getCoins, listCosmetics } from "../services/coins.service.js";

const router = Router();
router.use(requireAuth);

// GET /api/coins  -> balance + last 20 transactions
router.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json(await getCoins(req.user.id));
  })
);

// GET /api/coins/cosmetics  -> catalog with owned / equipped flags
router.get(
  "/cosmetics",
  asyncHandler(async (req, res) => {
    res.json({ cosmetics: await listCosmetics(req.user.id) });
  })
);

// POST /api/coins/cosmetics/:cosmeticId/buy
router.post(
  "/cosmetics/:cosmeticId/buy",
  asyncHandler(async (req, res) => {
    res.json(await buyCosmetic(req.user.id, uuid(req.params.cosmeticId, "invalid_cosmetic_id")));
  })
);

// POST /api/coins/cosmetics/:cosmeticId/equip
router.post(
  "/cosmetics/:cosmeticId/equip",
  asyncHandler(async (req, res) => {
    res.json(await equipCosmetic(req.user.id, uuid(req.params.cosmeticId, "invalid_cosmetic_id")));
  })
);

export default router;
