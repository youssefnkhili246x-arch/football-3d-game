import { supabase } from "../config/supabase.js";
import { ApiError } from "../utils/http.js";
import { rpc, run } from "./db.js";
import { ATTRS, ageOf, computeOverall, marketValue, trainingCost } from "./playerFactory.js";

const SORTS = {
  overall_desc: ["overall", false],
  overall_asc: ["overall", true],
  value_desc: ["market_value", false],
  value_asc: ["market_value", true],
  age_asc: ["age", true],
  age_desc: ["age", false],
};

// filters: { q, position, minOverall, maxOverall, clubId, freeAgents, sort, limit, offset }
export async function searchCards(f) {
  let query = supabase.from("player_cards").select("*", { count: "exact" });
  if (f.q) query = query.ilike("name", `%${f.q}%`);
  if (f.position) query = query.eq("position", f.position);
  if (f.minOverall !== null && f.minOverall !== undefined) query = query.gte("overall", f.minOverall);
  if (f.maxOverall !== null && f.maxOverall !== undefined) query = query.lte("overall", f.maxOverall);
  if (f.clubId) query = query.eq("club_id", f.clubId);
  if (f.freeAgents) query = query.is("club_id", null);

  const [column, ascending] = SORTS[f.sort] ?? SORTS.overall_desc;
  query = query.order(column, { ascending }).order("id").range(f.offset, f.offset + f.limit - 1);

  const { data, count } = await run(query);
  return { cards: data, total: count };
}

export async function getCard(playerId) {
  const { data } = await run(supabase.from("player_cards").select("*").eq("id", playerId).maybeSingle());
  if (!data) throw new ApiError(404, "player_not_found");
  return data;
}

// +2 on one attribute for a fee from the club budget. One training per player per day.
export async function trainPlayer(profileId, clubId, playerId, attribute) {
  if (!ATTRS.includes(attribute)) throw new ApiError(400, "invalid_attribute");

  const { data: p } = await run(
    supabase
      .from("players")
      .select("id, position, attributes, overall, potential, birth_date")
      .eq("id", playerId)
      .eq("club_id", clubId)
      .maybeSingle()
  );
  if (!p) throw new ApiError(409, "player_not_in_club");

  const current = p.attributes[attribute];
  if (!Number.isFinite(current) || current >= 99) throw new ApiError(409, "attribute_maxed");

  const attributes = { ...p.attributes, [attribute]: Math.min(99, current + 2) };
  const overall = computeOverall(p.position, attributes);
  if (overall > p.potential) throw new ApiError(409, "at_potential");

  const value = marketValue({ overall, potential: p.potential, age: ageOf(p.birth_date) });
  const cost = trainingCost(p.overall);

  await rpc("train_player", {
    p_club: clubId,
    p_profile: profileId,
    p_player: playerId,
    p_attributes: attributes,
    p_overall: overall,
    p_value: value,
    p_cost: cost,
  });

  return { card: await getCard(playerId), cost };
}
