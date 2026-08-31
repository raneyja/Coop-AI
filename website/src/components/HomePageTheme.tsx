"use client";

import { useEffect } from "react";

/** Paints the document chrome dark for the Codex-style homepage only. */
export function HomePageTheme({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    document.documentElement.classList.add("home-page");
    document.body.classList.add("home-page");
    return () => {
      document.documentElement.classList.remove("home-page");
      document.body.classList.remove("home-page");
    };
  }, []);

  return <div className="bg-neutral-950 text-neutral-100">{children}</div>;
}
