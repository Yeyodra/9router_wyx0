import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/localDb";

export const dynamic = "force-dynamic";

const IMAP_KEYS = [
  "qwen_register_imap_user",
  "qwen_register_imap_pass",
  "qwen_register_imap_host",
  "qwen_register_imap_port",
  "qwen_register_email_domain",
];

const DEFAULTS = {
  qwen_register_imap_host: "imap.gmail.com",
  qwen_register_imap_port: "993",
  qwen_register_email_domain: "nzr.web.id",
};

export async function GET() {
  try {
    const settings = await getSettings();
    const config = {};
    for (const key of IMAP_KEYS) {
      config[key] =
        settings[key] ||
        process.env[`QWEN_REGISTER_${key.replace("qwen_register_", "").toUpperCase()}`] ||
        DEFAULTS[key] ||
        "";
    }
    return NextResponse.json({ success: true, config });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const updates = {};
    for (const key of IMAP_KEYS) {
      if (body[key] !== undefined) {
        updates[key] = String(body[key] || "");
      }
    }
    await updateSettings(updates);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
