import { supabase } from "../config/supabase.js";
import { ApiError } from "../utils/http.js";
import { isUuid } from "../utils/validate.js";
import { rpc, run } from "./db.js";

export const DEFAULT_FORMATION = "4-3-3";

// the player_pos enum has no LM / RM, wingers (LW / RW) play wide in every formation
export const FORMATIONS = {
  "4-3-3": ["GK", "LB", "CB", "CB", "RB", "CM", "CM", "CM", "LW", "RW", "ST"],
  "4-4-2": ["GK", "LB", "CB", "CB", "RB", "LW", "CM", "CM", "RW", "ST", "ST"],
  "3-5-2": ["GK", "CB", "CB", "CB", "CDM", "CM", "CM", "LW", "RW", "ST", "ST"],
  "4-2-3-1": ["GK", "LB", "CB", "CB", "RB", "CDM", "CDM", "LW", "CAM", "RW", "ST"],
  "5-3-2": ["GK", "LB", "CB", "CB", "CB", "RB", "CM", "CM", "CM", "ST", "ST"],
};

// best eleven for a formation + up to 7 substitutes (with a spare goalkeeper when available)
export function autoPick(players, formation) {
  const slots = FORMATIONS[formation] ?? FORMATIONS[DEFAULT_FORMATION];
  const pool = [...players].sort((a, b) => b.overall - a.overall);
  const used = new Set();
  const starters = [];

  for (const pos of slots) {
    const exact = pool.find((p) => !used.has(p.id) && p.position === pos);
    const chosen = exact ?? pool.find((p) => !used.has(p.id) && (pos === "GK" || p.position !== "GK"));
    if (!chosen) break;
    used.add(chosen.id);
    starters.push(chosen.id);
  }

  const rest = pool.filter((p) => !used.has(p.id));
  const subs = [];
  const keeper = rest.find((p) => p.position === "GK");
  if (keeper) subs.push(keeper.id);
  for (const p of rest) {
    if (subs.length >= 7) break;
    if (!subs.includes(p.id)) subs.push(p.id);
  }
  return { starters, subs };
}

export async function getSquad(clubId) {
  const { data: club } = await run(supabase.from("clubs").select("id").eq("id", clubId).maybeSingle());
  if (!club) throw new ApiError(404, "club_not_found");

  const { data: squad } = await run(
    supabase.from("squads").select("formation, updated_at").eq("club_id", clubId).maybeSingle()
  );
  const { data: slots } = await run(
    supabase.from("squad_slots").select("slot, player_id").eq("club_id", clubId).order("slot")
  );

  const ids = slots.map((s) => s.player_id);
  let cards = [];
  if (ids.length > 0) {
    ({ data: cards } = await run(supabase.from("player_cards").select("*").in("id", ids)));
  }
  const byId = new Map(cards.map((c) => [c.id, c]));
  const cardOf = (s) => byId.get(s.player_id) ?? null;

  return {
    formation: squad ? squad.formation : DEFAULT_FORMATION,
    updated_at: squad ? squad.updated_at : null,
    starters: slots.filter((s) => s.slot < 11).map(cardOf),
    subs: slots.filter((s) => s.slot >= 11).map(cardOf),
  };
}

// body: { formation, starters: [11 player ids], subs: [0-7 player ids] }
export async function saveSquad(profileId, clubId, body) {
  const { formation, starters, subs } = body ?? {};
  if (typeof formation !== "string" || !FORMATIONS[formation]) throw new ApiError(400, "invalid_formation");
  if (!Array.isArray(starters) || starters.length !== 11 || !starters.every(isUuid)) {
    throw new ApiError(400, "invalid_starters");
  }
  const bench = subs === undefined || subs === null ? [] : subs;
  if (!Array.isArray(bench) || bench.length > 7 || !bench.every(isUuid)) throw new ApiError(400, "invalid_subs");

  await rpc("save_squad", {
    p_club: clubId,
    p_profile: profileId,
    p_formation: formation,
    p_starters: starters,
    p_subs: bench,
  });
  return getSquad(clubId);
}
