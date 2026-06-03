import { LogoStrip } from "./logos/LogoStrip";
import { INTEGRATION_LOGOS, MODEL_PROVIDER_LOGOS } from "./logos/logo-data";

/** Model + integration logo rows for the home page features section */
export function HomePartnerLogos() {
  return (
    <div className="mt-14 border-t border-white/5 pt-12 pb-4">
      <LogoStrip
        label="Works with your models"
        items={MODEL_PROVIDER_LOGOS}
        ariaLabel="Supported model providers"
      />
      <LogoStrip
        label="Connects to your stack"
        items={INTEGRATION_LOGOS}
        className="mt-10"
        ariaLabel="Supported integrations"
      />
    </div>
  );
}
