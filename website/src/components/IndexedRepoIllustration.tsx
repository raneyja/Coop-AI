import { ArrowRight, FileCode2, Network, Users } from "lucide-react";
import { GitHubIcon, GitLabIcon, BitbucketIcon } from "@/components/logos/brand-icons";
import styles from "./IndexedRepoIllustration.module.css";

/** Illustrative remote repository context, using the homepage's visual language. */
export function IndexedRepoIllustration() {
  return (
    <figure className={styles.stage} aria-label="Illustrative remote repositories feeding a searchable map, with file bodies fetched from the code host into the editor when needed.">
      <figcaption className={styles.caption}><span>REMOTE REPOSITORIES. CONNECTED CONTEXT.</span></figcaption>
      <div className={styles.flow}>
        <div className={styles.repositories}>
          <p className={styles.label}>YOUR CODE HOSTS</p>
          {[{ name: "GitHub", Icon: GitHubIcon }, { name: "GitLab", Icon: GitLabIcon }, { name: "Bitbucket", Icon: BitbucketIcon }].map(({ name, Icon }) => (
            <div className={styles.repo} key={name}><Icon className={styles.hostIcon} /><span>{name}</span><span className={styles.dot} /></div>
          ))}
          <p className={styles.note}>Repositories stay remote.</p>
        </div>
        <ArrowRight className={styles.connector} size={23} strokeWidth={1.3} aria-hidden="true" />
        <div className={styles.map}>
          <div className={styles.mapHeader}><span className={styles.coop}>C</span><div><p className={styles.label}>DEEP-INDEX</p><p className={styles.mapTitle}>One searchable map.</p></div></div>
          <div className={styles.graph} aria-hidden="true">
            <svg viewBox="0 0 280 120" preserveAspectRatio="xMidYMid meet"><path d="M45 25L140 60L235 25M45 95L140 60L235 95M140 60V10M140 60V110" /><circle cx="45" cy="25" r="7" /><circle cx="235" cy="25" r="7" /><circle cx="45" cy="95" r="7" /><circle cx="235" cy="95" r="7" /><circle cx="140" cy="10" r="5" /><circle cx="140" cy="110" r="5" /><circle cx="140" cy="60" r="14" /></svg>
          </div>
          <div className={styles.facts}><span><Network size={14} aria-hidden="true" />Symbols &amp; dependents</span><span><Users size={14} aria-hidden="true" />Owners &amp; history</span></div>
        </div>
        <ArrowRight className={styles.connector} size={23} strokeWidth={1.3} aria-hidden="true" />
        <div className={styles.editor}>
          <div className={styles.file}><FileCode2 size={15} aria-hidden="true" /><span>payments / retry.ts</span></div>
          <div className={styles.editorContent}>
            <p className={styles.question}>“If I change this retry policy, which services need an update?”</p>
            <div className={styles.code}><span>export function <b>retryPayment</b>() {'{'}</span><span>  return withRetry(payment, policy);</span><span>{'}'}</span></div>
            <div className={styles.context}><Network size={16} aria-hidden="true" /><span>Trace dependents across repos.</span></div>
          </div>
          <p className={styles.fileFetch}>File bodies fetched on demand.</p>
        </div>
      </div>
      <div className={styles.footer}><span>Shared repository context, in your editor.</span><span>No monorepo clone on every laptop.</span></div>
    </figure>
  );
}
