"use client";
import { useState, useTransition } from "react";
import { rotateAccessLinkAction } from "@/app/actions";
import { Card, btn } from "./ui";
import { CopyButton } from "./client";

/** Generates a private sign-in link for another device. Rotating revokes older links. */
export function PersonalLink() {
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Card className="p-5">
      <div className="font-medium">Your private sign-in link</div>
      <p className="mt-1 text-sm text-ink-500">Use it to open Roomsplit as yourself on another device. Don&apos;t share it — anyone with it can act as you. Generating a new one revokes the old one.</p>
      {link && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <code className="max-w-full truncate rounded-lg bg-sand-50 px-3 py-2 text-xs">{typeof window !== "undefined" ? window.location.origin : ""}{link}</code>
          <CopyButton text={link} />
        </div>
      )}
      {error && <p className="mt-2 text-sm text-bad-500">{error}</p>}
      <button
        type="button"
        className={btn.small + " mt-3"}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await rotateAccessLinkAction();
            if (r.ok && r.data) setLink(`/access/${r.data.token}`);
            else if (!r.ok) setError(r.error);
          })
        }
      >
        {pending ? "Generating…" : link ? "Generate a new link" : "Get my private link"}
      </button>
    </Card>
  );
}
