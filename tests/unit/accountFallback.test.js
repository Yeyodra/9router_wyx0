import { describe, expect, it } from "vitest";
import { checkFallbackError, isNonAccountError } from "../../open-sse/services/accountFallback.js";

describe("account fallback classification", () => {
  it("treats Kiro content-length errors as non-account errors", () => {
    const errorText = '{"message":"Input is too long.","reason":"CONTENT_LENGTH_EXCEEDS_THRESHOLD"}';

    expect(isNonAccountError(400, errorText)).toBe(true);
  });

  it("does not classify rate limits as non-account errors", () => {
    expect(isNonAccountError(429, "rate limit exceeded")).toBe(false);

    const fallback = checkFallbackError(429, "rate limit exceeded");
    expect(fallback.shouldFallback).toBe(true);
    expect(fallback.cooldownMs).toBeGreaterThan(0);
  });

  it("treats HTTP 413 payload-too-large as a non-account error", () => {
    expect(isNonAccountError(413, "Payload Too Large")).toBe(true);
  });

  it("treats Kiro malformed payload errors as non-account errors", () => {
    expect(isNonAccountError(400, "Improperly formed request")).toBe(true);
  });
});
