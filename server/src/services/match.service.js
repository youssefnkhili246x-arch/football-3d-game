import { supabase } from "../config/supabase.js";

// Creates a live match row and returns its id
export async function createMatch({ mode, aiDifficulty }) {
  const { data, error } = await supabase
    .from("matches")
    .insert({
      mode,
      status: "live",
      ai_difficulty: aiDifficulty,
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export async function setMatchStatus(matchId, status) {
  const patch = { status };
  if (status === "finished" || status === "abandoned") {
    patch.ended_at = new Date().toISOString();
  }
  const { error } = await supabase.from("matches").update(patch).eq("id", matchId);
  if (error) throw error;
}

// Saves the final score and closes the match
export async function finishMatch(matchId, homeScore, awayScore) {
  const { error } = await supabase
    .from("matches")
    .update({
      status: "finished",
      home_score: homeScore,
      away_score: awayScore,
      ended_at: new Date().toISOString(),
    })
    .eq("id", matchId);
  if (error) throw error;
}
