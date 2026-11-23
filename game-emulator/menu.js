import { loadGameCatalog, gameAssetUrl } from "./catalog.js";

const strip = document.querySelector("#game-strip");
const status = document.querySelector("#library-status");
const featuredTitle = document.querySelector("#featured-title");
const leftButton = document.querySelector("#scroll-left");
const rightButton = document.querySelector("#scroll-right");

function updateClock() {
  document.querySelector("#system-time").textContent = new Intl.DateTimeFormat([], {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date());
}

function createTile(game) {
  const tile = document.createElement("a");
  tile.className = "game-tile";
  tile.href = `./play.html?game=${encodeURIComponent(game.id)}`;
  tile.target = "_blank";
  tile.rel = "noopener";
  tile.setAttribute("aria-label", `Play ${game.title}, ${game.system.toUpperCase()}`);
  tile.addEventListener("focus", () => {
    featuredTitle.textContent = game.title;
    strip.querySelectorAll(".game-tile").forEach(item => item.classList.remove("selected"));
    tile.classList.add("selected");
  });

  const art = document.createElement("span");
  art.className = "game-tile-art";
  if (game.cover) {
    const image = document.createElement("img");
    image.src = gameAssetUrl(game, game.cover).href;
    image.alt = "";
    image.addEventListener("error", () => {
      image.remove();
      art.textContent = game.title.slice(0, 1).toUpperCase();
    }, { once: true });
    art.append(image);
  } else {
    art.textContent = game.title.slice(0, 1).toUpperCase();
  }

  const label = document.createElement("span");
  label.className = "game-tile-label";
  label.textContent = game.title;
  const system = document.createElement("span");
  system.className = "game-tile-system";
  system.textContent = { html: "HTML", gb: "GAME BOY", gbc: "GAME BOY COLOR", nes: "NES", dos: "DOS" }[game.system];
  tile.append(art, label, system);
  return tile;
}

async function showGames() {
  status.textContent = "LOADING GAME COLLECTION";
  try {
    const games = await loadGameCatalog();
    strip.replaceChildren(...games.map(createTile));
    if (games.length) {
      featuredTitle.textContent = games[0].title;
      strip.firstElementChild.classList.add("selected");
      status.textContent = `${games.length} GAME${games.length === 1 ? "" : "S"} READY`;
    } else {
      featuredTitle.textContent = "Your library is empty";
      status.textContent = "ADD A GAME FOLDER TO ASSETS/GAMES";
    }
    updateScrollControls();
  } catch (error) {
    console.error("Could not load game library:", error);
    featuredTitle.textContent = "Library unavailable";
    status.textContent = error.message;
  }
}

leftButton.addEventListener("click", () => strip.scrollBy({ left: -strip.clientWidth * 0.8, behavior: "smooth" }));
rightButton.addEventListener("click", () => strip.scrollBy({ left: strip.clientWidth * 0.8, behavior: "smooth" }));
strip.addEventListener("scroll", updateScrollControls);
window.addEventListener("resize", updateScrollControls);
document.querySelector("#refresh-games").addEventListener("click", showGames);
strip.addEventListener("keydown", event => {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  const tiles = [...strip.querySelectorAll(".game-tile")];
  const currentIndex = tiles.indexOf(document.activeElement);
  if (currentIndex < 0) return;
  event.preventDefault();
  const nextIndex = Math.max(0, Math.min(tiles.length - 1, currentIndex + (event.key === "ArrowRight" ? 1 : -1)));
  tiles[nextIndex].focus();
  tiles[nextIndex].scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
});
function updateScrollControls() {
  const canScroll = strip.scrollWidth > strip.clientWidth + 1;
  leftButton.disabled = !canScroll || strip.scrollLeft <= 1;
  rightButton.disabled = !canScroll || strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 1;
}
updateClock();
window.setInterval(updateClock, 60_000);
showGames();
