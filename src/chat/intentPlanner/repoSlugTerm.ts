import { CODE_HOST_PROVIDERS } from "../../api/codeHosts/types";

const HOST_PREFIX = new RegExp(`^(${CODE_HOST_PROVIDERS.join("|")}):`, "i");

/** Use-repo slug (and host-prefixed ids) must not become a search topic. */
export function isRepoSlugTerm(term: string, useRepo?: string): boolean {
  const cleaned = term.trim().replace(HOST_PREFIX, "");
  if (!cleaned) {
    return false;
  }
  const lower = cleaned.toLowerCase();
  if (useRepo) {
    const slug = useRepo.toLowerCase();
    const repo = slug.split("/")[1] ?? slug;
    if (lower === slug || lower === repo) {
      return true;
    }
    if (lower.endsWith(`/${repo}`) && lower.includes("/")) {
      return true;
    }
  }
  return HOST_PREFIX.test(term.trim());
}
