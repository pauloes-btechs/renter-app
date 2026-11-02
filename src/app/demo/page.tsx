import { notFound } from "next/navigation";
import { Avatar, Badge, Card, Notice, PageHeader, btn } from "@/components/ui";
import { CopyButton, ActionButton } from "@/components/client";
import { demoPersonas, findDemoGroup, seedDemo } from "@/lib/demo/seed";
import { demoAllowed } from "@/lib/server/demoGate";
import { getViewer } from "@/lib/server/session";
import { STATUS_LABELS } from "@/lib/server/repo";
import { resetDemoAction } from "@/app/actions";

export const metadata = { title: "Demo personas" };
export default async function DemoPage({ searchParams }: { searchParams: Promise<{ key?: string; reset?: string }> }) {
  const sp = await searchParams;
  const gate = await demoAllowed(sp.key);
  if (gate === "disabled") notFound();
  if (gate === "locked")
    return (
      <div className="mx-auto max-w-lg"><Notice tone="warn" title="Demo is protected">Open this page with the demo access key (?key=…) provided by the deployer.</Notice></div>
    );
  if (!findDemoGroup()) seedDemo();
  const g = findDemoGroup()!;
  const personas = demoPersonas();
  const viewer = await getViewer();
  const keyQ = sp.key ? `?key=${encodeURIComponent(sp.key)}` : "";
  return (
    <div className="fade-in">
      <PageHeader
        eyebrow="Developer preview"
        title="Switch perspectives"
        subtitle="Each persona is a real user with their own session and permissions. Open personas in separate browsers or private windows to watch live updates as votes and changes land."
        actions={<ActionButton action={resetDemoAction} variant="secondary" confirm="Reset all demo data?">Reset demo data</ActionButton>}
      />
      {sp.reset && <Notice className="mb-6" title="Demo reset">The demo group was re-seeded from the fixture.</Notice>}
      <Card className="mb-6 flex flex-wrap items-center gap-4 p-5">
        <div className="min-w-0 flex-1">
          <div className="font-display text-xl">{g.name}</div>
          <div className="text-sm text-ink-500">The Shared Vacation House · $4,200 · 4 parties · 6 travelers</div>
        </div>
        <Badge tone="pine">{STATUS_LABELS[g.status]}</Badge>
      </Card>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {personas.map((p) => {
          const href = `/demo/as/${p.key}${keyQ}`;
          const active = viewer?.id === p.userId;
          return (
            <Card key={p.key} className={"flex flex-col p-5 " + (active ? "ring-2 ring-pine-500" : "")}>
              <div className="flex items-center gap-3">
                <Avatar name={p.name} size={40} />
                <div className="min-w-0">
                  <div className="text-xs font-semibold uppercase tracking-wide text-pine-600">{p.label}</div>
                  <div className="truncate font-medium">{p.name}</div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Badge>{p.role}</Badge>
                {p.partyName && <Badge tone="pine">{p.partyName}</Badge>}
                {active && <Badge tone="ok">Current session</Badge>}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <a href={href} className={btn.primary + " !px-4 !py-2"} data-testid={`persona-${p.key}`}>
                  View as {p.name.split(" ")[0]}
                </a>
                <CopyButton text={href} label="Copy link for another browser" />
              </div>
            </Card>
          );
        })}
      </div>
      <p className="mt-8 text-sm text-ink-400">
        Persona switching is available only when demo mode is enabled (development, or <code>DEMO_MODE=true</code>, optionally gated by <code>DEMO_ACCESS_KEY</code>). It only ever signs in as seeded demo users.
      </p>
    </div>
  );
}
