"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { ArrowDown, ArrowRight, ArrowUpRight, Check, Expand, GitBranch, LockKeyhole, Menu, ShieldCheck, Users, X } from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import { GitHubIcon, GitLabIcon, BitbucketIcon, SlackIcon, JiraIcon, NotionIcon, ConfluenceIcon, TeamsIcon, GoogleDocsIcon } from "@/components/logos/brand-icons";
import { installExtensionHref, siteConfig } from "@/lib/site.config";
import { ProductIllustration, illustrationLabels, type IllustrationKind } from "./ProductIllustrations";
import styles from "./HomepagePreview.module.css";

const integrations = [
  { name: "GitHub", Icon: GitHubIcon, href: "/docs/github" },
  { name: "GitLab", Icon: GitLabIcon, href: "/integrations" },
  { name: "Bitbucket", Icon: BitbucketIcon, href: "/integrations" },
  { name: "Slack", Icon: SlackIcon, href: "/docs/slack" },
  { name: "Jira", Icon: JiraIcon, href: "/docs/jira" },
  { name: "Notion", Icon: NotionIcon, href: "/docs/notion" },
  { name: "Confluence", Icon: ConfluenceIcon, href: "/integrations" },
  { name: "Teams", Icon: TeamsIcon, href: "/integrations" },
  { name: "Google Docs", Icon: GoogleDocsIcon, href: "/docs/google-docs" }
];

function InstallLink({ secondary = false }: { secondary?: boolean }) {
  return <a className={secondary ? styles.secondaryButton : styles.primaryButton} href={installExtensionHref()}>Install free in VS Code <ArrowDown size={16} aria-hidden="true" /></a>;
}

function IllustrationButton({ kind, onOpen }: { kind: IllustrationKind; onOpen: (kind: IllustrationKind) => void }) {
  return (
    <button type="button" className={styles.capture} onClick={() => onOpen(kind)} aria-label={`Enlarge illustration: ${illustrationLabels[kind]}`}>
      <ProductIllustration kind={kind} />
      <span className={styles.expand}><Expand size={15} aria-hidden="true" /><span>View illustration</span></span>
    </button>
  );
}

export function HomepagePreview() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [selected, setSelected] = useState<IllustrationKind | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  function openIllustration(kind: IllustrationKind) {
    setSelected(kind);
    dialogRef.current?.showModal();
  }
  const nav = siteConfig.nav;

  return (
    <div className={styles.page} data-homepage>
      <a className={styles.skipLink} href="#preview-content">Skip to content</a>
      <header className={styles.header}>
        <div className={styles.navInner}>
          <Link href="/" aria-label="CoopAI home"><BrandMark /></Link>
          <nav className={styles.desktopNav} aria-label="Primary navigation">{nav.map(item => item.href.startsWith("#") ? <a key={item.label} href={item.href}>{item.label}</a> : <Link key={item.label} href={item.href}>{item.label}</Link>)}</nav>
          <div className={styles.navActions}><a className={styles.signIn} href={siteConfig.links.adminPortal}>Sign in</a><a className={styles.navInstall} href={installExtensionHref()}>Install free <ArrowDown size={14} aria-hidden="true" /></a><button className={styles.menuButton} aria-label={menuOpen ? "Close navigation" : "Open navigation"} aria-expanded={menuOpen} aria-controls="preview-mobile-menu" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X size={22} /> : <Menu size={22} />}</button></div>
        </div>
        {menuOpen && <nav className={styles.mobileNav} id="preview-mobile-menu" aria-label="Mobile navigation">{nav.map(item => <a key={item.label} href={item.href} onClick={() => setMenuOpen(false)}>{item.label}<ArrowUpRight size={15} /></a>)}<a href={siteConfig.links.adminPortal}>Sign in <ArrowUpRight size={15} /></a></nav>}
      </header>

      <div id="preview-content">
        <section className={`${styles.container} ${styles.hero}`} aria-labelledby="hero-title">
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}><span className={styles.liveDot} /> Your team&apos;s context. In your editor.</p>
            <h1 id="hero-title">From your stack,<br /><span>to your codebase.</span></h1>
            <p className={styles.heroDescription}>{siteConfig.heroKicker}</p>
            <div className={styles.buttonRow}><InstallLink /><Link className={styles.secondaryButton} href={siteConfig.links.demo}>Book a demo <ArrowUpRight size={16} aria-hidden="true" /></Link></div>
            <p className={styles.alongside}>Works alongside Copilot, Claude, Cursor, Codex, and more.</p>
          </div>
          <div className={styles.heroStage}>
            <div className={styles.stageTop}><span><span className={styles.stageDot} /> COOPAI IN VS CODE</span><span>Illustrative product view</span></div>
            <div className={styles.heroCapture}><IllustrationButton kind="hero" onOpen={openIllustration} /></div>
            <div className={styles.stageBottom}><span><Check size={14} /> A change you can review and apply.</span><a href="#product">Explore the product <ArrowRight size={15} /></a></div>
          </div>
        </section>

        <section className={`${styles.container} ${styles.integrationsStrip}`} aria-label="Supported context sources">
          <p>Connected to the tools your team already uses.</p>
          <div>{integrations.slice(0, 7).map(({ name, Icon, href }) => <Link href={href} key={name}><Icon className={styles.brandIcon} /><span>{name}</span></Link>)}</div>
        </section>

        <section className={`${styles.container} ${styles.features}`} id="product" aria-labelledby="features-title">
          <div className={styles.sectionIntro}><p className={styles.eyebrow}>THE CONTEXT BEHIND THE CODE</p><h2 id="features-title">Your coding assistant writes the lines.<br /><span>Coop brings the rest of the story.</span></h2><p>Who owns it. Why it exists. What depends on it. The pattern your team already shipped.</p><span className={styles.illustrationNote}>Illustrative examples of CoopAI workflows.</span></div>
          <div className={styles.featureGrid}>
            <article className={styles.feature}>
              <div className={styles.featureCopy}><span className={styles.featureLabel}>01 / TRACE DECISION</span><h3>Go from “why?” to the source.</h3><p>Follow a decision back to commits, pull requests, and team context. Keep the evidence next to the code you&apos;re reading.</p><Link href="/docs/what-is-coopai">Explore decision context <ArrowRight size={16} /></Link></div>
              <div className={`${styles.featureStage} ${styles.sageStage}`}><IllustrationButton kind="decision" onOpen={openIllustration} /></div>
            </article>
            <article className={styles.feature}>
              <div className={styles.featureCopy}><span className={styles.featureLabel}>02 / OWNERSHIP &amp; IMPACT</span><h3>Know who to ask. See what you touch.</h3><p>Find owners, inspect callers and dependents, and surface missing context before you change an unfamiliar module.</p><Link href="/product">Explore repository intelligence <ArrowRight size={16} /></Link></div>
              <div className={`${styles.featureStage} ${styles.blueStage}`}><IllustrationButton kind="ownership" onOpen={openIllustration} /></div>
            </article>
            <article className={styles.feature}>
              <div className={styles.featureCopy}><span className={styles.featureLabel}>03 / EDIT</span><h3>A grounded change. A diff you control.</h3><p>Describe the change, review the patch, and apply it in the file. Use the shipped patterns and context your team works with.</p><Link href="/docs/edit-mode">Explore editing <ArrowRight size={16} /></Link></div>
              <div className={`${styles.featureStage} ${styles.clayStage} ${styles.diffStage}`}><IllustrationButton kind="edit" onOpen={openIllustration} /></div>
            </article>
            <article className={styles.feature}>
              <div className={styles.featureCopy}><span className={styles.featureLabel}>04 / COMPLETE</span><h3>Stay in flow. Stay in the file.</h3><p>Accept inline suggestions with Tab. Completions start from your open buffer; indexed context can add dependents and ownership.</p><Link href="/docs/autocomplete">Explore completions <ArrowRight size={16} /></Link></div>
              <div className={`${styles.featureStage} ${styles.sandStage}`}><IllustrationButton kind="complete" onOpen={openIllustration} /></div>
            </article>
          </div>
        </section>

        <section className={styles.contextBand} id="organization" aria-labelledby="context-title">
          <div className={`${styles.container} ${styles.contextLayout}`}>
            <div><p className={styles.eyebrow}>SHARED ACROSS THE ORGANIZATION</p><h2 id="context-title">One connected stack.<br /><span>A team that shares the context.</span></h2><p className={styles.bodyCopy}>Bring company Slack, tickets, docs, and remote repositories into the same conversation. Your admin connects the sources and manages scope. Your developers stay in the editor.</p><Link className={styles.textLink} href="/integrations">Explore integrations <ArrowRight size={17} /></Link></div>
            <div className={styles.integrationProof}><IllustrationButton kind="integrations" onOpen={openIllustration} /></div>
          </div>
          <nav className={`${styles.container} ${styles.allIntegrations}`} aria-label="Integration guides">{integrations.map(({ name, Icon, href }) => <Link href={href} key={name}><Icon className={styles.brandIcon} /><span>{name}</span></Link>)}</nav>
        </section>

        <section className={`${styles.container} ${styles.howSection}`} id="how-it-works" aria-labelledby="how-title">
          <div className={styles.sectionIntro}><p className={styles.eyebrow}>FROM CONNECTED TO IN CONTEXT</p><h2 id="how-title">Connect once.<br /><span>Keep the team in the loop.</span></h2></div>
          <div className={styles.steps}>
            <article><span>01</span><h3>Connect your stack.</h3><p>Your admin connects code hosts, collaboration tools, and docs for the organization.</p><Link href="/docs/connect-integrations">Connect integrations <ArrowRight size={15} /></Link></article>
            <article><span>02</span><h3>Map the codebase.</h3><p>Server-side indexing maps ownership, history, and dependencies. Repository files are read remotely on demand.</p><Link href="/how-it-works">How indexing works <ArrowRight size={15} /></Link></article>
            <article><span>03</span><h3>Work in the editor.</h3><p>Ask, complete, and edit in VS Code, with source links and reviewable changes beside your code.</p><Link href="/docs/getting-started">Get started <ArrowRight size={15} /></Link></article>
          </div>
        </section>

        <section className={styles.quoteBand} aria-labelledby="quote-title"><div className={`${styles.container} ${styles.quoteLayout}`}><div><p className={styles.eyebrow}>LESS CONTEXT HUNTING</p><h2 id="quote-title">More of the story.<br /><span>Fewer repeat questions.</span></h2><span className={styles.quoteStat}>50%<small>less time asking and answering</small></span></div><figure><blockquote>“{siteConfig.quotes[0].text}”</blockquote><figcaption><span className={styles.avatar}>TD</span><div><strong>{siteConfig.quotes[0].author}</strong><span>{siteConfig.quotes[0].detail}</span></div></figcaption><p className={styles.quoteNote}>Reported by this customer on their production repos.</p></figure></div></section>

        <section className={`${styles.container} ${styles.securitySection}`} id="enterprise" aria-labelledby="security-title"><div className={styles.sectionIntro}><p className={styles.eyebrow}>BUILT FOR THE ORGANIZATION</p><h2 id="security-title">Your context.<br /><span>Your deployment controls.</span></h2><p>Shared intelligence needs clear access boundaries. Connect your organization&apos;s sources and review the data flow for your deployment.</p></div><div className={styles.securityGrid}><article><GitBranch size={23} /><h3>Zero-clone for developers</h3><p>Remote repository context, without a full monorepo copy on every laptop.</p></article><article><LockKeyhole size={23} /><h3>Keys on the server</h3><p>Model-provider credentials are configured server-side, outside the extension.</p></article><article><Users size={23} /><h3>Org-managed context</h3><p>Admin-connected sources, configurable scope, and selected-action audit records.</p></article><article><ShieldCheck size={23} /><h3>Enterprise sign-in</h3><p>SAML sign-in and enterprise deployment options for your organization.</p></article></div><Link className={styles.textLink} href="/security">Explore architecture &amp; data handling <ArrowUpRight size={16} /></Link></section>

        <section className={styles.closeSection}><div className={styles.container}><p className={styles.eyebrow}>STAY IN THE FILE. KNOW THE STACK.</p><h2>See CoopAI<br /><span>on your codebase.</span></h2><p>Install the extension, or take a 20-minute walkthrough<br className={styles.desktopBreak} /> of your actual repo with the founder.</p><div className={styles.buttonRow}><InstallLink /><Link className={styles.secondaryButton} href={siteConfig.links.demo}>Book a demo <ArrowUpRight size={16} /></Link></div></div></section>
      </div>

      <footer className={styles.footer}><div className={`${styles.container} ${styles.footerGrid}`}><div><Link href="/"><BrandMark /></Link><p>Shared org context in the editor.<br />From your stack, to your codebase.</p></div><div><h3>Product</h3><Link href="/product">Features</Link><Link href="/integrations">Integrations</Link><Link href="/pricing">Pricing</Link><Link href="/security">Security</Link></div><div><h3>Resources</h3><Link href="/docs">Documentation</Link><Link href="/manual">Owner&apos;s manual</Link><Link href="/blog">Blog</Link><Link href="/demo">Book a demo</Link></div><div><h3>Company</h3><a href={`mailto:${siteConfig.contactEmail}`}>Contact</a><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><a href={siteConfig.links.adminPortal}>Admin portal</a></div></div><div className={`${styles.container} ${styles.footerBottom}`}><span>© {new Date().getFullYear()} CoopAI.</span><span>Made for the way your team ships.</span></div></footer>

      <dialog ref={dialogRef} className={styles.dialog} aria-label="Product illustration" onClose={() => setSelected(null)} onClick={event => { if (event.target === event.currentTarget) dialogRef.current?.close(); }}>
        <div className={styles.dialogHeader}><p>{selected ? illustrationLabels[selected] : ""}</p><button type="button" aria-label="Close illustration" onClick={() => dialogRef.current?.close()}><X size={22} /></button></div>
        {selected && <div className={styles.dialogArtwork}><ProductIllustration kind={selected} /></div>}
      </dialog>
    </div>
  );
}
