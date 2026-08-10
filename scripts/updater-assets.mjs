export function isInstallerWindowsBundle(name) {
  if (/portable/i.test(name)) return false;
  return /(nsis|msi|setup)/i.test(name);
}

export function isPortableWindowsBundle(name) {
  return /portable\.zip$/i.test(name);
}
