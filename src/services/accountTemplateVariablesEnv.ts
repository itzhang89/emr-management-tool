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

    if (raw.startsWith('"') || raw.startsWith("'")) {
      const pattern = raw.startsWith('"') ? /^"((?:[^"\\]|\\[\s\S])*)"/ : /^'([^']*)'/;
      let quoted = raw;
      let match = pattern.exec(quoted);
      while (!match && index + 1 < lines.length) {
        quoted += `\n${lines[++index]}`;
        match = pattern.exec(quoted);
      }
      if (!match || !/^\s*(?:#.*)?$/.test(quoted.slice(match[0].length))) {
        throw new AccountVariablesEnvError(lineNumber, "quote");
      }
      variables[name] = raw.startsWith('"')
        ? match[1].replace(/\\(?:["\\bnfrt]|u[\da-fA-F]{4})/g, (escape) => JSON.parse(`"${escape}"`) as string)
        : match[1];
    } else {
      variables[name] = raw.split("#", 1)[0].trim();
    }
  }
  return variables;
}

export function formatAccountTemplateVariablesEnv(variables: AccountTemplateVariables) {
  return Object.entries(variables)
    .map(([name, value]) => `${name}=${/^[a-zA-Z0-9_.:/@+-]*$/.test(value) ? value : JSON.stringify(value)}`)
    .join("\n");
}
