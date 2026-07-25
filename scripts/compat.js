export function dnd5eVersionAtLeast(major, minor = 0, patch = 0) {
  const parts = String(game.system?.version ?? "0").split(".").map(n => parseInt(n, 10) || 0);
  const a = parts[0] ?? 0, b = parts[1] ?? 0, c = parts[2] ?? 0;
  if (a !== major) return a > major;
  if (b !== minor) return b > minor;
  return c >= patch;
}

export function resolveFilePicker() {
  return foundry.applications?.apps?.FilePicker?.implementation
    ?? foundry.applications?.apps?.FilePicker
    ?? globalThis.FilePicker;
}
