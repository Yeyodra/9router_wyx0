import { describe, expect, it } from "vitest";
import { readJsonResponse } from "../../src/shared/utils/httpResponse.js";

describe("readJsonResponse", () => {
  it("turns a non-json HTML response into an actionable error payload", async () => {
    const response = new Response("<!DOCTYPE html><html><body>Not Found</body></html>", {
      status: 404,
      statusText: "Not Found",
      headers: { "content-type": "text/html" },
    });

    const data = await readJsonResponse(response, "Failed to open manual browser session");

    expect(data.error).toContain("Failed to open manual browser session");
    expect(data.error).toContain("404");
    expect(data.error).toContain("Not Found");
  });
});
