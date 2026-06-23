export type EvidenceStalenessInput = {
  eventDate?: string | Date;
  referenceDate?: string | Date;
  fileChangeCountSince?: number;
};

export type EvidenceStalenessMeta = {
  ageLabel?: string;
  staleWarning?: string;
  fileChangeCountSince?: number;
};

export function formatEvidenceStaleness(input: EvidenceStalenessInput): EvidenceStalenessMeta {
  const event = toDate(input.eventDate);
  const reference = toDate(input.referenceDate) ?? new Date();
  if (!event) {
    return {};
  }

  const ageLabel = formatAgeLabel(event, reference);
  const monthsApart = monthDelta(event, reference);
  const fileChangeCountSince = input.fileChangeCountSince;
  const warnings: string[] = [];

  if (monthsApart >= 24) {
    warnings.push(`Evidence is from ${ageLabel} — verify against current code.`);
  }
  if (fileChangeCountSince !== undefined && fileChangeCountSince >= 10) {
    warnings.push(`File changed ${fileChangeCountSince}× since this evidence.`);
  }

  return {
    ageLabel,
    staleWarning: warnings.length > 0 ? warnings.join(" ") : undefined,
    fileChangeCountSince
  };
}

export function combineStalenessLabels(parts: Array<string | undefined>): string | undefined {
  const filtered = parts.filter(Boolean);
  return filtered.length > 0 ? filtered.join(" · ") : undefined;
}

function toDate(value: string | Date | undefined): Date | undefined {
  if (!value) {
    return undefined;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function formatAgeLabel(from: Date, to: Date): string {
  const days = Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86_400_000));
  if (days < 1) {
    return "today";
  }
  if (days < 7) {
    return `${days}d ago`;
  }
  if (days < 30) {
    return `${Math.floor(days / 7)}w ago`;
  }
  if (days < 365) {
    return `${Math.floor(days / 30)}mo ago`;
  }
  return `${Math.floor(days / 365)}y ago`;
}

function monthDelta(from: Date, to: Date): number {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}
