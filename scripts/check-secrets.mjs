#!/usr/bin/env node
/**
 * Scan git objects / working tree for high-confidence secrets.
 * Exit 1 when findings are present so hooks can block the push.
 *
 * Usage:
 *   node scripts/check-secrets.mjs            # scan staged + unstaged tracked diffs vs HEAD, plus untracked text files
 *   node scripts/check-secrets.mjs --pre-push # scan commit ranges from pre-push stdin
 *   node scripts/check-secrets.mjs --range A..B
 */

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve, relative } from "node:path";

const ZERO = "0000000000000000000000000000000000000000";

/** @type {{ name: string, re: RegExp }[]} */
const RULES = [
  { name: "aws-access-key-id", re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g },
  {
    name: "aws-secret-access-key-assignment",
    re: /(?:aws_secret_access_key|AWS_SECRET_ACCESS_KEY|secret_access_key|secretAccessKey)\s*[:=]\s*['"]?([A-Za-z0-9/+=]{40})['"]?/g
  },
  { name: "private-key-block", re: /-----BEGIN (?:RSA |OPENSSH |EC |DSA |OPENSSH )?PRIVATE KEY-----/g },
  { name: "github-pat", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/g },
  { name: "github-fine-grained-pat", re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { name: "slack-token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: "stripe-live-key", re: /\bsk_live_[A-Za-z0-9]{20,}\b/g },
  { name: "google-api-key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  {
    name: "db-url-with-password",
    re: /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis):\/\/[^:\s/]+:[^@\s/]+@/gi
  }
];

const ALLOWED_SUBSTRINGS = [
  "default-secret",
  "dev-secret",
  "AKIATEST",
  "AKIADUP",
  "AKIANONE",
  "AKIADEFAULT1234",
  "AKIADEV5678",
  "AKIAONLYKEY1234",
  "AKIA****",
  "123456789012",
  "test-user",
  "test-account"
];

const SKIP_PATH_RE =
  /(^|\/)(node_modules|dist|src-tauri\/target|\.git|\.idea)(\/|$)|package-lock\.json$|Cargo\.lock$|\.(png|jpg|jpeg|gif|webp|ico|woff2?|ttf|eot|mp4|zip|gz|tgz|dmg|exe|msi)$/i;

function execGit(args, { cwd, input, allowFail = false } = {}) {
  try {
    return execFileSync("git", args, {
      cwd: cwd ?? ROOT,
      encoding: "utf8",
      input,
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024
    });
  } catch (error) {
    if (allowFail) {
      return error.stdout?.toString?.() ?? "";
    }
    throw error;
  }
}

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8"
}).trim();

function loadAllowlist() {
  const path = resolve(ROOT, ".secretsallowlist");
  if (!existsSync(path)) {
    return [];
  }
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

function isAllowed(snippet, allowlist) {
  const haystack = snippet.toLowerCase();
  if (ALLOWED_SUBSTRINGS.some((item) => haystack.includes(item.toLowerCase()))) {
    return true;
  }
  return allowlist.some((item) => haystack.includes(item.toLowerCase()));
}

function shouldSkipPath(filePath) {
  return SKIP_PATH_RE.test(filePath.replaceAll("\\", "/"));
}

/**
 * @param {string} text
 * @param {string} location
 * @param {string[]} allowlist
 * @param {{ location: string, rule: string, match: string }[]} findings
 */
function scanText(text, location, allowlist, findings) {
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let match;
    while ((match = rule.re.exec(text)) !== null) {
      const value = match[0];
      if (isAllowed(value, allowlist)) {
        continue;
      }
      findings.push({
        location,
        rule: rule.name,
        match: value.length > 80 ? `${value.slice(0, 77)}...` : value
      });
    }
  }
}

function parseDiffPatches(diffText) {
  /** @type {{ file: string, added: string }[]} */
  const files = [];
  let currentFile = null;
  let added = [];

  for (const line of diffText.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      if (currentFile && added.length) {
        files.push({ file: currentFile, added: added.join("\n") });
      }
      currentFile = null;
      added = [];
      continue;
    }
    const pathMatch = line.match(/^\+\+\+ [ab]\/(.+)$/);
    if (pathMatch) {
      currentFile = pathMatch[1];
      continue;
    }
    if (line.startsWith("+++ /dev/null")) {
      currentFile = null;
      continue;
    }
    if (currentFile && line.startsWith("+") && !line.startsWith("+++")) {
      added.push(line.slice(1));
    }
  }

  if (currentFile && added.length) {
    files.push({ file: currentFile, added: added.join("\n") });
  }
  return files;
}

function scanDiff(diffText, allowlist, findings, label) {
  for (const { file, added } of parseDiffPatches(diffText)) {
    if (shouldSkipPath(file)) {
      continue;
    }
    scanText(added, `${label}:${file}`, allowlist, findings);
  }
}

function scanRange(range, allowlist, findings) {
  const diff = execGit(["diff", "-U0", "--no-ext-diff", "--binary", range], { allowFail: true });
  scanDiff(diff, allowlist, findings, range);
}

function scanPrePush(allowlist, findings) {
  const stdin = readFileSync(0, "utf8");
  const lines = stdin.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) {
    // No refs updated (e.g. delete-only); nothing to scan.
    return;
  }

  for (const line of lines) {
    const [localRef, localSha, , remoteSha] = line.split(/\s+/);
    if (!localSha || localSha === ZERO) {
      continue;
    }
    if (!remoteSha || remoteSha === ZERO) {
      // New ref: scan all commits reachable from local tip that aren't on remotes.
      const commits = execGit(
        ["rev-list", localSha, "--not", "--remotes=origin"],
        { allowFail: true }
      )
        .trim()
        .split(/\r?\n/)
        .filter(Boolean);
      if (commits.length === 0) {
        scanRange(`${localSha}^!`, allowlist, findings);
      } else {
        for (const commit of commits) {
          scanRange(`${commit}^!`, allowlist, findings);
        }
      }
      continue;
    }
    scanRange(`${remoteSha}..${localSha}`, allowlist, findings);
    void localRef;
  }
}

function scanWorkingTree(allowlist, findings) {
  const staged = execGit(["diff", "--cached", "-U0", "--no-ext-diff", "--binary"], { allowFail: true });
  scanDiff(staged, allowlist, findings, "staged");

  const unstaged = execGit(["diff", "-U0", "--no-ext-diff", "--binary"], { allowFail: true });
  scanDiff(unstaged, allowlist, findings, "unstaged");

  const untracked = execGit(["ls-files", "--others", "--exclude-standard"], { allowFail: true })
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);

  for (const file of untracked) {
    if (shouldSkipPath(file)) {
      continue;
    }
    const abs = resolve(ROOT, file);
    try {
      const text = readFileSync(abs, "utf8");
      scanText(text, `untracked:${relative(ROOT, abs)}`, allowlist, findings);
    } catch {
      // skip binary / unreadable
    }
  }
}

function main() {
  const args = process.argv.slice(2);
  const allowlist = loadAllowlist();
  /** @type {{ location: string, rule: string, match: string }[]} */
  const findings = [];

  if (args.includes("--pre-push")) {
    scanPrePush(allowlist, findings);
  } else {
    const rangeIdx = args.indexOf("--range");
    if (rangeIdx >= 0 && args[rangeIdx + 1]) {
      scanRange(args[rangeIdx + 1], allowlist, findings);
    } else {
      scanWorkingTree(allowlist, findings);
    }
  }

  if (findings.length === 0) {
    process.stdout.write("secrets check: ok\n");
    process.exit(0);
  }

  process.stderr.write("secrets check: blocked — possible secrets detected\n\n");
  for (const finding of findings) {
    process.stderr.write(`- [${finding.rule}] ${finding.location}\n  ${finding.match}\n`);
  }
  process.stderr.write(
    "\nRemove the secrets (or add a precise allowlist entry in .secretsallowlist for known fixtures),\nthen retry. To bypass once: git push --no-verify\n"
  );
  process.exit(1);
}

main();
