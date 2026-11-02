"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addCommentAction } from "@/app/actions";
import { btn } from "@/components/ui";

export function CommentBox({ groupId }: { groupId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await addCommentAction(groupId, body);
          if (!r.ok) setError(r.error);
          else { setBody(""); setError(null); router.refresh(); }
        });
      }}
    >
      <label className="sr-only" htmlFor="comment">Add a comment</label>
      <textarea id="comment" rows={3} className="w-full rounded-xl border border-sand-300 p-3 text-sm" placeholder="Share feedback or an objection…" value={body} onChange={(e) => setBody(e.target.value)} />
      {error && <p role="alert" className="text-sm text-bad-500">{error}</p>}
      <div className="mt-2 flex justify-end"><button className={btn.primary} disabled={pending || !body.trim()}>Post</button></div>
    </form>
  );
}
