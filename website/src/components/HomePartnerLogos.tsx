import { LogoStrip } from "./logos/LogoStrip";
import { INTEGRATION_LOGOS, MODEL_PROVIDER_LOGOS } from "./logos/logo-data";

/** Model + integration logo rows for the home page features section */
export function HomePartnerLogos({ tone = "light" }: { tone?: "light" | "dark" }) {
  return (
    <>
      <LogoStrip
        label="Works with your models"
        items={MODEL_PROVIDER_LOGOS}
        tone={tone}
        ariaLabel="Supported model providers"
      />
      <LogoStrip
        label="Connects to your stack"
        items={INTEGRATION_LOGOS}
        tone={tone}
        className="mt-10"
        ariaLabel="Supported integrations"
      />
    </>
  );
}
