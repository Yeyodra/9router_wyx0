"use client";

import { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";

const DISCORD_URL = "https://dsc.gg/wyxhub";
const STORAGE_KEY = "discord-popup-dismissed";

export default function DiscordPopup() {
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const dismissed = window.localStorage.getItem(STORAGE_KEY);
    if (dismissed === "forever") return;
    const timer = setTimeout(() => setVisible(true), 800);
    return () => clearTimeout(timer);
  }, []);

  const dismiss = useCallback((permanent) => {
    if (permanent) window.localStorage.setItem(STORAGE_KEY, "forever");
    setVisible(false);
  }, []);

  if (!mounted || !visible) return null;

  return createPortal(
    <div id="discord-popup-root">
      {/* backdrop */}
      <div
        onClick={() => dismiss(false)}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 99998,
          background: "rgba(0,0,0,0.45)",
          backdropFilter: "blur(4px)",
        }}
      />
      {/* card */}
      <div
        style={{
          position: "fixed",
          zIndex: 99999,
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(384px, calc(100vw - 32px))",
        }}
        className="overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, padding: "32px 24px 24px" }}>
          {/* icon */}
          <div style={{ width: 64, height: 64, borderRadius: 16, background: "rgba(88,101,242,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <img src="/icons/discord.svg" alt="Discord" width={36} height={36} style={{ opacity: 0.9 }} />
          </div>

          {/* text */}
          <div style={{ textAlign: "center" }}>
            <h3 className="text-lg font-bold text-text-main">Join our Discord!</h3>
            <p className="mt-2 text-sm leading-relaxed text-text-muted">
              Get help, share configs, request features, and hang out with the WYx0 community.
            </p>
          </div>

          {/* buttons */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
            <a
              href={DISCORD_URL}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                width: "100%",
                padding: "10px 16px",
                borderRadius: 12,
                background: "#5865F2",
                color: "#fff",
                fontSize: 14,
                fontWeight: 600,
                textDecoration: "none",
                cursor: "pointer",
              }}
            >
              <img src="/icons/discord.svg" alt="" width={18} height={18} style={{ filter: "brightness(0) invert(1)" }} />
              Join Discord
            </a>
            <button
              type="button"
              onClick={() => dismiss(false)}
              className="w-full rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-text-main transition-colors hover:bg-sidebar"
            >
              Close
            </button>
          </div>

          {/* dont remind */}
          <button
            type="button"
            onClick={() => dismiss(true)}
            className="text-xs text-text-muted transition-colors hover:text-text-main"
          >
            Don&apos;t remind me
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
