import { loadGameCatalog, fetchGameAsset, gameAssetUrl } from "./catalog.js";

const stage = document.querySelector("#game-stage");
const title = document.querySelector("#player-title");
const status = document.querySelector("#player-status");
const htmlPlayer = document.querySelector("#html-player");
const romPlayer = document.querySelector("#rom-player");
const localRomPlayer = document.querySelector("#local-rom-player");
const dosPlayer = document.querySelector("#dos-player");
let activeGame;
let romUrl;
let emulatorLoader;
let launchId = 0;

function showStatus(message, failed = false) {
  status.textContent = message;
  document.body.classList.toggle("player-error", failed);
}

async function loadAppsDirectory() {
  const rootUrl = new URL("../assets/apps/", document.baseURI);
  const manifestResponse = await fetch(new URL("manifest.json", rootUrl));
  if (!manifestResponse.ok) throw new Error("Could not load assets/apps/manifest.json.");
  const paths = await manifestResponse.json();
  if (!Array.isArray(paths) || paths.some(path => typeof path !== "string")) {
    throw new Error("assets/apps/manifest.json must contain an array of file paths.");
  }
  if (paths.length > 2048) throw new Error("assets/apps contains more than 2,048 files.");

  const files = [];
  const seenPaths = new Set();
  let totalBytes = 0;
  for (const path of paths) {
    const parts = path.split("/");
    if (!path || path.includes("\\") || parts.some(part => !part || part === "." || part === "..")) {
      throw new Error(`Invalid app path in assets/apps/manifest.json: ${path}`);
    }
    if (seenPaths.has(path)) throw new Error(`Duplicate app path in assets/apps/manifest.json: ${path}`);
    const response = await fetch(new URL(parts.map(encodeURIComponent).join("/"), rootUrl));
    if (!response.ok) throw new Error(`Could not load assets/apps/${path}.`);
    const data = await response.arrayBuffer();
    totalBytes += data.byteLength;
    if (totalBytes > 128 * 1024 * 1024) throw new Error("assets/apps exceeds the 128 MB limit.");
    files.push({ path, data });
    seenPaths.add(path);
  }
  return files;
}

function startHtmlGame(game) {
  htmlPlayer.hidden = false;
  htmlPlayer.addEventListener("load", () => showStatus(""), { once: true });
  htmlPlayer.src = new URL(`../assets/games/${encodeURIComponent(game.id)}/${game.entry
    .split("/").map(encodeURIComponent).join("/")}`, document.baseURI).href;
}

async function startRomGame(game, runId) {
  if (game.system === "gb" || game.system === "gbc") {
    showStatus("Starting local Game Boy emulator…");
    const playerUrl = new URL("../assets/binjgb/simple.html", document.baseURI);
    playerUrl.searchParams.set("rom", gameAssetUrl(game, game.rom).href);
    localRomPlayer.addEventListener("load", () => {
      if (runId === launchId) showStatus("");
    }, { once: true });
    localRomPlayer.addEventListener("error", () => {
      if (runId === launchId) showStatus("Could not load the local Game Boy emulator.", true);
    }, { once: true });
    localRomPlayer.src = playerUrl.href;
    localRomPlayer.hidden = false;
    return;
  }

  showStatus("Loading emulator runtime and ROM…");
  const response = await fetchGameAsset(game, game.rom);
  if (runId !== launchId) return;
  const rom = await response.blob();
  if (runId !== launchId) return;
  if (rom.size > 64 * 1024 * 1024) throw new Error("ROM files must be 64 MB or smaller.");
  romUrl = URL.createObjectURL(rom);
  romPlayer.hidden = false;
  window.EJS_player = "#rom-player";
  window.EJS_core = game.system === "gbc" ? "gb" : game.system;
  window.EJS_gameUrl = romUrl;
  window.EJS_gameName = game.title;
  window.EJS_pathtodata = "https://cdn.emulatorjs.org/stable/data/";
  window.EJS_startOnLoaded = true;
  window.EJS_color = "#e60012";
  emulatorLoader = document.createElement("script");
  emulatorLoader.src = `${window.EJS_pathtodata}loader.js`;
  emulatorLoader.async = true;
  emulatorLoader.onload = () => {
    if (runId === launchId) showStatus("Emulator ready. Loading game…");
  };
  emulatorLoader.onerror = () => {
    if (runId === launchId) showStatus("Could not load the emulator runtime. Check your internet connection.", true);
  };
  romPlayer.append(emulatorLoader);
}

async function startDosGame(game, runId) {
  showStatus("Preparing DOS game…");
  const gameFiles = await Promise.all(game.files.map(async path => {
    const response = await fetchGameAsset(game, path);
    return { path: `GAMES/${game.id}/${path}`, data: await response.arrayBuffer() };
  }));
  if (runId !== launchId) return;
  if (gameFiles.reduce((total, file) => total + file.data.byteLength, 0) > 128 * 1024 * 1024) {
    throw new Error("DOS game files exceed the 128 MB virtual disk limit.");
  }
  const appFiles = await loadAppsDirectory();
  if (runId !== launchId) return;
  if (!window.FreeDosRunner && document.readyState !== "complete") {
    await new Promise(resolve => window.addEventListener("load", resolve, { once: true }));
  }
  if (runId !== launchId) return;
  if (!window.FreeDosRunner) throw new Error("The bundled DOS emulator could not be loaded.");
  dosPlayer.hidden = false;
  await window.FreeDosRunner.runDosGame(
    `C:\\APPS\\GAMES\\${game.id}\\${game.launch.replaceAll("/", "\\")}`,
    [...appFiles, ...gameFiles],
    dosPlayer,
    showStatus
  );
}

async function startGame() {
  const runId = ++launchId;
  const gameId = new URLSearchParams(location.search).get("game");
  if (!gameId) throw new Error("No game was selected.");
  const games = await loadGameCatalog();
  if (runId !== launchId) return;
  activeGame = games.find(game => game.id === gameId);
  if (!activeGame) throw new Error(`Game "${gameId}" is not listed in the game manifest.`);
  title.textContent = activeGame.title;
  document.title = `${activeGame.title} — PLAYROOM`;

  if (activeGame.system === "html") {
    await startHtmlGame(activeGame);
  } else if (activeGame.system === "dos") {
    await startDosGame(activeGame, runId);
  } else {
    await startRomGame(activeGame, runId);
  }
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else if (typeof stage.requestFullscreen === "function") {
      await stage.requestFullscreen();
    } else {
      throw new Error("Fullscreen is unavailable in this browser.");
    }
  } catch (error) {
    showStatus(`Could not change fullscreen mode: ${error.message}`, true);
  }
}

function stopGame() {
  launchId++;
  htmlPlayer.removeAttribute("src");
  localRomPlayer.removeAttribute("src");
  window.EJS_emulator?.gameManager?.exit?.();
  if (emulatorLoader) emulatorLoader.remove();
  if (romUrl) URL.revokeObjectURL(romUrl);
  if (activeGame?.system === "dos") window.FreeDosRunner?.stop();
}

document.querySelector("#fullscreen-button").addEventListener("click", toggleFullscreen);
window.addEventListener("pagehide", stopGame);
startGame().catch(error => {
  console.error("Could not start game:", error);
  showStatus(error.message, true);
});
