import { buildFaqPageSchema, type FaqPair } from "@/lib/faqSchema";

type FaqPageSchemaProps = {
  pairs: FaqPair[];
};

export function FaqPageSchema({ pairs }: FaqPageSchemaProps) {
  if (pairs.length === 0) {
    return null;
  }

  const schema = buildFaqPageSchema(pairs);

  return (
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />
  );
}
