import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0b0d12",
        panel: "#12151c",
        edge: "#222733",
        accent: "#5b8cff",
        good: "#46d39a",
        warn: "#ffb454",
        bad: "#ff5d6c",
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
