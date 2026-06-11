import { describe, expect, it } from "vitest";
import {
  classifyConnectionStatus,
  isTerminalConnectionStatus,
} from "../../src/shared/utils/connectionStatus.js";

describe("connection status classifier", () => {
  it("keeps healthy and disabled connections distinct", () => {
    expect(classifyConnectionStatus({ testStatus: "active" }).key).toBe("active");
    expect(classifyConnectionStatus({ isActive: false, testStatus: "active" }).key).toBe("disabled");
  });

  it("marks auth, exhausted, and banned states as terminal", () => {
    const terminalCases = [
      { lastErrorType: "upstream_auth_error", lastError: "Token invalid or revoked" },
      { errorCode: 402, lastError: "Payment required" },
      { lastError: "Account suspended or banned" },
    ];

    for (const connection of terminalCases) {
      expect(isTerminalConnectionStatus(connection)).toBe(true);
    }
  });

  it("does not mark transient rate limits or network errors as terminal", () => {
    expect(classifyConnectionStatus({ errorCode: 429, lastError: "Rate limit exceeded" }).key).toBe("rate_limited");
    expect(isTerminalConnectionStatus({ errorCode: 429, lastError: "Rate limit exceeded" })).toBe(false);

    expect(classifyConnectionStatus({ lastErrorType: "network_error", lastError: "fetch failed" }).key).toBe("connection_error");
    expect(isTerminalConnectionStatus({ lastErrorType: "network_error", lastError: "fetch failed" })).toBe(false);
  });
});
