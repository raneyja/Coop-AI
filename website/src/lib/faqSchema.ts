export type FaqPair = {
  question: string;
  answer: string;
};

/** Extract FAQ pairs from markdown content (### question headings). */
export function extractFaqPairs(content: string): FaqPair[] {
  const pairs: FaqPair[] = [];

  for (const section of content.split(/^### /m).slice(1)) {
    const newlineIndex = section.indexOf("\n");
    if (newlineIndex === -1) {
      continue;
    }

    const question = section.slice(0, newlineIndex).trim();
    const answer = section
      .slice(newlineIndex + 1)
      .trim()
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/\*\*/g, "")
      .replace(/\s+/g, " ")
      .slice(0, 500);

    if (question && answer) {
      pairs.push({ question, answer });
    }
  }

  return pairs;
}

export function buildFaqPageSchema(pairs: FaqPair[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: pairs.map((pair) => ({
      "@type": "Question",
      name: pair.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: pair.answer
      }
    }))
  };
}
