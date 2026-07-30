import type { BoundaryIntent, BoundaryOrigin, BoundaryToken } from "@godgesture/shared";

export function cloneBoundarySequence(sequence: readonly BoundaryToken[]): BoundaryToken[] {
  return sequence.map((token) => ({ ...token }));
}

function sameOrigin(a: BoundaryOrigin, b: BoundaryOrigin): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind === "hotCorner"
    ? a.corner === (b as Extract<BoundaryOrigin, { kind: "hotCorner" }>).corner
    : a.edge === (b as Extract<BoundaryOrigin, { kind: "rubEdge" }>).edge;
}

function sameToken(a: BoundaryToken, b: BoundaryToken): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "wheel") {
    return a.direction === (b as Extract<BoundaryToken, { type: "wheel" }>).direction;
  }
  if (a.type === "button") {
    return a.button === (b as Extract<BoundaryToken, { type: "button" }>).button;
  }
  return a.direction === (b as Extract<BoundaryToken, { type: "stroke" }>).direction;
}

function isPrefix(a: BoundaryToken[], b: BoundaryToken[]): boolean {
  return a.length <= b.length && a.every((token, index) => sameToken(token, b[index]!));
}

export function findBoundaryConflict(
  intents: BoundaryIntent[],
  origin: BoundaryOrigin,
  sequence: BoundaryToken[],
  excludeId?: string | null,
): { kind: "exact" | "prefix"; intent: BoundaryIntent } | null {
  for (const intent of intents) {
    if (intent.id === excludeId || !sameOrigin(intent.origin, origin)) continue;
    const existingPrefix = isPrefix(intent.sequence, sequence);
    const nextPrefix = isPrefix(sequence, intent.sequence);
    if (existingPrefix && nextPrefix) return { kind: "exact", intent };
    if (existingPrefix || nextPrefix) return { kind: "prefix", intent };
  }
  return null;
}
