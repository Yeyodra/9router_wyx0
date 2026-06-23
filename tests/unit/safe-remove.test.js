import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { cleanPathForRebuild } = require("../../cli/scripts/safeRemove.js");

let tempDir;
let originalRmSync;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "safe-remove-"));
  originalRmSync = fs.rmSync;
});

afterEach(() => {
  fs.rmSync = originalRmSync;
  vi.restoreAllMocks();
  if (tempDir && fs.existsSync(tempDir)) {
    originalRmSync(tempDir, { recursive: true, force: true });
  }
});

describe("cleanPathForRebuild", () => {
  it("moves a locked rebuild directory aside when Windows denies removal", () => {
    const target = path.join(tempDir, "app");
    const staleDir = path.join(tempDir, ".app-trash");
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, "server.js"), "console.log('old');\n");

    fs.rmSync = vi.fn((nextPath, options) => {
      if (path.resolve(nextPath) === path.resolve(target)) {
        const error = new Error("Permission denied");
        error.code = "EPERM";
        throw error;
      }
      return originalRmSync(nextPath, options);
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = cleanPathForRebuild(target, {
      staleDir,
      label: "old CLI app",
      processHint: "Close old process.",
    });

    expect(result.action).toBe("moved");
    expect(fs.existsSync(target)).toBe(false);
    expect(result.movedPath.startsWith(staleDir)).toBe(true);
  });
});
