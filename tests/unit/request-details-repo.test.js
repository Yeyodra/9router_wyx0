import assert from "node:assert/strict";
import test from "node:test";

import { compactRequestDetail } from "../../src/lib/db/repos/requestDetailsRepo.js";

test("compacts large Kiro payloads before they enter the write buffer", () => {
  const largeContent = "x".repeat(1024 * 1024);
  const compact = compactRequestDetail({
    provider: "kiro",
    model: "claude-sonnet",
    request: {
      headers: {
        authorization: "Bearer secret",
        "content-type": "application/json",
      },
      messages: [{ role: "user", content: largeContent }],
    },
    providerRequest: { conversation: largeContent },
  }, 1024 * 1024);

  assert.equal(compact.request._truncated, true);
  assert.equal(compact.providerRequest._truncated, true);
  assert.ok(JSON.stringify(compact).length < 2048);
  assert.ok(!JSON.stringify(compact).includes("Bearer secret"));
});

test("handles circular observability values without retaining the original object", () => {
  const request = { message: "hello" };
  request.self = request;

  const compact = compactRequestDetail({
    provider: "kiro",
    request,
  });

  assert.equal(compact.request.self.self, "[Circular]");
  request.message = "changed";
  assert.equal(compact.request.message, "hello");
  assert.equal(compact.request.self.message, "hello");
});
