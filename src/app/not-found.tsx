import { ButtonLink } from "@/components/ui";
export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg py-20 text-center">
      <div className="font-display text-3xl">Nothing here — or not for you</div>
      <p className="mt-3 text-ink-500">This page doesn&apos;t exist, or you aren&apos;t signed in as someone who can see it. If a friend invited you, open the link they shared.</p>
      <div className="mt-6 flex justify-center gap-2">
        <ButtonLink href="/">Home</ButtonLink>
        <ButtonLink href="/trips" variant="secondary">My trips</ButtonLink>
      </div>
    </div>
  );
}
