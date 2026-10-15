import { MatchRules, rulesSummary } from "@/lib/matchRules";
export default function MatchRulesCard({ rules }: { rules: MatchRules }) {
  return (
    <section
      aria-label="Reglas acordadas"
      className="mt-5 rounded-2xl bg-mm-gold/10 p-4 ring-1 ring-mm-gold/30"
    >
      <h2 className="font-semibold text-mm-gold">Reglas de esta mesa</h2>
      <p className="mt-2 text-sm">{rulesSummary(rules)}</p>
      {rules.rules_version === 1 ? (
        <>
          <p className="mt-2 text-sm text-white/70">
            {rules.rules_variant === "EIGHT_KINGS"
              ? "Los treses cuentan como reyes y los doses como ases."
              : "Los treses y los doses conservan su valor; no cuentan como reyes ni ases."}
          </p>
          <p className="mt-2 text-sm text-white/70">
            Gana cada juego quien llega a {rules.points_per_game} tantos. Gana
            una vaca quien consigue {rules.games_to_win} juegos y la partida
            quien consigue {rules.vacas_to_win}{" "}
            {rules.vacas_to_win === 1 ? "vaca" : "vacas"}.
          </p>
          {rules.house_rules && (
            <p className="mt-3 whitespace-pre-wrap text-sm">
              <strong>Reglas de la mesa:</strong> {rules.house_rules}
            </p>
          )}
          <p className="mt-3 text-xs text-white/60">
            Al apuntarte aceptas estas reglas. Quedan fijadas desde la creación
            de la partida.
          </p>
        </>
      ) : (
        <p className="mt-2 text-sm text-white/70">
          Acordad el formato antes de jugar. Esta partida conserva su marcador
          antiguo.
        </p>
      )}
    </section>
  );
}
