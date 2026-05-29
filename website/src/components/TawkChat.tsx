"use client";

import Script from "next/script";

/**
 * Same embed as Tawk’s “insert this code” snippet — IDs come from env vars
 * (see README). Tawk’s dashboard may still say “install code” until a visitor
 * loads the widget on your production domain.
 */
export function TawkChat() {
  const propertyId = process.env.NEXT_PUBLIC_TAWK_PROPERTY_ID?.trim();
  const widgetId = process.env.NEXT_PUBLIC_TAWK_WIDGET_ID?.trim();

  if (!propertyId || !widgetId) {
    return null;
  }

  const embedSrc = `https://embed.tawk.to/${propertyId}/${widgetId}`;

  return (
    <>
      <Script id="tawk-api-init" strategy="afterInteractive">
        {`var Tawk_API=Tawk_API||{}, Tawk_LoadStart=new Date();`}
      </Script>
      <Script
        id="tawk-embed"
        src={embedSrc}
        strategy="afterInteractive"
        crossOrigin="anonymous"
        charSet="UTF-8"
      />
    </>
  );
}
