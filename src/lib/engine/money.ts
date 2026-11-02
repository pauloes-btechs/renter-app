/**
 * Exact integer money helpers. No floating point is used for currency amounts.
 */

/**
 * Largest-remainder (Hamilton) apportionment of `totalCents` across integer weights.
 * - Each share gets floor(total * w / sum(w)).
 * - Leftover cents go one each to the largest fractional remainders.
 * - Ties are broken by original index (deterministic).
 * Uses BigInt internally so `total * weight` never loses precision.
 */
export function allocateLargestRemainder(totalCents: number, weights: number[]): number[] {
  if (!Number.isInteger(totalCents) || totalCents < 0) {
    throw new Error(`totalCents must be a non-negative integer (got ${totalCents})`);
  }
  if (weights.length === 0) {
    if (totalCents === 0) return [];
    throw new Error("Cannot allocate a non-zero amount across zero shares");
  }
  for (const w of weights) {
    if (!Number.isInteger(w) || w < 0) throw new Error(`weights must be non-negative integers (got ${w})`);
  }
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0) throw new Error("Sum of weights must be positive");

  const T = BigInt(totalCents);
  const S = BigInt(sum);
  const base: number[] = [];
  const rema: { idx: number; rem: bigint }[] = [];
  let allocated = 0n;
  weights.forEach((w, idx) => {
    const num = T * BigInt(w);
    const q = num / S;
    base.push(Number(q));
    allocated += q;
    rema.push({ idx, rem: num % S });
  });
  let leftover = Number(T - allocated);
  rema.sort((a, b) => (a.rem === b.rem ? a.idx - b.idx : a.rem > b.rem ? -1 : 1));
  for (let i = 0; leftover > 0; i++, leftover--) base[rema[i % rema.length].idx] += 1;
  return base;
}

/** Split an amount into `parts` near-equal integer shares (earlier shares receive extra cents). */
export function splitEqually(totalCents: number, parts: number): number[] {
  return allocateLargestRemainder(totalCents, Array.from({ length: parts }, () => 1));
}

export function dollarsToCents(d: number): number {
  return Math.round(d * 100);
}

export function formatMoney(cents: number, currency = "USD", opts: { compact?: boolean } = {}): string {
  const fmt = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: opts.compact && cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return fmt.format(cents / 100);
}

export function formatBps(bps: number, digits = 1): string {
  return `${(bps / 100).toFixed(digits)}%`;
}
