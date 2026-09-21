/**
 * Derives the next beta version from the newest stable tag plus the betas that
 * already exist, so cutting a prerelease needs no version input.
 *
 * Latest stable `v0.2.1` → `v0.2.2-beta1`, then `v0.2.2-beta2`, … and finally
 * `v0.2.2` stable. The patch is bumped rather than reusing `0.2.1`, because
 * semver orders `0.2.1-beta1` *below* the already-released `0.2.1`, which would
 * leave every install on `0.2.1` unable to ever see it.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const BETA_TAG = /^v?(\d+)\.(\d+)\.(\d+)-beta(\d+)$/;
const STABLE_TAG = /^v?(\d+)\.(\d+)\.(\d+)$/;

/** Compares two `[major, minor, patch]` triples. */
function compareCore(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

/**
 * @param {object} input
 * @param {string|null} input.stableTag newest stable tag, with or without the `v`
 * @param {string[]} input.tags every tag in the repository
 * @returns {{ tag: string, version: string, name: string, beta: number }}
 */
export function deriveNextBeta({ stableTag, tags = [] }) {
  const stable = STABLE_TAG.exec(stableTag ?? "");
  if (!stable) {
    throw new Error(
      `No stable release tag found (got ${stableTag ?? "(none)"}). Publish a v<major>.<minor>.<patch> release first.`
    );
  }

  const floor = [Number(stable[1]), Number(stable[2]), Number(stable[3]) + 1];
  const betas = tags
    .map((tag) => BETA_TAG.exec(tag))
    .filter(Boolean)
    .map(([, major, minor, patch, beta]) => ({
      core: [Number(major), Number(minor), Number(patch)],
      beta: Number(beta)
    }))
    // A beta already aimed at a later patch wins, so a stray `v0.2.3-beta1`
    // neither regresses to `v0.2.2-betaN` nor collides with it.
    .filter(({ core }) => compareCore(core, floor) >= 0)
    .sort((left, right) => compareCore(left.core, right.core) || left.beta - right.beta);

  const latest = betas.at(-1);
  const core = latest ? latest.core : floor;
  const beta = latest && compareCore(latest.core, core) === 0 ? latest.beta + 1 : 1;

  const version = `${core[0]}.${core[1]}.${core[2]}-beta${beta}`;
  return {
    tag: `v${version}`,
    version,
    name: `EMR Management Tool v${core[0]}.${core[1]}.${core[2]} Beta ${beta}`,
    beta
  };
}

function gh(...args) {
  return execFileSync("gh", args, { encoding: "utf8" }).trim();
}

function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) throw new Error("GITHUB_REPOSITORY is required.");

  // `releases/latest` is the newest published, non-prerelease release — exactly
  // the stable baseline. There is no checkout in this job, so tags come from the
  // API rather than `git tag`.
  const stableTag = gh("api", `repos/${repo}/releases/latest`, "--jq", ".tag_name");
  const tags = gh("api", "--paginate", `repos/${repo}/git/matching-refs/tags/v`, "--jq", ".[].ref")
    .split("\n")
    .map((ref) => ref.replace(/^refs\/tags\//, "").trim())
    .filter(Boolean);

  const next = deriveNextBeta({ stableTag, tags });
  console.log(`${next.tag} (from stable ${stableTag}, ${tags.length} tags scanned)`);

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `release_tag=${next.tag}\nrelease_version=${next.version}\nrelease_name=${next.name}\n`
    );
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
