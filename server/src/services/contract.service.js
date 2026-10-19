import { rpc } from "./db.js";
import { getCard } from "./card.service.js";

// Renews the contract of one of my players. Costs a signing bonus of 10 weeks of salary.
// salary / years / releaseClause may be null (defaults: current salary, 3 years, no clause).
export async function renewContract(profileId, clubId, playerId, { salary, years, releaseClause }) {
  const contractId = await rpc("renew_contract", {
    p_club: clubId,
    p_profile: profileId,
    p_player: playerId,
    p_salary: salary,
    p_years: years,
    p_release: releaseClause,
  });
  return { contract_id: contractId, card: await getCard(playerId) };
}
