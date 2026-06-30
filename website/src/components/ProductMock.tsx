"use client";

import type { ProductMockScenario } from "@/lib/productMockScenarios";
import { isInquiryProductMock } from "@/lib/productMockScenarios";
import { CODE_CREATION_STORIES } from "@/lib/codeCreationScenarios";
import { ProductCreationMock } from "./ProductCreationMock";
import { ProductInquiryMock } from "./ProductInquiryMock";

type ProductMockProps = {
  scenario: ProductMockScenario;
  className?: string;
  onAnimationComplete?: () => void;
};

export function ProductMock({ scenario, className = "", onAnimationComplete }: ProductMockProps) {
  if (!isInquiryProductMock(scenario)) {
    const creationStory = CODE_CREATION_STORIES.find((s) => s.id === scenario.codeCreationId);
    if (!creationStory) {
      return null;
    }

    return (
      <ProductCreationMock
        story={creationStory}
        tabs={scenario.tabs}
        ariaLabel={scenario.ariaLabel}
        className={className}
        onCycleComplete={onAnimationComplete}
      />
    );
  }

  return (
    <ProductInquiryMock
      scenario={scenario}
      className={className}
      onCycleComplete={onAnimationComplete}
    />
  );
}
