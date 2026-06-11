import { describe, expect, it } from "vitest";
import {
  buildCodexGatewayModelEntries,
  parseCodexGatewayModel,
  slugifyCodexAccount,
} from "@/sse/services/codexGateway.js";

describe("Codex gateway aliases", () => {
  it("maps auto-codex to the default Codex pool model", () => {
    expect(parseCodexGatewayModel("auto-codex")).toMatchObject({
      mode: "router",
      modelString: "cx/gpt-5.5",
      strictAccount: false,
    });
  });

  it("maps router/* to Codex by default and preserves explicit provider prefixes", () => {
    expect(parseCodexGatewayModel("router/gpt-5.4")).toMatchObject({
      mode: "router",
      modelString: "cx/gpt-5.4",
    });
    expect(parseCodexGatewayModel("router/kr/sonnet-4")).toMatchObject({
      mode: "router",
      modelString: "kr/sonnet-4",
    });
  });

  it("maps original and account aliases to strict Codex account routes", () => {
    expect(parseCodexGatewayModel("original/gpt-5.5")).toMatchObject({
      mode: "original",
      modelString: "cx/gpt-5.5",
      strictAccount: true,
    });
    expect(parseCodexGatewayModel("account/wisam-12345678/gpt-5.4-mini")).toMatchObject({
      mode: "account",
      accountRef: "wisam-12345678",
      modelString: "cx/gpt-5.4-mini",
      strictAccount: true,
    });
  });

  it("builds stable account slugs and model entries without exposing tokens", () => {
    const conn = {
      id: "12345678-aaaa-bbbb-cccc-123456789abc",
      provider: "codex",
      isActive: true,
      name: "Wisam Team",
      accessToken: "secret",
    };

    expect(slugifyCodexAccount(conn)).toBe("wisam-team-12345678");

    const entries = buildCodexGatewayModelEntries([conn]);
    expect(entries.some((entry) => entry.id === "auto-codex")).toBe(true);
    expect(entries.some((entry) => entry.id === "router/gpt-5.5")).toBe(true);
    expect(entries.some((entry) => entry.id === "original/gpt-5.5")).toBe(true);
    expect(entries.some((entry) => entry.id === "account/wisam-team-12345678")).toBe(true);
    expect(JSON.stringify(entries)).not.toContain("secret");
  });
});
