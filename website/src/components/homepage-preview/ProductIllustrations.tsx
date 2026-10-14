import { ArrowRight, Check, FileCode2, GitBranch, GitMerge, UserRound, Users } from "lucide-react";
import { ConfluenceIcon, GitHubIcon, JiraIcon, SlackIcon, NotionIcon } from "@/components/logos/brand-icons";
import styles from "./ProductIllustrations.module.css";

export type IllustrationKind = "hero" | "decision" | "ownership" | "edit" | "complete" | "integrations";

export const illustrationLabels: Record<IllustrationKind, string> = {
  hero: "Illustrative chat asking why authentication moved into shared middleware and tracing that decision to the team's discussion and shipped PR, with linked sources and a code owner.",
  decision: "Illustrative answer to why auth is checked in middleware, connecting the architecture discussion, auth ADR and merged PR.",
  ownership: "Illustrative answer to who should review a retry-policy change and which services use that policy.",
  edit: "Illustrative request to implement PLATFORM-2847 using the auth pattern from merged PR #891, with a reviewable diff.",
  complete: "Illustrative inline completion matching the AuthError pattern from the team's shipped code.",
  integrations: "Illustrative request for a webhook auth fix using a related ticket and the pattern shipped in api-gateway, with connected PRs, team discussions and runbooks."
};

function SourceChips() {
  return <div className={styles.sourceChips}><span><SlackIcon />#platform-bugs</span><span><JiraIcon />PLATFORM-2847</span><span><GitHubIcon />PR #891</span></div>;
}

function FileLabel({ file = "middleware / auth.ts" }: { file?: string }) {
  return <span className={styles.fileLabel}><FileCode2 size={13} />{file}</span>;
}

function HeroIllustration() {
  return <div className={styles.editor}>
    <div className={styles.editorBar}><FileLabel /><span className={styles.branch}><GitBranch size={12} /> main</span></div>
    <div className={styles.editorBody}>
      <div className={styles.codePane}>
        <p className={styles.codeBreadcrumb}>middleware <span>/</span> auth.ts <span>/</span> authenticate</p>
        <div className={styles.codeLines}>
          <div><i>18</i><code><b>function</b> <em>authenticate</em>(req, next) {'{'}</code></div>
          <div><i>19</i><code>  <b>const</b> session = readSession(req);</code></div>
          <div className={styles.selectedLine}><i>20</i><code>  <b>if</b> (!session) {'{'}</code></div>
          <div className={styles.selectedLine}><i>21</i><code>    <b>throw new</b> AuthError(&apos;missing_session&apos;);</code><span className={styles.lineDot} /></div>
          <div><i>22</i><code>  {'}'}</code></div>
          <div><i>23</i><code>  <b>return</b> next(req);</code></div>
          <div><i>24</i><code>{'}'}</code></div>
        </div>
        <div className={styles.inlineContext}><span><GitMerge size={14} /> Introduced in PR #412</span><span>Auth ADR <ArrowRight size={12} /></span></div>
        <div className={styles.editorStatus}><span>TypeScript</span><span>Decision sources linked <Check size={11} /></span></div>
      </div>
      <div className={styles.contextPane}>
        <div className={styles.userMessage}>
          <div className={styles.userMessageLabel}><span><UserRound size={12} aria-hidden="true" /></span>You</div>
          <div className={styles.questionBubble}>
            <p className={styles.heroQuestion}>Why did we move authentication into shared middleware instead of checking it in each route?</p>
            <p className={styles.heroQuestion}>Can you trace that decision back to the team discussion and the PR that shipped it?</p>
          </div>
        </div>
        <div className={styles.coopLabel}><span className={styles.coopSquare}>C</span>CoopAI <span>Trace Decision</span></div>
        <div className={styles.contextSources}>
          <div><SlackIcon /><span><strong>#architecture</strong><small>Why route checks were replaced</small></span><ArrowRight /></div>
          <div><JiraIcon /><span><strong>AUTH-184</strong><small>Centralize auth validation</small></span><ArrowRight /></div>
          <div><GitHubIcon /><span><strong>PR #412 · merged</strong><small>Introduced the middleware</small></span><ArrowRight /></div>
        </div>
        <p className={styles.answer}>One shared check for every route.</p>
        <p className={styles.answerDetail}>The auth ADR moved validation into middleware so routes use the same checks.</p>
        <div className={styles.ownerStrip}><span className={styles.avatar}>PA</span><span><strong>Platform Auth</strong><small>CODEOWNERS · auth/</small></span><Users size={15} /></div>
      </div>
    </div>
  </div>;
}

function DecisionIllustration() {
  return <div className={styles.decision}>
    <span className={styles.smallLabel}>UNDERSTAND AN UNFAMILIAR CODEBASE</span>
    <h4>“Why is auth checked here?”</h4>
    <p className={styles.sceneAnswer}>Shared middleware replaced per-route checks.</p>
    <div className={styles.trail}>
      <div><SlackIcon /><strong>Auth discussion</strong><small>#architecture</small></div><ArrowRight className={styles.trailArrow} />
      <div><ConfluenceIcon /><strong>Shared auth ADR</strong><small>Confluence</small></div><ArrowRight className={styles.trailArrow} />
      <div><GitHubIcon /><strong>Middleware merged</strong><small>PR #412</small></div>
    </div>
    <div className={styles.decisionCode}><FileLabel file="middleware / auth.ts" /><code>router.use(authenticate);</code></div>
  </div>;
}

function OwnershipIllustration() {
  return <div className={styles.ownership}>
    <p className={styles.sceneQuestion}>“Who should review this change?”</p>
    <div className={styles.ownerCard}><span className={styles.avatar}>PP</span><span><strong>Payments team</strong><small>@platform-payments · retry policy</small></span><span className={styles.ownerBadge}>CODEOWNERS</span></div>
    <div className={styles.dependencyMap}>
      <div className={styles.functionNode}><FileCode2 size={19} /><strong>retryBackoff()</strong><small>payments / queue.go</small></div>
      <svg className={styles.mapLines} viewBox="0 0 140 132" preserveAspectRatio="none" fill="none" aria-hidden="true"><path d="M0 66H34C74 66 64 20 140 20M0 66H140M34 66C74 66 64 112 140 112" stroke="#9baaa0" strokeWidth="1.3" /></svg>
      <div className={styles.dependentNodes}><span><GitBranch />api-gateway</span><span><GitBranch />billing-worker</span><span><GitBranch />ledger-svc</span></div>
    </div>
    <div className={styles.mapFoot}><span><span className={styles.smallDot} /> 3 services use this retry policy</span><span>Review with Payments <ArrowRight size={11} /></span></div>
  </div>;
}

function EditIllustration() {
  return <div className={styles.edit}>
    <div className={styles.miniBar}><FileLabel file="webhooks / auth.ts" /><span>Patch ready</span></div>
    <p className={`${styles.sceneQuestion} ${styles.insetQuestion}`}>“Fix this auth bug like api-gateway did.”</p>
    <div className={styles.patchContext}><span>Ticket + shipped fix</span><SourceChips /></div>
    <div className={styles.diffCode}>
      <div className={styles.removed}><span>−</span><code>return validate(payload);</code></div>
      <div className={styles.added}><span>+</span><code><b>if</b> (!payload) <b>throw new</b> AuthError(</code></div>
      <div className={styles.added}><span>+</span><code>  &apos;empty_or_unsigned_payload&apos;);</code></div>
      <div className={styles.added}><span>+</span><code><b>return</b> validate(payload);</code></div>
    </div>
    <div className={styles.patchFooter}><span>1 file · 1 edit</span><span className={styles.reviewPill}>Review diff <ArrowRight size={12} /></span></div>
  </div>;
}

function CompletionIllustration() {
  return <div className={styles.completion}>
    <div className={styles.miniBar}><FileLabel file="token_validator.ts" /><span>TypeScript</span></div>
    <p className={`${styles.sceneQuestion} ${styles.insetQuestion}`}>“Use our existing AuthError pattern.”</p>
    <div className={styles.completionCode}><div><i>4</i><code><b>if</b> (!payload) {'{'}</code></div><div><i>5</i><code>  <span className={styles.typed}>throw </span><span className={styles.ghost}>new AuthError(</span></code></div><div><i>6</i><code className={styles.ghost}>    &apos;empty_or_unsigned_payload&apos;</code></div><div><i>7</i><code className={styles.ghost}>  );</code></div><div><i>8</i><code>{'}'}</code></div></div>
    <div className={styles.patternNote}><GitHubIcon /><span>Pattern from shipped code<br /><strong>billing / auth</strong></span><span className={styles.acceptKey}><kbd>Tab</kbd> Accept</span></div>
  </div>;
}

function IntegrationsIllustration() {
  return <div className={styles.integrations}>
    <p className={styles.sceneQuestion}>“How should I fix this webhook auth failure? Use the related ticket and the pattern we already shipped in api-gateway to suggest the code change.”</p>
    <div className={styles.integrationNodes}><span><GitHubIcon />Merged PRs</span><span><SlackIcon />Team decisions</span><span><JiraIcon />Open tickets</span><span><NotionIcon />Runbooks</span></div>
    <svg className={styles.integrationLines} viewBox="0 0 400 60" preserveAspectRatio="none" fill="none" aria-hidden="true"><path d="M50 0V10C50 40 200 10 200 60M150 0C150 30 200 20 200 60M250 0C250 30 200 20 200 60M350 0V10C350 40 200 10 200 60" stroke="#a9b9a0" strokeWidth="1.2" /></svg>
    <div className={styles.sharedLayer}><span className={styles.coopSquare}>C</span><span><strong>The context behind the change</strong><small>Connected sources, within your access scope.</small></span></div>
    <div className={styles.developers}><span><FileCode2 />Onboarding</span><span><FileCode2 />Code review</span><span><FileCode2 />Support</span></div>
  </div>;
}

export function ProductIllustration({ kind }: { kind: IllustrationKind }) {
  const scenes = { hero: HeroIllustration, decision: DecisionIllustration, ownership: OwnershipIllustration, edit: EditIllustration, complete: CompletionIllustration, integrations: IntegrationsIllustration };
  const Scene = scenes[kind];
  return <div className={styles.art} role="img" aria-label={illustrationLabels[kind]}><Scene /></div>;
}
