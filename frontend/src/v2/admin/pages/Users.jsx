import React, { useEffect, useState } from "react";
import { useNavigate, useOutletContext, useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { toast } from "sonner";
import { cn } from "../../../lib/utils";
import { useResource, formatApiError } from "../../lib/data";
import { useIsMobile } from "../../lib/useMedia";
import { Avatar, Badge, Banner, Button, Input, NativeSelect, SkeletonRows } from "../../ui/primitives";
import { Page, Stagger, StaggerItem, motion, t as T } from "../../ui/motion";
import { admin } from "../api";
import { downloadCsv } from "../AdminApp";
import { ago, fmtMoney, fmtNum, shortDate } from "../ui";

/* Admin › Users — Figma 207:193 */
export const STATUS_TONE = { trial: "info", paying: "success", past_due: "warning", canceled: "neutral", expired: "neutral", suspended: "danger" };
const FILTERS = [["all", "All"], ["trial", "Trial"], ["paying", "Paying"], ["past_due", "Past due"], ["canceled", "Canceled"], ["expired", "Expired"], ["suspended", "Suspended"]];
const SORTS = [["last_active", "Sort: Last active"], ["signed_up", "Sort: Newest"], ["projects", "Sort: Most projects"], ["name", "Sort: Name"]];
const SIZE = 25;

export function PlanBadge({ u }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge tone={STATUS_TONE[u.status] || "neutral"} dot>{u.plan_label}</Badge>
      {u.trial_day && <span className="text-body-s text-fg-tertiary">day {u.trial_day}</span>}
    </span>
  );
}
const mrr = (u) => (u.mrr ? `${fmtMoney(u.mrr.amount, u.mrr.currency)}${u.mrr.one_time ? " once" : ""}` : "—");

export default function Users() {
  const { setExport } = useOutletContext();
  const navigate = useNavigate();
  const mobile = useIsMobile();
  const [params, setParams] = useSearchParams();
  const status = params.get("status") || "all";
  const sort = params.get("sort") || "last_active";
  const page = Number(params.get("page") || 1);
  const [q, setQ] = useState(params.get("q") || "");
  const [debounced, setDebounced] = useState(q);
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const set = (patch) => {
    const n = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v == null || v === "" || (k === "status" && v === "all") || (k === "page" && v === 1) ? n.delete(k) : n.set(k, v)));
    setParams(n, { replace: true });
  };
  useEffect(() => { if ((params.get("q") || "") !== debounced) set({ q: debounced, page: 1 }); }, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data, error, reload } = useResource(() => admin.users({ q: debounced, status, sort, page, size: SIZE }), [debounced, status, sort, page]);

  useEffect(() => {
    setExport(async () => {
      try {
        const all = await admin.users({ q: debounced, status, sort, export: 1 });
        downloadCsv("bracket-users", [
          ["id", "name", "email", "company", "status", "plan", "projects", "sources", "last_active", "signed_up", "mrr", "currency", "from_sandbox"],
          ...all.users.map((u) => [u.id, u.name, u.email, u.company, u.status, u.plan_label, u.projects, u.sources.join(" "), u.last_active_at, u.created_at, u.mrr?.amount ?? "", u.mrr?.currency ?? "", u.from_sandbox ? "yes" : "no"]),
        ]);
      } catch (e) { toast.error(formatApiError(e)); }
    });
  }, [debounced, status, sort]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = data?.total ?? 0;
  const from = total ? (page - 1) * SIZE + 1 : 0;
  const to = Math.min(total, page * SIZE);
  const open = (u) => navigate(`/admin/users/${u.id}`);

  return (
    <Page className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-[320px]">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-tertiary" />
          <Input type="search" aria-label="Search users" placeholder="Search name, email or company" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
        </div>
        <div role="tablist" aria-label="Filter by status" className="-mx-1 flex max-w-full gap-1 overflow-x-auto px-1">
          {FILTERS.map(([k, l]) => {
            const on = status === k;
            return (
              <button key={k} role="tab" aria-selected={on} onClick={() => set({ status: k, page: 1 })}
                className={cn("relative flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-body-s font-medium transition-colors", on ? "text-fg" : "text-fg-secondary hover:text-fg")}>
                {on && <motion.span layoutId="user-filter" className="absolute inset-0 rounded-md border border-line bg-raised" transition={T.base} />}
                <span className="relative">{l}</span>
                <span className="relative font-mono text-[12px] text-fg-tertiary">{data ? fmtNum(data.counts[k]) : ""}</span>
              </button>
            );
          })}
        </div>
        <span className="hidden flex-1 lg:block" />
        <NativeSelect aria-label="Sort users" value={sort} onChange={(e) => set({ sort: e.target.value, page: 1 })} className="w-auto">
          {SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </NativeSelect>
      </div>

      {error && !data && <Banner tone="danger" title="Couldn’t load users" action={<Button size="s" onClick={reload}>Try again</Button>}>{formatApiError(error)}</Banner>}
      {!data && !error && <SkeletonRows rows={8} />}

      {data && (mobile ? (
        <Stagger as="ul" key={`${status}-${page}-${debounced}`} className="overflow-hidden rounded-lg border border-line-subtle bg-surface">
          {data.users.length === 0 && <li className="p-6 text-center text-body-s text-fg-tertiary">No users match.</li>}
          {data.users.map((u) => (
            <StaggerItem as="li" key={u.id} className="border-b border-line-subtle last:border-b-0">
              <button onClick={() => open(u)} className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-hover">
                <Avatar name={u.name} size="s" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body-m text-fg">{u.name}</span>
                  <span className="block truncate text-body-s text-fg-tertiary">{u.email}</span>
                  <span className="mt-1 flex items-center gap-2"><PlanBadge u={u} /><span className="font-mono text-[12px] text-fg-tertiary">{ago(u.last_active_at)}</span></span>
                </span>
                <ChevronRight size={16} className="text-fg-tertiary" />
              </button>
            </StaggerItem>
          ))}
        </Stagger>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line-subtle bg-surface">
          <table className="w-full min-w-[900px] text-left">
            <thead className="bg-raised">
              <tr>
                {["User", "Plan", "Projects", "Sources", "Last active", "Signed up", "MRR", ""].map((h, i) => <th key={i} className="eyebrow px-4 py-2.5 font-semibold">{h}</th>)}
              </tr>
            </thead>
            <Stagger as="tbody" key={`${status}-${page}-${debounced}-${sort}`} step={0.015}>
              {data.users.length === 0 && <tr><td colSpan={8} className="p-8 text-center text-body-s text-fg-tertiary">No users match those filters.</td></tr>}
              {data.users.map((u) => (
                <StaggerItem as="tr" key={u.id} tabIndex={0} onClick={() => open(u)} onKeyDown={(e) => e.key === "Enter" && open(u)}
                  className="cursor-pointer border-t border-line-subtle transition-colors hover:bg-hover focus-visible:bg-hover focus-visible:outline-none">
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-2.5"><Avatar name={u.name} size="s" />
                      <span className="min-w-0"><span className="block truncate text-body-m text-fg">{u.name}</span><span className="block truncate text-body-s text-fg-tertiary">{u.email}</span></span>
                    </span>
                  </td>
                  <td className="px-4 py-2.5"><PlanBadge u={u} /></td>
                  <td className="px-4 py-2.5 text-body-m text-fg">{u.projects}</td>
                  <td className="px-4 py-2.5 text-body-m text-fg">{u.sources.length ? u.sources.map((s) => s[0].toUpperCase() + s.slice(1)).join(" ") : "—"}</td>
                  <td className="px-4 py-2.5 font-mono text-[12px] text-fg-secondary">{ago(u.last_active_at)}</td>
                  <td className="px-4 py-2.5 font-mono text-[12px] text-fg-secondary">{shortDate(u.created_at)}</td>
                  <td className="px-4 py-2.5 font-mono text-[12px] text-fg">{mrr(u)}</td>
                  <td className="w-8 pr-4"><ChevronRight size={16} className="text-fg-tertiary" /></td>
                </StaggerItem>
              ))}
            </Stagger>
          </table>
        </div>
      ))}

      {data && total > 0 && (
        <div className="flex items-center gap-2">
          <p className="flex-1 text-body-s text-fg-tertiary">{fmtNum(from)}–{fmtNum(to)} of {fmtNum(total)} users</p>
          <Button size="s" variant="ghost" icon={ChevronLeft} disabled={page <= 1} onClick={() => set({ page: page - 1 })}>Previous</Button>
          <Button size="s" variant="secondary" iconRight={ChevronRight} disabled={to >= total} onClick={() => set({ page: page + 1 })}>Next</Button>
        </div>
      )}
    </Page>
  );
}
