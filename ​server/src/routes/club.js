import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/http.js";
import { uuid } from "../utils/validate.js";
import { createClub, getClub, getClubPlayers, getMyClub } from "../services/club.service.js";
import { trainPlayer } from "../services/card.service.js";
import { releasePlayer } from "../services/market.service.js";

const router = Router();
router.use(requireAuth);

// POST /api/clubs  { name, country_id? }  -> creates my club with a generated squad
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const { name, country_id: countryId } = req.body ?? {};
    res.status(201).json({ club: await createClub(req.user.id, { name, countryId }) });
  })
);

// GET /api/clubs/mine
router.get(
  "/mine",
  asyncHandler(async (req, res) => {
    res.json({ club: await getMyClub(req.user.id) });
  })
);

// GET /api/clubs/:clubId
router.get(
  "/:clubId",
  asyncHandler(async (req, res) => {
    res.json({ club: await getClub(uuid(req.params.clubId), req.user.id) });
  })
);

// GET /api/clubs/:clubId/players  -> player cards with contract info
router.get(
  "/:clubId/players",
  asyncHandler(async (req, res) => {
    res.json({ players: await getClubPlayers(uuid(req.params.clubId)) });
  })
);

// POST /api/clubs/:clubId/players/:playerId/train  { attribute }
router.post(
  "/:clubId/players/:playerId/train",
  asyncHandler(async (req, res) => {
    const { attribute } = req.body ?? {};
    res.json(
      await trainPlayer(req.user.id, uuid(req.params.clubId), uuid(req.params.playerId), attribute)
    );
  })
);

// POST /api/clubs/:clubId/players/:playerId/release
router.post(
  "/:clubId/players/:playerId/release",
  asyncHandler(async (req, res) => {
    res.json(await releasePlayer(req.user.id, uuid(req.params.clubId), uuid(req.params.playerId)));
  })
);

export default router;
