import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/http.js";
import { int, paging, position, text, uuid } from "../utils/validate.js";
import { getCard, searchCards } from "../services/card.service.js";

const router = Router();
router.use(requireAuth);

// GET /api/players?q=&position=&minOverall=&maxOverall=&club_id=&sort=&limit=&offset=
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = req.query;
    const clubId = typeof q.club_id === "string" && q.club_id !== "" ? uuid(q.club_id, "invalid_club_id") : undefined;
    res.json(
      await searchCards({
        q: text(q.q),
        position: position(q.position),
        minOverall: int(q.minOverall, { min: 1, max: 99, code: "invalid_overall", fallback: null }),
        maxOverall: int(q.maxOverall, { min: 1, max: 99, code: "invalid_overall", fallback: null }),
        clubId,
        sort: typeof q.sort === "string" ? q.sort : undefined,
        ...paging(q),
      })
    );
  })
);

// GET /api/players/:playerId
router.get(
  "/:playerId",
  asyncHandler(async (req, res) => {
    res.json({ card: await getCard(uuid(req.params.playerId)) });
  })
);

export default router;
