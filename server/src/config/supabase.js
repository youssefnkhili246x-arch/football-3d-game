import { createClient } from "@supabase/supabase-js";
import { env } from "./env.js";

// Server-side client using the service_role key (bypasses RLS).
// All database writes in the game go through this client.
export const supabase = createClient(env.supabaseUrl, env.supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
