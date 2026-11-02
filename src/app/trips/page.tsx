import Link from "next/link";
import { Badge, ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { STATUS_LABELS } from "@/lib/server/repo";
import { requireViewer } from "@/lib/server/session";
import { listMyGroups } from "@/lib/server/views";

export const metadata = { title: "My trips" };
export default async function Trips() {
  const v = await requireViewer("/trips");
  const groups = listMyGroups(v.id);
  return (
    <div className="fade-in">
      <PageHeader title="My trips" subtitle={`Signed in as ${v.display_name}`} actions={<ButtonLink href="/create">Start a group</ButtonLink>} />
      {groups.length === 0 ? (
        <EmptyState title="No trips yet" body="Start a group, or open an invitation link from a friend." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {groups.map((g) => (
            <Link key={g.id} href={`/group/${g.id}`}>
              <Card className="p-5 transition hover:shadow-lift">
                <div className="font-display text-xl">{g.name}</div>
                <div className="mt-2"><Badge tone="pine">{STATUS_LABELS[g.status]}</Badge></div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
