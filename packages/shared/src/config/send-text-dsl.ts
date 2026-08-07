import { HotkeyKeyName, HotkeyModifier } from "./hotkeys.js";
import { MAX_SEND_TEXT_STEPS } from "./limits.js";

export const MAX_SEND_TEXT_SLEEP_MS = 10_000;

export type SendTextInstruction =
  | { type: "text"; text: string }
  | { type: "key"; key: HotkeyKeyName }
  | { type: "hotkey"; modifiers: HotkeyModifier[]; key: HotkeyKeyName }
  | { type: "sleep"; milliseconds: number };

export class SendTextDslError extends Error {
  constructor(
    readonly line: number,
    message: string,
  ) {
    super(`Line ${line}: ${message}`);
    this.name = "SendTextDslError";
  }
}

export function parseSendTextDsl(source: string): SendTextInstruction[] {
  const instructions: SendTextInstruction[] = [];
  for (const [index, rawLine] of source.split(/\r?\n/).entries()) {
    const lineNumber = index + 1;
    const line = rawLine.trim();
    if (!line) continue;
    const separator = line.indexOf(" ");
    const keyword = (separator === -1 ? line : line.slice(0, separator)).toLowerCase();
    const argument = separator === -1 ? "" : line.slice(separator + 1).trim();
    let instruction: SendTextInstruction;
    if (keyword === "text") {
      if (!argument.startsWith('"')) {
        throw new SendTextDslError(lineNumber, "text must use a JSON quoted string");
      }
      let text: unknown;
      try {
        text = JSON.parse(argument);
      } catch {
        throw new SendTextDslError(lineNumber, "text contains an invalid JSON string");
      }
      if (typeof text !== "string") {
        throw new SendTextDslError(lineNumber, "text must contain a string");
      }
      instruction = { type: "text", text };
    } else if (keyword === "key") {
      const parsed = HotkeyKeyName.safeParse(argument);
      if (!parsed.success) throw new SendTextDslError(lineNumber, `unknown key '${argument}'`);
      instruction = { type: "key", key: parsed.data };
    } else if (keyword === "hotkey") {
      const parts = argument.split("+").map((part) => part.trim()).filter(Boolean);
      if (parts.length < 2) {
        throw new SendTextDslError(lineNumber, "hotkey requires modifiers and one key");
      }
      const key = HotkeyKeyName.safeParse(parts.at(-1));
      const parsedModifiers = parts.slice(0, -1).map((part) => HotkeyModifier.safeParse(part));
      if (!key.success || parsedModifiers.some((part) => !part.success)) {
        throw new SendTextDslError(lineNumber, "hotkey contains an unknown modifier or key");
      }
      const modifiers = parsedModifiers.flatMap((part) => part.success ? [part.data] : []);
      instruction = {
        type: "hotkey",
        modifiers: [...new Set(modifiers)],
        key: key.data,
      };
    } else if (keyword === "sleep") {
      const milliseconds = Number(argument);
      if (!Number.isSafeInteger(milliseconds) || milliseconds < 0 || milliseconds > MAX_SEND_TEXT_SLEEP_MS) {
        throw new SendTextDslError(
          lineNumber,
          `sleep must be an integer from 0 to ${MAX_SEND_TEXT_SLEEP_MS}`,
        );
      }
      instruction = { type: "sleep", milliseconds };
    } else {
      throw new SendTextDslError(lineNumber, `unknown statement '${keyword}'`);
    }
    instructions.push(instruction);
    if (instructions.length > MAX_SEND_TEXT_STEPS) {
      throw new SendTextDslError(lineNumber, `sequence supports at most ${MAX_SEND_TEXT_STEPS} statements`);
    }
  }
  return instructions;
}

export function serializeSendTextInstructions(instructions: SendTextInstruction[]): string {
  return instructions.map((instruction) => {
    switch (instruction.type) {
      case "text":
        return `text ${JSON.stringify(instruction.text)}`;
      case "key":
        return `key ${instruction.key}`;
      case "hotkey":
        return `hotkey ${[...instruction.modifiers, instruction.key].join("+")}`;
      case "sleep":
        return `sleep ${instruction.milliseconds}`;
    }
  }).join("\n");
}
