import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Brand palette derived from the ONLib / Verta reference marks:
        // deep navy + red for ONLib, navy + sky blue for Verta.
        brand: {
          navy: "#0B1F4D",
          blue: "#2952CC",
          red: "#D6293E",
          skyblue: "#3E6BE0",
        },
      },
      borderRadius: {
        xl: "0.875rem",
      },
    },
  },
  plugins: [],
};

export default config;
