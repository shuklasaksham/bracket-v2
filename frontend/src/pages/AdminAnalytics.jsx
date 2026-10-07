import React, { useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCcw, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  ScatterChart,
  Scatter,
  ZAxis,
} from "recharts";
import { api, formatApiError } from "../lib/api";

// ---- palette (dark aesthetic, matches reference image) --------------------
// Palette aligned with site tokens (see index.css)
const COLORS = {
  accent: "#8184C4",       // --accent (blue)
  accent2: "#8184C4",      // scatter cluster 2 (lighter blue tint)
  accent3: "#F97316",      // scatter cluster 3 (orange)
  positive: "#22C55E",
  danger: "#EF4444",
  grid: "rgba(255, 255, 255, 0.06)",   // matches --hairline
  gridStrong: "rgba(255, 255, 255, 0.10)",
  axis: "rgba(255, 255, 255, 0.20)",
  axisLabel: "#A0A0AB",   // --text-2
  cardBg: "#0E0F12",      // --surface
  cardBorder: "rgba(255, 255, 255, 0.07)", // --hairline
};
const PIE_COLORS = ["#8184C4", "#8184C4", "#22C55E", "#F97316", "#EF4444", "#06B6D4"];

// ---- helpers --------------------------------------------------------------
const shortDate = (iso) => {
  if (!iso) return "";
  const [, m, d] = iso.split("-");
  return `${m}/${d}`;
};

const CustomTooltip = ({ active, payload, label, unit = "" }) => {
  if (!active || !payload || !payload.length) return null;
  return (
    <div
      className="rounded-md border px-3 py-2 shadow-lg"
      style={{
        background: "#0A0B0F",
        borderColor: COLORS.cardBorder,
        color: "#F7F7F8",
        fontFamily: "'Geist', sans-serif",
        fontSize: 12,
      }}
    >
      {label && <div style={{ opacity: 0.55, marginBottom: 4 }}>{label}</div>}
      {payload.map((p) => (
        <div key={p.dataKey} style={{ color: p.color }}>
          {p.name || p.dataKey}: {typeof p.value === "number" ? p.value.toLocaleString() : p.value}
          {unit}
        </div>
      ))}
    </div>
  );
};

// ---- KPI card — tinted background palette to match the landing page ----
const KPI_TONES = {
  lime:    { bg: "#D6FF48",  text: "#0A0A0C", subText: "#2A2A2E" },
  coral:   { bg: "#FF7A6B",  text: "#0A0A0C", subText: "#2A0F0A" },
  violet:  { bg: "#5B3EF7",  text: "#F5F5F7", subText: "rgba(245,245,247,0.68)" },
  pink:    { bg: "#FFB0D5",  text: "#0A0A0C", subText: "#2A0F1E" },
  sky:     { bg: "#4FB1FF",  text: "#04121F", subText: "#0F2740" },
  emerald: { bg: "#5BE3A2",  text: "#04140B", subText: "#0F2820" },
  lavender:{ bg: "linear-gradient(160deg, #C7CBFB 0%, #E7DFF9 55%, #F1D9EE 100%)", text: "#0A0A0C", subText: "#3B3B44" },
  peach:   { bg: "linear-gradient(160deg, #FFD5B8 0%, #FFC1B0 55%, #FFB6A8 100%)", text: "#1A0F0A", subText: "#3B2820" },
  ghost:   { bg: "var(--surface)", text: "var(--text)", subText: "var(--text-3)" }, // dashed placeholder tone
};

function Kpi({ label, value, unit = "", tone = "ghost", testid }) {
  const t = KPI_TONES[tone] || KPI_TONES.ghost;
  const isDashed = tone === "ghost";
  return (
    <div
      className="rounded-2xl px-4 py-4 sm:px-5 sm:py-5 overflow-hidden"
      style={{
        background: t.bg,
        color: t.text,
        border: isDashed ? "1px dashed var(--hairline)" : "none",
      }}
      data-testid={testid}
    >
      <div className="text-[11px] uppercase tracking-wider" style={{ color: t.subText }}>
        {label}
      </div>
      <div
        className="mt-2 font-display"
        style={{
          fontSize: 28,
          lineHeight: 1,
          color: t.text,
          letterSpacing: "-0.02em",
          fontWeight: 500,
        }}
      >
        {typeof value === "number" ? value.toLocaleString() : value}
        {unit && (
          <span style={{ fontSize: 13, color: t.subText, marginLeft: 6 }}>{unit}</span>
        )}
      </div>
    </div>
  );
}

function SectionHead({ label, title, subtitle }) {
  return (
    <div className="pt-6">
      <span className="section-label"><span className="dot" />{label}</span>
      <h3 className="mt-3 font-display text-[22px] leading-none" style={{ letterSpacing: "-0.02em", color: "var(--text)" }}>
        {title}
      </h3>
      {subtitle && (
        <p className="mt-2 text-[13px]" style={{ color: "var(--text-2)" }}>{subtitle}</p>
      )}
    </div>
  );
}

// ---- Card wrapper ---------------------------------------------------------
function Card({ title, subtitle, children, height = 260, className = "", testid }) {
  return (
    <div
      className={`card-brut p-4 sm:p-5 ${className}`}
      data-testid={testid}
    >
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h3 className="text-[13px] font-medium" style={{ color: "var(--text)" }}>{title}</h3>
          {subtitle && (
            <p className="text-[11px] uppercase tracking-wider mt-0.5" style={{ color: "var(--text-3)" }}>{subtitle}</p>
          )}
        </div>
      </div>
      <div className="mt-3" style={{ height }}>
        {children}
      </div>
    </div>
  );
}

// ---- Activity heatmap (custom SVG grid) -----------------------------------
function Heatmap({ data }) {
  const maxVal = useMemo(() => {
    let m = 1;
    for (const row of data) for (const h of row.hours) if (h.value > m) m = h.value;
    return m;
  }, [data]);
  const cell = 16;
  const gap = 2;
  const labelCol = 40;
  const width = labelCol + (cell + gap) * 24;
  const height = (cell + gap) * data.length + 24;

  const color = (v) => {
    if (!v) return "rgba(255,255,255,0.04)";
    const t = Math.min(1, v / maxVal);
    // signal blue with alpha ramp
    const alpha = 0.18 + t * 0.82;
    return `rgba(129, 132, 196, ${alpha.toFixed(3)})`;
  };

  return (
    <div style={{ overflowX: "auto" }}>
      <svg width={width} height={height} role="img" aria-label="Activity heatmap">
        {/* hour headers */}
        {Array.from({ length: 24 }, (_, h) => (
          <text
            key={`h-${h}`}
            x={labelCol + h * (cell + gap) + cell / 2}
            y={12}
            fill={COLORS.axisLabel}
            fontSize={9}
            fontFamily="'Geist', sans-serif"
            textAnchor="middle"
            opacity={h % 3 === 0 ? 1 : 0}
          >
            {h.toString().padStart(2, "0")}
          </text>
        ))}
        {/* rows */}
        {data.map((row, ri) => (
          <g key={row.day} transform={`translate(0, ${20 + ri * (cell + gap)})`}>
            <text
              x={0}
              y={cell - 3}
              fill={COLORS.axisLabel}
              fontSize={10}
              fontFamily="'Geist', sans-serif"
            >
              {row.day}
            </text>
            {row.hours.map((h) => (
              <rect
                key={h.hour}
                x={labelCol + h.hour * (cell + gap)}
                y={0}
                width={cell}
                height={cell}
                rx={2}
                fill={color(h.value)}
              >
                <title>{`${row.day} ${h.hour.toString().padStart(2, "0")}:00 — ${h.value} project${h.value === 1 ? "" : "s"}`}</title>
              </rect>
            ))}
          </g>
        ))}
      </svg>
    </div>
  );
}

// ---- Scatter data prep: jitter x per user bucket -------------------------
function bucketAndJitter(points, maxBuckets = 6) {
  if (!points || points.length === 0) return { series: [], xTicks: [] };
  // Group by user, take top N users by point count, cluster the rest into "Others"
  const byUser = new Map();
  for (const p of points) {
    const k = p.user || "unknown";
    if (!byUser.has(k)) byUser.set(k, []);
    byUser.get(k).push(p);
  }
  const sorted = Array.from(byUser.entries()).sort((a, b) => b[1].length - a[1].length);
  const top = sorted.slice(0, maxBuckets - 1);
  const rest = sorted.slice(maxBuckets - 1);
  const buckets = top.map(([user, pts]) => ({ user, pts }));
  if (rest.length) {
    buckets.push({
      user: "Others",
      pts: rest.flatMap(([, pts]) => pts),
    });
  }
  const series = buckets.map((b, i) => {
    const xCenter = i + 0.5;
    const data = b.pts.map((p) => ({
      x: xCenter + (Math.random() - 0.5) * 0.5,
      y: p.days,
      name: p.name,
      user: b.user,
    }));
    return { user: b.user, data, color: PIE_COLORS[i % PIE_COLORS.length] };
  });
  const xTicks = buckets.map((_, i) => i + 0.5);
  const xLabels = buckets.map((b) => b.user);
  return { series, xTicks, xLabels };
}

// Scatter tooltip lifted out to avoid unstable-nested-components warning.
function ScatterTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div
      className="rounded-md border px-3 py-2"
      style={{
        background: "#0A0B0F",
        borderColor: COLORS.cardBorder,
        color: "var(--text)",
        fontFamily: "'Geist', sans-serif",
        fontSize: 12,
      }}
    >
      <div style={{ opacity: 0.6 }}>{p.user}</div>
      {p.name && <div>{p.name}</div>}
      <div style={{ color: COLORS.accent }}>{p.y.toFixed(2)} days</div>
    </div>
  );
}

// ============================================================================
// PUBLISH LOG — track every release + compare before/after metrics.
// ============================================================================
function DeltaValue({ before, after, pct, kind }) {
  const fmt = (v) => {
    if (v == null) return "—";
    if (typeof v !== "number") return String(v);
    // Per-day values are often small (e.g. 0.5 signups/day) — give them extra
    // precision. Big whole-number metrics don't need decimals.
    const digits = kind === "per_day"
      ? (Math.abs(v) >= 10 ? 1 : 2)
      : (Math.abs(v) >= 100 ? 0 : 1);
    return v.toLocaleString(undefined, { maximumFractionDigits: digits });
  };
  let arrow = "→";
  let color = "var(--text-3)";
  if (typeof pct === "number") {
    // For "lower_better" (time-to-first-doc), a negative pct is GOOD.
    const good = kind === "lower_better" ? pct < 0 : pct > 0;
    const bad  = kind === "lower_better" ? pct > 0 : pct < 0;
    if (pct === 0) { arrow = "→"; color = "var(--text-3)"; }
    else if (good) { arrow = "↑"; color = "#22C55E"; }
    else if (bad)  { arrow = "↓"; color = "#EF4444"; }
  }
  return (
    <span className="inline-flex items-baseline gap-2">
      <span className="tabular-nums" style={{ color: "var(--text-3)" }}>{fmt(before)}</span>
      <span style={{ color: "var(--text-3)" }}>→</span>
      <span className="tabular-nums" style={{ color: "var(--text)" }}>{fmt(after)}</span>
      {typeof pct === "number" && (
        <span className="tabular-nums text-[12px] ml-1" style={{ color }}>
          {arrow} {pct >= 0 ? "+" : ""}{pct.toFixed(1)}%
        </span>
      )}
    </span>
  );
}

function PublishLogPanel() {
  const [publishes, setPublishes] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [comparison, setComparison] = useState(null);
  const [windowDays, setWindowDays] = useState(14);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", published_at: "" });

  const load = async () => {
    try {
      const { data } = await api.get("/admin/publishes");
      setPublishes(data.publishes || []);
      if (!selectedId && (data.publishes || []).length > 0) {
        setSelectedId(data.publishes[0].id);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("publishes load", e);
    }
  };
  const loadCompare = async (id, w) => {
    if (!id) { setComparison(null); return; }
    try {
      const { data } = await api.get(`/admin/publishes/${id}/compare?window_days=${w || windowDays}`);
      setComparison(data);
    } catch {
      setComparison(null);
    }
  };
  useEffect(() => { load(); }, []);
  useEffect(() => { loadCompare(selectedId, windowDays); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [selectedId, windowDays]);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name || form.name.length < 2) return;
    const body = { name: form.name, description: form.description };
    if (form.published_at) body.published_at = new Date(form.published_at).toISOString();
    try {
      const { data } = await api.post("/admin/publishes", body);
      setForm({ name: "", description: "", published_at: "" });
      setAdding(false);
      setSelectedId(data.id);
      load();
    } catch (e2) {
      // eslint-disable-next-line no-alert
      window.alert(`Add failed: ${formatApiError(e2)}`);
    }
  };
  const remove = async (id) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm("Remove this publish from the log?")) return;
    try {
      await api.delete(`/admin/publishes/${id}`);
      if (selectedId === id) setSelectedId(null);
      load();
    } catch {
      /* silent */
    }
  };

  return (
    <section className="space-y-4" data-testid="publish-log-panel">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <span className="section-label"><span className="dot" />Publish log</span>
          <h2 className="mt-2 font-display text-[22px] sm:text-[24px] leading-none"
              style={{ letterSpacing: "-0.03em", color: "var(--text)", fontWeight: 500 }}>
            Did this release make the product better?
          </h2>
          <p className="mt-2 text-[13px]" style={{ color: "var(--text-2)" }}>
            Log each release. Compare visitor→signup, source-connect, and memory-capture rates
            {" "}<b>{windowDays}</b> days before vs after.
            <span style={{ color: "var(--text-3)" }}> Recommended min 14d to smooth noise.</span>
          </p>
          <p className="mt-1 text-[11.5px]" style={{ color: "var(--text-3)" }}>
            Sum metrics (sessions, signups, projects…) are shown{" "}
            <b style={{ color: "var(--text-2)" }}>per day</b> so windows of unequal length compare fairly.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-[11px] uppercase tracking-wider" style={{ color: "var(--text-3)" }}>Window</label>
          <select
            value={windowDays}
            onChange={(e) => setWindowDays(Number(e.target.value))}
            className="text-[12.5px] rounded-md px-2 py-1.5"
            style={{ background: "var(--surface)", color: "var(--text)", border: "1px solid var(--hairline)" }}
            data-testid="publish-window-select"
          >
            {[7, 14, 21, 30, 60].map((d) => <option key={d} value={d}>{d} days</option>)}
          </select>
          <button
            onClick={() => setAdding((v) => !v)}
            className="clay-signal px-3 py-1.5 t-tag inline-flex items-center gap-2 text-[12px]"
            data-testid="publish-add-btn"
          >
            <Plus size={12} /> Log publish
          </button>
        </div>
      </div>

      {adding && (
        <form
          onSubmit={submit}
          className="rounded-2xl px-5 py-4 space-y-3"
          style={{ background: "rgba(129, 132, 196,0.06)", border: "1px solid rgba(129, 132, 196,0.35)" }}
          data-testid="publish-add-form"
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input
              placeholder="Name (e.g. v0.9.4 · NPS launch)"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="px-3 py-2 rounded-md text-[13px]"
              style={{ background: "var(--surface)", color: "var(--text)", border: "1px solid var(--hairline)" }}
              required
              data-testid="publish-name"
            />
            <input
              placeholder="Description"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="px-3 py-2 rounded-md text-[13px]"
              style={{ background: "var(--surface)", color: "var(--text)", border: "1px solid var(--hairline)" }}
              data-testid="publish-description"
            />
            <input
              type="datetime-local"
              value={form.published_at}
              onChange={(e) => setForm({ ...form, published_at: e.target.value })}
              className="px-3 py-2 rounded-md text-[13px]"
              style={{ background: "var(--surface)", color: "var(--text)", border: "1px solid var(--hairline)" }}
              title="Publish date/time (defaults to now)"
              data-testid="publish-when"
            />
          </div>
          <div className="flex items-center gap-2 justify-end">
            <button type="button" onClick={() => setAdding(false)} className="btn-ghost text-[12px]" data-testid="publish-cancel">Cancel</button>
            <button type="submit" className="clay-signal px-3 py-1.5 t-tag text-[12px]" data-testid="publish-save">Save publish</button>
          </div>
        </form>
      )}

      {publishes.length === 0 ? (
        <p className="rounded-2xl px-5 py-6 text-[13px] text-center"
           style={{ background: "var(--surface)", border: "1px dashed var(--hairline)", color: "var(--text-3)" }}>
          No publishes logged yet. Add your first one to start comparing before/after metrics.
        </p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
          {/* Publishes list */}
          <div className="lg:col-span-4 rounded-2xl overflow-hidden"
               style={{ background: "var(--surface)", border: "1px solid var(--hairline)" }}
               data-testid="publish-list">
            <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--hairline)" }}>
              <p className="text-[10.5px] uppercase tracking-[0.16em] font-medium" style={{ color: "var(--text-3)" }}>
                Releases ({publishes.length})
              </p>
            </div>
            <ul className="max-h-[380px] overflow-y-auto">
              {publishes.map((p) => {
                const active = p.id === selectedId;
                return (
                  <li
                    key={p.id}
                    className="px-4 py-3 flex items-start gap-2 cursor-pointer group"
                    style={{
                      borderBottom: "1px solid var(--hairline)",
                      background: active ? "rgba(129, 132, 196,0.08)" : "transparent",
                    }}
                    onClick={() => setSelectedId(p.id)}
                    data-testid={`publish-row-${p.id}`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium truncate" style={{ color: active ? "var(--text)" : "var(--text-2)" }}>{p.name}</p>
                      {p.description && (
                        <p className="text-[12px] mt-0.5 truncate" style={{ color: "var(--text-3)" }}>{p.description}</p>
                      )}
                      <p className="text-[11px] mt-1 tabular-nums" style={{ color: "var(--text-3)" }}>
                        {new Date(p.published_at).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); remove(p.id); }}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-white/[0.05]"
                      title="Delete"
                      data-testid={`publish-delete-${p.id}`}
                    >
                      <Trash2 size={13} style={{ color: "#EF4444" }} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Comparison table */}
          <div className="lg:col-span-8 rounded-2xl overflow-hidden"
               style={{ background: "var(--surface)", border: "1px solid var(--hairline)" }}
               data-testid="publish-comparison">
            {!comparison ? (
              <p className="p-6 text-[13px] text-center" style={{ color: "var(--text-3)" }}>
                Select a release to see its before / after comparison.
              </p>
            ) : (
              <>
                <div className="px-5 py-3.5" style={{ borderBottom: "1px solid var(--hairline)" }}>
                  <p className="text-[13px] font-medium" style={{ color: "var(--text)" }}>
                    {comparison.publish.name}
                  </p>
                  <p className="text-[11px] tabular-nums" style={{ color: "var(--text-3)" }}>
                    {new Date(comparison.before_window.start).toLocaleDateString([], { month: "short", day: "numeric" })}
                    {" → "}
                    {new Date(comparison.before_window.end).toLocaleDateString([], { month: "short", day: "numeric" })}
                    {comparison.before_window.days != null && (
                      <span style={{ color: "var(--text-3)" }}> ({comparison.before_window.days}d)</span>
                    )}
                    {"  vs  "}
                    {new Date(comparison.after_window.start).toLocaleDateString([], { month: "short", day: "numeric" })}
                    {" → "}
                    {new Date(comparison.after_window.end).toLocaleDateString([], { month: "short", day: "numeric" })}
                    {comparison.after_window.days != null && (
                      <span style={{ color: "var(--text-3)" }}> ({comparison.after_window.days}d)</span>
                    )}
                  </p>
                </div>
                <table className="w-full text-left">
                  <tbody>
                    {comparison.deltas.map((d) => (
                      <tr key={d.key} style={{ borderTop: "1px solid var(--hairline)" }} data-testid={`publish-delta-${d.key}`}>
                        <td className="py-2.5 px-4 text-[13px]" style={{ color: "var(--text-2)" }}>{d.label}</td>
                        <td className="py-2.5 px-4 text-right">
                          <DeltaValue before={d.before} after={d.after} pct={d.pct_change} kind={d.kind} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

// ============================================================================
// WEBSITE ANALYTICS PANEL — traffic + geo + click heatmap with time-range
// filter. Auto-refreshes hourly. Every section respects the range dropdown.
// ============================================================================
const RANGE_OPTIONS = [
  { key: "yesterday", label: "Yesterday" },
  { key: "7d",        label: "Last 7 days" },
  { key: "30d",       label: "Last 30 days" },
  { key: "90d",       label: "Last 90 days" },
  { key: "lifetime",  label: "Lifetime" },
];

function RangePicker({ value, onChange, testid }) {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg overflow-hidden" style={{ background: "var(--surface)", border: "1px solid var(--hairline)" }} data-testid={testid}>
      {RANGE_OPTIONS.map((opt) => {
        const active = value === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(opt.key)}
            className="px-3 py-1.5 text-[11px] uppercase tracking-[0.14em] font-medium"
            style={{
              color: active ? "#fff" : "var(--text-3)",
              background: active ? "var(--accent)" : "transparent",
            }}
            data-testid={`range-${opt.key}`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function TrafficStatCard({ label, value, testid }) {
  return (
    <div className="rounded-2xl px-5 py-5" style={{ background: "var(--surface)", border: "1px solid var(--hairline)" }} data-testid={testid}>
      <p className="text-[10.5px] uppercase tracking-[0.16em] font-medium" style={{ color: "var(--text-3)" }}>{label}</p>
      <p className="mt-3 font-display tabular-nums" style={{ fontSize: 34, lineHeight: 1, color: "var(--text)", letterSpacing: "-0.03em", fontWeight: 500 }}>
        {(value ?? 0).toLocaleString()}
      </p>
    </div>
  );
}

function CountryRow({ c, max }) {
  const pct = max ? Math.max(2, Math.round((c.sessions / max) * 100)) : 0;
  return (
    <li className="py-2" data-testid={`country-row-${c.code}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-medium" style={{ color: "var(--text)" }}>{c.country}</span>
        <span className="text-[12px] tabular-nums" style={{ color: "var(--text-3)" }}>{c.sessions.toLocaleString()}</span>
      </div>
      <div className="mt-1 h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: "linear-gradient(90deg, #8184C4 0%, #22C55E 100%)" }} />
      </div>
    </li>
  );
}

function ClickHeatmapCanvas({ events, vpW = 1440, vpH = 900 }) {
  const displayW = 720;
  const displayH = Math.round(displayW * (vpH / vpW));
  if (!events || events.length === 0) {
    return (
      <div className="rounded-lg p-8 text-center text-[13px]" style={{ background: "var(--surface)", border: "1px dashed var(--hairline)", color: "var(--text-3)" }} data-testid="heatmap-empty">
        No clicks captured on this page yet.<br/>
        Clicks are tracked from every visit — check back after some real traffic.
      </div>
    );
  }
  return (
    <div className="relative rounded-lg overflow-hidden" style={{ width: displayW, height: displayH, background: "#0F1114", border: "1px solid var(--hairline)" }} data-testid="heatmap-canvas">
      {events.map((e, i) => (
        <div
          key={i}
          className="absolute rounded-full"
          style={{
            left: `${e.x_frac * 100}%`,
            top:  `${e.y_frac * 100}%`,
            width: 22, height: 22,
            transform: "translate(-50%, -50%)",
            background: "radial-gradient(circle, rgba(239,68,68,0.55) 0%, rgba(239,68,68,0.18) 45%, rgba(239,68,68,0) 75%)",
            pointerEvents: "none",
          }}
        />
      ))}
      <p className="absolute bottom-2 right-3 text-[10.5px] uppercase tracking-[0.16em]" style={{ color: "var(--text-3)" }}>
        {events.length.toLocaleString()} clicks
      </p>
    </div>
  );
}

function WebsiteAnalyticsPanel() {
  const [range, setRange] = useState("lifetime");
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [hmPages, setHmPages] = useState([]);
  const [hmSelected, setHmSelected] = useState("/");
  const [hmData, setHmData] = useState(null);
  const [lastLoad, setLastLoad] = useState(null);

  const load = async (r) => {
    const rk = r || range;
    try {
      const [{ data: wd }, { data: hp }] = await Promise.all([
        api.get(`/admin/website-analytics?range=${encodeURIComponent(rk)}`),
        api.get(`/admin/heatmap/pages?range=${encodeURIComponent(rk)}`),
      ]);
      setData(wd);
      setHmPages(hp?.pages || []);
      if ((hp?.pages || []).length > 0) {
        const next = hp.pages[0].path;
        setHmSelected((prev) => hp.pages.find((p) => p.path === prev) ? prev : next);
      }
      setErr("");
      setLastLoad(new Date());
    } catch (e) {
      setErr(formatApiError(e));
    }
  };

  const loadHm = async (path, r) => {
    try {
      const { data: h } = await api.get(`/admin/heatmap?path=${encodeURIComponent(path)}&range=${encodeURIComponent(r || range)}`);
      setHmData(h);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("heatmap load failed", e);
      setHmData({ events: [] });
    }
  };

  useEffect(() => { load(range); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [range]);
  useEffect(() => {
    if (hmSelected) loadHm(hmSelected, range);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [hmSelected, range]);

  // Hourly auto-refresh so admins see updates without action.
  useEffect(() => {
    const id = setInterval(() => load(range), 60 * 60 * 1000);
    return () => clearInterval(id);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [range]);

  if (err) {
    return <p className="text-[13px]" style={{ color: "var(--danger, #EF4444)" }}>Website analytics unavailable: {err}</p>;
  }
  if (!data) return null;

  const t = data.traffic || {};
  const maxCountry = Math.max(1, ...(data.countries || []).map((c) => c.sessions));

  return (
    <section className="space-y-4" data-testid="website-analytics-panel">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <span className="section-label"><span className="dot" />Website analytics</span>
          <h2 className="mt-2 font-display text-[22px] sm:text-[24px] leading-none"
              style={{ letterSpacing: "-0.03em", color: "var(--text)", fontWeight: 500 }}>
            Traffic, geography &amp; click heatmap.
          </h2>
          <p className="mt-2 text-[13px]" style={{ color: "var(--text-2)" }}>
            All numbers respect the range filter. Refreshes hourly · last updated{" "}
            <span className="tabular-nums" style={{ color: "var(--text)" }}>
              {lastLoad ? lastLoad.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <RangePicker value={range} onChange={setRange} testid="wa-range" />
          <button
            onClick={() => load(range)}
            className="btn-ghost text-[11px] uppercase tracking-wider inline-flex items-center gap-2"
            data-testid="wa-refresh"
          >
            <RefreshCcw size={12} /> Refresh
          </button>
        </div>
      </div>

      {/* Traffic KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="wa-kpis">
        <TrafficStatCard label="Total sessions"      value={t.total_sessions}    testid="wa-sessions" />
        <TrafficStatCard label="Unique visitors"     value={t.unique_visitors}   testid="wa-visitors" />
        <TrafficStatCard label="Page views"          value={t.total_page_views}  testid="wa-pageviews" />
        <TrafficStatCard label="Logged-in visits"    value={t.logged_in_visits}  testid="wa-loggedin" />
      </div>

      {/* Geo + Top pages side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="rounded-2xl px-5 py-5" style={{ background: "var(--surface)", border: "1px solid var(--hairline)" }} data-testid="wa-geo">
          <div className="flex items-baseline justify-between">
            <p className="text-[10.5px] uppercase tracking-[0.16em] font-medium" style={{ color: "var(--text-3)" }}>
              Top countries
            </p>
            {data.unresolved_ips > 0 && (
              <span className="text-[11px]" style={{ color: "var(--text-3)" }}>
                {data.unresolved_ips} pending geo lookup
              </span>
            )}
          </div>
          {(data.countries || []).length === 0 ? (
            <p className="mt-3 text-[13px]" style={{ color: "var(--text-3)" }}>
              No geo data yet. New visitor IPs will resolve to countries within a few seconds of arrival.
            </p>
          ) : (
            <ul className="mt-2 space-y-1 max-h-[300px] overflow-y-auto pr-1">
              {data.countries.map((c) => (<CountryRow key={c.code} c={c} max={maxCountry} />))}
            </ul>
          )}
        </div>

        <div className="rounded-2xl px-5 py-5" style={{ background: "var(--surface)", border: "1px solid var(--hairline)" }} data-testid="wa-top-pages">
          <p className="text-[10.5px] uppercase tracking-[0.16em] font-medium" style={{ color: "var(--text-3)" }}>Top pages</p>
          {(data.top_pages || []).length === 0 ? (
            <p className="mt-3 text-[13px]" style={{ color: "var(--text-3)" }}>No page views in this range.</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {data.top_pages.map((p, i) => (
                <li key={i} className="flex items-baseline justify-between gap-3 py-1" style={{ borderBottom: "1px solid var(--hairline)" }}>
                  <span className="text-[13px] truncate" style={{ color: "var(--text)" }}>{p.path}</span>
                  <span className="text-[12px] tabular-nums" style={{ color: "var(--text-3)" }}>{p.views.toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Top sources */}
      <div className="rounded-2xl px-5 py-5" style={{ background: "var(--surface)", border: "1px solid var(--hairline)" }} data-testid="wa-sources">
        <p className="text-[10.5px] uppercase tracking-[0.16em] font-medium" style={{ color: "var(--text-3)" }}>Top traffic sources</p>
        {(data.top_sources || []).length === 0 ? (
          <p className="mt-3 text-[13px]" style={{ color: "var(--text-3)" }}>No source data.</p>
        ) : (
          <ul className="mt-2 grid grid-cols-2 md:grid-cols-3 gap-x-4">
            {data.top_sources.map((s, i) => (
              <li key={i} className="flex items-baseline justify-between gap-2 py-1" style={{ borderBottom: "1px solid var(--hairline)" }}>
                <span className="text-[13px]" style={{ color: "var(--text)" }}>{s.source}</span>
                <span className="text-[12px] tabular-nums" style={{ color: "var(--text-3)" }}>{s.sessions.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Click heatmap */}
      <div className="rounded-2xl px-5 py-5" style={{ background: "var(--surface)", border: "1px solid var(--hairline)" }} data-testid="wa-heatmap">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <p className="text-[10.5px] uppercase tracking-[0.16em] font-medium" style={{ color: "var(--text-3)" }}>Click heatmap</p>
          {hmPages.length > 0 && (
            <select
              value={hmSelected}
              onChange={(e) => setHmSelected(e.target.value)}
              className="text-[13px] rounded-md px-2.5 py-1.5"
              style={{ background: "var(--surface)", color: "var(--text)", border: "1px solid var(--hairline)" }}
              data-testid="heatmap-page-select"
            >
              {hmPages.map((p) => (
                <option key={p.path} value={p.path}>{p.path} · {p.clicks.toLocaleString()} clicks</option>
              ))}
            </select>
          )}
        </div>
        <div className="mt-3 flex justify-center">
          <ClickHeatmapCanvas events={hmData?.events || []} />
        </div>
        {hmPages.length === 0 && (
          <p className="mt-3 text-[13px] text-center" style={{ color: "var(--text-3)" }}>
            Click tracking is live. Data starts appearing as soon as visitors interact with any page.
          </p>
        )}
      </div>
    </section>
  );
}

// ============================================================================
// NPS DETAIL PANEL — expandable block below the pitch board. Shows:
//   • Live progress of the currently-sending campaign (bar + counts)
//   • Full campaign history (targeted / sent / failed / when)
//   • Score histogram (0-10) with promoter/passive/detractor bands
//   • Response rate (responses / total sent across all campaigns)
//   • Latest 20 responses with score badges + verbatim comments
// Polls every 4s while any campaign is in "running" state so the admin
// sees emails land in real time.
// ============================================================================
function ScoreBucketBadge({ score, bucket }) {
  const b = bucket || (score >= 9 ? "promoter" : score <= 6 ? "detractor" : "passive");
  const color = b === "promoter" ? "#22C55E" : b === "detractor" ? "#EF4444" : "#F59E0B";
  return (
    <span
      className="inline-flex items-center justify-center rounded-md font-medium"
      style={{
        minWidth: 30, height: 26, padding: "0 6px",
        background: "#0F1114", border: `1.5px solid ${color}`, color: color,
        fontSize: 12.5, letterSpacing: "-0.01em",
      }}
    >
      {score}
    </span>
  );
}

function CampaignRow({ c }) {
  const pct = c.targeted ? Math.round(((c.sent || 0) / c.targeted) * 100) : 0;
  const isRunning = c.status === "running";
  const isTest = !!c.test_only;
  const when = c.started_at ? new Date(c.started_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
  return (
    <tr data-testid={`nps-campaign-row-${c.id || c.started_at}`} style={{ borderTop: "1px solid var(--hairline)" }}>
      <td className="py-2.5 px-3 text-[13px]" style={{ color: "var(--text-2)" }}>{when}</td>
      <td className="py-2.5 px-3 text-[12.5px]" style={{ color: "var(--text-3)" }}>
        {isTest ? "Test" : "Full"}
      </td>
      <td className="py-2.5 px-3 text-[13px] font-medium tabular-nums" style={{ color: "var(--text)" }}>{c.targeted || 0}</td>
      <td className="py-2.5 px-3 text-[13px] tabular-nums" style={{ color: "#5BE3A2" }}>{c.sent || 0}</td>
      <td className="py-2.5 px-3 text-[13px] tabular-nums" style={{ color: (c.failed || 0) > 0 ? "#EF4444" : "var(--text-3)" }}>{c.failed || 0}</td>
      <td className="py-2.5 px-3 text-[13px] tabular-nums" style={{ color: "#F59E0B" }}>{c.queued || 0}</td>
      <td className="py-2.5 px-3 text-[12px]">
        {isRunning ? (
          <span className="inline-flex items-center gap-1.5" style={{ color: "#8184C4" }}>
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#8184C4] animate-pulse" />
            Sending · {pct}%
          </span>
        ) : c.status === "cancelled" ? (
          <span style={{ color: "#F59E0B" }}>Cancelled</span>
        ) : (
          <span style={{ color: "var(--text-3)" }}>Completed</span>
        )}
      </td>
    </tr>
  );
}

function ScoreHistogram({ histogram = [], totals = {} }) {
  const max = Math.max(1, ...histogram.map((b) => b.count || 0));
  return (
    <div
      className="rounded-2xl px-5 py-5 sm:px-6 sm:py-6"
      style={{ background: "var(--surface)", border: "1px solid var(--hairline)" }}
      data-testid="nps-histogram"
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[10.5px] uppercase tracking-[0.16em] font-medium" style={{ color: "var(--text-3)" }}>
          Score distribution
        </p>
        <div className="flex items-center gap-3 text-[11px]" style={{ color: "var(--text-3)" }}>
          <span><span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: "#EF4444" }} />Detractor {totals.detractors || 0}</span>
          <span><span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: "#F59E0B" }} />Passive {totals.passives || 0}</span>
          <span><span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: "#22C55E" }} />Promoter {totals.promoters || 0}</span>
        </div>
      </div>
      <div className="mt-4 flex items-end gap-1.5" style={{ height: 120 }}>
        {histogram.map((b) => {
          const bg = b.score >= 9 ? "#22C55E" : b.score <= 6 ? "#EF4444" : "#F59E0B";
          const h = b.count > 0 ? Math.max(4, Math.round((b.count / max) * 108)) : 3;
          return (
            <div key={b.score} className="flex-1 flex flex-col items-center gap-1">
              <div className="text-[10.5px] tabular-nums" style={{ color: "var(--text-2)", opacity: b.count > 0 ? 1 : 0.35 }}>
                {b.count}
              </div>
              <div
                className="w-full rounded-t-md"
                style={{ height: h, background: bg, opacity: b.count > 0 ? 0.92 : 0.18 }}
                data-testid={`nps-histogram-bar-${b.score}`}
                title={`Score ${b.score}: ${b.count} response${b.count === 1 ? "" : "s"}`}
              />
              <div className="text-[10px] tabular-nums" style={{ color: "var(--text-3)" }}>{b.score}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ResponsesList({ responses = [], onDelete }) {
  return (
    <div
      className="rounded-2xl px-5 py-5 sm:px-6 sm:py-6"
      style={{ background: "var(--surface)", border: "1px solid var(--hairline)" }}
      data-testid="nps-responses-list"
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[10.5px] uppercase tracking-[0.16em] font-medium" style={{ color: "var(--text-3)" }}>
          Latest responses
        </p>
        <span className="text-[11px]" style={{ color: "var(--text-3)" }}>{responses.length} shown</span>
      </div>
      {responses.length === 0 ? (
        <p className="mt-4 text-[13px]" style={{ color: "var(--text-3)" }}>
          No responses yet. Send the survey to start collecting.
        </p>
      ) : (
        <ul className="mt-3 space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
          {responses.map((r) => (
            <li
              key={r.id}
              className="flex items-start gap-3 py-2 group"
              style={{ borderBottom: "1px solid var(--hairline)" }}
              data-testid={`nps-response-${r.id}`}
            >
              <ScoreBucketBadge score={r.score} bucket={r.score_bucket} />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-[12.5px] font-medium truncate" style={{ color: "var(--text)" }}>{r.name}</p>
                  <p className="text-[10.5px] shrink-0" style={{ color: "var(--text-3)" }}>
                    {r.updated_at ? new Date(r.updated_at).toLocaleDateString([], { month: "short", day: "numeric" }) : ""}
                  </p>
                </div>
                <p className="mt-1 text-[13px] leading-relaxed break-words" style={{ color: r.comment ? "var(--text-2)" : "var(--text-3)", fontStyle: r.comment ? "normal" : "italic" }}>
                  {r.comment || "No comment"}
                </p>
              </div>
              {onDelete && (
                <button
                  type="button"
                  onClick={() => onDelete(r)}
                  className="p-1.5 rounded opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-white/[0.05] transition-opacity"
                  aria-label={`Delete response from ${r.name}`}
                  data-testid={`nps-response-delete-${r.id}`}
                  title="Delete this rating"
                >
                  <Trash2 size={13} style={{ color: "#EF4444" }} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatCooldown(sec) {
  if (sec <= 0) return "";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function NpsDetailPanel() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [expanded, setExpanded] = useState(true);
  const load = async () => {
    try {
      const { data: d } = await api.get("/admin/nps/detail");
      setData(d);
      setErr("");
    } catch (e) {
      setErr(formatApiError(e));
    }
  };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!data) return undefined;
    const anyRunning = (data.campaigns || []).some((c) => c.status === "running");
    if (!anyRunning) return undefined;
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, [data]);
  useEffect(() => {
    if (!data || data.cooldown_remaining_seconds <= 0) return undefined;
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, [data]);

  const deleteResponse = async (r) => {
    // eslint-disable-next-line no-alert
    const ok = window.confirm(
      `Delete ${r.name}'s rating of ${r.score}?\n\n` +
      "This removes the response permanently and recomputes the NPS. Cannot be undone."
    );
    if (!ok) return;
    try {
      await api.delete(`/admin/nps/responses/${r.id}`);
      // Optimistic local update so the UI feels instant, then re-fetch
      // to refresh totals + histogram.
      setData((prev) => prev ? {
        ...prev,
        latest_responses: (prev.latest_responses || []).filter((x) => x.id !== r.id),
      } : prev);
      load();
    } catch (e) {
      // eslint-disable-next-line no-alert
      window.alert(`Delete failed: ${formatApiError(e)}`);
    }
  };

  if (err) {
    return <p className="text-[13px]" style={{ color: "var(--danger, #EF4444)" }}>{err}</p>;
  }
  if (!data) return null;

  const campaigns  = data.campaigns || [];
  const running    = campaigns.find((c) => c.status === "running");

  return (
    <section className="space-y-4" data-testid="nps-detail-panel">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <span className="section-label"><span className="dot" />NPS · deep view</span>
          <h2 className="mt-2 font-display text-[22px] sm:text-[24px] leading-none"
              style={{ letterSpacing: "-0.03em", color: "var(--text)", fontWeight: 500 }}>
            Every score, every campaign, every comment.
          </h2>
          <p className="mt-2 text-[13px]" style={{ color: "var(--text-2)" }}>
            {data.totals.responses} response{data.totals.responses === 1 ? "" : "s"} ·{" "}
            {data.response_rate}% response rate ·{" "}
            {campaigns.length} campaign{campaigns.length === 1 ? "" : "s"} run
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="btn-ghost text-[11px] uppercase tracking-wider inline-flex items-center gap-2"
            data-testid="nps-detail-refresh"
          >
            <RefreshCcw size={12} /> Refresh
          </button>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="btn-ghost text-[11px] uppercase tracking-wider"
            data-testid="nps-detail-toggle"
          >
            {expanded ? "Collapse" : "Expand"}
          </button>
        </div>
      </div>

      {expanded && (
        <>
          {/* Live progress banner while sending */}
          {running && (
            <div
              className="rounded-2xl px-5 py-4 flex items-center gap-4"
              style={{ background: "rgba(129, 132, 196,0.08)", border: "1px solid rgba(129, 132, 196,0.35)" }}
              data-testid="nps-live-progress"
            >
              <Loader2 size={16} className="animate-spin" style={{ color: "#8184C4" }} />
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium" style={{ color: "var(--text)" }}>
                  Sending in progress · {(running.sent || 0) + (running.failed || 0)} of {running.targeted} processed
                </p>
                <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                  <div
                    className="h-full"
                    style={{
                      width: `${running.targeted ? Math.min(100, Math.round(((running.sent || 0) + (running.failed || 0)) / running.targeted * 100)) : 0}%`,
                      background: "linear-gradient(90deg, #8184C4 0%, #22C55E 100%)",
                      transition: "width 0.6s ease-out",
                    }}
                  />
                </div>
                <p className="mt-1.5 text-[11px]" style={{ color: "var(--text-3)" }}>
                  Sent {running.sent || 0} · Failed {running.failed || 0} · Queued {running.queued || 0}
                </p>
              </div>
            </div>
          )}

          {/* Histogram + Responses side-by-side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <ScoreHistogram histogram={data.histogram} totals={data.totals} />
            <ResponsesList responses={data.latest_responses} onDelete={deleteResponse} />
          </div>

          {/* Campaign history table */}
          <div
            className="rounded-2xl overflow-hidden"
            style={{ background: "var(--surface)", border: "1px solid var(--hairline)" }}
            data-testid="nps-campaigns-table"
          >
            <div className="px-5 py-3.5 flex items-center justify-between" style={{ borderBottom: "1px solid var(--hairline)" }}>
              <p className="text-[10.5px] uppercase tracking-[0.16em] font-medium" style={{ color: "var(--text-3)" }}>
                Campaign history
              </p>
              <p className="text-[11px]" style={{ color: "var(--text-3)" }}>
                Total emails sent (all time): <span className="tabular-nums font-medium" style={{ color: "var(--text-2)" }}>{data.total_sent}</span>
              </p>
            </div>
            {campaigns.length === 0 ? (
              <p className="p-5 text-[13px]" style={{ color: "var(--text-3)" }}>
                No campaigns yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr>
                      <th className="py-2.5 px-3 text-[10.5px] uppercase tracking-[0.14em] font-medium" style={{ color: "var(--text-3)" }}>Started</th>
                      <th className="py-2.5 px-3 text-[10.5px] uppercase tracking-[0.14em] font-medium" style={{ color: "var(--text-3)" }}>Type</th>
                      <th className="py-2.5 px-3 text-[10.5px] uppercase tracking-[0.14em] font-medium" style={{ color: "var(--text-3)" }}>Targeted</th>
                      <th className="py-2.5 px-3 text-[10.5px] uppercase tracking-[0.14em] font-medium" style={{ color: "var(--text-3)" }}>Sent</th>
                      <th className="py-2.5 px-3 text-[10.5px] uppercase tracking-[0.14em] font-medium" style={{ color: "var(--text-3)" }}>Failed</th>
                      <th className="py-2.5 px-3 text-[10.5px] uppercase tracking-[0.14em] font-medium" style={{ color: "var(--text-3)" }}>Queued</th>
                      <th className="py-2.5 px-3 text-[10.5px] uppercase tracking-[0.14em] font-medium" style={{ color: "var(--text-3)" }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaigns.map((c) => (
                      <CampaignRow key={c.id || c.started_at} c={c} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

// Helper — format duration in seconds → "1h 12m" / "42m 6s" / "18s".
function formatDuration(secs) {
  if (!secs || secs < 1) return "—";
  const s = Math.round(secs);
  if (s >= 3600) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h}h ${m}m`;
  }
  if (s >= 60) {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}m ${r}s`;
  }
  return `${s}s`;
}

function ProductSignalsRow({ ps = {} }) {
  if (!ps) return null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3" data-testid="pitch-product-signals-row">
      <PitchStat
        label="Signup → 1st project"
        value={ps.avg_signup_to_first_doc_minutes != null ? formatDuration(ps.avg_signup_to_first_doc_minutes * 60) : "—"}
        tone="sky"
        testid="ps-time-to-first-doc"
      />
      <PitchStat
        label="Connected a source"
        value={ps.pct_users_connected_source ?? 0}
        unit="%"
        tone="emerald"
        testid="ps-connected-source"
        sub="of signups"
      />
      <PitchStat
        label="Projects / active user"
        value={ps.avg_projects_per_active_user ?? 0}
        tone="violet"
        testid="ps-projects-per-user"
      />
      <PitchStat
        label="Returning (7d / 30d)"
        value={`${ps.returning_users_7d ?? 0} / ${ps.returning_users_30d ?? 0}`}
        tone="pink"
        testid="ps-returning"
      />
      <PitchStat
        label="Avg session length"
        value={ps.avg_session_duration_seconds ? formatDuration(ps.avg_session_duration_seconds) : "—"}
        tone="lime"
        testid="ps-session-duration"
      />
    </div>
  );
}

// ============================================================================
// PITCH METRICS BOARD — prominent investor-headline block, rendered above the
// analytics grid. Auto-computed numbers come from GET /admin/pitch-metrics;
// NPS + notable users are curated via PUT /admin/pitch-metrics/config
// (inline modal editor).
// ============================================================================
function PitchStat({ label, value, unit = "", tone = "lime", size = "lg", testid, sub }) {
  const t = KPI_TONES[tone] || KPI_TONES.ghost;
  const isDashed = tone === "ghost";
  const numFont = size === "xl" ? 44 : size === "lg" ? 36 : 28;
  return (
    <div
      className="rounded-2xl px-5 py-5 sm:px-6 sm:py-6 overflow-hidden relative"
      style={{
        background: t.bg,
        color: t.text,
        border: isDashed ? "1px dashed var(--hairline)" : "none",
      }}
      data-testid={testid}
    >
      <div className="text-[10.5px] uppercase tracking-[0.16em] font-medium" style={{ color: t.subText }}>
        {label}
      </div>
      <div
        className="mt-3 font-display"
        style={{
          fontSize: numFont,
          lineHeight: 1,
          color: t.text,
          letterSpacing: "-0.03em",
          fontWeight: 500,
        }}
      >
        {value ?? "—"}
        {unit && value !== null && value !== undefined && value !== "—" && (
          <span style={{ fontSize: numFont * 0.5, color: t.subText, marginLeft: 6, fontWeight: 400 }}>
            {unit}
          </span>
        )}
      </div>
      {sub && (
        <div className="mt-2 text-[11px]" style={{ color: t.subText }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function OrganicPaidBar({ organic_pct, paid_pct, organic, paid }) {
  const total = organic + paid;
  return (
    <div
      className="rounded-2xl px-5 py-5 sm:px-6 sm:py-6"
      style={{ background: "var(--surface)", border: "1px solid var(--hairline)" }}
      data-testid="pitch-organic-paid"
    >
      <div className="text-[10.5px] uppercase tracking-[0.16em] font-medium" style={{ color: "var(--text-3)" }}>
        Organic vs Paid split
      </div>
      {total > 0 ? (
        <>
          <div className="mt-3 flex items-baseline gap-3 font-display" style={{ letterSpacing: "-0.03em" }}>
            <span style={{ fontSize: 30, lineHeight: 1, color: "var(--text)" }}>
              {organic_pct}
              <span style={{ fontSize: 15, color: "var(--text-3)", marginLeft: 3 }}>%</span>
            </span>
            <span style={{ color: "var(--text-3)", fontSize: 15 }}>/</span>
            <span style={{ fontSize: 30, lineHeight: 1, color: "var(--text-2)" }}>
              {paid_pct}
              <span style={{ fontSize: 15, color: "var(--text-3)", marginLeft: 3 }}>%</span>
            </span>
          </div>
          <div className="mt-4 h-2 rounded-full overflow-hidden flex" style={{ background: "var(--hairline)" }}>
            <div style={{ width: `${organic_pct}%`, background: "#5BE3A2" }} />
            <div style={{ width: `${paid_pct}%`, background: "#F97316" }} />
          </div>
          <div className="mt-2 flex justify-between text-[11px]" style={{ color: "var(--text-3)" }}>
            <span>Organic · {organic.toLocaleString()}</span>
            <span>Paid · {paid.toLocaleString()}</span>
          </div>
        </>
      ) : (
        <p className="mt-3 text-[13px]" style={{ color: "var(--text-3)" }}>
          No traffic sessions captured yet.
        </p>
      )}
    </div>
  );
}

function NotableUsersCard({ items, onEdit }) {
  return (
    <div
      className="rounded-2xl px-5 py-5 sm:px-6 sm:py-6"
      style={{ background: "var(--surface)", border: "1px solid var(--hairline)" }}
      data-testid="pitch-notable-users"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="text-[10.5px] uppercase tracking-[0.16em] font-medium" style={{ color: "var(--text-3)" }}>
          Notable users / studios
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="text-[10.5px] uppercase tracking-[0.14em] inline-flex items-center gap-1 hover:text-[var(--text)]"
          style={{ color: "var(--text-3)" }}
          data-testid="pitch-notable-edit"
        >
          <Pencil size={11} /> Edit
        </button>
      </div>
      {items.length === 0 ? (
        <p className="mt-3 text-[13px]" style={{ color: "var(--text-3)" }}>
          No lighthouse customers added yet. <button onClick={onEdit} className="underline">Add up to 12</button>.
        </p>
      ) : (
        <ul className="mt-3 space-y-2" data-testid="pitch-notable-list">
          {items.slice(0, 6).map((n, i) => (
            <li key={i} className="flex items-center gap-3">
              {n.logo_url ? (
                <img
                  src={n.logo_url}
                  alt=""
                  className="w-8 h-8 rounded-full object-cover"
                  style={{ border: "1px solid var(--hairline)" }}
                  onError={(e) => { e.currentTarget.style.display = "none"; }}
                />
              ) : (
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-medium"
                  style={{ background: "var(--hairline)", color: "var(--text-2)" }}
                >
                  {(n.name || "?").slice(0, 1).toUpperCase()}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium truncate" style={{ color: "var(--text)" }}>{n.name}</p>
                {n.role && (
                  <p className="text-[11px] truncate" style={{ color: "var(--text-3)" }}>{n.role}</p>
                )}
              </div>
            </li>
          ))}
          {items.length > 6 && (
            <li className="text-[11px] pt-1" style={{ color: "var(--text-3)" }}>
              +{items.length - 6} more
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function NpsCard({ nps, source, responsesCount, onEdit, onSend, sending, cooldownSeconds = 0 }) {
  const isComputed = source === "responses";
  const onCooldown = cooldownSeconds > 0;
  const disabled = sending || onCooldown;
  const tone = nps === null || nps === undefined
    ? "ghost"
    : nps >= 50 ? "emerald"
    : nps >= 30 ? "lime"
    : nps >= 0 ? "sky"
    : "coral";
  const t = KPI_TONES[tone] || KPI_TONES.ghost;
  const isDashed = tone === "ghost";
  return (
    <div
      className="rounded-2xl px-5 py-5 sm:px-6 sm:py-6 relative"
      style={{
        background: t.bg,
        color: t.text,
        border: isDashed ? "1px dashed var(--hairline)" : "none",
      }}
      data-testid="pitch-nps"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="text-[10.5px] uppercase tracking-[0.16em] font-medium" style={{ color: t.subText }}>
          Net Promoter Score (NPS)
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="text-[10.5px] uppercase tracking-[0.14em] inline-flex items-center gap-1 hover:opacity-100"
          style={{ color: t.subText, opacity: 0.85 }}
          data-testid="pitch-nps-edit"
          aria-label="Edit NPS score manually"
        >
          <Pencil size={11} /> Edit
        </button>
      </div>
      <div
        className="mt-3 font-display"
        style={{
          fontSize: 44,
          lineHeight: 1,
          color: t.text,
          letterSpacing: "-0.03em",
          fontWeight: 500,
        }}
      >
        {nps === null || nps === undefined ? "—" : nps}
      </div>
      <div className="mt-2 text-[11px]" style={{ color: t.subText }}>
        {isComputed && responsesCount > 0
          ? `From ${responsesCount} response${responsesCount === 1 ? "" : "s"} · ${
              nps >= 50 ? "World-class." : nps >= 30 ? "Strong." : nps >= 0 ? "Positive." : "Under-water."
            }`
          : nps === null || nps === undefined
            ? "Not yet measured. Send the survey below."
            : nps >= 50 ? "World-class."
            : nps >= 30 ? "Strong."
            : nps >= 0  ? "Positive — room to grow."
            : "Under-water — investigate churn drivers."}
      </div>
      <button
        type="button"
        onClick={onSend}
        disabled={disabled}
        className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] font-medium"
        style={{
          background: isDashed ? "var(--accent)" : "rgba(255,255,255,0.14)",
          color: isDashed ? "#fff" : t.text,
          border: isDashed ? "none" : "1px solid rgba(255,255,255,0.22)",
          opacity: disabled ? 0.5 : 1,
          cursor: disabled ? "not-allowed" : "pointer",
        }}
        data-testid="pitch-nps-send"
        title={onCooldown ? `Next campaign in ${formatCooldown(cooldownSeconds)}` : ""}
        aria-label={onCooldown ? `On cool-down. Next campaign in ${formatCooldown(cooldownSeconds)}` : "Send NPS survey email to all registered users"}
      >
        {sending ? (
          <><Loader2 size={12} className="animate-spin" /> Sending…</>
        ) : onCooldown ? (
          <>Next in {formatCooldown(cooldownSeconds)}</>
        ) : (
          <>Send NPS survey →</>
        )}
      </button>
    </div>
  );
}

// --- Editor modal ------------------------------------------------------------
function PitchConfigModal({ open, initial, onClose, onSave }) {
  const [nps, setNps] = useState(initial?.nps ?? "");
  const [items, setItems] = useState(initial?.notable_users || []);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (open) {
      setNps(initial?.nps ?? "");
      setItems(initial?.notable_users || []);
      setErr("");
    }
  }, [open, initial]);

  if (!open) return null;

  const setField = (i, k, v) => {
    const next = items.slice();
    next[i] = { ...next[i], [k]: v };
    setItems(next);
  };
  const addRow = () => setItems([...items, { name: "", role: "", logo_url: "" }].slice(0, 12));
  const rmRow = (i) => setItems(items.filter((_, idx) => idx !== i));

  const save = async () => {
    setSaving(true);
    setErr("");
    try {
      const body = {};
      if (nps === "" || nps === null) body.nps = null;
      else {
        const n = Number(nps);
        if (Number.isNaN(n)) throw new Error("NPS must be a number.");
        if (n < -100 || n > 100) throw new Error("NPS must be between -100 and 100.");
        body.nps = n;
      }
      body.notable_users = items
        .map((x) => ({
          name: (x.name || "").trim(),
          role: (x.role || "").trim(),
          logo_url: (x.logo_url || "").trim(),
        }))
        .filter((x) => x.name);
      await api.put("/admin/pitch-metrics/config", body);
      onSave();
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message || "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[210] flex items-center justify-center px-4 py-8"
      style={{ background: "rgba(0,0,0,0.6)" }}
      role="dialog"
      aria-modal="true"
      data-testid="pitch-config-modal"
    >
      <div
        className="w-full max-w-2xl rounded-2xl overflow-hidden"
        style={{ background: "var(--bg-elev)", border: "1px solid var(--hairline)" }}
      >
        <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: "1px solid var(--hairline)" }}>
          <h2 className="text-[15px] font-medium" style={{ color: "var(--text)" }}>Edit pitch metrics</h2>
          <button onClick={onClose} className="p-1 hover:opacity-70" aria-label="Close" data-testid="pitch-config-close">
            <X size={16} style={{ color: "var(--text-3)" }} />
          </button>
        </div>

        <div className="p-5 space-y-5 max-h-[70vh] overflow-y-auto">
          <div>
            <label className="text-[11px] uppercase tracking-wider" style={{ color: "var(--text-3)" }}>
              NPS score (−100 to 100)
            </label>
            <input
              type="number"
              min={-100}
              max={100}
              step="0.1"
              className="mt-1 w-32 px-3 py-2 rounded-md text-sm"
              style={{ background: "var(--surface)", color: "var(--text)", border: "1px solid var(--hairline)" }}
              value={nps}
              onChange={(e) => setNps(e.target.value)}
              placeholder="e.g. 42"
              data-testid="pitch-config-nps"
            />
            <p className="text-[11px] mt-1" style={{ color: "var(--text-3)" }}>Leave empty to show as “—”.</p>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label className="text-[11px] uppercase tracking-wider" style={{ color: "var(--text-3)" }}>
                Notable users / studios ({items.length}/12)
              </label>
              {items.length < 12 && (
                <button
                  onClick={addRow}
                  className="text-[11px] uppercase tracking-[0.14em] inline-flex items-center gap-1"
                  style={{ color: "var(--accent)" }}
                  data-testid="pitch-config-add"
                >
                  <Plus size={12} /> Add
                </button>
              )}
            </div>
            <div className="mt-2 space-y-2">
              {items.length === 0 && (
                <p className="text-[13px]" style={{ color: "var(--text-3)" }}>
                  No entries yet. Add lighthouse customers you can name-drop in investor conversations.
                </p>
              )}
              {items.map((it, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center" data-testid={`pitch-config-row-${i}`}>
                  <input
                    className="col-span-4 px-2.5 py-1.5 rounded-md text-[13px]"
                    style={{ background: "var(--surface)", color: "var(--text)", border: "1px solid var(--hairline)" }}
                    placeholder="Name (required)"
                    value={it.name || ""}
                    onChange={(e) => setField(i, "name", e.target.value)}
                  />
                  <input
                    className="col-span-4 px-2.5 py-1.5 rounded-md text-[13px]"
                    style={{ background: "var(--surface)", color: "var(--text)", border: "1px solid var(--hairline)" }}
                    placeholder="Role / company"
                    value={it.role || ""}
                    onChange={(e) => setField(i, "role", e.target.value)}
                  />
                  <input
                    className="col-span-3 px-2.5 py-1.5 rounded-md text-[13px]"
                    style={{ background: "var(--surface)", color: "var(--text)", border: "1px solid var(--hairline)" }}
                    placeholder="Logo URL (optional)"
                    value={it.logo_url || ""}
                    onChange={(e) => setField(i, "logo_url", e.target.value)}
                  />
                  <button
                    onClick={() => rmRow(i)}
                    className="col-span-1 p-1.5 rounded hover:opacity-70 justify-self-end"
                    aria-label={`Remove ${it.name || "row"}`}
                    data-testid={`pitch-config-remove-${i}`}
                  >
                    <Trash2 size={14} style={{ color: "var(--text-3)" }} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {err && (
            <p className="text-[13px]" style={{ color: "var(--danger, #EF4444)" }}>{err}</p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3" style={{ borderTop: "1px solid var(--hairline)" }}>
          <button onClick={onClose} className="btn-ghost text-[12px]" data-testid="pitch-config-cancel">Cancel</button>
          <button
            onClick={save}
            disabled={saving}
            className="clay-signal px-3 py-1.5 t-tag inline-flex items-center gap-2 text-[12px]"
            data-testid="pitch-config-save"
          >
            {saving ? <><Loader2 size={12} className="animate-spin" /> Saving…</> : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PitchMetricsBoard() {
  const [data, setData] = useState(null);
  const [cooldownSec, setCooldownSec] = useState(0);
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState(false);
  const [sending, setSending] = useState(false);

  const load = async () => {
    try {
      const [pm, nd] = await Promise.all([
        api.get("/admin/pitch-metrics"),
        api.get("/admin/nps/detail").catch(() => ({ data: { cooldown_remaining_seconds: 0 } })),
      ]);
      setData(pm.data);
      setCooldownSec(nd.data?.cooldown_remaining_seconds || 0);
      setErr("");
    } catch (e) {
      setErr(formatApiError(e));
    }
  };

  useEffect(() => { load(); }, []);

  const sendSurvey = async () => {
    if (cooldownSec > 0) return;
    const eligible = data?.registered_users || 0;
    // eslint-disable-next-line no-alert
    const ok = window.confirm(
      `Send the NPS survey email to all registered users? (${eligible} eligible)\n\n` +
      "Users who have already responded will be skipped."
    );
    if (!ok) return;
    setSending(true);
    try {
      const { data: r } = await api.post("/admin/nps/send-campaign", {
        test_only: false,
        include_answered: false,
      });
      // eslint-disable-next-line no-alert
      window.alert(r.message || `Queued ${r.targeted} email(s).`);
      setTimeout(load, 3000);
    } catch (e) {
      // eslint-disable-next-line no-alert
      window.alert(`Send failed: ${formatApiError(e)}`);
    } finally {
      setSending(false);
    }
  };

  if (err) {
    return (
      <p className="text-[13px]" style={{ color: "var(--danger, #EF4444)" }} data-testid="pitch-metrics-error">
        Pitch metrics unavailable: {err}
      </p>
    );
  }
  if (!data) return null;

  return (
    <section className="space-y-4" data-testid="pitch-metrics-board">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <span className="section-label"><span className="dot" />Pitch snapshot</span>
          <h2 className="mt-2 font-display text-[26px] sm:text-[30px] leading-none"
              style={{ letterSpacing: "-0.03em", color: "var(--text)", fontWeight: 500 }}>
            The numbers investors care about.
          </h2>
          <p className="mt-2 text-[13px]" style={{ color: "var(--text-2)" }}>
            One-glance summary for pitch decks and diligence conversations.
            Manually curated fields (NPS, notable users) are editable inline.
          </p>
        </div>
        <button
          onClick={load}
          className="btn-ghost text-[11px] uppercase tracking-wider inline-flex items-center gap-2"
          data-testid="pitch-metrics-refresh"
        >
          <RefreshCcw size={12} /> Refresh
        </button>
      </div>

      {/* Row 1 — six auto-computed big stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3" data-testid="pitch-primary-row">
        <PitchStat label="Registered users"         value={data.registered_users}          tone="lime"    testid="pitch-registered-users" />
        <PitchStat label="Projects created"         value={data.projects_created}          tone="violet"  testid="pitch-projects-created" />
        <PitchStat label="Work tools connected"     value={data.sources_connected}         tone="coral"   testid="pitch-sources-connected" />
        <PitchStat label="Client accept rate"       value={data.client_accept_rate}  unit="%" tone="emerald" testid="pitch-accept-rate" />
        <PitchStat label="Weekly active users"      value={data.weekly_active_users}       tone="sky"     testid="pitch-wau" />
        <PitchStat label="4-week retention"         value={data.retention_4w}        unit="%" tone="pink"    testid="pitch-retention" />
      </div>

      {/* Row 1a — connect-tools: work sources + project memory (core loop) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mt-3" data-testid="pitch-connect-row">
        <PitchStat label="Memory captured"          value={data.memory_items_extracted}    tone="violet"  testid="pitch-memory-items" sub="items extracted" />
        <PitchStat label="Projects connected"       value={data.pct_projects_connected} unit="%" tone="emerald" testid="pitch-projects-connected-pct" sub="≥1 source" />
        <PitchStat label="Sources / project"        value={data.avg_sources_per_project}   tone="sky"     testid="pitch-avg-sources" />
        <PitchStat label="Memory / project"         value={data.avg_memory_per_project}    tone="coral"   testid="pitch-avg-memory" />
        <PitchStat label="Projects with a source"   value={data.projects_with_source}      tone="lime"    testid="pitch-projects-with-source" />
      </div>

      {/* Row 1b — product signals (activation + engagement + returning) */}
      <ProductSignalsRow ps={data.product_signals} />

      {/* Row 2 — three interactive/qualitative cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3" data-testid="pitch-secondary-row">
        <NpsCard
          nps={data.nps}
          source={data.nps_source}
          responsesCount={data.nps_responses_count || 0}
          onEdit={() => setEditing(true)}
          onSend={sendSurvey}
          sending={sending}
          cooldownSeconds={cooldownSec}
        />
        <OrganicPaidBar {...data.organic_paid_split} />
        <NotableUsersCard items={data.notable_users || []} onEdit={() => setEditing(true)} />
      </div>

      <PitchConfigModal
        open={editing}
        initial={{ nps: data.nps, notable_users: data.notable_users }}
        onClose={() => setEditing(false)}
        onSave={() => { setEditing(false); load(); }}
      />
    </section>
  );
}

// ---- Main page ------------------------------------------------------------
export default function AdminAnalytics() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const { data: d } = await api.get("/admin/analytics");
      setData(d);
    } catch (e) {
      setError(formatApiError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const scatterPrepped = useMemo(
    () => bucketAndJitter(data?.cycle_time_points || []),
    [data],
  );

  if (loading) {
    return (
      <div
        className="flex items-center gap-2 mt-8 text-[13px]"
        style={{ color: "var(--text-3)" }}
        data-testid="analytics-loading"
      >
        <Loader2 size={14} className="animate-spin" /> Loading analytics…
      </div>
    );
  }
  if (error) {
    return (
      <p className="text-[13px] mt-8" style={{ color: "var(--danger, #EF4444)" }} data-testid="analytics-error">
        {error}
      </p>
    );
  }
  if (!data) return null;

  const { kpis, new_users_daily, projects_daily, status_distribution, step_funnel, top_users, share_funnel, activity_heatmap, acquisition, activation, engagement, business, ph_launch } = data;

  const gridProps = { strokeDasharray: "3 3", stroke: COLORS.grid, vertical: false };
  const axisProps = {
    stroke: COLORS.axis,
    tick: { fill: COLORS.axisLabel, fontSize: 10, fontFamily: "'Geist', sans-serif" },
    tickLine: false,
    axisLine: false,
  };

  return (
    <div className="space-y-6" data-testid="admin-analytics">
      {/* Prominent pitch-metrics snapshot — investor headline numbers. */}
      <PitchMetricsBoard />

      {/* Divider */}
      <div style={{ borderTop: "1px solid var(--hairline)" }} />

      {/* NPS deep view — campaigns, histogram, responses, cooldown */}
      <NpsDetailPanel />

      {/* Divider */}
      <div style={{ borderTop: "1px solid var(--hairline)" }} />

      {/* Website analytics — traffic, geo, heatmap with time-range filter */}
      <WebsiteAnalyticsPanel />

      {/* Divider */}
      <div style={{ borderTop: "1px solid var(--hairline)" }} />

      {/* Publish log — release history + before/after comparison */}
      <PublishLogPanel />

      {/* Divider */}
      <div style={{ borderTop: "1px solid var(--hairline)" }} />

      {/* Header row */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-wider" style={{ color: "var(--text-3)" }}>
            Live snapshot · updated {new Date(data.generated_at).toLocaleTimeString()}
          </p>
        </div>
        <button
          onClick={load}
          className="btn-ghost text-[11px] uppercase tracking-wider inline-flex items-center gap-2"
          data-testid="analytics-refresh"
        >
          <RefreshCcw size={12} /> Refresh
        </button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3" data-testid="analytics-kpis">
        <Kpi label="Total users"     value={kpis.total_users}       tone="lime"    testid="kpi-total-users" />
        <Kpi label="New · 7d"        value={kpis.new_users_7d}      tone="violet"  testid="kpi-new-users" />
        <Kpi label="Total projects"  value={kpis.total_projects}    tone="coral"   testid="kpi-total-projects" />
        <Kpi label="Locked"          value={kpis.locked_projects}   tone="emerald" testid="kpi-locked" />
        <Kpi label="Accept rate"     value={kpis.share_accept_rate} unit="%" tone="sky" testid="kpi-accept-rate" />
        <Kpi label="Avg steps"       value={kpis.avg_steps}         unit="/5" tone="pink" testid="kpi-avg-steps" />
      </div>

      {/* ============ PRODUCT HUNT LAUNCH OFFER ============ */}
      <SectionHead
        label="Launch offer"
        title="Product Hunt — first project free"
        subtitle={
          ph_launch?.enabled
            ? "The 14-day free trial is currently LIVE. Claims and paid conversions below update in real time."
            : "The launch offer is currently OFF. These lifetime totals reflect everyone who ever claimed the trial."
        }
      />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="ph-launch-kpis">
        <Kpi label="Trials claimed"  value={ph_launch?.claimed ?? 0}      tone="coral"   testid="kpi-ph-claimed" />
        <Kpi label="On trial now"    value={ph_launch?.active ?? 0}       tone="violet"  testid="kpi-ph-active" />
        <Kpi label="Converted to paid" value={ph_launch?.converted ?? 0}  tone="emerald" testid="kpi-ph-converted" />
        <Kpi label="Conversion rate" value={ph_launch?.conversion_rate ?? 0} unit="%" tone="lime" testid="kpi-ph-conversion" />
      </div>


      {/* Row 1: two line/area charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card
          title="New users"
          subtitle="Signups per day · last 30 days"
          testid="chart-new-users"
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={new_users_daily.map((d) => ({ ...d, label: shortDate(d.date) }))} margin={{ top: 6, right: 8, bottom: 0, left: -16 }}>
              <defs>
                <linearGradient id="gradUsers" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLORS.accent} stopOpacity={0.55} />
                  <stop offset="100%" stopColor={COLORS.accent} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="label" {...axisProps} interval={4} />
              <YAxis {...axisProps} allowDecimals={false} />
              <Tooltip content={<CustomTooltip />} cursor={{ stroke: COLORS.accent, strokeOpacity: 0.35 }} />
              <Area
                type="monotone"
                dataKey="count"
                stroke={COLORS.accent}
                strokeWidth={2}
                fill="url(#gradUsers)"
                dot={false}
                name="Users"
              />
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        <Card
          title="Projects created"
          subtitle="New projects per day · last 30 days"
          testid="chart-projects-created"
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={projects_daily.map((d) => ({ ...d, label: shortDate(d.date) }))} margin={{ top: 6, right: 8, bottom: 0, left: -16 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="label" {...axisProps} interval={4} />
              <YAxis {...axisProps} allowDecimals={false} />
              <Tooltip content={<CustomTooltip />} cursor={{ stroke: COLORS.accent2, strokeOpacity: 0.35 }} />
              <Line
                type="monotone"
                dataKey="count"
                stroke={COLORS.accent2}
                strokeWidth={2}
                dot={{ r: 2.5, stroke: COLORS.accent2, strokeWidth: 1, fill: COLORS.cardBg }}
                name="Projects"
              />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Row 2: status donut + step funnel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card title="Projects by status" subtitle="Distribution" testid="chart-status">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={status_distribution}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={55}
                outerRadius={90}
                paddingAngle={2}
                stroke={COLORS.cardBg}
                strokeWidth={2}
              >
                {status_distribution.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
          <div className="mt-2 flex flex-wrap gap-3">
            {status_distribution.map((s, i) => (
              <div key={s.name} className="flex items-center gap-1.5 text-[11px]" style={{ color: "var(--text-2)" }}>
                <span
                  className="inline-block rounded-full"
                  style={{ width: 8, height: 8, background: PIE_COLORS[i % PIE_COLORS.length] }}
                />
                {s.name} · {s.value}
              </div>
            ))}
          </div>
        </Card>

        <Card title="Step drop-off" subtitle="Projects that reached each step" testid="chart-step-funnel" className="lg:col-span-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={step_funnel} margin={{ top: 6, right: 8, bottom: 0, left: -16 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="step" {...axisProps} />
              <YAxis {...axisProps} allowDecimals={false} />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: COLORS.grid, fillOpacity: 0.4 }} />
              <Bar dataKey="count" radius={[4, 4, 0, 0]} fill={COLORS.accent} name="Projects" />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Row 3: cycle time scatter (full width) */}
      <Card title="Cycle time by user" subtitle="Days from project creation → locked (for locked projects only)" height={340} testid="chart-cycle-time">
        {scatterPrepped.series.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[12px]" style={{ color: "var(--text-3)" }}>
            No locked projects yet.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 12, right: 12, bottom: 24, left: 0 }}>
              <CartesianGrid {...gridProps} vertical />
              <XAxis
                type="number"
                dataKey="x"
                domain={[0, scatterPrepped.xTicks.length]}
                ticks={scatterPrepped.xTicks}
                tickFormatter={(v) => {
                  const idx = Math.floor(v);
                  const label = scatterPrepped.xLabels?.[idx] || "";
                  // truncate long emails
                  return label.length > 14 ? label.slice(0, 12) + "…" : label;
                }}
                stroke={COLORS.axis}
                tick={{ fill: COLORS.axisLabel, fontSize: 10, fontFamily: "'Geist', sans-serif" }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                type="number"
                dataKey="y"
                {...axisProps}
                name="days"
                unit="d"
              />
              <ZAxis type="number" range={[40, 40]} />
              <Tooltip content={<ScatterTooltip />} />
              {scatterPrepped.series.map((s) => (
                <Scatter key={s.user} data={s.data} fill={s.color} fillOpacity={0.85} />
              ))}
            </ScatterChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* Row 4: top users + share funnel */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card title="Top users" subtitle="By project count" height={300} testid="chart-top-users">
          {top_users.length === 0 ? (
            <div className="flex items-center justify-center h-full text-[12px]" style={{ color: "var(--text-3)" }}>
              No users yet.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart layout="vertical" data={top_users.map((u) => ({ ...u, label: (u.email || u.name || "").length > 24 ? (u.email || u.name).slice(0, 22) + "…" : (u.email || u.name) }))} margin={{ top: 6, right: 12, bottom: 0, left: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} horizontal={false} />
                <XAxis type="number" {...axisProps} allowDecimals={false} />
                <YAxis type="category" dataKey="label" {...axisProps} width={140} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: COLORS.grid, fillOpacity: 0.4 }} />
                <Bar dataKey="projects" radius={[0, 4, 4, 0]} fill={COLORS.accent} name="Projects" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card title="Share review funnel" subtitle="Client review outcomes" height={300} testid="chart-share-funnel">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={share_funnel} margin={{ top: 6, right: 8, bottom: 0, left: -16 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="stage" {...axisProps} />
              <YAxis {...axisProps} allowDecimals={false} />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: COLORS.grid, fillOpacity: 0.4 }} />
              <Bar dataKey="count" radius={[4, 4, 0, 0]} name="Count">
                {share_funnel.map((entry, i) => {
                  const map = { Shared: COLORS.accent, Reviewed: COLORS.accent2, Accepted: COLORS.positive, Rejected: COLORS.danger };
                  return <Cell key={i} fill={map[entry.stage] || COLORS.accent} />;
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Row 5: heatmap full width */}
      <Card title="Activity heatmap" subtitle="Projects created by hour × weekday · last 90 days" height={200} testid="chart-heatmap">
        <Heatmap data={activity_heatmap} />
      </Card>

      {/* ============ ACQUISITION ============ */}
      <SectionHead
        label="Acquisition"
        title="Where they came from"
        subtitle={acquisition?.total_sessions ? `${acquisition.total_sessions.toLocaleString()} sessions tracked · ${acquisition.utms_captured.toLocaleString()} with UTM params` : "UTM capture just went live — numbers below will fill in as visitors land."}
      />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="acquisition-kpis">
        <Kpi label="Sessions"      value={acquisition?.total_sessions ?? 0}  tone="sky"     testid="kpi-sessions" />
        <Kpi label="With UTM"      value={acquisition?.utms_captured ?? 0}   tone="lime"    testid="kpi-utms" />
        <Kpi label="Top source"    value={acquisition?.top_sources?.[0]?.source || "—"} tone="violet" testid="kpi-top-source" />
        <Kpi label="Top campaign"  value={acquisition?.top_campaigns?.[0]?.campaign || "—"} tone="coral" testid="kpi-top-campaign" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5" data-testid="acquisition-lists">
        <Card title="Traffic source" subtitle="Sessions by attributed source" height={230}>
          <ListRows rows={acquisition?.top_sources || []} labelKey="source" valueKey="count" empty="No sessions tracked yet." />
        </Card>
        <Card title="Referrers" subtitle="Where the click came from" height={230}>
          <ListRows rows={acquisition?.top_referrers || []} labelKey="referrer" valueKey="count" empty="No referrer data yet." shorten />
        </Card>
        <Card title="Campaigns" subtitle="UTM campaigns" height={230}>
          <ListRows rows={acquisition?.top_campaigns || []} labelKey="campaign" valueKey="count" empty="No UTM campaigns yet." />
        </Card>
      </div>

      {/* ============ ACTIVATION ============ */}
      <SectionHead
        label="Activation"
        title="The five events that matter"
        subtitle="Mapped to Bracket's real events, not vanity steps."
      />
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3" data-testid="activation-kpis">
        <Kpi label="Started project"    value={activation?.started ?? 0}    tone="lime"    testid="kpi-act-started" />
        <Kpi label="Added description"  value={activation?.context ?? 0}    tone="sky"     testid="kpi-act-context" />
        <Kpi label="Uploaded first screen" value={activation?.decision ?? 0} tone="violet" testid="kpi-act-decision" />
        <Kpi label="Published project"  value={activation?.published ?? 0}  tone="emerald" testid="kpi-act-published" />
        <Kpi label="Shared project"     value={activation?.shared ?? 0}     tone="pink"    testid="kpi-act-shared" />
      </div>

      {/* ============ ENGAGEMENT ============ */}
      <SectionHead
        label="Engagement"
        title="Are they coming back?"
        subtitle="Returning-user cohorts by last-seen. Session duration proxy: create → last edit."
      />
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3" data-testid="engagement-kpis">
        <Kpi label="Returning · 1d"  value={engagement?.returning_1d ?? 0}  tone="coral"   testid="kpi-ret-1d" />
        <Kpi label="Returning · 7d"  value={engagement?.returning_7d ?? 0}  tone="lavender" testid="kpi-ret-7d" />
        <Kpi label="Returning · 30d" value={engagement?.returning_30d ?? 0} tone="peach"   testid="kpi-ret-30d" />
        <Kpi label="Projects / user" value={engagement?.projects_per_user ?? 0} tone="sky" testid="kpi-projects-per-user" />
        <Kpi label="Avg edit span"   value={engagement?.avg_edit_span_days ?? 0} unit="d" tone="lime" testid="kpi-avg-edit-span" />
      </div>

      {/* ============ BUSINESS (placeholder) ============ */}
      <SectionHead
        label="Business"
        title="Coming when paid launches"
        subtitle="These tiles will fill in when downloads and purchases go live. Numbers you see today are honest proxies from the current data model."
      />
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3" data-testid="business-kpis">
        <Kpi label="Total published" value={business?.total_published ?? 0} tone="emerald" testid="kpi-biz-published" />
        <Kpi label="Downloads"       value={business?.downloads ?? 0}       tone="ghost"   testid="kpi-biz-downloads" />
        <Kpi label="Purchases"       value={business?.purchases ?? 0}       tone="ghost"   testid="kpi-biz-purchases" />
        <Kpi label="Revenue"         value={business?.revenue ?? 0}         unit="₹" tone="ghost" testid="kpi-biz-revenue" />
        <Kpi label="Top categories"  value={(business?.top_categories?.length ?? 0) || "—"} tone="ghost" testid="kpi-biz-categories" />
        <Kpi label="Repeat creators" value={business?.repeat_creators ?? 0} tone="lime"    testid="kpi-biz-repeat" />
      </div>
      <Card title="Top creators" subtitle="By project count · proxy for creator leaderboard" height={220} testid="business-top-creators">
        <ListRows
          rows={(business?.top_creators || []).map((c) => ({ label: c.name && c.name !== "—" ? c.name : c.email, count: c.projects }))}
          labelKey="label"
          valueKey="count"
          empty="No creators yet."
        />
      </Card>
    </div>
  );
}

// ---- Simple two-column list helper ----------------------------------------
function ListRows({ rows, labelKey, valueKey, empty = "No data", shorten = false }) {
  if (!rows || rows.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-[12px]" style={{ color: "var(--text-3)" }}>
        {empty}
      </div>
    );
  }
  return (
    <ul className="space-y-1.5">
      {rows.map((r, i) => {
        const label = String(r[labelKey] ?? "");
        const value = r[valueKey];
        const shownLabel = shorten && label.length > 34 ? label.slice(0, 32) + "…" : label;
        return (
          <li key={i} className="flex items-center justify-between gap-3 py-1 border-b border-[var(--hairline)] last:border-b-0">
            <span className="text-[13px] truncate" style={{ color: "var(--text)" }}>{shownLabel}</span>
            <span className="text-[13px] font-mono" style={{ color: "var(--text-2)" }}>{typeof value === "number" ? value.toLocaleString() : value}</span>
          </li>
        );
      })}
    </ul>
  );
}
