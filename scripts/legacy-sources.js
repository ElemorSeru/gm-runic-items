
function topFolderName(pack) {
  let folder = pack?.folder ?? null;
  while (folder?.folder) folder = folder.folder;
  return folder?.name ?? "";
}

export function legacySourceOf(packId) {
  const pack = game.packs.get(packId);
  return {
    label: pack?.title ?? pack?.metadata?.label ?? packId,
    folder: topFolderName(pack)
  };
}

// stable sort keeps names alphabetical in each compendium for user ease
export function sortBySource(entries) {
  const order = new Map([...game.packs.keys()].map((id, i) => [id, i]));
  const rank = entry => order.get(entry.pack) ?? order.size;
  return [...entries].sort((a, b) => rank(a) - rank(b));
}

export function buildSourceHead(packId) {
  const { label, folder } = legacySourceOf(packId);
  const head = document.createElement("div");
  head.className = "legacy-source-head";
  const icon = document.createElement("i");
  icon.className = "fa-solid fa-book";
  head.appendChild(icon);
  head.appendChild(document.createTextNode(label));
  if (folder) {
    const note = document.createElement("span");
    note.className = "legacy-source-folder";
    note.textContent = folder;
    head.appendChild(note);
  }
  return head;
}
