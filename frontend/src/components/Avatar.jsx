// Unified default avatar — light background, dark first letter for every user.
// AVATARS export kept for API compatibility with Onboarding/Settings imports.

export const AVATARS = [{ id: "mono-1", label: "Default" }];

export function getAvatar() {
  return AVATARS[0];
}

export default function Avatar({ size = 32, initial = "B", className = "" }) {
  const letter = (initial || "B").trim().charAt(0).toUpperCase() || "B";
  return (
    <span
      className={`inline-flex items-center justify-center select-none shrink-0 ${className}`}
      style={{
        width: size,
        height: size,
        background: "#F5F5F7",
        color: "#0A0A0C",
        borderRadius: "9999px",
        border: "1px solid rgba(255, 255, 255, 0.08)",
        fontFamily: "'Geist', sans-serif",
        fontSize: Math.round(size * 0.44),
        fontWeight: 600,
        letterSpacing: "-0.01em",
        lineHeight: 1,
      }}
      aria-label={`Avatar ${letter}`}
      data-testid="avatar-default"
    >
      {letter}
    </span>
  );
}
