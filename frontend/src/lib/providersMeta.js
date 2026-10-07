import React from "react";
import {
  Mail,
  Slack,
  MessageCircle,
  Users,
  Figma,
  Palette,
  HardDrive,
  NotebookText,
  Package,
  Github,
  Layers,
  Sparkles,
  FileText,
} from "lucide-react";
import { BRAND_PATHS } from "./brandIcons";

// Real brand marks are bundled locally (simple-icons paths, see brandIcons.js)
// — no external CDN calls. `brandColor` is the mark's fill on Bracket's dark
// surface; a few brands are lightened so they stay visible.
export const PROVIDER_META = {
  gmail:    { label: "Gmail",           icon: Mail,          color: "#EA4335", slug: "gmail" },
  slack:    { label: "Slack",           icon: Slack,         color: "#E01E5A", slug: "slack" },
  whatsapp: { label: "WhatsApp",        icon: MessageCircle, color: "#25D366", slug: "whatsapp" },
  teams:    { label: "Microsoft Teams", icon: Users,         color: "#6264A7", slug: null },
  figma:    { label: "Figma",           icon: Figma,         color: "#A259FF", slug: "figma" },
  adobe:    { label: "Adobe",           icon: Palette,       color: "#FF3B30", slug: "adobe" },
  gdrive:   { label: "Google Drive",    icon: HardDrive,     color: "#4285F4", slug: "googledrive" },
  notion:   { label: "Notion",          icon: NotebookText,  color: "#E8E7E4", slug: "notion", brandColor: "#FFFFFF" },
  dropbox:  { label: "Dropbox",         icon: Package,       color: "#0061FF", slug: "dropbox" },
  github:   { label: "GitHub",          icon: Github,        color: "#E6EDF3", slug: "github", brandColor: "#E6EDF3" },
  linear:   { label: "Linear",          icon: Layers,        color: "#3B82F6", slug: "linear", brandColor: "#3B82F6" },
  bracket:  { label: "Bracket",          icon: Sparkles,      color: "#E4E4E7", slug: null },
  meeting:  { label: "Meeting notes",     icon: FileText,      color: "#E4E4E7", slug: null },
  manual:   { label: "Added by you",     icon: Sparkles,      color: "#E4E4E7", slug: null },
};

export function ProviderIcon({ provider, size = 16, bare = false }) {
  const meta = PROVIDER_META[provider] || {};
  const Icon = meta.icon || Layers;
  const path = meta.slug ? BRAND_PATHS[meta.slug] : null;
  const fill = meta.brandColor || meta.color || "var(--text-2)";
  const glyph = path ? (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: "block" }} fill={fill}>
      <path d={path} />
    </svg>
  ) : (
    <Icon size={size} strokeWidth={1.75} style={{ color: meta.color || "var(--text-2)" }} />
  );
  if (bare) return glyph;
  return (
    <span
      className="inline-flex items-center justify-center shrink-0"
      style={{
        width: size + 14, height: size + 14, borderRadius: "6px",
        background: "rgba(255,255,255,0.04)",
        border: "1px solid var(--hairline)",
        color: meta.color || "var(--text-2)",
      }}
      aria-hidden="true"
    >
      {glyph}
    </span>
  );
}

export function timeAgo(iso) {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
