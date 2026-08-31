import { LogoStrip } from "./logos/LogoStrip";
import { MODEL_PROVIDER_LOGOS } from "./logos/logo-data";

export function ModelProviderLogos() {
  return (
    <LogoStrip
      label="Works with your models"
      items={MODEL_PROVIDER_LOGOS}
      ariaLabel="Supported model providers"
    />
  );
}
