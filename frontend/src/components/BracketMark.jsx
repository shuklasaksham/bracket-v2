import React from "react";

const BRACKET_LOGO =
  "https://customer-assets-lqy194kg.emergentagent.net/job_design-decided/artifacts/jl2k3bid_new-logo-1.png";

/**
 * BracketMark — official Bracket brand mark (the hexagon logo). Rendered as an
 * <img> so every placement across marketing + app uses the SAME current logo.
 * `label`/`variant` kept for API compatibility (unused).
 */
export default function BracketMark({
  size = 24,
  label = false,
  variant = "chalk",
  className = "",
}) {
  void label; void variant;
  return (
    <img
      src={BRACKET_LOGO}
      alt="Bracket"
      height={size}
      width={size}
      className={className}
      style={{ display: "block", flexShrink: 0, height: size, width: "auto" }}
    />
  );
}
