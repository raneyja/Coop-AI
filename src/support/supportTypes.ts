export const SUPPORT_KINDS = ["bug", "feedback", "feature_request"] as const;
export type SupportKind = typeof SUPPORT_KINDS[number];
export const SUPPORT_STATUSES = ["open", "in_progress", "resolved"] as const;
export type SupportStatus = typeof SUPPORT_STATUSES[number];
export type SupportDiagnostics = {
  extensionVersion: string;
  vscodeVersion: string;
  platform: string;
  architecture: string;
};
export type SupportSubmission = {
  submissionId: string;
  kind: SupportKind;
  title: string;
  description: string;
  contactEmail: string;
  diagnostics?: SupportDiagnostics;
};
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Rebuild an allowlisted object. Never persist arbitrary webview or diagnostic fields. */
export function parseSupportSubmission(value: unknown): SupportSubmission {
  if (!value || typeof value !== "object") throw new Error("Report is required.");
  const body = value as Record<string, unknown>;
  const string = (key: string, max: number, min = 1) => {
    const value = body[key];
    if (typeof value !== "string" || value.trim().length < min || value.trim().length > max) {
      throw new Error(`${key} must be between ${min} and ${max} characters.`);
    }
    return value.trim();
  };
  const submissionId = string("submissionId", 36);
  if (!UUID_PATTERN.test(submissionId)) throw new Error("Invalid submission ID.");
  const kind = string("kind", 20) as SupportKind;
  if (!SUPPORT_KINDS.includes(kind)) throw new Error("Invalid report type.");
  const contactEmail = string("contactEmail", 320);
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(contactEmail)) throw new Error("Enter a valid contact email.");
  let diagnostics: SupportDiagnostics | undefined;
  if (body.diagnostics !== undefined) {
    if (!body.diagnostics || typeof body.diagnostics !== "object") throw new Error("Invalid diagnostics.");
    const raw = body.diagnostics as Record<string, unknown>;
    const field = (key: string) => {
      if (typeof raw[key] !== "string" || (raw[key] as string).length > 100) throw new Error("Invalid diagnostics.");
      return raw[key] as string;
    };
    diagnostics = { extensionVersion: field("extensionVersion"), vscodeVersion: field("vscodeVersion"), platform: field("platform"), architecture: field("architecture") };
  }
  return { submissionId, kind, contactEmail, title: string("title", 160, 3), description: string("description", 12000, 10), ...(diagnostics ? { diagnostics } : {}) };
}
