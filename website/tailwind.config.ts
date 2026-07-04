import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";
import { siteDarkUiText, siteGray } from "./src/lib/siteColors";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        gray: siteGray,
        darkUi: siteDarkUiText,
        coop: {
          blue: "#1F6FEB",
          accent: "#58A6FF",
          index: "#3FB950",
          warn: "#D29922",
          dark: "#ffffff",
          surface: "#f9fafb",
          border: "#e5e7eb",
          muted: siteGray[500],
          editor: "#ffffff",
          foreground: siteGray[800],
          "foreground-secondary": siteGray[500]
        }
      },
      fontFamily: {
        sans: [
          "var(--font-inter)",
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "ui-sans-serif",
          "system-ui",
          "sans-serif"
        ],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"]
      },
      backgroundImage: {
        "hero-glow":
          "radial-gradient(ellipse 80% 60% at 50% -10%, rgba(31, 111, 235, 0.08), transparent 70%)",
        "hero-grid":
          "linear-gradient(to right, rgba(229, 231, 235, 0.8) 1px, transparent 1px), linear-gradient(to bottom, rgba(229, 231, 235, 0.8) 1px, transparent 1px)"
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
