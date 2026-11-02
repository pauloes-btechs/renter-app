import Link from "next/link";
import { HouseArt, RoomArt } from "@/components/RoomArt";
import { ButtonLink, Card } from "@/components/ui";
import { isDemoEnabled } from "@/lib/server/session";

export default function Welcome() {
  const demo = isDemoEnabled();
  return (
    <div className="fade-in">
      <section className="grid items-center gap-10 py-6 lg:grid-cols-[1.05fr_1fr] lg:py-12">
        <div>
          <div className="mb-4 text-xs font-semibold uppercase tracking-[0.16em] text-pine-600">Group stays, settled fairly</div>
          <h1 className="font-display text-4xl leading-[1.08] text-ink-900 sm:text-6xl">Who gets which bedroom — and what everyone pays.</h1>
          <p className="mt-5 max-w-xl text-lg text-ink-500">
            Roomsplit collects each party&apos;s budget and room preferences, finds the fairest assignment, and splits the rental to the exact cent. Every number is
            explained; nobody pays more just because they could.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            {demo && (
              <ButtonLink href="/demo" className="!px-6 !py-3 !text-base">
                Explore Demo
              </ButtonLink>
            )}
            <ButtonLink href="/create" variant="secondary" className="!px-6 !py-3 !text-base">
              Start a group
            </ButtonLink>
          </div>
          {demo && <p className="mt-3 text-sm text-ink-400">The demo is a 4-bedroom, $4,200 house shared by four parties — switch between all seven travelers&apos; views.</p>}
        </div>
        <div className="overflow-hidden rounded-3xl border border-sand-200 bg-white shadow-lift">
          <HouseArt className="block h-auto w-full" />
          <div className="grid grid-cols-4 gap-px bg-sand-200">
            {(["master", "view", "comfort", "bunk"] as const).map((k) => (
              <div key={k} className="bg-white">
                <RoomArt kind={k} className="block aspect-[16/10] w-full" />
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mt-12 grid gap-4 md:grid-cols-3">
        {[
          { n: "1", t: "Invite each party", b: "Couples share one party and one room. Everyone gets their own secure link — no accounts or passwords." },
          { n: "2", t: "Collect preferences", b: "A two-minute questionnaire: budget, sleeping needs, what matters most, and how you rank the rooms." },
          { n: "3", t: "Agree on a fair split", b: "Compare balanced, budget-first and preference-first plans — or run a room auction — then vote and finalize." },
        ].map((s) => (
          <Card key={s.n} className="p-6">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-pine-50 font-display text-pine-700">{s.n}</div>
            <div className="mt-4 font-display text-xl">{s.t}</div>
            <p className="mt-2 text-sm text-ink-500">{s.b}</p>
          </Card>
        ))}
      </section>

      <section className="mt-12 grid gap-6 lg:grid-cols-2">
        <Card className="p-6 sm:p-8">
          <div className="font-display text-2xl">The math, in one line</div>
          <p className="mt-2 text-ink-500">A share of the rent covers the whole house and is split per traveler; the rest follows the bedroom each party gets.</p>
          <pre className="mt-4 overflow-x-auto rounded-xl bg-sand-50 p-4 text-sm text-ink-700">
            {`Party cost = people × (Shared ÷ travelers)
           + Private × room weight ÷ Σ occupied weights`}
          </pre>
          <p className="mt-3 text-sm text-ink-500">Integer cents, largest-remainder rounding — totals always reconcile exactly.</p>
        </Card>
        <Card className="p-6 sm:p-8">
          <div className="font-display text-2xl">Or let demand set the price</div>
          <p className="mt-2 text-ink-500">
            Switch on the room auction: parties submit sealed bids, rooms go where they&apos;re valued most, and envy-free prices reveal what each room is really worth.
          </p>
          <div className="mt-4 flex flex-wrap gap-2 text-sm">
            <Link href={demo ? "/demo" : "/create"} className="font-medium text-pine-600 underline-offset-4 hover:underline">
              See it in the demo →
            </Link>
          </div>
        </Card>
      </section>
    </div>
  );
}
