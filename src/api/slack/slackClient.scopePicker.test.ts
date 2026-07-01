import test from "node:test";
import assert from "node:assert/strict";
import { SlackApiError, SlackClient, type SlackChannelInfo } from "./slackClient";

class ScopePickerTestClient extends SlackClient {
  public constructor(
    private readonly publicChannels: SlackChannelInfo[],
    private readonly privateChannels: SlackChannelInfo[] | "missing_scope"
  ) {
    super({ token: "xoxb-test" });
  }

  public override async listChannels(options?: {
    limit?: number;
    types?: "public_channel" | "private_channel" | "public_channel,private_channel";
  }): Promise<SlackChannelInfo[]> {
    if (options?.types === "private_channel") {
      if (this.privateChannels === "missing_scope") {
        throw new SlackApiError("missing_scope", "missing_scope");
      }
      return this.privateChannels;
    }
    return this.publicChannels;
  }
}

test("listChannelsForScopePicker merges public and private channels", async () => {
  const client = new ScopePickerTestClient(
    [{ id: "C1", name: "general", isPrivate: false }],
    [{ id: "C2", name: "eng-private", isPrivate: true }]
  );
  const channels = await client.listChannelsForScopePicker();
  assert.deepEqual(
    channels.map((channel) => channel.id),
    ["C2", "C1"]
  );
});

test("listChannelsForScopePicker falls back to public channels when private scope is missing", async () => {
  const client = new ScopePickerTestClient(
    [{ id: "C1", name: "general", isPrivate: false }],
    "missing_scope"
  );
  const channels = await client.listChannelsForScopePicker();
  assert.equal(channels.length, 1);
  assert.equal(channels[0]?.id, "C1");
});

test("listChannelsForScopePicker deduplicates overlapping channel ids", async () => {
  const shared = { id: "C1", name: "general", isPrivate: false };
  const client = new ScopePickerTestClient([shared], [shared]);
  const channels = await client.listChannelsForScopePicker();
  assert.equal(channels.length, 1);
});
