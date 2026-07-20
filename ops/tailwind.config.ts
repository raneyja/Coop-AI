import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        coop: {
          index: "#3FB950",
          warn: "#D29922",
          dark: "#0D1117",
          surface: "#161B22",
          border: "#444A50",
          muted: "#A1A9B1",
          editor: "#1e1e1e"
        }
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"]
      }
    }
  },
  plugins: []
};

export default config;
