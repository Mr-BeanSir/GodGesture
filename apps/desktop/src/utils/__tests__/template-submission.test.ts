import { describe, expect, it } from "vitest";
import { canSubmitPublicTemplate, submissionAuthor } from "../template-submission";

describe("public template submission", () => {
  it("only permits verified official sessions", () => {
    expect(canSubmitPublicTemplate({ endpointMode: "official", phase: "signedIn", emailVerified: true })).toBe(true);
    expect(canSubmitPublicTemplate({ endpointMode: "official", phase: "signedOut", emailVerified: true })).toBe(false);
    expect(canSubmitPublicTemplate({ endpointMode: "custom", phase: "signedIn", emailVerified: true })).toBe(false);
    expect(canSubmitPublicTemplate({ endpointMode: "official", phase: "signedIn", emailVerified: false })).toBe(false);
  });
  it("uses display name, then email, then the export placeholder", () => {
    expect(submissionAuthor("  Bean  ", "bean@example.com")).toBe("Bean");
    expect(submissionAuthor("", "bean@example.com")).toBe("bean@example.com");
    expect(submissionAuthor(null, null)).toBe("-");
  });
});
