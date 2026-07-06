import { ImageResponse } from "next/og";
import { siteConfig } from "@/lib/site.config";

export const alt = siteConfig.seo.ogImageAlt;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          width: "100%",
          height: "100%",
          padding: "64px 72px",
          background: "linear-gradient(145deg, #ffffff 0%, #f4f4f5 55%, #e4e4e7 100%)",
          color: "#18181b"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              background: "#18181b",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#ffffff",
              fontSize: 28,
              fontWeight: 700
            }}
          >
            C
          </div>
          <span style={{ fontSize: 34, fontWeight: 700, letterSpacing: -1 }}>{siteConfig.name}</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 920 }}>
          <div style={{ fontSize: 58, fontWeight: 700, lineHeight: 1.08, letterSpacing: -2 }}>
            {siteConfig.tagline}
          </div>
          <div style={{ fontSize: 28, lineHeight: 1.35, color: "#52525b" }}>{siteConfig.subheadline}</div>
        </div>

        <div style={{ display: "flex", gap: 12 }}>
          {["VS Code", "Zero-clone", "Enterprise-ready"].map((label) => (
            <div
              key={label}
              style={{
                padding: "10px 18px",
                borderRadius: 999,
                border: "1px solid #d4d4d8",
                background: "#ffffff",
                fontSize: 20,
                color: "#3f3f46"
              }}
            >
              {label}
            </div>
          ))}
        </div>
      </div>
    ),
    size
  );
}
