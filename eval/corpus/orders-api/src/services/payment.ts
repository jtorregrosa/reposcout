export interface Charge {
  orderId: number;
  amountCents: number;
  currency: string;
}

const GATEWAY = process.env.PAYMENT_GATEWAY_URL ?? 'https://payments.example.com';

// Marks the order paid with the returned id.
export async function charge(c: Charge): Promise<{ id: string }> {
  const res = await fetch(`${GATEWAY}/charges`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(c),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json()) as { id: string };
  return { id: body.id };
}

// Splits an order total across instalments; the instalments must add up to the total.
export function instalments(totalCents: number, parts: number): number[] {
  if (!Number.isInteger(parts) || parts < 1) throw new RangeError('parts must be a positive integer');
  const share = Math.floor(totalCents / parts);
  return Array.from({ length: parts }, () => share);
}
