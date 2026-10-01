export type MockEvent = {
  id: string;
  title: string;
  mode: "PAIRS" | "INDIVIDUAL";
  location_text: string | null;
  starts_at: string;
  notes: string | null;
  players_count: number;
};

export const mockEvents: MockEvent[] = [
  {
    id: "e1",
    title: "Mus en el bar (Gazalbide)",
    mode: "INDIVIDUAL",
    location_text: "Vitoria",
    starts_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    notes: "Se juega rápido, sin líos.",
    players_count: 2,
  },
  {
    id: "e2",
    title: "Partida por parejas 🔥",
    mode: "PAIRS",
    location_text: "Bilbao",
    starts_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    notes: "Parejas nivel medio.",
    players_count: 4,
  },
  {
    id: "e3",
    title: "Mus tranquilo (individual)",
    mode: "INDIVIDUAL",
    location_text: null,
    starts_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    notes: null,
    players_count: 1,
  },
];