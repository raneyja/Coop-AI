import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        coop: {
          blue: "#1F6FEB",
          accent: "#58A6FF",
          dark: "#0D1117",
          surface: "#161B22",
          border: "#30363D",
          muted: "#9CA4AD"
        }
      },
      fontFamily: {
        sans: [
          "var(--font-geist-sans)",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "sans-serif"
        ],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"]
      },
      backgroundImage: {
        "hero-glow":
          "radial-gradient(ellipse 80% 60% at 50% -10%, rgba(31, 111, 235, 0.18), transparent 70%)",
        "hero-grid":
          "linear-gradient(to right, rgba(48, 54, 61, 0.35) 1px, transparent 1px), linear-gradient(to bottom, rgba(48, 54, 61, 0.35) 1px, transparent 1px)"
      },
      backgroundSize: {
        grid: "64px 64px"
      },
      animation: {
        "fade-up": "fadeUp 0.6s ease-out forwards"
      },
      keyframes: {
        fadeUp: {
          "0%": { opacity: "0", transform: "translateY(16px)" },
          "100%": { opacity: "1", transform: "translateY(0)" }
        }
      }
    }
  },
  plugins: [typography]
};

export default config;
