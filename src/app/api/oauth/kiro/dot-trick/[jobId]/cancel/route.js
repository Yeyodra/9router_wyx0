import { NextResponse } from "next/server";
import { getKiroDotTrickManager } from "../../../../../../../lib/oauth/services/kiroDotTrickManager.js";
import path from "node:path";
import fs from "node:fs";
import { DATA_DIR } from "../../../../../../../lib/dataDir.js";

export const dynamic = "force-dynamic";

const DOT_TRICK_DIR = path.join(DATA_DIR, "kiro-dot-trick");

export async function POST(_request, { params }) {
  const { jobId } = await params;
  const manager = getKiroDotTrickManager();

  // 1. Try in-memory cancel (sets cancelRequested=true, closes browsers)
  const job = manager.cancelJob(jobId);

  // 2. Force-write cancelled status to JSON file regardless of memory state.
  //    This fixes two cases:
  //    a) Running jobs: cancelJob() only sets cancelRequested, worker loop
  //       may not get a chance to write "cancelled" before the next /latest poll.
  //    b) File-only jobs (after hot reload): job not in memory, file still says
  //       "running" — nothing would ever update it without this write.
  const jobFile = path.join(DOT_TRICK_DIR, `${jobId}.json`);
  if (fs.existsSync(jobFile)) {
    try {
      const raw = JSON.parse(fs.readFileSync(jobFile, "utf8"));
      if (raw.status === "running" || raw.status === "queued") {
        raw.status = "cancelled";
        raw.cancelRequested = true;
        raw.finishedAt = raw.finishedAt || new Date().toISOString();
        // Mark any still-pending accounts as cancelled too
        if (Array.isArray(raw.accounts)) {
          raw.accounts.forEach((acc) => {
            if (acc.status === "queued" || acc.status === "running") {
              acc.status = "cancelled";
            }
          });
        }
        // Atomic write — same pattern used by kiroBulkImportManager.js
        const tmp = `${jobFile}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(raw));
        fs.renameSync(tmp, jobFile);
      }
      return NextResponse.json({ success: true, job: raw });
    } catch {
      // File write failed — fall through; if in-memory cancel worked, still return success
    }
  }

  if (!job) {
    return NextResponse.json({ error: "Dot-trick job not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true, job });
}
