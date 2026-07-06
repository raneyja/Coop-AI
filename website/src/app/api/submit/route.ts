import { NextRequest, NextResponse } from "next/server";
import { postToGoogleAppsScript } from "@/lib/googleAppsScriptWebhook";

type FormPayload = {
  type: "demo";
  email: string;
  name?: string;
  company?: string;
  role?: string;
  message?: string;
};

export async function POST(request: NextRequest) {
  const webhookUrl = process.env.GOOGLE_SHEETS_WEBHOOK_URL?.trim();

  let body: FormPayload;
  try {
    body = (await request.json()) as FormPayload;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
  }

  if (body.type !== "demo") {
    return NextResponse.json({ error: "Invalid form type." }, { status: 400 });
  }

  const row = {
    timestamp: new Date().toISOString(),
    type: body.type,
    email,
    name: body.name?.trim() ?? "",
    company: body.company?.trim() ?? "",
    role: body.role?.trim() ?? "",
    message: body.message?.trim() ?? "",
    source: "coop-ai.dev"
  };

  if (!webhookUrl) {
    console.warn("[form] GOOGLE_SHEETS_WEBHOOK_URL not set — submission NOT saved:", row);
    return NextResponse.json(
      {
        error:
          "Form storage is not configured on the server. Set GOOGLE_SHEETS_WEBHOOK_URL in Vercel and redeploy."
      },
      { status: 503 }
    );
  }

  try {
    const result = await postToGoogleAppsScript(webhookUrl, row);

    if (!result.ok) {
      console.error("[form] Google Sheets webhook failed:", {
        status: result.status,
        body: result.text.slice(0, 500),
        parsed: result.parsed,
        row
      });
      const hint =
        result.status === 401 || result.text.includes("Sign in")
          ? "Web app must allow access: Anyone (not only Google accounts)."
          : undefined;
      return NextResponse.json(
        {
          error: hint
            ? `Unable to save submission. ${hint}`
            : "Unable to save submission. Check Vercel logs and Apps Script deployment."
        },
        { status: 502 }
      );
    }

    console.info("[form] Saved to sheet:", row.email, row.type, "lastRow:", result.parsed?.lastRow);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[form] Google Sheets webhook error:", error);
    return NextResponse.json({ error: "Unable to save submission. Please try again." }, { status: 502 });
  }
}
