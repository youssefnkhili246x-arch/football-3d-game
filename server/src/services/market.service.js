import { supabase } from "../config/supabase.js";
import { rpc, run } from "./db.js";
import { getCard, searchCards } from "./card.service.js";
import { getCountryIds } from "./country.service.js";
import { generateFreeAgents } from "./playerFactory.js";

const LISTING_SORTS = {
  price_asc: ["asking_price", true],
  price_desc: ["asking_price", false],
  overall_desc: ["overall", false],
  newest: ["created_at", false],
  expiring: ["expires_at", true],
};

const MIN_FREE_AGENTS = 40;
const REFILL_COUNT = 20;

// ---------- transfer market ----------
// filters: { q, position, minOverall, maxOverall, minPrice, maxPrice, sort, limit, offset }
export async function browseListings(f) {
  let query = supabase.from("market_view").select("*", { count: "exact" });
  if (f.q) query = query.ilike("name", `%${f.q}%`);
  if (f.position) query = query.eq("position", f.position);
  if (f.minOverall !== null && f.minOverall !== undefined) query = query.gte("overall", f.minOverall);
  if (f.maxOverall !== null && f.maxOverall !== undefined) query = query.lte("overall", f.maxOverall);
  if (f.minPrice !== null && f.minPrice !== undefined) query = query.gte("asking_price", f.minPrice);
  if (f.maxPrice !== null && f.maxPrice !== undefined) query = query.lte("asking_price", f.maxPrice);

  const [column, ascending] = LISTING_SORTS[f.sort] ?? LISTING_SORTS.newest;
  query = query.order(column, { ascending }).order("id").range(f.offset, f.offset + f.limit - 1);

  const { data, count } = await run(query);
  return { listings: data, total: count };
}

export async function createListing(profileId, { clubId, playerId, askingPrice, hours }) {
  const listingId = await rpc("create_listing", {
    p_club: clubId,
    p_profile: profileId,
    p_player: playerId,
    p_price: askingPrice,
    p_hours: hours,
  });
  return { listing_id: listingId };
}

export async function cancelListing(profileId, listingId) {
  await rpc("cancel_listing", { p_listing: listingId, p_profile: profileId });
  return { cancelled: true };
}

// the buyer pays the asking price + 10 weeks of salary as signing bonus; the seller receives 95%
export async function buyListing(profileId, listingId, { clubId, salary, years }) {
  const contractId = await rpc("buy_listing", {
    p_listing: listingId,
    p_buyer_club: clubId,
    p_profile: profileId,
    p_salary: salary,
    p_years: years,
  });
  return { contract_id: contractId };
}

// ---------- free agents ----------
async function ensureFreeAgentPool() {
  const { count } = await run(
    supabase.from("players").select("id", { count: "exact", head: true }).is("club_id", null)
  );
  if ((count ?? 0) >= MIN_FREE_AGENTS) return;
  await rpc("create_free_agents", { p_players: generateFreeAgents(REFILL_COUNT, await getCountryIds()) });
}

export async function listFreeAgents(filters) {
  await ensureFreeAgentPool();
  return searchCards({ ...filters, freeAgents: true });
}

export async function signFreeAgent(profileId, playerId, { clubId, salary, years }) {
  const contractId = await rpc("sign_free_agent", {
    p_player: playerId,
    p_club: clubId,
    p_profile: profileId,
    p_salary: salary,
    p_years: years,
  });
  return { contract_id: contractId, card: await getCard(playerId) };
}

// ---------- release clause and release ----------
export async function payReleaseClause(profileId, playerId, { clubId, salary, years }) {
  const contractId = await rpc("pay_release_clause", {
    p_player: playerId,
    p_buyer_club: clubId,
    p_profile: profileId,
    p_salary: salary,
    p_years: years,
  });
  return { contract_id: contractId, card: await getCard(playerId) };
}

// the club pays half of the remaining wages, the player becomes a free agent
export async function releasePlayer(profileId, clubId, playerId) {
  const compensation = await rpc("release_player", {
    p_club: clubId,
    p_profile: profileId,
    p_player: playerId,
  });
  return { compensation };
}
