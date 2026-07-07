import type { ContextFetchRequest, ContextFetchResult } from "./requestBatcher";

const INTEGRATION_DATA_KEYS = [
  "jiraSearch",
  "slackSearch",
  "teamsSearch",
  "confluenceSearch",
  "notionSearch",
  "googleDocsSearch",
  "codeHostSearch"
] as const;

type IntegrationDataKey = (typeof INTEGRATION_DATA_KEYS)[number];
type IntegrationData = Partial<Record<IntegrationDataKey, unknown>>;

export async function enrichIntentFetchResultsOnce(options: {
  requests: ContextFetchRequest[];
  results: ContextFetchResult[];
  enrich: (result: ContextFetchResult, request: ContextFetchRequest) => Promise<ContextFetchResult>;
}): Promise<ContextFetchResult[]> {
  const { requests, results, enrich } = options;
  if (requests.length === 0 || results.length === 0) {
    return results;
  }

  const primaryRequest = requests[0];
  const primaryIndex = results.findIndex((result) => result.requestId === primaryRequest.id);
  if (primaryIndex < 0) {
    return results;
  }

  const primaryResult = results[primaryIndex];
  const enrichedPrimary = await enrich(primaryResult, primaryRequest);
  const integrationData = pickIntegrationData(enrichedPrimary.data);
  if (Object.keys(integrationData).length === 0) {
    return replaceAt(results, primaryIndex, enrichedPrimary);
  }

  return results.map((result, index) => {
    const base = index === primaryIndex ? enrichedPrimary : result;
    return mergeIntegrationData(base, integrationData);
  });
}

export function pickIntegrationData(data: unknown): IntegrationData {
  const record = asRecord(data);
  if (!record) {
    return {};
  }

  const extracted: IntegrationData = {};
  for (const key of INTEGRATION_DATA_KEYS) {
    if (record[key] !== undefined) {
      extracted[key] = record[key];
    }
  }
  return extracted;
}

function mergeIntegrationData(result: ContextFetchResult, integrationData: IntegrationData): ContextFetchResult {
  if (Object.keys(integrationData).length === 0) {
    return result;
  }

  const resultData = asRecord(result.data) ?? {};
  return {
    ...result,
    data: {
      ...resultData,
      ...integrationData
    }
  };
}

function replaceAt<T>(values: T[], index: number, replacement: T): T[] {
  if (values[index] === replacement) {
    return values;
  }
  const updated = [...values];
  updated[index] = replacement;
  return updated;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}
