import { supabase } from "../config/supabase.js";
import { ApiError } from "../utils/http.js";
import { rpc, run } from "./db.js";

// Coins only buy cosmetics. They never buy players (transfers use the club budget).
export async function getCoins(profileId) {
  const { data: profile } = await run(supabase.from("profiles").select("coins").eq("id", profileId).maybeSingle());
  if (!profile) throw new ApiError(404, "profile_not_found");

  const { data: transactions } = await run(
    supabase
      .from("coin_transactions")
      .select("id, amount, reason, created_at")
      .eq("profile_id", profileId)
      .order("created_at", { ascending: false })
      .limit(20)
  );
  return { coins: profile.coins, transactions };
}

export async function listCosmetics(profileId) {
  const { data: items } = await run(
    supabase.from("cosmetics").select("id, name, kind, price_coins").order("price_coins")
  );
  const { data: owned } = await run(
    supabase.from("profile_cosmetics").select("cosmetic_id, equipped").eq("profile_id", profileId)
  );
  const mine = new Map(owned.map((o) => [o.cosmetic_id, o.equipped]));
  return items.map((c) => ({ ...c, owned: mine.has(c.id), equipped: mine.get(c.id) === true }));
}

export async function buyCosmetic(profileId, cosmeticId) {
  const coins = await rpc("buy_cosmetic", { p_profile: profileId, p_cosmetic: cosmeticId });
  return { coins };
}

export async function equipCosmetic(profileId, cosmeticId) {
  await rpc("equip_cosmetic", { p_profile: profileId, p_cosmetic: cosmeticId });
  return { equipped: true };
}
