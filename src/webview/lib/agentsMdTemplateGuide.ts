export const AGENTS_MD_TEMPLATE_SECTIONS = [
  {
    heading: "Canonical URLs",
    shortDescription: "API, staging, admin portal, docs.",
    description: "Production vs staging API, admin portal, docs — so Coop links to the right hosts."
  },
  {
    heading: "Build & test",
    shortDescription: "npm run build, npm test, and similar.",
    description: "Exact commands to build, test, and lint (for example npm run build, npm test)."
  },
  {
    heading: "Architecture",
    shortDescription: "Services, entry points, doc links.",
    description: "Short map of services, entry points, and where deeper docs live in the repo."
  },
  {
    heading: "Agent instructions",
    shortDescription: "How to give setup steps (File, Terminal, Browser, UI).",
    description: "How Coop should give setup steps — name the surface (File, Terminal, Browser, Extension UI)."
  }
] as const;

export { AGENTS_MD_SKELETON } from "../../context/agentsMdSkeleton";
