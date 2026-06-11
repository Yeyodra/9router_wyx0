import { NextResponse } from "next/server";
import { getKiroBulkImportManager, parseKiroBulkAccounts } from "@/lib/oauth/services/kiroBulkImportManager";
import { validateAndSaveKiroImportedToken } from "@/lib/oauth/services/kiroConnections";

/**
 * POST /api/oauth/kiro/import
 * Import and validate Kiro credentials.
 * Supported today:
 * - single/bulk refresh token import
 *
 * Reserved for future work:
 * - bulk account credential import (email|password)
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const mode = body?.mode === "account" ? "account" : "token";

    if (mode === "account") {
      const accounts = Array.isArray(body?.accounts) ? body.accounts : [];
      const { parsed, invalidLines } = parseKiroBulkAccounts(accounts);
      if (!parsed.length) {
        return NextResponse.json(
          { error: "At least one account entry is required" },
          { status: 400 }
        );
      }

      if (invalidLines.length > 0) {
        return NextResponse.json(
          {
            error: "Invalid account format. Use one account per line: gmail@example.com|password",
            invalidLines,
          },
          { status: 400 }
        );
      }

      const manager = getKiroBulkImportManager();
      const job = manager.startJob({
        accounts,
        concurrency: body?.concurrency,
      });

      return NextResponse.json({
        success: true,
        job,
      });
    }

    const singleRefreshToken = typeof body?.refreshToken === "string"
      ? body.refreshToken.trim()
      : "";
    const bulkRefreshTokens = Array.isArray(body?.refreshTokens)
      ? body.refreshTokens.map((token) => String(token || "").trim()).filter(Boolean)
      : [];
    const refreshTokens = bulkRefreshTokens.length > 0
      ? bulkRefreshTokens
      : (singleRefreshToken ? [singleRefreshToken] : []);

    if (!refreshTokens.length) {
      return NextResponse.json(
        { error: "Refresh token is required" },
        { status: 400 }
      );
    }

    const importedConnections = [];
    const failed = [];

    for (let index = 0; index < refreshTokens.length; index += 1) {
      const refreshToken = refreshTokens[index];

      try {
        const { connection } = await validateAndSaveKiroImportedToken(refreshToken);
        importedConnections.push(connection);
      } catch (error) {
        failed.push({
          line: bulkRefreshTokens.length > 0 ? index + 1 : 1,
          error: error.message,
        });
      }
    }

    if (!importedConnections.length) {
      return NextResponse.json(
        { error: failed[0]?.error || "Import failed", failed },
        { status: 400 }
      );
    }

    if (bulkRefreshTokens.length > 0) {
      return NextResponse.json({
        success: true,
        imported: importedConnections.length,
        failed: failed.length,
        connections: importedConnections,
        failures: failed,
      });
    }

    return NextResponse.json({
      success: true,
      connection: importedConnections[0],
    });
  } catch (error) {
    console.log("Kiro import token error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
