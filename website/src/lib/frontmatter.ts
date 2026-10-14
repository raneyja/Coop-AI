import { parse } from 'yaml';

/** The site's authored content uses YAML mappings, followed by untouched Markdown. */
export function parseFrontmatter(source: string): {data: Record<string, unknown>; content: string} {
  const text = source.replace(/^\uFEFF/, '');
  const opening = /^---[ \t]*\r?\n/.exec(text);
  if (!opening) return {data: {}, content: text};
  const remainder = text.slice(opening[0].length);
  const closing = /^---[ \t]*\r?$/m.exec(remainder);
  if (!closing) throw new Error('Unclosed YAML frontmatter');
  const data: unknown = parse(remainder.slice(0, closing.index), {customTags: ['timestamp'], merge: true, maxAliasCount: 100});
  if (data != null && (typeof data !== 'object' || Array.isArray(data) || data instanceof Date)) {
    throw new Error('YAML frontmatter must be a mapping');
  }
  let content = remainder.slice(closing.index + closing[0].length);
  if (content.startsWith('\n')) content = content.slice(1);
  return {data: (data ?? {}) as Record<string, unknown>, content};
}
