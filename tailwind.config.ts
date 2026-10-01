import type { Config } from "tailwindcss";

export default {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        mm: {
          bg: "var(--mm-bg)",
          bg2: "var(--mm-bg-2)",
          card: "var(--mm-card)",
          text: "var(--mm-text)",
          muted: "var(--mm-muted)",
          gold: "var(--mm-gold)",
          red: "var(--mm-red)",
          brown: "var(--mm-brown)",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;