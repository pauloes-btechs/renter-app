import { ButtonLink, Card, PageHeader } from "@/components/ui";
import { isDemoEnabled } from "@/lib/server/session";

export const metadata = { title: "Sign in" };
export default function SignIn() {
  return (
    <div className="mx-auto max-w-lg fade-in">
      <PageHeader title="Open your personal link" />
      <Card className="space-y-4 p-6 text-ink-700">
        <p>Roomsplit doesn&apos;t use passwords. Each traveler signs in with their own private link — from the invitation you joined with, or the personal link on your party page.</p>
        <p className="text-sm text-ink-500">Lost it? Ask your organizer for a fresh invitation, or open your personal link on a device where you&apos;re still signed in and generate a new one.</p>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href="/">Home</ButtonLink>
          {isDemoEnabled() && <ButtonLink href="/demo" variant="secondary">Demo personas</ButtonLink>}
        </div>
      </Card>
    </div>
  );
}
