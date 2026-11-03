# Roomsplit

Fair room allocation and cost sharing for group vacation rentals. Parties submit their budgets and room preferences. Roomsplit finds the fairest bedroom assignment, splits the rent to the exact cent, explains every number, and walks the group through comparing options, voting, and signing off on a final agreement. You can also use an **optional sealed-bid room auction** so the bids themselves set room prices.

## Quick start

Requires Node.js 20.9+ (tested on Node 22).

```bash
npm install
npm run seed      # optional: creates the demo group (otherwise it's created on first visit to /demo)
npm run dev       # http://localhost:3000  → "Explore Demo"
```

Production-style run on your own machine:

```bash
npm install        # after every pull — picks up dependency updates
npm run build
DEMO_MODE=true npm start   # DEMO_MODE=true keeps the persona switcher / Explore Demo available
```

Without `APP_SECRET`, a local `npm start` generates one in `data/.secret` and prints a warning. On Vercel, `APP_SECRET` is required.

| Env var | Default | Purpose |
|---|---|---|
| `DATABASE_PATH` | `./data/roomsplit.db` | SQLite file |
| `APP_SECRET` | auto-generated `data/.secret` on a single machine | HMAC key for token hashing, AES key for stored invite links. **Required on Vercel / multi-instance hosts.** |
| `DEMO_MODE` | on in dev, off in production | `true` enables the persona switcher in production; `false` disables it everywhere |
| `DEMO_ACCESS_KEY` | unset | If set, `/demo` requires `?key=<value>` |
| `GEMINI_API_KEY` | unset | Enables photo analysis for listing import (free tier at aistudio.google.com) |
| `GEMINI_MODEL` | `gemini-flash-latest` | Gemini model for listing import |
| `ANTHROPIC_API_KEY` | unset | Alternative analyzer (Claude) |
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` | Vision model used for listing import |
| `LISTING_ANALYZER` | unset | Force `gemini`, `claude` or `mock` (offline, for tests/demos) |

## Deploying to Vercel (demo)

1. Import the GitHub repo into Vercel. The framework is auto-detected, and `engines.node` pins Node 22.
2. Set these environment variables: `DEMO_MODE=true` and `APP_SECRET=<long random string>`. Optionally set `DEMO_ACCESS_KEY` to protect `/demo`.
3. Deploy, then open `/demo`.

> Note: on Vercel, SQLite runs in `/tmp`, which is temporary. Data can reset when a server instance restarts, and separate instances don't share data. That's fine for a demo, but not for real groups. For production, move the data layer to a hosted Postgres database such as Supabase or Neon (see "Design decisions"), or run on a host with a persistent disk such as Railway, Render or Fly.io, with `DATABASE_PATH` pointing at a mounted volume.

## Tests

```bash
npm test            # 82 unit + integration tests (engine, auction, services, authorization, concurrency)
npm run test:e2e    # Playwright: multi-browser journeys, mobile + desktop screenshots → e2e/screenshots/
npm run typecheck
```

The end-to-end tests run against a production build (`npm run build` first) on port 3200 with an isolated database.

## Demo

Open **/demo**. The seeded group *Big Sur, June 2027* is The Shared Vacation House: $4,200, 4 bedrooms, 4 parties, 6 travelers. It is created by calling the real services (invitations, joins, questionnaires, the optimizer, and votes), so nothing about it is hard-coded. It starts in **Voting** with 2 of 4 approvals.

| Party | People | Max budget | Recommended room | Cost |
|---|---:|---:|---|---:|
| A — Maya & Jordan | 2 | $1,500 | Master Suite | $1,409.77 |
| B — Priya & Sam | 2 | $1,300 | View Room | $1,233.95 |
| C — Lena | 1 | $1,000 | Comfort Room | $924.65 |
| D — Theo | 1 | $700 | Twin/Bunk Room | $631.63 |

There are seven personas. Maya is both the organizer and Party A's member 1. Each persona's link signs you in as that user with only that user's permissions. Open the links in separate browsers or private windows to see live updates (the pages poll for changes every 3 seconds). Use **Reset demo data** to re-seed.

## Architecture

```
src/lib/engine/        pure, deterministic, fully unit-tested (no I/O)
  money.ts             integer-cent largest-remainder apportionment (BigInt)
  pricing.ts           shared / private pools → party charges, previews
  scoring.ts           hard constraints, fit / affordability / satisfaction, strategy weights
  optimizer.ts         AssignmentOptimizer interface; Exhaustive + LocalSearch; proposals; infeasibility diagnosis
  auction.ts           sealed-bid auction: welfare-max assignment + envy-free prices (Bellman-Ford)
  explain.ts           facts vs. judgments; budget facts kept private per party
src/lib/domain/        questionnaire schema (Zod), mapping to engine inputs, diffs between members
src/lib/db/            SQLite schema + migrations (better-sqlite3, WAL, foreign keys)
src/lib/server/
  services/            all mutations: auth, groups, parties/invites, questionnaire, allocation/voting
  views.ts             per-viewer read model (authorization + privacy filtering in one place)
  session.ts, page.ts  cookie sessions; pages 404 unless the viewer is the organizer or a member
src/app/               Next.js App Router pages + server actions (actions.ts)
src/lib/ingestion/     property-source abstraction (manual today; listing URL recorded, never scraped)
```

**Data model.** User, Session, AccessLink, Property, PropertyCostItem, Room, RoomAmenity, Stay, Group, PricingConfiguration, Party, PartyMembership, Invitation, Questionnaire (each member's draft), PartyPreferences (the party's finalized answers), ProposalVersion (a snapshot of the inputs plus their hash), AllocationProposal, RoomAssignment, CostBreakdown, Vote, Comment, Agreement, LedgerEntry, ActivityEvent.

**Group lifecycle.** `draft → collecting → ready → proposed → voting → approved → finalized`. Any material change invalidates the current proposal version and clears every live vote. Material changes are: total cost, shared %, pricing method, a room or its weight, membership (join / leave / remove), or a party's submitted preferences. Drafts autosave without invalidating anything. Finalizing writes an Agreement and one `owed` LedgerEntry per party. No payment is processed; the ledger is designed so a payment provider can be added later.

## Pricing methodology

```
SharedPool   = T × s                      (default s = 40%)
PrivatePool  = T − SharedPool
SharedCostPerPerson = SharedPool / N      (N = travelers across all parties)
RoomCost(r)  = PrivatePool × w[r] / Σ w[occupied rooms]
PartyCost(p) = n[p] × SharedCostPerPerson + RoomCost(room(p))
```

- All money is integer cents. Fractions are stored as basis points and weights as thousandths, so the arithmetic is exact.
- Each split (the two pools, per traveler, per occupied room, per member) uses **largest-remainder apportionment** with index tie-breaks. Charges always sum to exactly `T`, and `priceAssignment` throws if they ever don't.
- Unoccupied rooms cost nothing. With fewer parties, the private pool is spread only over the rooms in use.
- Budgets never affect price. They only decide what is affordable and how well a room fits a party.

## Assignment methodology

1. **Hard constraints** are never violated: room capacity, separate sleeping surfaces, no bunks, accessibility, refused rooms, hard maximum budgets, and one room per party.
2. **Per-party scores**, all on a 0–1 scale and normalized per party rather than per person:
   - `fit = 0.55·rank + 0.45·priority-match`, where a party's top-3 priorities are boosted ×1.6, ×1.35 and ×1.15
   - `afford` = 1 up to the ideal budget, then declining linearly toward the maximum (the decline is softened by stated flexibility and by willingness to pay a premium for a first choice)
   - `satisfaction = 0.65·fit + 0.35·afford`
   - `envy` = how much a party would gain by taking another party's room at the price it would pay there.
3. **Strategies:**
   - *Balanced* (recommended): 0.40 min-satisfaction + 0.30 mean + 0.15 affordability + 0.15 envy-freeness
   - *Budget-conscious*: emphasizes minimum and mean affordability plus budget headroom
   - *Preference-first*: emphasizes mean and minimum room fit
4. **Proposals:** each strategy's winner is shown. When several strategies pick the same assignment, that is shown as an overlap rather than inventing a different answer. If fewer than three distinct plans exist, the next-best feasible alternatives fill the gap. Ties are broken by a stable assignment key, so identical inputs always give identical rankings.
5. **Engines:** exhaustive enumeration with static pruning is used up to 8! = 40,320 assignments. Beyond that, a deterministic local search (swaps and moves) takes over, behind the same `AssignmentOptimizer` interface. A mixed-integer or CP-SAT solver can be added the same way.
6. **No feasible plan:** you get a diagnosis instead. It names parties with no workable room, applies Hall's-condition checks for groups of parties competing for too few rooms, flags hard budgets below the lowest possible price, and suggests concrete fixes.

## Starting a group from a listing link

**Create group** starts with the rental listing. Paste its link and Roomsplit fills in the rest for the organizer to review:
- property name, location and description
- dates
- the cost breakdown (nightly × nights, cleaning, service fees, taxes), always adding up to the listing's stated total
- currency
- shared amenities
- every bedroom, with photos

It also sets the number of parties to the number of bedrooms.

- **Sites that allow automated reading:** the link alone is enough. The server checks `robots.txt` for our user agent, fetches the page, and reads its title, description, JSON-LD and text. It downloads up to 12 photos, resized with `sharp`. It only connects to public addresses: http(s), standard ports, no private IPs, every redirect re-checked, plus timeouts and size limits (`src/lib/ingestion/fetchListing.ts`).
- **Airbnb, Vrbo, Booking.com, Expedia and similar:** these are never fetched, because their terms prohibit automated access. The link step asks the organizer to select-all and copy the listing page (⌘A, ⌘C), paste it, and add the bedroom photos. Extraction then works exactly the same way.
- **Abuse protection:** the create-flow endpoint (`/api/listing/analyze`) is rate-limited per client (`LISTING_ANALYZE_PER_HOUR`, default 12, counted separately on each server instance).

## Listing import on an existing group (photos → bedrooms)

On **Property → Import from listing**, the organizer pastes the listing link, adds the listing's photos (drag and drop, file picker, or pasted screenshots, up to 16), and copies in the "Where you'll sleep" and "What this place offers" sections.

Roomsplit doesn't fetch Airbnb or Vrbo pages itself, because their terms prohibit automated access. The organizer supplies the content from their own browser session.

1. **Photos are compressed in the browser.** Each one is downscaled to 1024 px before upload.
2. **A vision model reads the photos and text.** This is Google Gemini, set with `GEMINI_API_KEY` (a free key from Google AI Studio; optional `GEMINI_MODEL`, default `gemini-flash-latest`), or Claude, set with `ANTHROPIC_API_KEY` (optional `ANTHROPIC_MODEL`). If both keys are set, Gemini is used. Note that Google may use free-tier inputs to improve its products, so avoid putting sensitive material through a free-tier key. It groups the photos into bedrooms. For each room it returns:
   - beds and their sizes
   - relative room size
   - ensuite bathroom
   - walk-in closet
   - view quality, plus a ranking of views across rooms
   - other room-specific features

   It returns these as structured data through a forced tool call.
3. **A deterministic mapper turns that into editable room drafts** (`src/lib/ingestion/analysis.ts`, unit-tested). It derives:
   - capacity
   - number of sleeping surfaces
   - bunks
   - the matching attributes used for scoring
   - a suggested pricing weight (averaging 1.00)
   - a "Best view in the house" tag for the room with the top view

   **Property-wide amenities (air conditioning, heating, Wi-Fi, fans, linens, …) are applied to every room and never used to tell rooms apart.** This holds even if the model lists one of them under a specific room.
4. **The organizer reviews every room and applies.** They can edit names, beds, sleeping capacity, weights, ensuite and closet before applying. Applying replaces the bedrooms and stores each room's cover photo. It also invalidates any proposal and reopens submitted questionnaires so parties re-rank the new rooms; their other answers are kept.

For tests and offline demos, set `LISTING_ANALYZER=mock` to get an analysis built from the pasted text without a network call.

## Room auction (price discovery)

The organizer chooses a pricing method under **Property → Pricing model**:

- **Weighted** (default): fixed weights only.
- **Weighted + auction comparison**: the auction result appears as an extra "Market auction" proposal.
- **Auction-led**: the auction proposal is recommended.

How the auction works:

1. Each party privately bids the most it would pay, as a party total, for every room it would accept. Hard constraints still apply.
2. **Allocation:** rooms go to the arrangement with the highest combined bids, found by exhaustive search with a deterministic tie-break.
3. **Prices are envy-free.** For a party in room *r* and any room *r′* it bid on, `bid(r) − P(r) ≥ bid(r′) − P(r′)`. These conditions are difference constraints, solved with Bellman-Ford and each price capped at the occupant's bid. The result is lowered uniformly until prices sum to `T`. This choice maximizes the smallest surplus (bid minus price) among all envy-free price sets. A welfare-maximizing assignment always has envy-free prices.
4. **When the auction doesn't clear:** if the bids don't cover the rent, or a clearing price exceeds a hard budget, the auction reports why and the weighted proposals still stand.
5. **Market page:** shows bid counts, the clearing price compared with the weighted price (market premium or discount), and the weights implied by the clearing prices. The organizer can **apply market weights** so the weighted model reflects this group's demand.
6. **Bid privacy:** raw bids are private. Other parties see only bid counts and clearing prices. The organizer sees the top and second bid per room, with no names attached.

## Security & privacy

- Sessions are random tokens stored as HMAC hashes in httpOnly SameSite cookies.
- Invitations are revocable, expiring and optionally use-limited. They are stored hashed, plus AES-GCM encrypted so the organizer can copy them again later.
- Personal sign-in links can be rotated; rotating revokes the older ones.
- Every mutation is authorized server-side in the service layer:
  - only the organizer can change pricing, rooms and invitations
  - only a party's own members can read or edit its questionnaire
  - only the party's representative submits the questionnaire and votes
- Group pages return 404 to non-members, so no data leaks across groups.
- Joins and votes run in `BEGIN IMMEDIATE` transactions backed by partial unique indexes: one active party per user per group, and one live vote per party per proposal. This makes party caps and concurrent votes race-safe.
- Budgets and bids are visible only to the party itself. The organizer sees only whether each party is within its maximum.
- The demo persona switcher works only in demo mode, can be gated by a key, and can sign in only as seeded `is_demo` users.

## Design decisions & assumptions

- **SQLite instead of Postgres** for a zero-setup, runnable demo. The schema uses portable SQL (TEXT ids, integer money, partial indexes). To move to Postgres or Supabase, port `src/lib/db/schema.ts` to migrations, swap `client.ts` for a `pg` pool, and add RLS policies that mirror `views.ts`.
- **No passwords.** Identity comes from invitation and personal links, which matches how groups share trips. Email magic links or OAuth can slot into `services/auth.ts`.
- **Live updates** use a cheap version counter polled every 3 seconds. This could be replaced with SSE or Supabase Realtime later.
- **Who votes:** the party representative votes. Other members can comment. A second member's questionnaire draft is shown to the representative, who resolves the differences before submitting.
- **Master-suite bed size and the twin/bunk setup** are editable room attributes.
- **PDF export:** the agreement page has print-optimized CSS, so "Print / save as PDF" in the browser produces the PDF.

## Future scaling

- Multiple properties and bookings per organizer. The data model already separates Property, Stay and Group.
- Listing import through an official partner API or owner export, implementing `PropertySource`, with organizer review of the imported bedrooms and fees.
- A solver-backed optimizer for large houses or cohorts. Other room-pricing mechanisms (for example Spliddit-style lexicographic maximin) could also be added behind the same interfaces.
- Payment collection from `ledger_entries`.
