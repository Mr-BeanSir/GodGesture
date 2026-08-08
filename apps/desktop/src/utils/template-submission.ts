export function canSubmitPublicTemplate(input: {
  endpointMode: "official" | "custom";
  phase: string;
  emailVerified: boolean;
}): boolean {
  return input.endpointMode === "official" && input.phase === "signedIn" && input.emailVerified;
}

export function submissionAuthor(displayName: string | null | undefined, email: string | null | undefined): string {
  return displayName?.trim() || email?.trim() || "-";
}
