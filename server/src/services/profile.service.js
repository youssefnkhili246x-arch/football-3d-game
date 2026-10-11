import { supabase } from "../config/supabase.js";
import { ApiError } from "../utils/http.js";

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

export const isValidUsername = (value) =>
  typeof value === "string" && USERNAME_RE.test(value);

function checkCountry(countryId) {
  if (countryId !== null && !Number.isInteger(countryId)) {
    throw new ApiError(400, "invalid_country");
  }
}

// Translate Postgres errors into clean API errors
function mapDbError(error) {
  if (error.code === "23505") {
    const code = error.message.includes("username") ? "username_taken" : "profile_exists";
    throw new ApiError(409, code);
  }
  if (error.code === "23503") throw new ApiError(400, "invalid_country");
  throw error;
}

export async function createProfile(userId, { username, countryId = null }) {
  if (!isValidUsername(username)) throw new ApiError(400, "invalid_username");
  checkCountry(countryId);

  const { data, error } = await supabase
    .from("profiles")
    .insert({ id: userId, username, country_id: countryId })
    .select()
    .single();
  if (error) mapDbError(error);
  return data;
}

export async function getProfile(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data; // null if the user has no profile yet
}

// Only username and country can be changed by the player (never coins)
export async function updateProfile(userId, { username, countryId }) {
  const patch = {};

  if (username !== undefined) {
    if (!isValidUsername(username)) throw new ApiError(400, "invalid_username");
    patch.username = username;
  }
  if (countryId !== undefined) {
    checkCountry(countryId);
    patch.country_id = countryId;
  }
  if (Object.keys(patch).length === 0) throw new ApiError(400, "nothing_to_update");

  const { data, error } = await supabase
    .from("profiles")
    .update(patch)
    .eq("id", userId)
    .select()
    .maybeSingle();
  if (error) mapDbError(error);
  if (!data) throw new ApiError(404, "profile_not_found");
  return data;
}
