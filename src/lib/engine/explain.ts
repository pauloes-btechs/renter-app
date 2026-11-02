import { formatMoney, formatBps } from "./money";
import type { EvaluatedAssignment, Proposal } from "./optimizer";
import { PRIORITY_LABELS, type PartyInput, type PricingConfig, type RoomInput } from "./types";
import { STRATEGY_DESCRIPTIONS } from "./scoring";

export interface PartyExplanation {
  partyId: string;
  headline: string;
  /** Mathematical facts that anyone can verify. */
  facts: string[];
  /** Budget-related facts — shown only to the party itself (budgets are private). */
  privateFacts: string[];
  /** Subjective fairness judgments produced by the scoring model. */
  judgments: string[];
  tradeoffs: string[];
}

export interface ProposalExplanation {
  summary: string;
  facts: string[];
  judgments: string[];
  comparison: string[];
  parties: PartyExplanation[];
}

const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

export function explainProposal(
  proposal: Proposal,
  all: Proposal[],
  parties: PartyInput[],
  rooms: RoomInput[],
  config: PricingConfig,
  currency = "USD",
): ProposalExplanation {
  const ev = proposal.evaluation;
  const roomName = (id: string) => rooms.find((r) => r.id === id)?.name ?? id;
  const partyName = (id: string) => parties.find((p) => p.id === id)?.name ?? id;
  const m = (c: number) => formatMoney(c, currency);
  const pr = ev.pricing;

  const partyEx: PartyExplanation[] = ev.parties.map((pe) => {
    const party = parties.find((p) => p.id === pe.partyId)!;
    const room = rooms.find((r) => r.id === pe.roomId)!;
    const charge = pr.charges.find((c) => c.partyId === pe.partyId)!;
    const facts: string[] = [];
    const privateFacts: string[] = [];
    const judgments: string[] = [];
    const tradeoffs: string[] = [];

    facts.push(
      `${party.size} traveler${party.size > 1 ? "s" : ""} × ${m(pr.sharedPerPersonCents)} shared = ${m(charge.sharedCents)}` +
        (charge.sharedCents !== pr.sharedPerPersonCents * party.size ? " (includes a rounding cent)" : ""),
    );
    facts.push(
      `${room.name} bedroom share: ${(room.weightMilli / 1000).toFixed(2)} of ${(pr.occupiedWeightMilli / 1000).toFixed(2)} occupied weight × ${m(
        pr.privatePoolCents,
      )} = ${m(charge.roomCents)}`,
    );
    facts.push(`Total ${m(charge.totalCents)} — ${formatBps(charge.shareBps)} of the rental`);
    if (pe.costCents <= party.budget.idealCents) privateFacts.push(`${m(party.budget.idealCents - pe.costCents)} under the ideal budget`);
    else if (pe.costCents <= party.budget.maxCents)
      privateFacts.push(`${m(pe.costCents - party.budget.idealCents)} over ideal, ${m(party.budget.maxCents - pe.costCents)} under maximum`);
    else privateFacts.push(`${m(pe.costCents - party.budget.maxCents)} over the (flexible) maximum budget`);
    facts.push(`${ordinal(pe.rankPosition + 1)} choice in their room ranking`);

    if (pe.matched.length) judgments.push(`Matches stated priorities: ${pe.matched.map((k) => PRIORITY_LABELS[k]).join(", ")}`);
    judgments.push(`Match score ${(pe.satisfaction * 100).toFixed(0)} / 100`);
    privateFacts.push(`Score detail: room fit ${(pe.fit * 100).toFixed(0)}, affordability ${(pe.afford * 100).toFixed(0)}`);
    if (pe.envy && pe.envy.gain >= 0.02)
      judgments.push(
        `Might prefer ${roomName(pe.envy.roomId)} (held by ${partyName(pe.envy.partyId)}) at the price they'd pay there (+${(pe.envy.gain * 100).toFixed(0)} pts)`,
      );
    else judgments.push("Would not prefer any other party's room at the price they would pay for it");

    if (pe.rankPosition > 0) {
      const firstId = party.roomRanking[0];
      const holder = ev.parties.find((x) => x.roomId === firstId);
      if (firstId && holder) {
        const holderParty = parties.find((p) => p.id === holder.partyId)!;
        const holderRank = holder.rankPosition + 1;
        tradeoffs.push(
          `First choice ${roomName(firstId)} went to ${holderParty.name} (their ${ordinal(holderRank)} choice)` +
            (holderRank === 1 ? ", who ranked it first too." : "."),
        );
      } else if (firstId) {
        tradeoffs.push(`First choice ${roomName(firstId)} would have broken another party's hard constraint or lowered the least-satisfied party's score.`);
      }
    }
    if (pe.overIdealCents > 0) privateFacts.push(`Trade-off: pays ${m(pe.overIdealCents)} above the ideal budget.`);

    const headline =
      pe.rankPosition === 0
        ? `${party.name} gets ${room.name} — their top choice.`
        : `${party.name} gets ${room.name} (${ordinal(pe.rankPosition + 1)} choice).`;
    return { partyId: pe.partyId, headline, facts, privateFacts, judgments, tradeoffs };
  });

  const facts = [
    `Shared pool ${m(pr.sharedPoolCents)} (${formatBps(config.sharedBps, 0)}) ÷ ${pr.travelers} travelers; private pool ${m(pr.privatePoolCents)} (${formatBps(
      10000 - config.sharedBps,
      0,
    )}) by room weight.`,
    `Charges reconcile exactly: ${pr.charges.map((c) => m(c.totalCents)).join(" + ")} = ${m(pr.totalCents)}.`,
    `${ev.metrics.firstChoiceCount} of ${ev.parties.length} parties receive their first-choice room.`,
  ];
  const judgments = [
    ...proposal.strategies.map((s) => STRATEGY_DESCRIPTIONS[s]),
    `Least-satisfied party scores ${(ev.metrics.minSatisfaction * 100).toFixed(0)}; average ${(ev.metrics.meanSatisfaction * 100).toFixed(0)}.`,
    ev.metrics.envyFreeParties === ev.parties.length
      ? "No party would rather swap into another party's room at the price they'd pay there."
      : `${ev.parties.length - ev.metrics.envyFreeParties} part${ev.parties.length - ev.metrics.envyFreeParties === 1 ? "y" : "ies"} might prefer another room.`,
  ];
  const comparison = all
    .filter((p) => p.evaluation.key !== ev.key)
    .map((other) => {
      const diff = other.evaluation.parties
        .filter((op) => ev.parties.find((x) => x.partyId === op.partyId)!.roomId !== op.roomId)
        .map((op) => `${partyName(op.partyId)} → ${roomName(op.roomId)}`);
      const d = (ev.scores.balanced - other.evaluation.scores.balanced) * 100;
      return `vs ${other.label}: ${diff.join(", ") || "same rooms"}; balanced score ${d >= 0 ? "+" : ""}${d.toFixed(1)} pts for this plan.`;
    });
  const summary =
    ev.metrics.firstChoiceCount === ev.parties.length
      ? "Every party gets its first-choice bedroom within budget."
      : `${ev.metrics.firstChoiceCount} of ${ev.parties.length} parties get their first choice; trade-offs are spread to protect the least-satisfied party.`;
  return { summary, facts, judgments, comparison, parties: partyEx };
}

export function describeEvaluation(ev: EvaluatedAssignment) {
  return ev.key;
}
