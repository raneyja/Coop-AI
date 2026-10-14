import Link from "next/link";
import { ArrowDown } from "lucide-react";
import styles from "./HowItWorksLoop.module.css";
import { HOW_IT_WORKS_LOOP } from "@/lib/howItWorks";

/** Numbered 01 → 02 → 03 pipeline for the How CoopAI works page. */
export function HowItWorksLoop() {
  return (
    <ol className={styles.steps}>
      {HOW_IT_WORKS_LOOP.map((step) => (
        <li key={step.id} className={styles.step}>
          <Link
            href={`#${step.id}`}
            className={styles.link}
          >
            <span className={styles.number}>{step.step}</span>
            <p className={styles.label}>// {step.label}</p>
            <p className={styles.title}>{step.title}</p>
            <p className={styles.summary}>{step.summary}</p>
            <ArrowDown className={styles.arrow} size={16} aria-hidden="true" />
          </Link>
        </li>
      ))}
    </ol>
  );
}
