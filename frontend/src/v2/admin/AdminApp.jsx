import React, { lazy, useCallback, useEffect, useMemo, useState } from "react";
import { NavLink, Navigate, Outlet, Route, useLocation, useNavigate } from "react-router-dom";
import { Download, Eye, LayoutGrid, Layers, Lock, Menu as MenuIcon, Plug, User, X } from "lucide-react";
import { cn } from "../../lib/utils";
import { Logo } from "../shell/Logo";
import { Seo } from "../shell/Seo";
import { FullScreenLoader } from "../shell/Guards";
import { Avatar, Badge, Button, IconButton, NativeSelect } from "../ui/primitives";
import { AnimatePresence, motion, t as T } from "../ui/motion";
import { useMedia } from "../lib/useMedia";
import { admin, onSessionChange, sessionExpiry } from "./api";

/* Admin panel — owner only. Figma › 13 Admin panel.
   /admin/login is the only public route; everything else sits behind an
   admin session (separate from product accounts) and signs out when it ends. */
const SignIn = lazy(() => import("./SignIn"));
const Overview = lazy(() => import("./pages/Overview"));
const Users = lazy(() => import("./pages/Users"));
const UserDetail = lazy(() => import("./pages/UserDetail"));
const Revenue = lazy(() => import("./pages/Revenue"));
const Usage = lazy(() => import("./pages/Usage"));
const SandboxStats = lazy(() => import("./pages/SandboxStats"));

export function AdminRoutes() {
  return (
    <>
      <Route path="/admin/login" element={<SignIn />} />
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<Overview />} />
        <Route path="users" element={<Users />} />
        <Route path="users/:uid" element={<UserDetail />} />
        <Route path="revenue" element={<Revenue />} />
        <Route path="usage" element={<Usage />} />
        <Route path="sandbox" element={<SandboxStats />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Route>
    </>
  );
}

const NAV = [
  { to: "/admin", label: "Overview", icon: LayoutGrid, end: true, filters: ["range", "currency"] },
  { to: "/admin/users", label: "Users", icon: User, filters: [] },
  { to: "/admin/revenue", label: "Revenue", icon: Layers, filters: ["range", "currency"] },
  { to: "/admin/usage", label: "Usage & health", icon: Plug, filters: ["range"] },
  { to: "/admin/sandbox", label: "Sandbox", icon: Eye, filters: ["range"] },
];
const navFor = (path) => [...NAV].reverse().find((n) => (n.end ? path === n.to : path.startsWith(n.to))) || NAV[0];
const RANGES = [[7, "Last 7 days"], [30, "Last 30 days"], [90, "Last 90 days"], [365, "Last 12 months"]];

const read = (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } };

function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const wide = useMedia("(min-width: 1024px)");
  const [session, setSession] = useState(undefined); // undefined = checking, null = none
  const [drawer, setDrawer] = useState(false);
  const [range, setRange] = useState(() => Number(read("bk.admin.range", "30")));
  const [currency, setCurrency] = useState(() => read("bk.admin.currency", "usd"));
  const [updatedAt, setUpdatedAt] = useState(null);
  const [exporter, setExporter] = useState(null);
  const [, tick] = useState(0);

  useEffect(() => {
    let off = false;
    admin.session().then((s) => !off && setSession(s)).catch(() => !off && setSession(null));
    return () => { off = true; };
  }, []);
  useEffect(() => {
    const out = () => navigate(`/admin/login?expired=1&next=${encodeURIComponent(location.pathname)}`, { replace: true });
    window.addEventListener("bk:admin-signed-out", out);
    return () => window.removeEventListener("bk:admin-signed-out", out);
  }, [navigate, location.pathname]);
  useEffect(() => onSessionChange(() => tick((n) => n + 1)), []);
  useEffect(() => { const i = setInterval(() => tick((n) => n + 1), 30e3); return () => clearInterval(i); }, []);
  useEffect(() => { setDrawer(false); setExporter(null); }, [location.pathname]);

  const ctx = useMemo(() => ({
    range, currency, setUpdatedAt,
    setExport: (fn) => setExporter(() => fn),
  }), [range, currency]);
  const signOut = useCallback(async () => {
    try { await admin.logout(); } catch { /* signing out anyway */ }
    navigate("/admin/login", { replace: true });
  }, [navigate]);

  if (session === undefined) return <FullScreenLoader label="Checking admin session" />;
  if (session === null) return <Navigate to={`/admin/login?next=${encodeURIComponent(location.pathname)}`} replace />;

  const nav = navFor(location.pathname);
  const exp = sessionExpiry() || (session.expires_at && Date.parse(session.expires_at));
  const minsLeft = exp ? Math.max(0, Math.ceil((exp - Date.now()) / 60e3)) : null;
  const sidebar = (
    <aside className="flex h-full w-[240px] flex-col border-r border-line-subtle bg-sidebar px-3 pb-3 pt-4">
      <div className="flex items-center gap-2 pb-5 pl-1.5">
        <Logo to="/admin" />
        <Badge>Admin</Badge>
        {!wide && <IconButton icon={X} label="Close navigation" className="ml-auto" onClick={() => setDrawer(false)} />}
      </div>
      <nav aria-label="Admin" className="space-y-0.5">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end}
            className={({ isActive }) => cn("relative flex h-8 items-center gap-2.5 rounded-md px-2 text-body-m transition-colors duration-fast", isActive ? "text-fg" : "text-fg-secondary hover:bg-hover hover:text-fg")}>
            {({ isActive }) => (
              <>
                {isActive && <motion.span layoutId="admin-nav" className="absolute inset-0 rounded-md bg-selected" transition={T.base} />}
                <n.icon size={16} strokeWidth={1.75} className="relative" />
                <span className="relative">{n.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="flex-1" />
      <div className="space-y-2 rounded-lg border border-line-subtle p-2.5">
        <div className="flex items-center gap-2"><Avatar name={session.username} size="s" /><span className="truncate text-body-s font-medium text-fg">{session.username}</span></div>
        <p className="flex items-center gap-1.5 text-body-s text-fg-tertiary"><Lock size={14} /> {minsLeft != null ? `Session ends in ${minsLeft} min` : "Signed in"}</p>
        <Button size="s" variant="secondary" className="w-full" onClick={signOut}>Sign out</Button>
      </div>
    </aside>
  );

  return (
    <div className="bk flex h-[100dvh] bg-app">
      <Seo title="Admin" />
      {wide && sidebar}
      <AnimatePresence>
        {!wide && drawer && (
          <motion.div className="fixed inset-0 z-40 flex" role="dialog" aria-modal="true" aria-label="Admin navigation" initial="closed" animate="open" exit="closed">
            <motion.div variants={{ open: { x: 0 }, closed: { x: "-100%" } }} transition={T.base} className="h-full shadow-overlay">{sidebar}</motion.div>
            <motion.button variants={{ open: { opacity: 1 }, closed: { opacity: 0 } }} transition={T.base} className="flex-1 bg-overlay" aria-label="Close navigation" onClick={() => setDrawer(false)} />
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-16 shrink-0 flex-wrap items-center gap-x-2 gap-y-2 border-b border-line-subtle px-4 py-3 md:px-8">
          {!wide && <IconButton icon={MenuIcon} label="Open navigation" onClick={() => setDrawer(true)} />}
          <h1 className="text-title-l text-fg">{nav.label}</h1>
          {updatedAt && <span className="hidden text-body-s text-fg-tertiary sm:inline">Updated {Math.max(0, Math.round((Date.now() - updatedAt) / 60e3)) || "just now"}{Math.round((Date.now() - updatedAt) / 60e3) ? " min ago" : ""}</span>}
          <span className="flex-1" />
          {nav.filters.includes("range") && (
            <NativeSelect aria-label="Date range" value={range} onChange={(e) => { setRange(Number(e.target.value)); write("bk.admin.range", e.target.value); }} className="w-auto">
              {RANGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </NativeSelect>
          )}
          {nav.filters.includes("currency") && (
            <div role="radiogroup" aria-label="Currency" className="inline-flex gap-0.5 rounded-md border border-line p-0.5">
              {["usd", "inr"].map((c) => (
                <button key={c} role="radio" aria-checked={currency === c} onClick={() => { setCurrency(c); write("bk.admin.currency", c); }}
                  className={cn("relative rounded px-2.5 py-1 text-body-s font-medium uppercase transition-colors", currency === c ? "text-fg" : "text-fg-tertiary hover:text-fg")}>
                  {currency === c && <motion.span layoutId="admin-cur" className="absolute inset-0 rounded bg-raised" transition={T.base} />}
                  <span className="relative">{c}</span>
                </button>
              ))}
            </div>
          )}
          {exporter && <Button size="s" variant="ghost" icon={Download} onClick={exporter}>Export CSV</Button>}
        </header>
        <main className="scroll-pane min-h-0 flex-1 px-4 pb-10 pt-6 md:px-8">
          <Outlet context={ctx} />
        </main>
      </div>
    </div>
  );
}

/* CSV download — values are quoted; formulas are neutralised so a name like
   "=HYPERLINK(…)" can't run when the file is opened in a spreadsheet. */
export function downloadCsv(name, rows) {
  const cell = (v) => {
    let s = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const csv = rows.map((r) => r.map(cell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
