"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { castVoteAction } from "@/app/actions";
import { Badge, Card, btn } from "./ui";

export function VotePanel({ groupId, proposalId, current, canVote, open, repName }: { groupId: string; proposalId: string; current: { decision: string; comment: string } | null; canVote: boolean; open: boolean; repName: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "changes">("idle");
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const vote = (decision: "approve" | "request_changes") =>
    start(async () => {
      setError(null);
      const r = await castVoteAction(groupId, { proposalId, decision, comment: decision === "approve" ? comment : comment });
      if (!r.ok) setError(r.error);
      else {
        setMode("idle");
        setComment("");
        router.refresh();
      }
    });
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium">Your party&apos;s decision</div>
        {current ? current.decision === "approve" ? <Badge tone="ok">Approved</Badge> : <Badge tone="warn">Changes requested</Badge> : <Badge>Not voted</Badge>}
      </div>
      {!open ? (
        <p className="mt-2 text-sm text-ink-500">Voting opens once the organizer publishes a proposal.</p>
      ) : !canVote ? (
        <p className="mt-2 text-sm text-ink-500">{repName} votes for your party. You can add thoughts in the discussion.</p>
      ) : mode === "changes" ? (
        <div className="mt-3 space-y-2">
          <label className="block text-sm">
            What would you like changed?
            <textarea className="mt-1 w-full rounded-xl border border-sand-300 p-3 text-sm" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} data-testid="changes-comment" />
          </label>
          <div className="flex gap-2">
            <button className={btn.secondary} onClick={() => setMode("idle")}>Cancel</button>
            <button className={btn.primary} disabled={pending || !comment.trim()} onClick={() => vote("request_changes")} data-testid="submit-changes">Send request</button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <button className={btn.primary} disabled={pending || current?.decision === "approve"} onClick={() => vote("approve")} data-testid="approve">
            {pending ? "Saving…" : current?.decision === "approve" ? "Approved ✓" : "Approve this plan"}
          </button>
          <button className={btn.secondary} disabled={pending} onClick={() => setMode("changes")} data-testid="request-changes">Request changes</button>
        </div>
      )}
      {current?.comment && <p className="mt-3 rounded-lg bg-sand-50 p-3 text-sm text-ink-700">“{current.comment}”</p>}
      {error && <p role="alert" className="mt-2 text-sm text-bad-500">{error}</p>}
    </Card>
  );
}
