/** Decorative Spanish deck: code-native artwork, with no image requests. */
export default function TableCards() {
  return <div className="mm-table-cards" aria-hidden="true">
    <span className="mm-table-ring" />
    <svg viewBox="0 0 260 210" fill="none">
      <defs>
        <pattern id="card-back" width="12" height="12" patternUnits="userSpaceOnUse"><path d="M6 0 12 6 6 12 0 6Z" stroke="#d5ad63" strokeWidth=".6" /></pattern>
      </defs>
      <g transform="translate(36 36) rotate(-19 52 75)">
        <rect width="104" height="150" rx="10" fill="#ede5cf" />
        <rect x="7" y="7" width="90" height="136" rx="6" fill="#154a38" stroke="#d5ad63" />
        <rect x="12" y="12" width="80" height="126" rx="3" fill="url(#card-back)" />
      </g>
      <g transform="translate(119 19) rotate(13 52 75)">
        <rect width="104" height="150" rx="10" fill="#faf3e2" />
        <rect x="7" y="7" width="90" height="136" rx="6" stroke="#d1c6a8" />
        <text x="15" y="28" fill="#174936" fontSize="17" fontFamily="Georgia, serif">1</text>
        <text transform="rotate(180 52 75)" x="15" y="28" fill="#174936" fontSize="17" fontFamily="Georgia, serif">1</text>
        <circle cx="52" cy="75" r="28" fill="#e6b748" stroke="#a97b25" strokeWidth="2" />
        <circle cx="52" cy="75" r="21" stroke="#faf3e2" strokeWidth="1.5" />
        <path d="m52 57 5 12 13 1-10 9 3 13-11-7-11 7 3-13-10-9 13-1Z" fill="#a97b25" />
        <circle cx="52" cy="75" r="4" fill="#faf3e2" />
      </g>
    </svg>
  </div>;
}
