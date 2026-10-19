import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/http.js";
import { MAX_MONEY, contractTerms, int, paging, position, text, uuid } from "../utils/validate.js";
import {
  browseListings,
  buyListing,
  cancelListing,
  createListing,
  listFreeAgents,
  payReleaseClause,
  signFreeAgent,
} from "../services/market.service.js";

const router = Router();
router.use(requireAuth);

const overall = (v) => int(v, { min: 1, max: 99, code: "invalid_overall", fallback: null });
const price = (v) => int(v, { min: 1, max: MAX_MONEY, code: "invalid_price", fallback: null });

// GET /api/market/listings?q=&position=&minOverall=&maxOverall=&minPrice=&maxPrice=&sort=&limit=&offset=
router.get(
  "/listings",
  asyncHandler(async (req, res) => {
    const q = req.query;
    res.json(
      await browseListings({
        q: text(q.q),
        position: position(q.position),
        minOverall: overall(q.minOverall),
        maxOverall: overall(q.maxOverall),
        minPrice: price(q.minPrice),
        maxPrice: price(q.maxPrice),
        sort: typeof q.sort === "string" ? q.sort : undefined,
        ...paging(q),
      })
    );
  })
);

// POST /api/market/listings  { club_id, player_id, asking_price, hours? }
router.post(
  "/listings",
  asyncHandler(async (req, res) => {
    const b = req.body ?? {};
    const result = await createListing(req.user.id, {
      clubId: uuid(b.club_id, "invalid_club_id"),
      playerId: uuid(b.player_id, "invalid_player_id"),
      askingPrice: int(b.asking_price, { min: 1, max: MAX_MONEY, code: "invalid_price" }),
      hours: int(b.hours, { min: 1, max: 168, code: "invalid_hours", fallback: 48 }),
    });
    res.status(201).json(result);
  })
);

// DELETE /api/market/listings/:listingId
router.delete(
  "/listings/:listingId",
  asyncHandler(async (req, res) => {
    res.json(await cancelListing(req.user.id, uuid(req.params.listingId)));
  })
);

// POST /api/market/listings/:listingId/buy  { club_id, weekly_salary?, years? }
router.post(
  "/listings/:listingId/buy",
  asyncHandler(async (req, res) => {
    const b = req.body ?? {};
    const { salary, years } = contractTerms(b);
    res.json(
      await buyListing(req.user.id, uuid(req.params.listingId), {
        clubId: uuid(b.club_id, "invalid_club_id"),
        salary,
        years,
      })
    );
  })
);

// GET /api/market/free-agents?q=&position=&minOverall=&maxOverall=&sort=&limit=&offset=
router.get(
  "/free-agents",
  asyncHandler(async (req, res) => {
    const q = req.query;
    res.json(
      await listFreeAgents({
        q: text(q.q),
        position: position(q.position),
        minOverall: overall(q.minOverall),
        maxOverall: overall(q.maxOverall),
        sort: typeof q.sort === "string" ? q.sort : undefined,
        ...paging(q),
      })
    );
  })
);

// POST /api/market/free-agents/:playerId/sign  { club_id, weekly_salary?, years? }
router.post(
  "/free-agents/:playerId/sign",
  asyncHandler(async (req, res) => {
    const b = req.body ?? {};
    const { salary, years } = contractTerms(b);
    res.json(
      await signFreeAgent(req.user.id, uuid(req.params.playerId), {
        clubId: uuid(b.club_id, "invalid_club_id"),
        salary,
        years,
      })
    );
  })
);

// POST /api/market/release-clause/:playerId  { club_id, weekly_salary?, years? }
router.post(
  "/release-clause/:playerId",
  asyncHandler(async (req, res) => {
    const b = req.body ?? {};
    const { salary, years } = contractTerms(b);
    res.json(
      await payReleaseClause(req.user.id, uuid(req.params.playerId), {
        clubId: uuid(b.club_id, "invalid_club_id"),
        salary,
        years,
      })
    );
  })
);

export default router;
