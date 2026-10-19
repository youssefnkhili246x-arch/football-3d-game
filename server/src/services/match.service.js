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

// Match rewards: Coins (cosmetics) for every human player, club budget for club owners.
const REWARDS = {
  win: { coins: 50, budget: 250000 },
  draw: { coins: 25, budget: 100000 },
  loss: { coins: 10, budget: 50000 },
};

// participants: [{ userId, result: "win" | "draw" | "loss" }]. Granted once per player and match.
export async function rewardMatch(matchId, participants) {
  if (participants.length === 0) return 0;
  const rewards = participants.map((p) => ({
    profile_id: p.userId,
    coins: REWARDS[p.result].coins,
    budget: REWARDS[p.result].budget,
  }));
  const { data, error } = await supabase.rpc("grant_match_rewards", { p_match: matchId, p_rewards: rewards });
  if (error) throw error;
  return data;
}
