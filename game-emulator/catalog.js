const GAMES_ROOT = new URL("../assets/games/", import.meta.url);
const ROM_EXTENSIONS = { gb: ".gb", gbc: ".gbc", nes: ".nes" };

function isSafePath(path) {
  return typeof path === "string" && path.length > 0 && !path.includes("\\") &&
    path.split("/").every(part => part && part !== "." && part !== "..");
}

function isDosPath(path) {
  return isSafePath(path) &&
    path.split("/").every(part => /^[A-Za-z0-9_-]{1,8}(?:\.[A-Za-z0-9]{1,3})?$/.test(part));
}

function validateGame(game, id) {
  if (!game || typeof game !== "object" || game.id !== id ||
      typeof game.title !== "string" || !game.title.trim() ||
      typeof game.description !== "string" ||
      !["html", "gb", "gbc", "nes", "dos"].includes(game.system)) {
    throw new Error(`Invalid game metadata in assets/games/${id}/game.json.`);
  }
  if (game.cover !== undefined && !isSafePath(game.cover)) {
    throw new Error(`Invalid cover path for ${game.title}.`);
  }
  if (game.system === "html" && (!isSafePath(game.entry) || !/\.html?$/i.test(game.entry))) {
    throw new Error(`HTML game ${game.title} needs a safe .html entry path.`);
  }
  if (ROM_EXTENSIONS[game.system] &&
      (!isSafePath(game.rom) || !game.rom.toLowerCase().endsWith(ROM_EXTENSIONS[game.system]))) {
    throw new Error(`${game.title} needs a ${ROM_EXTENSIONS[game.system]} ROM path.`);
  }
  if (game.system === "dos") {
    const files = game.files;
    const uniqueFiles = Array.isArray(files)
      ? new Set(files.filter(path => typeof path === "string").map(path => path.toUpperCase()))
      : new Set();
    if (!isDosPath(game.launch) || !/\.exe$/i.test(game.launch) ||
        !Array.isArray(files) || files.length === 0 || files.length > 2048 ||
        files.some(path => !isDosPath(path)) || uniqueFiles.size !== files.length ||
        !uniqueFiles.has(game.launch.toUpperCase())) {
      throw new Error(`DOS game ${game.title} needs a launch .EXE and a files array using DOS 8.3 paths.`);
    }
  }
}

export async function loadGameCatalog() {
  const manifestResponse = await fetch(new URL("manifest.json", GAMES_ROOT));
  if (!manifestResponse.ok) throw new Error("Could not load assets/games/manifest.json.");
  const gameIds = await manifestResponse.json();
  if (!Array.isArray(gameIds) || gameIds.some(id => typeof id !== "string")) {
    throw new Error("assets/games/manifest.json must contain an array of game folder names.");
  }
  if (gameIds.length > 200) throw new Error("assets/games/manifest.json cannot list more than 200 games.");

  const seenIds = new Set();
  const seenRootRoms = new Set();
  const games = [];
  for (const entry of gameIds) {
    if (/\.((gb)|(gbc)|(nes))$/i.test(entry)) {
      if (!isSafePath(entry) || entry.includes("/") || seenRootRoms.has(entry.toLowerCase())) {
        throw new Error(`Invalid or duplicate ROM file in assets/games/manifest.json: ${entry}`);
      }
      seenRootRoms.add(entry.toLowerCase());
      const extension = entry.slice(entry.lastIndexOf(".") + 1).toLowerCase();
      const title = entry.slice(0, entry.lastIndexOf(".")).replace(/\s+\([^)]*\)/g, "").trim();
      games.push({
        id: `rom:${entry}`,
        title: title || entry,
        description: `${extension.toUpperCase()} game`,
        system: extension,
        rom: entry,
        folderUrl: GAMES_ROOT
      });
      continue;
    }
    const id = entry;
    if (!/^[A-Za-z0-9_-]{1,8}$/.test(id) || seenIds.has(id)) {
      throw new Error(`Invalid or duplicate game folder name in assets/games/manifest.json: ${id}`);
    }
    seenIds.add(id);
    const folderUrl = new URL(`${encodeURIComponent(id)}/`, GAMES_ROOT);
    const response = await fetch(new URL("game.json", folderUrl));
    if (!response.ok) throw new Error(`Could not load assets/games/${id}/game.json.`);
    const game = await response.json();
    validateGame(game, id);
    games.push({ ...game, folderUrl });
  }
  return games;
}

export function gameAssetUrl(game, path) {
  const parts = path.split("/");
  return new URL(parts.map(encodeURIComponent).join("/"), game.folderUrl);
}

export async function fetchGameAsset(game, path) {
  const response = await fetch(gameAssetUrl(game, path));
  if (!response.ok) throw new Error(`Could not load ${path} from the ${game.title} folder.`);
  return response;
}
