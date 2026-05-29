import type { CoopChatSession } from "./CoopChatSession";

class CoopSessionRegistryImpl {
  private readonly sessions = new Set<CoopChatSession>();
  private active?: CoopChatSession;

  public register(session: CoopChatSession): void {
    this.sessions.add(session);
    this.active = session;
  }

  public unregister(session: CoopChatSession): void {
    this.sessions.delete(session);
    if (this.active === session) {
      this.active = [...this.sessions].pop();
    }
  }

  public setActive(session: CoopChatSession): void {
    this.active = session;
  }

  public getActive(): CoopChatSession | undefined {
    return this.active;
  }

  public getAll(): CoopChatSession[] {
    return [...this.sessions];
  }
}

export const coopSessionRegistry = new CoopSessionRegistryImpl();
