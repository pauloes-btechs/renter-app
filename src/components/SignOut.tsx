"use client";
import { useRouter } from "next/navigation";
import { signOutAction } from "@/app/actions";

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="rounded-full px-2 py-2 text-xs text-ink-500 hover:bg-sand-200/60 hover:text-ink-900"
      onClick={async () => {
        await signOutAction();
        router.push("/");
        router.refresh();
      }}
    >
      Sign out
    </button>
  );
}
