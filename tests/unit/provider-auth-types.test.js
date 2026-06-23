import { describe, expect, it } from "vitest";
import { getProviderAuthTypes } from "../../src/shared/utils/providerAuthTypes.js";

describe("provider auth type expansion", () => {
  it("keeps single-auth providers scoped to the fallback type", () => {
    expect(getProviderAuthTypes({}, "oauth")).toEqual(["oauth"]);
  });

  it("expands dual-auth providers to both API key spellings", () => {
    expect(getProviderAuthTypes({ authModes: ["oauth", "apikey"] }, "oauth")).toEqual([
      "oauth",
      "apikey",
      "api_key",
    ]);
  });
});
