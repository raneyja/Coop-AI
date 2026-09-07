"use client";

import { usePathname } from "next/navigation";

/** Light inner-page atmosphere. Hidden on `/` so the homepage galaxy stays the only space scene. */
export function SiteAtmosphere() {
  const pathname = usePathname();
  if (pathname === "/") return null;

  return <div className="site-atmosphere" aria-hidden />;
}
