export type WebviewStartupStage = "html-assigned" | "document-loaded" | "frontend-mounted" | "webview-ready" | "session-restored" | "frontend-failed" | "session-failed";
export type WebviewStartupEvent = { generation: string; stage: WebviewStartupStage };

/** A visible view must acknowledge startup; assigned HTML alone proves no delivery. */
export class WebviewStartup {
  private generation?: string;
  private stage: WebviewStartupStage = "html-assigned";
  private visible = false;
  private reported = false;
  private timer?: ReturnType<typeof setTimeout>;

  public constructor(
    private readonly report: (event: WebviewStartupEvent) => void,
    private readonly timeoutMs = 15_000
  ) {}

  public update(event: WebviewStartupEvent): void {
    if (event.stage === "html-assigned") {
      this.generation = event.generation;
      this.reported = false;
    } else if (event.generation !== this.generation) {
      return;
    }
    const stages: WebviewStartupStage[] = ["html-assigned", "document-loaded", "frontend-mounted", "webview-ready", "session-restored"];
    if (event.stage !== "html-assigned" && stages.includes(event.stage) && stages.indexOf(event.stage) < stages.indexOf(this.stage)) {
      return;
    }
    this.stage = event.stage;
    this.cancelTimer();
    if (event.stage === "frontend-failed" || event.stage === "session-failed") {
      this.fail();
    } else if (event.stage !== "session-restored") {
      this.arm();
    }
  }

  public setVisible(visible: boolean): void {
    if (this.visible === visible) { return; }
    this.visible = visible;
    this.cancelTimer();
    if (visible && this.generation) {
      // retainContextWhenHidden:false recreates the document on show, with the
      // same assigned HTML. Await its new handshake without assigning HTML again.
      this.stage = "html-assigned";
      this.reported = false;
      this.arm();
    }
  }

  public dispose(): void {
    this.cancelTimer();
    this.generation = undefined;
    this.visible = false;
  }

  public owns(generation: string): boolean {
    return this.generation === generation;
  }

  private arm(): void {
    if (!this.visible || !this.generation || this.reported) { return; }
    const generation = this.generation;
    this.timer = setTimeout(() => {
      if (this.generation === generation) { this.fail(); }
    }, this.timeoutMs);
  }

  private fail(): void {
    if (!this.visible || !this.generation || this.reported) { return; }
    this.reported = true;
    this.report({ generation: this.generation, stage: this.stage });
  }

  private cancelTimer(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
  }
}
