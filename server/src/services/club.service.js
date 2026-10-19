import { supabase } from "../config/supabase.js";
import { ApiError } from "../utils/http.js";
import { int } from "../utils/validate.js";
import { rpc, run } from "./db.js";
import { getCountryIds } from "./country.service.js";
import { generateStarterSquad } from "./playerFactory.js";
import { DEFAULT_FORMATION, autoPick } from "./squad.service.js";

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 ._'-]{2,23}$/;
const PUBLIC_FIELDS = "id, name, badge_url, country_id, reputation, owner_id, budget, created_at";

// the budget is private: only the owner sees it
function present(club, profileId) {
  const { budget, owner_id: ownerId, ...pub } = club;
  const isOwner = ownerId === profileId;
  return { ...pub, is_owner: isOwner, ...(isOwner ? { budget } : {}) };
}

export async function getClub(clubId, profileId) {
  const { data } = await run(supabase.from("clubs").select(PUBLIC_FIELDS).eq("id", clubId).maybeSingle());
  if (!data) throw new ApiError(404, "club_not_found");
  return present(data, profileId);
}

export async function getMyClub(profileId) {
  const { data } = await run(
    supabase.from("clubs").select(PUBLIC_FIELDS).eq("owner_id", profileId).limit(1).maybeSingle()
  );
  return data ? present(data, profileId) : null;
}

export async function getClubPlayers(clubId) {
  const { data } = await run(
    supabase.from("player_cards").select("*").eq("club_id", clubId).order("overall", { ascending: false })
  );
  return data;
}

// creates the club with a generated fictional squad (18 players) and the best eleven
export async function createClub(profileId, { name, countryId }) {
  const clean = typeof name === "string" ? name.trim() : "";
  if (!NAME_RE.test(clean)) throw new ApiError(400, "invalid_club_name");
  const country = int(countryId, { min: 1, max: 100000, code: "invalid_country", fallback: null });

  const players = generateStarterSquad(await getCountryIds());
  const clubId = await rpc("create_club", {
    p_profile: profileId,
    p_name: clean,
    p_country: country,
    p_players: players,
  });

  const { data: roster } = await run(
    supabase.from("players").select("id, position, overall").eq("club_id", clubId)
  );
  const { starters, subs } = autoPick(roster, DEFAULT_FORMATION);
  await rpc("save_squad", {
    p_club: clubId,
    p_profile: profileId,
    p_formation: DEFAULT_FORMATION,
    p_starters: starters,
    p_subs: subs,
  });

  return getClub(clubId, profileId);
}
