import { ProductMock } from "./ProductMock";
import { getProductMockScenario } from "@/lib/productMockScenarios";

/** Homepage hero — default ownership scenario */
export function HeroProductMock() {
  return <ProductMock scenario={getProductMockScenario("ownership")} />;
}
