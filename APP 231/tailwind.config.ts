import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Verta Delivery brand accent (indigo/navy)
        verta: {
          50: "#eef1fd",
          100: "#dbe2fb",
          400: "#5a6df0",
          500: "#3d4fe0",
          600: "#2f3fc7",
          700: "#1e2a99",
          900: "#0f1547",
        },
        // ONLib Marketplace brand accent (red)
        onlib: {
          50: "#fdecec",
          100: "#fad6d6",
          400: "#f16060",
          500: "#e63946",
          600: "#c92a37",
          700: "#a11f2b",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      borderRadius: {
        xl2: "1.25rem",
      },
    },
  },
  plugins: [],
};

export default config;
