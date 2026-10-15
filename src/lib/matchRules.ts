export type RulesVariant = "FOUR_KINGS" | "EIGHT_KINGS";
export type MatchRules = {
  rules_version?: number;
  rules_variant?: RulesVariant | null;
  points_per_game?: number | null;
  games_to_win?: number | null;
  vacas_to_win?: number | null;
  house_rules?: string | null;
};
export function rulesSummary(r: MatchRules) {
  if (r.rules_version !== 1) return "Reglas no especificadas (partida antigua)";
  const variant =
    r.rules_variant === "FOUR_KINGS" ? "4 reyes / 4 ases" : "8 reyes / 8 ases";
  return `${variant} · ${r.points_per_game} tantos · ${r.games_to_win} juegos por vaca · ${r.vacas_to_win} ${r.vacas_to_win === 1 ? "vaca" : "vacas"}`;
}
export function scoreTarget(r: MatchRules) {
  return r.rules_version === 1
    ? ((r.vacas_to_win === 1 ? r.games_to_win : r.vacas_to_win) ?? null)
    : null;
}
