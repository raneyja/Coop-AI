import { Button, InstallExtensionButton } from "./Button";
import styles from "./CTASection.module.css";

type CTASectionProps = {
  title?: string;
  secondaryTitle?: string;
  description?: string;
  primaryLabel?: string;
  primaryHref?: string;
  showInstall?: boolean;
};

export function CTASection({
  title,
  secondaryTitle,
  description = "Install the extension, or spend 20 minutes on your actual repo with the founder.",
  primaryLabel = "Book a 20-minute demo on your repo",
  primaryHref = "/demo",
  showInstall = true
}: CTASectionProps) {
  const heading = title ?? "See CoopAI";
  const secondLine = secondaryTitle ?? (title ? undefined : "on your codebase");
  return (
    <section className={styles.section}>
      <div className={styles.content}>
        <h2 className={`site-title ${styles.title}`}>{heading}{secondLine && <> <span className="site-title-secondary">{secondLine}</span></>}</h2>
        <p className={styles.description}>{description}</p>
        <div className={styles.actions}>
          <Button href={primaryHref} className={styles.primary}>{primaryLabel}</Button>
          {showInstall && <InstallExtensionButton className={styles.secondary} label="Install the free VS Code extension" />}
        </div>
        <p className={styles.caption}>code intelligence from your entire stack</p>
      </div>
    </section>
  );
}
