import { isBuiltinTemplateVariable } from "@/services/templateEngine";
import type { AccountTemplateVariables } from "@/types/domain";

export function isAccountTemplateVariableName(name: string) {
  return /^[a-zA-Z0-9_]+$/.test(name) && !isBuiltinTemplateVariable(name);
}

type EnvErrorReason = "assignment" | "name" | "duplicate" | "quote";

export class AccountVariablesEnvError extends Error {
  constructor(readonly line: number, readonly reason: EnvErrorReason) {
    super(`Invalid .env entry at line ${line}: ${reason}`);
  }
}

export function parseAccountTemplateVariablesEnv(text: string): AccountTemplateVariables {
  const variables: AccountTemplateVariables = Object.create(null);
  const lines = text.split(/\r\n|\r|\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trimStart();
    if (!line || line.startsWith("#")) continue;
    const lineNumber = index + 1;
    const assignment = /^(?:export\s+)?([^=\s]+)\s*=\s*([\s\S]*)$/.exec(line);
    if (!assignment) throw new AccountVariablesEnvError(lineNumber, "assignment");
    const [, name, raw] = assignment;
    if (!isAccountTemplateVariableName(name)) throw new AccountVariablesEnvError(lineNumber, "name");
    if (Object.hasOwn(variables, name)) throw new AccountVariablesEnvError(lineNumber, "duplicate");

    let value: string;
    let comment: string;
    if (raw.startsWith('"') || raw.startsWith("'")) {
      const pattern = raw.startsWith('"') ? /^"((?:[^"\\]|\\[\s\S])*)"/ : /^'([^']*)'/;
      let quoted = raw;
      let match = pattern.exec(quoted);
      while (!match && index + 1 < lines.length) {
        quoted += `\n${lines[++index]}`;
        match = pattern.exec(quoted);
      }
      comment = match ? quoted.slice(match[0].length).trimStart() : "";
      if (!match || (comment && !comment.startsWith("#"))) {
        throw new AccountVariablesEnvError(lineNumber, "quote");
      }
      value = raw.startsWith('"')
        ? match[1].replace(/\\(?:["\\bnfrt]|u[\da-fA-F]{4})/g, (escape) => JSON.parse(`"${escape}"`) as string)
        : match[1];
    } else {
      const commentStart = raw.indexOf("#");
      value = (commentStart === -1 ? raw : raw.slice(0, commentStart)).trim();
      comment = commentStart === -1 ? "" : raw.slice(commentStart);
    }
    const description = comment.slice(1).trim();
    variables[name] = description ? { value, description } : { value };
  }
  return variables;
}

export function formatAccountTemplateVariablesEnv(variables: AccountTemplateVariables) {
  return Object.entries(variables)
    .map(([name, { value, description }]) => {
      const serializedValue = /^[a-zA-Z0-9_.:/@+-]*$/.test(value) ? value : JSON.stringify(value);
      const comment = description?.trim().replace(/[\r\n]+/g, " ");
      return `${name}=${serializedValue}${comment ? `  # ${comment}` : ""}`;
    })
    .join("\n");
}
