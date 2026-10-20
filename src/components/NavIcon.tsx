type IconName = "cards" | "calendar" | "plus" | "trophy" | "user" | "people" | "bell";
const paths: Record<IconName, string> = {
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4",
  cards: "M7 3h11a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM9 9l3-3 3 3-3 3-3-3Zm0 8h6",
  calendar: "M7 3v4m10-4v4M4 10h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1Zm3 9h2m4 0h2m-8 3h2",
  plus: "M12 5v14M5 12h14",
  trophy: "M8 3h8v7a4 4 0 0 1-8 0V3Zm0 2H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4m-4 2v6m-4 1h8",
  user: "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm-12 14v-3a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v3",
  people: "M14 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM3 21v-4a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v4m0-17a3 3 0 0 1 0 6m3 11v-4a5 5 0 0 0-3-5",
};
export default function NavIcon({ name }: { name: IconName }) {
  return <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>;
}
export type { IconName };
