"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { joinAction } from "@/app/actions";
import { btn } from "@/components/ui";
import { field, labelCls } from "@/app/create/form";

export function JoinForm({ token, defaultName, parties }: { token: string; defaultName: string; parties: { id: string; label: string }[] | null }) {
  const router = useRouter();
  const [name, setName] = useState(defaultName);
  const [partyId, setPartyId] = useState(parties?.[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const r = await joinAction(token, { displayName: name, partyId: parties ? partyId : undefined });
          if (!r.ok) setError(r.error);
          else if (r.redirect) router.push(r.redirect);
        });
      }}
    >
      <label className="block">
        <span className={labelCls}>Your name, as the group will see it</span>
        <input required maxLength={40} className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Jordan Reyes" name="displayName" />
      </label>
      {parties && (
        <label className="block">
          <span className={labelCls}>Your party</span>
          {parties.length === 0 ? (
            <p className="mt-1 text-sm text-bad-500">All parties are full. Ask the organizer to add a slot.</p>
          ) : (
            <select className={field} value={partyId} onChange={(e) => setPartyId(e.target.value)}>
              {parties.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          )}
        </label>
      )}
      {error && <p role="alert" className="text-sm text-bad-500">{error}</p>}
      <button type="submit" className={btn.primary + " w-full"} disabled={pending || (!!parties && parties.length === 0)} data-testid="join-submit">
        {pending ? "Joining…" : "Join the group"}
      </button>
      <p className="text-xs text-ink-400">No password needed — this device stays signed in. You&apos;ll get a private link to sign in elsewhere.</p>
    </form>
  );
}
