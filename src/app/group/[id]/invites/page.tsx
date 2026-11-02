import { notFound } from "next/navigation";
import { GroupNav } from "@/components/GroupNav";
import { ActionButton, CopyButton } from "@/components/client";
import { Avatar, Badge, Card, EmptyState, PageHeader, SectionTitle } from "@/components/ui";
import { addPartySlotAction, createInvitationAction, removePartyAction, revokeInvitationAction, setRepresentativeAction } from "@/app/actions";
import { loadView } from "@/lib/server/page";
import { listInvitations } from "@/lib/server/services/parties";

export const metadata = { title: "Invitations" };
export default async function InvitesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { viewer, view } = await loadView(id, `/group/${id}/invites`);
  if (!view.isOrganizer) notFound();
  const invites = listInvitations(viewer.id, id);
  const general = invites.filter((i) => !i.party_id && i.active);
  const locked = view.group.status === "finalized";
  return (
    <div className="fade-in">
      <GroupNav view={view} active="invites" />
      <PageHeader
        eyebrow="Invitations"
        title="Parties & invitations"
        subtitle={`Each party gets one bedroom and up to ${view.group.maxPartySize} people. Send each party its own link, or share one general link where people choose their party.`}
        actions={!locked && view.parties.length < view.group.maxParties ? <ActionButton action={addPartySlotAction.bind(null, id)} variant="secondary">+ Add party slot</ActionButton> : undefined}
      />

      <Card className="mb-6 p-6">
        <SectionTitle>General invitation link</SectionTitle>
        <p className="mb-3 text-sm text-ink-500">Anyone with this link can join a party that still has room. Revoke it any time.</p>
        {general.length ? (
          general.map((i) => (
            <div key={i.id} className="flex flex-wrap items-center gap-2">
              <code className="max-w-full truncate rounded-lg bg-sand-50 px-3 py-2 text-xs" data-testid="general-link">/join/{i.token}</code>
              <CopyButton text={`/join/${i.token}`} />
              <ActionButton action={revokeInvitationAction.bind(null, id, i.id)} variant="small" confirm="Revoke this link?">Revoke</ActionButton>
            </div>
          ))
        ) : (
          <ActionButton action={createInvitationAction.bind(null, id, null, "General link")} variant="secondary" disabled={locked}>Create general link</ActionButton>
        )}
      </Card>

      {view.parties.length === 0 ? (
        <EmptyState title="No party slots" body="Add a slot for each party sharing the house." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {view.parties.map((p) => {
            const links = invites.filter((i) => i.party_id === p.id);
            const active = links.filter((l) => l.active);
            const full = p.members.length >= view.group.maxPartySize;
            return (
              <Card key={p.id} className="p-5" as="section">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-pine-600">{p.slot}</div>
                    <div className="font-display text-xl">{p.name}</div>
                  </div>
                  <div className="flex gap-1.5">
                    <Badge>{p.members.length}/{view.group.maxPartySize} joined</Badge>
                    {p.submitted ? <Badge tone="ok">Submitted</Badge> : <Badge>Not submitted</Badge>}
                  </div>
                </div>
                <ul className="mt-4 space-y-2">
                  {p.members.map((m) => (
                    <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-sand-50 px-3 py-2">
                      <span className="flex items-center gap-2 text-sm"><Avatar name={m.name} size={26} />{m.name}{m.id === viewer.id && <span className="text-xs text-ink-400">(you)</span>}</span>
                      {m.role === "representative" ? <Badge tone="pine">Representative</Badge> : !locked && <ActionButton action={setRepresentativeAction.bind(null, p.id, m.id)} variant="small">Make representative</ActionButton>}
                    </li>
                  ))}
                  {p.members.length === 0 && <li className="text-sm text-ink-400">Nobody has joined yet.</li>}
                </ul>
                <div className="mt-4 space-y-2">
                  {active.map((l) => (
                    <div key={l.id} className="flex flex-wrap items-center gap-2">
                      <code className="max-w-[16rem] truncate rounded-lg bg-sand-50 px-3 py-1.5 text-xs" data-testid={`invite-${p.slot}`}>/join/{l.token}</code>
                      <CopyButton text={`/join/${l.token}`} />
                      <ActionButton action={revokeInvitationAction.bind(null, id, l.id)} variant="small" confirm="Revoke?">Revoke</ActionButton>
                      <span className="text-xs text-ink-400">expires {new Date(l.expires_at).toLocaleDateString()} · used {l.uses}×</span>
                    </div>
                  ))}
                  {links.length > active.length && <div className="text-xs text-ink-400">{links.length - active.length} revoked or expired link(s)</div>}
                </div>
                {!locked && (
                  <div className="mt-4 flex flex-wrap gap-2 border-t border-sand-100 pt-4">
                    {!full && <ActionButton action={createInvitationAction.bind(null, id, p.id, p.slot)} variant="small" testId={`create-invite-${p.slot}`}>{active.length ? "New link" : "Create invite link"}</ActionButton>}
                    <ActionButton action={removePartyAction.bind(null, id, p.id)} variant="small" confirm={`Remove ${p.name} from the trip?`}>Remove party</ActionButton>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
