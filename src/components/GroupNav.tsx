import Link from "next/link";
import type { GroupView } from "@/lib/server/views";
import { LiveRefresh } from "./client";
import { Badge, cx } from "./ui";
import { STATUS_ORDER, STATUS_LABELS } from "@/lib/server/repo";

export function GroupNav({ view, active }: { view: GroupView; active: string }) {
  const g = view.group;
  const tabs: { key: string; label: string; href: string; show: boolean }[] = [
    { key: "overview", label: view.isOrganizer ? "Dashboard" : "Group", href: `/group/${g.id}`, show: true },
    { key: "party", label: "My party", href: view.myParty ? `/party/${view.myParty.id}` : "#", show: !!view.myParty },
    { key: "property", label: "Property", href: `/group/${g.id}/property`, show: true },
    { key: "invites", label: "Invitations", href: `/group/${g.id}/invites`, show: view.isOrganizer },
    { key: "results", label: "Results", href: `/results/${g.id}`, show: true },
    { key: "compare", label: "Compare", href: `/results/${g.id}/compare`, show: view.proposals.length > 0 },
    { key: "pricing", label: "Pricing", href: `/results/${g.id}/pricing`, show: true },
    { key: "market", label: "Market", href: `/results/${g.id}/market`, show: view.pricing.method !== "weighted" },
    { key: "discussion", label: "Discussion", href: `/results/${g.id}/discussion`, show: true },
    { key: "agreement", label: "Agreement", href: `/results/${g.id}/agreement`, show: g.status === "finalized" },
  ];
  const idx = STATUS_ORDER.indexOf(g.status);
  return (
    <div className="no-print mb-8">
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        <span className="font-display text-lg text-ink-900">{g.name}</span>
        <Badge tone={g.status === "finalized" ? "ok" : g.status === "approved" ? "ok" : "pine"}>{STATUS_LABELS[g.status]}</Badge>
        {g.isDemo && <Badge tone="clay">Demo</Badge>}
        <span className="ml-auto">
          <LiveRefresh groupId={g.id} version={g.version} />
        </span>
      </div>
      <ol className="mb-4 hidden gap-1 sm:flex" aria-label="Group progress">
        {STATUS_ORDER.map((s, i) => (
          <li key={s} className="flex-1">
            <div className={cx("h-1 rounded-full", i <= idx ? "bg-pine-500" : "bg-sand-200")} />
            <div className={cx("mt-1 text-[11px]", i === idx ? "font-semibold text-pine-700" : "text-ink-400")}>{STATUS_LABELS[s]}</div>
          </li>
        ))}
      </ol>
      <nav className="-mx-4 overflow-x-auto px-4" aria-label="Group sections">
        <ul className="flex min-w-max gap-1 border-b border-sand-200">
          {tabs
            .filter((t) => t.show)
            .map((t) => (
              <li key={t.key}>
                <Link
                  href={t.href}
                  aria-current={active === t.key ? "page" : undefined}
                  className={cx(
                    "-mb-px inline-block border-b-2 px-3 py-2.5 text-sm",
                    active === t.key ? "border-pine-600 font-medium text-ink-900" : "border-transparent text-ink-500 hover:text-ink-900",
                  )}
                >
                  {t.label}
                </Link>
              </li>
            ))}
        </ul>
      </nav>
    </div>
  );
}
