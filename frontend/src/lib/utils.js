import { clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Teach tailwind-merge the Bracket type scale (Figma text styles) so
// `text-body-m` is treated as a font size, not a text colour — otherwise it
// would strip colour classes like `text-fg-inverse` sitting next to it.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["display-s", "title-l", "title-m", "title-s", "body-l", "body-m", "body-s", "caption", "mono-s", "eyebrow"] }],
    },
  },
});

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
