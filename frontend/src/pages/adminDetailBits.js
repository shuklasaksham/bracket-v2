import React, { useMemo } from "react";

// ---- helpers --------------------------------------------------------------
export const isEmpty = (v) =>
  v === null ||
  v === undefined ||
  (typeof v === "string" && !v.trim()) ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0);

const humanKey = (k) =>
  (k || "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

// Flatten any JSON-like value into a list of render rows (no recursive JSX
// component — some in-tree Babel plugins cannot walk self-referencing
// components without stack overflow).
function flatten(value, opts) {
  const limit = (opts && opts.limit) || 500;
  const rows = [];
  const stack = [{ value, depth: 0, label: null }];
  while (stack.length) {
    const { value: v, depth, label } = stack.shift();
    if (isEmpty(v)) continue;
    if (label) rows.push({ kind: "label", text: label, depth });
    if (typeof v === "string") {
      rows.push({ kind: "value", text: v, depth });
    } else if (typeof v === "number" || typeof v === "boolean") {
      rows.push({ kind: "value", text: String(v), depth });
    } else if (Array.isArray(v)) {
      const allPrim = v.every(
        (x) => typeof x === "string" || typeof x === "number" || typeof x === "boolean",
      );
      if (allPrim) {
        v.forEach((x) => rows.push({ kind: "bullet", text: String(x), depth: depth + 1 }));
      } else {
        const kids = v.map((x, i) => ({ value: x, depth: depth + 1, label: "#" + (i + 1) }));
        stack.unshift.apply(stack, kids);
      }
    } else if (typeof v === "object") {
      const kids = [];
      Object.entries(v).forEach((kv) => {
        if (!isEmpty(kv[1])) {
          kids.push({ value: kv[1], depth: depth + 1, label: humanKey(kv[0]) });
        }
      });
      stack.unshift.apply(stack, kids);
    } else {
      rows.push({ kind: "value", text: String(v), depth });
    }
  }
  if (rows.length > limit) {
    return rows.slice(0, limit).concat([
      { kind: "sep", text: "+" + (rows.length - limit) + " more…", depth: 0 },
    ]);
  }
  return rows;
}

function renderRow(r, i) {
  const pad = { paddingLeft: (Math.min(r.depth, 6) * 12) + "px" };
  if (r.kind === "label") {
    return React.createElement(
      "div",
      { key: i, className: "text-[10.5px] uppercase tracking-wider pt-1.5 first:pt-0", style: { ...pad, color: "var(--text-3)" } },
      r.text,
    );
  }
  if (r.kind === "bullet") {
    return React.createElement(
      "div",
      { key: i, className: "flex gap-2 text-[12.5px]", style: pad },
      React.createElement("span", { className: "shrink-0", style: { color: "var(--text-4, #52525B)" } }, "·"),
      React.createElement(
        "span",
        { className: "whitespace-pre-wrap break-words" },
        r.text,
      ),
    );
  }
  if (r.kind === "sep") {
    return React.createElement(
      "div",
      { key: i, className: "text-[11px] italic", style: { ...pad, color: "var(--text-3)" } },
      r.text,
    );
  }
  return React.createElement(
    "div",
    { key: i, className: "whitespace-pre-wrap break-words text-[12.5px]", style: pad },
    r.text,
  );
}

export function FlatValue(props) {
  const rows = useMemo(function () {
    return flatten(props.value, { limit: 500 });
  }, [props.value]);
  if (rows.length === 0) return null;
  return React.createElement(
    "div",
    { className: "space-y-1 leading-relaxed", style: { color: "var(--text)" } },
    rows.map(renderRow),
  );
}

export function LabeledBlock(props) {
  if (isEmpty(props.value)) return null;
  return React.createElement(
    "div",
    null,
    React.createElement(
      "div",
      { className: "text-[10px] uppercase tracking-wider mb-1", style: { color: "var(--accent)" } },
      props.label,
    ),
    React.createElement(FlatValue, { value: props.value }),
  );
}
