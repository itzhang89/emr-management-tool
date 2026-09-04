/**
 * Package a Windows portable build into a zip for distribution and updater apply.
 *
 * Layout: the `.exe` sits at the archive root (no `data/` folder). The portable
 * updater copies `*.exe` from the zip directly into `exe_dir`.
 *
 * Env:
 *   PORTABLE_EXE  - path to the built portable `.exe`
 *   PORTABLE_OUT  - output `.zip` path
 *   TAURI_SIGNING_PRIVATE_KEY (+ TAURI_SIGNING_PRIVATE_KEY_PASSWORD) - optional;
 *                     when set, signs the zip via the Tauri CLI and writes `<zip>.sig`
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32 } from "node:zlib";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function shouldSignPortableZip(env = process.env) {
  return Boolean(env.TAURI_SIGNING_PRIVATE_KEY?.trim());
}

export function createPortableZip(exePath, zipPath) {
  const fileName = basename(exePath);
  if (!fileName.toLowerCase().endsWith(".exe")) {
    throw new Error(`PORTABLE_EXE must be a .exe file: ${exePath}`);
  }

  const fileData = readFileSync(exePath);
  const nameBytes = Buffer.from(fileName, "utf8");
  const checksum = crc32(fileData) >>> 0;

  const localHeader = Buffer.alloc(30 + nameBytes.length);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0, 6);
  localHeader.writeUInt16LE(0, 8);
  localHeader.writeUInt16LE(0, 10);
  localHeader.writeUInt16LE(0, 12);
  localHeader.writeUInt32LE(checksum, 14);
  localHeader.writeUInt32LE(fileData.length, 18);
  localHeader.writeUInt32LE(fileData.length, 22);
  localHeader.writeUInt16LE(nameBytes.length, 26);
  localHeader.writeUInt16LE(0, 28);
  nameBytes.copy(localHeader, 30);

  const centralHeader = Buffer.alloc(46 + nameBytes.length);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt16LE(0, 8);
  centralHeader.writeUInt16LE(0, 10);
  centralHeader.writeUInt16LE(0, 12);
  centralHeader.writeUInt16LE(0, 14);
  centralHeader.writeUInt32LE(checksum, 16);
  centralHeader.writeUInt32LE(fileData.length, 20);
  centralHeader.writeUInt32LE(fileData.length, 24);
  centralHeader.writeUInt16LE(nameBytes.length, 28);
  centralHeader.writeUInt16LE(0, 30);
  centralHeader.writeUInt16LE(0, 32);
  centralHeader.writeUInt16LE(0, 34);
  centralHeader.writeUInt16LE(0, 36);
  centralHeader.writeUInt32LE(0, 38);
  centralHeader.writeUInt32LE(0, 42);
  nameBytes.copy(centralHeader, 46);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralHeader.length, 12);
  eocd.writeUInt32LE(localHeader.length + fileData.length, 16);
  eocd.writeUInt16LE(0, 20);

  mkdirSync(dirname(zipPath), { recursive: true });
  writeFileSync(zipPath, Buffer.concat([localHeader, fileData, centralHeader, eocd]));
}

export function listZipMembers(zipPath) {
  const data = readFileSync(zipPath);
  let eocdOffset = -1;

  for (let offset = data.length - 22; offset >= 0; offset -= 1) {
    if (data.readUInt32LE(offset) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }

  if (eocdOffset < 0) {
    throw new Error(`Invalid zip archive: ${zipPath}`);
  }

  const entryCount = data.readUInt16LE(eocdOffset + 10);
  let offset = data.readUInt32LE(eocdOffset + 16);
  const members = [];

  for (let index = 0; index < entryCount; index += 1) {
    if (data.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error(`Invalid zip central directory in ${zipPath}`);
    }

    const nameLength = data.readUInt16LE(offset + 28);
    const extraLength = data.readUInt16LE(offset + 30);
    const commentLength = data.readUInt16LE(offset + 32);
    const name = data.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    members.push(name);
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return members;
}

export function signPortableZip(zipPath, env = process.env) {
  if (!shouldSignPortableZip(env)) {
    return false;
  }

  // Call the Tauri CLI's real JS entry directly. The npm shim at
  // node_modules/.bin/tauri is a shell script on Windows and cannot be
  // spawned as `node <path>` (EINVAL / SyntaxError), while `npm run tauri`
  // also fails under spawnSync on Windows. Resolving the CLI entry avoids
  // both shell wrappers.
  const cliEntry = resolve(repoRoot, "node_modules/@tauri-apps/cli/tauri.js");
  execFileSync(process.execPath, [cliEntry, "signer", "sign", zipPath], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: "inherit"
  });

  const signaturePath = `${zipPath}.sig`;
  if (!existsSync(signaturePath)) {
    throw new Error(`Expected signature file missing: ${signaturePath}`);
  }

  return true;
}

function main() {
  const exePath = process.env.PORTABLE_EXE?.trim();
  const zipPath = process.env.PORTABLE_OUT?.trim();

  if (!exePath) {
    throw new Error("PORTABLE_EXE is required.");
  }
  if (!zipPath) {
    throw new Error("PORTABLE_OUT is required.");
  }

  const resolvedExe = resolve(exePath);
  const resolvedZip = resolve(zipPath);

  if (!existsSync(resolvedExe)) {
    throw new Error(`PORTABLE_EXE not found: ${resolvedExe}`);
  }

  createPortableZip(resolvedExe, resolvedZip);
  console.log(`Wrote ${resolvedZip}`);

  if (signPortableZip(resolvedZip)) {
    console.log(`Wrote ${resolvedZip}.sig`);
  }
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (entryPath === resolve(fileURLToPath(import.meta.url))) {
  main();
}
