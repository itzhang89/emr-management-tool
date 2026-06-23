import { appendFileSync } from "node:fs";
import { assertReleaseVersion } from "./release-version.mjs";

const tag = process.env.GITHUB_REF_NAME;
const version = assertReleaseVersion(tag, { label: "git tag" });

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `app_version=${version}\n`);
}

console.log(`Validated tag ${tag} -> app version ${version}`);
