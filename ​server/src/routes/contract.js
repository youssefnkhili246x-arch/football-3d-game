import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/http.js";
import { MAX_MONEY, contractTerms, int, uuid } from "../utils/validate.js";
import { renewContract } from "../services/contract.service.js";

// mounted at /api/clubs/:clubId/contracts
const router = Router({ mergeParams: true });
router.use(requireAuth);

// POST /api/clubs/:clubId/contracts/:playerId/renew  { weekly_salary?, years?, release_clause? }
router.post(
  "/:playerId/renew",
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    const { salary, years } = contractTerms(body);
    const releaseClause = int(body.release_clause, {
      min: 1,
      max: MAX_MONEY,
      code: "invalid_release_clause",
      fallback: null,
    });
    res.json(
      await renewContract(req.user.id, uuid(req.params.clubId), uuid(req.params.playerId), {
        salary,
        years,
        releaseClause,
      })
    );
  })
);

export default router;
