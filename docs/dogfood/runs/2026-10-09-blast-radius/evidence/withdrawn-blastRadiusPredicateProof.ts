import ts from "typescript";
import { posix } from "node:path";
import type { BlastRadiusEvidence } from "../context/contextBundleEvidence";
import type { BlastRadiusSourceFile } from "../context/blastRadiusSourceEvidence";
import { citationLocatorInFenceBody, tryParseFenceInfoLocator } from "../webview/lib/codeCitationLocator";

type Parsed = { source: BlastRadiusSourceFile; file: ts.SourceFile };
const isFunction = (node: ts.Node): node is ts.FunctionLikeDeclaration =>
  ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node);

function parse(source: BlastRadiusSourceFile): Parsed | undefined {
  if (source.truncated || !/\.(?:[cm]?[jt]sx?)$/.test(source.path)) return undefined;
  const file = ts.createSourceFile(source.path, source.content, ts.ScriptTarget.Latest, true,
    /\.tsx$/.test(source.path) ? ts.ScriptKind.TSX : /\.jsx$/.test(source.path) ? ts.ScriptKind.JSX : ts.ScriptKind.TS);
  if ((file as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics.length) return undefined;
  return { source, file };
}
function nodes<T extends ts.Node>(root: ts.Node, predicate: (node: ts.Node) => node is T): T[] {
  const found: T[] = [];
  const visit = (node: ts.Node): void => { if (predicate(node)) found.push(node); ts.forEachChild(node, visit); };
  visit(root); return found;
}
function line(parsed: Parsed, node: ts.Node, end = false): number {
  return parsed.file.getLineAndCharacterOfPosition(end ? node.getEnd() - 1 : node.getStart(parsed.file)).line + (parsed.source.startLine ?? 1);
}
function enclosingFunction(node: ts.Node, outermost: boolean): ts.FunctionLikeDeclaration | undefined {
  let found: ts.FunctionLikeDeclaration | undefined;
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (isFunction(parent)) { found = parent; if (!outermost) break; }
  }
  return found;
}
function functionName(node: ts.FunctionLikeDeclaration): string | undefined {
  if (node.name && ts.isIdentifier(node.name)) return node.name.text;
  return ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name) ? node.parent.name.text : undefined;
}
function codeText(text: string): string {
  const delimiter = "`".repeat(Math.max(0, ...[...text.matchAll(/`+/g)].map(match => match[0].length)) + 1);
  return `${delimiter} ${text} ${delimiter}`;
}
function enclosingPredicates(parsed: Parsed, node: ts.Node, scope?: ts.FunctionLikeDeclaration): string[] {
  const predicates: string[] = [];
  let child = node;
  for (let parent = node.parent; parent && (scope ? parent !== scope : !isFunction(parent)); parent = parent.parent) {
    if (ts.isIfStatement(parent)) {
      const expression = parent.expression.getText(parsed.file);
      predicates.unshift(parent.elseStatement === child ? `!(${expression})` : expression);
    }
    child = parent;
  }
  return predicates;
}
function flowName(fn: ts.FunctionLikeDeclaration | undefined): string | undefined {
  if (!fn) return undefined;
  const name = functionName(fn); if (name) return name;
  for (let parent = fn.parent; parent && !ts.isSourceFile(parent); parent = parent.parent) {
    if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
    if (ts.isPropertyAssignment(parent) && (ts.isIdentifier(parent.name) || ts.isStringLiteral(parent.name))) return parent.name.text;
  }
  return undefined;
}
function citation(parsed: Parsed, node: ts.Node): string | undefined {
  const start = line(parsed, node), end = line(parsed, node, true);
  return rangeCitation(parsed, start, end);
}
function rangeCitation(parsed: Parsed, start: number, end: number): string | undefined {
  if (end - start > 120) return undefined;
  const base = parsed.source.startLine ?? 1;
  const body = parsed.source.content.split("\n").slice(start - base, end - base + 1).join("\n");
  return `\`\`\`${start}:${end}:${parsed.source.path}\n${body}\n\`\`\``;
}

/** Imported identifiers only. Names appearing in comments, strings, unrelated
 * imports, or a shadowing local binding do not establish a call to the target. */
function importedCalls(parsed: Parsed, targetPath: string, symbol: string): ts.CallExpression[] {
  const stem = targetPath.replace(/\.(?:[cm]?[jt]sx?)$/, "");
  const suffix = stem.split("/").slice(-3).join("/");
  const aliases = new Set<string>();
  for (const statement of parsed.file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const module = statement.moduleSpecifier.text.replace(/\.(?:[cm]?[jt]sx?)$/, "");
    const resolves = module.startsWith(".")
      ? posix.normalize(posix.join(posix.dirname(parsed.source.path), module)) === stem
      : module.endsWith(suffix);
    if (!resolves || statement.importClause?.isTypeOnly) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) for (const binding of bindings.elements) {
      if (!binding.isTypeOnly && (binding.propertyName?.text ?? binding.name.text) === symbol) aliases.add(binding.name.text);
    }
  }
  const declarations = nodes(parsed.file, (node): node is ts.VariableDeclaration | ts.ParameterDeclaration | ts.FunctionDeclaration =>
    ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isFunctionDeclaration(node));
  const binds = (binding: ts.BindingName | undefined, name: string): boolean => Boolean(binding && (ts.isIdentifier(binding) ? binding.text === name
    : binding.elements.some(element => ts.isBindingElement(element) && binds(element.name, name))));
  for (const name of aliases) if (declarations.some(node => binds(node.name, name))) aliases.delete(name);
  return nodes(parsed.file, ts.isCallExpression).filter(call => ts.isIdentifier(call.expression) && aliases.has(call.expression.text));
}

/** A predicate-change answer uses parser-verified calls and the original bytes.
 * The model selects a focus; it cannot author behavior, predicates, or excerpts.
 * This intentionally proves syntax in opened bodies, not data flow or access. */
export function renderBlastPredicateProof(proposedAnswer: string, evidence: BlastRadiusEvidence, focusLines?: [number, number], question?: string): string | undefined {
  const source = evidence.sourceFiles?.find(file => file.role === "target");
  const target = source && parse(source);
  if (!target) return undefined;
  let changed: ts.IfStatement | undefined;
  const conditions = nodes(target.file, ts.isIfStatement);
  if (focusLines) {
    const focused = conditions.filter(node => line(target, node.expression) >= focusLines[0] && line(target, node.expression, true) <= focusLines[1]);
    if (focused.length === 1) changed = focused[0];
  }
  if (!changed && !focusLines && question) {
    const words = new Set(question.toUpperCase().match(/\b[A-Z][A-Z\d_]*\b/g) ?? []);
    const named = conditions.filter(node => nodes(node.expression, ts.isPropertyAccessExpression).some(property =>
      /^[A-Z][A-Z\d_]*$/.test(property.name.text) && words.has(property.name.text)));
    if (named.length === 1) changed = named[0];
  }
  for (const block of proposedAnswer.matchAll(/```([^\n]*)\n([\s\S]*?)```/g)) {
    if (changed) break;
    const locator = tryParseFenceInfoLocator(block[1]!.trim()) ?? citationLocatorInFenceBody(block[2]!.split("\n"))?.locator;
    if (!locator || locator.path !== source!.path || locator.startLine == null || locator.endLine == null ||
      (focusLines && (locator.startLine > focusLines[1] || locator.endLine < focusLines[0]))) continue;
    const matches = conditions.filter(node => line(target, node) >= locator.startLine! && line(target, node, true) <= locator.endLine!);
    if (matches.length === 1) { changed = matches[0]; break; }
  }
  const scope = changed && enclosingFunction(changed, true);
  const symbol = scope && functionName(scope);
  if (!changed || !scope || !symbol) return undefined;
  const callers = (evidence.sourceFiles ?? []).filter(file => file.role === "dependent").flatMap(source => {
    const parsed = parse(source); if (!parsed) return [];
    const calls = importedCalls(parsed, target!.source.path, symbol);
    return calls.length ? [{ parsed, calls }] : [];
  });
  if (!callers.length) return undefined;
  const parts = [
    "**Verified call paths and conditions**",
    `The opened dependent bodies below contain calls to \`${symbol}\`. Effects of relaxing the shown predicate depend on the callers' earlier checks, the target's later checks, and any unopened helpers.`,
    "Changed predicate:", citation(target, changed)!
  ];
  for (const { parsed, calls } of callers) {
    const call = calls[0]!;
    const fn = enclosingFunction(call, true);
    const name = flowName(fn);
    parts.push(`**\`${parsed.source.path}\`**`,
      `The ${name ? `${codeText(name)} flow` : "shown function"} calls ${codeText(symbol)}. The change can affect that call if execution reaches the changed predicate; earlier return/throw paths and unopened helpers still matter.`);
    const earlierExits = fn ? nodes(fn, (node): node is ts.ThrowStatement | ts.ReturnStatement => ts.isThrowStatement(node) || ts.isReturnStatement(node))
      .filter(exit => exit.getEnd() < call.getStart(parsed.file) && enclosingPredicates(parsed, exit).length) : [];
    if (earlierExits.length) parts.push("Before that call, the source contains these guarded exits:", ...earlierExits.map(exit =>
      `- L${line(parsed, exit)}: ${ts.isThrowStatement(exit) ? "throws" : "returns from its enclosing function/callback"} under ${enclosingPredicates(parsed, exit).map(codeText).join(" AND ")}.`));
    parts.push("Actual call and surrounding checks:",
      (fn && citation(parsed, fn)) ?? citation(parsed, call)!);
  }
  const later = conditions.filter(node => node.getStart(target.file) > changed!.getEnd() && node.getEnd() <= scope.getEnd());
  const rejections = nodes(scope, ts.isThrowStatement).filter(node => !(node.getStart(target.file) >= changed!.getStart(target.file) && node.getEnd() <= changed!.getEnd()) && enclosingPredicates(target, node).length);
  if (rejections.length) parts.push("**Remaining inline rejection paths** — earlier control flow or helpers can prevent reaching these branches:",
    ...rejections.map(node => `- L${line(target, node)}: throws under ${enclosingPredicates(target, node).map(codeText).join(" AND ")}.`));
  // Definitions prevent a derived predicate such as `isSignatureField` from
  // concealing a disjunction. This list does not claim every helper was opened.
  const identifiers = new Set(later.flatMap(node => nodes(node.expression, ts.isIdentifier).map(id => id.text)));
  const writeCalls = nodes(scope, ts.isCallExpression).filter(call => call.getStart(target.file) > changed!.getEnd() && ts.isPropertyAccessExpression(call.expression) && /^(?:create|update|upsert|delete|insert|save)$/.test(call.expression.name.text));
  const beforeWrites = writeCalls[0]?.getStart(target.file) ?? scope.getEnd();
  const definitions = nodes(scope, ts.isVariableDeclaration).filter(node => node.getStart(target.file) > changed!.getEnd() && node.getEnd() < beforeWrites && ts.isIdentifier(node.name) && identifiers.has(node.name.text) && node.initializer);
  const helperCalls = nodes(scope, ts.isCallExpression).filter(call => call.getStart(target.file) > changed!.getEnd() && call.getEnd() < beforeWrites && ts.isIdentifier(call.expression) &&
    !definitions.some(definition => call.getStart(target.file) >= definition.getStart(target.file) && call.getEnd() <= definition.getEnd()));
  const ranges: Array<{ start: number; end: number }> = [];
  for (const node of [...definitions, ...helperCalls].sort((a, b) => a.getStart(target.file) - b.getStart(target.file))) {
    const start = line(target, node), end = line(target, node, true), previous = ranges.at(-1);
    if (previous && start - previous.end <= 8 && end - previous.start <= 120) previous.end = Math.max(previous.end, end);
    else ranges.push({ start, end });
  }
  if (ranges.length) parts.push("**Guard bindings and helper calls** — validate helper implementations before relying on their policy:",
    ...ranges.map(range => rangeCitation(target, range.start, range.end)!));
  const shown = new Set<ts.Node>();
  if (writeCalls.length) parts.push("**Later calls that may be affected** — they are reached only if the preceding control flow allows it:",
    ...writeCalls.map(call => {
      const predicates = enclosingPredicates(target, call, scope);
      const payload = call.arguments.find(ts.isObjectLiteralExpression);
      const branches = payload?.properties.filter(ts.isPropertyAssignment).map(property => property.name.getText(target.file)) ?? [];
      return `- L${line(target, call)}: ${codeText(call.expression.getText(target.file))}${predicates.length ? ` is enclosed by ${predicates.map(codeText).join(" AND ")}` : " has no enclosing if in the shown function"}.${branches.includes("create") && branches.includes("update") ? " Its source has separate create and update payloads." : ""}`;
    }));
  for (const call of writeCalls) {
    let excerpt: ts.Node = call;
    for (let parent = call.parent; parent && parent !== scope; parent = parent.parent) {
      if (isFunction(parent) && ts.isCallExpression(parent.parent)) { excerpt = parent.parent; break; }
      if (ts.isIfStatement(parent)) excerpt = parent;
    }
    if (shown.has(excerpt)) continue;
    const code = citation(target, excerpt); if (!code) continue;
    shown.add(excerpt); parts.push("Later call sites and their enclosing branch:", code);
  }
  parts.push("**Pre-ship verification**",
    "- For each shown caller, test a newly admitted predicate value with the other checks passing and with each shown rejection condition met. Verify the intended allowed-value policy.",
    "- Test the conditional calls with their enclosing predicates false and true. Verify any create/update payload expectations against the actual stored records.",
    "- Do imported helpers or middleware enforce additional preconditions? Verify their bodies before making an access or status-enforcement claim.",
    "- Which additional caller paths are outside this opened set? The capped dependency set does not establish complete coverage.",
    "These excerpts prove the shown syntax and calls. They do not prove stored-data invariants, helper internals, authentication policy, or inevitable writes.");
  return parts.filter(Boolean).join("\n\n");
}
