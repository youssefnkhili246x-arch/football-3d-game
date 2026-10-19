import { supabase } from "../config/supabase.js";
import { ApiError } from "../utils/http.js";

// error message raised by the SQL functions -> HTTP status
const STATUS = {
  invalid_years: 400,
  invalid_hours: 400,
  invalid_formation: 400,
  invalid_starters: 400,
  invalid_subs: 400,
  duplicate_players: 400,
  need_one_goalkeeper: 400,
  salary_too_low: 400,
  release_clause_too_low: 400,
  price_out_of_range: 400,
  insufficient_budget: 402,
  insufficient_coins: 402,
  not_club_owner: 403,
  profile_required: 403,
  player_not_found: 404,
  cosmetic_not_found: 404,
  listing_unavailable: 409,
  own_listing: 409,
  own_player: 409,
  already_listed: 409,
  not_free_agent: 409,
  no_release_clause: 409,
  squad_full: 409,
  squad_too_small: 409,
  player_not_in_club: 409,
  already_owned: 409,
  not_owned: 409,
  club_exists: 409,
  club_name_taken: 409,
};

export function toApiError(error) {
  const message = String(error.message ?? "").trim();
  if (STATUS[message]) return new ApiError(STATUS[message], message);
  if (error.code === "23505") return new ApiError(409, "duplicate");
  if (error.code === "23503") return new ApiError(400, "invalid_reference");
  if (error.code === "22P02") return new ApiError(400, "invalid_id");
  return error;
}

// calls a SQL function (all game logic that must be atomic lives there)
export async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw toApiError(error);
  return data;
}

// awaits a supabase query builder -> { data, count }
export async function run(builder) {
  const { data, error, count } = await builder;
  if (error) throw toApiError(error);
  return { data, count };
}
