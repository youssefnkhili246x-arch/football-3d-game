import { supabase } from "../config/supabase.js";
import { run } from "./db.js";

const CACHE_MS = 10 * 60 * 1000;
let cache = { at: 0, ids: [] };

// ids of the fictional countries (used when generating players)
export async function getCountryIds() {
  if (Date.now() - cache.at < CACHE_MS && cache.ids.length > 0) return cache.ids;
  const { data } = await run(supabase.from("countries").select("id"));
  cache = { at: Date.now(), ids: data.map((c) => c.id) };
  return cache.ids;
}
