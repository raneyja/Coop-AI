import { degradationCacheKey } from "../../cache/degradationCache";
import { contextResult, unavailableResult, type FeatureExecutionContext } from "./types";

export async function ownershipMap(context: FeatureExecutionContext) {
  const params = context.request.params;
  const key = degradationCacheKey("ownership", [params.repoId, params.file]);

  if (context.status.level === "cached" || context.status.level === "unavailable") {
    const cached = await context.cache.get(key);
    if (cached) {
      return contextResult(
        context,
        {
          ...(cached.data as Record<string, unknown>),
          cached: true,
          cacheAge: cached.cacheAge,
          fallbackLevel: "cached"
        },
        "GitHub offline. Showing cached ownership.",
        true
      );
    }
    return unavailableResult(context, "GitHub is offline and no cached ownership data is available.");
  }

  const slackOffline = context.status.unavailableProviders.includes("slack");
  const data = {
    file: params.file,
    owner: params.owner || "unknown",
    likelyOwner: params.owner || "unknown",
    confidence: params.owner ? 0.7 : 0.25,
    slackStatus: slackOffline ? null : { status: "availability-requested" },
    fallbackLevel: context.status.level
  };
  await context.cache.set(key, data, { provider: "github", feature: "ownership_map" });
  return contextResult(
    context,
    data,
    slackOffline ? "Slack offline. Showing ownership without availability." : context.status.message,
    context.status.level !== "full"
  );
}
