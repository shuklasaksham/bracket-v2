import React from "react";
import { Link } from "react-router-dom";
import { cn } from "../../lib/utils";

/* Brand mark (raster from the brand PNG — swap for SVG when available).
   White mark for dark surfaces, dark mark for light (emails/print). */
export function Mark({ size = 20, tone = "light", className }) {
  return (
    <img
      src={tone === "dark" ? "/brand/mark-dark.png" : "/brand/mark-white.png"}
      alt=""
      aria-hidden="true"
      width={Math.round(size * 0.93)}
      height={size}
      className={cn("shrink-0 select-none", className)}
      draggable={false}
    />
  );
}

export function Logo({ to = "/", size = 22, wordmark = true, className }) {
  return (
    <Link to={to} className={cn("inline-flex items-center gap-2 text-fg", className)} aria-label="Bracket home">
      <Mark size={size} />
      {wordmark && <span className="text-[17px] font-semibold tracking-[-0.3px] leading-5">bracket</span>}
    </Link>
  );
}
