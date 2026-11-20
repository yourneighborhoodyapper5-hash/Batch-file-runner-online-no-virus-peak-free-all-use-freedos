#!/usr/bin/env node
"use strict";

const readline = require("node:readline");

if (!process.stdin.isTTY || !process.stdout.isTTY || typeof process.stdin.setRawMode !== "function") {
  console.error("Snake needs an interactive terminal. Run it in the VS Code integrated terminal with: node snake.js");
  process.exit(1);
}

const MAX_WIDTH = 40;
const MAX_HEIGHT = 18;
const MIN_WIDTH = 16;
const MIN_HEIGHT = 8;
const width = Math.min(MAX_WIDTH, process.stdout.columns - 2);
const height = Math.min(MAX_HEIGHT, process.stdout.rows - 6);
const directions = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 }
};

let snake;
let direction;
let nextDirection;
let food;
let score;
let paused;
let gameOver;
let timer;
let cleanedUp = false;

function randomFood() {
  const emptyCells = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!snake.some(segment => segment.x === x && segment.y === y)) {
        emptyCells.push({ x, y });
      }
    }
  }
  if (!emptyCells.length) return null;
  return emptyCells[Math.floor(Math.random() * emptyCells.length)];
}

function startGame() {
  snake = [
    { x: Math.floor(width / 2), y: Math.floor(height / 2) },
    { x: Math.floor(width / 2) - 1, y: Math.floor(height / 2) },
    { x: Math.floor(width / 2) - 2, y: Math.floor(height / 2) }
  ];
  direction = directions.right;
  nextDirection = direction;
  food = randomFood();
  score = 0;
  paused = false;
  gameOver = false;
  render();
  scheduleTick();
}

function scheduleTick() {
  clearTimeout(timer);
  if (gameOver || paused) return;
  const delay = Math.max(65, 145 - score * 3);
  timer = setTimeout(tick, delay);
}

function tick() {
  direction = nextDirection;
  const head = {
    x: snake[0].x + direction.x,
    y: snake[0].y + direction.y
  };
  const eating = head.x === food.x && head.y === food.y;
  const body = eating ? snake : snake.slice(0, -1);
  const hitWall = head.x < 0 || head.x >= width || head.y < 0 || head.y >= height;
  const hitSelf = body.some(segment => segment.x === head.x && segment.y === head.y);

  if (hitWall || hitSelf) {
    gameOver = true;
    render();
    return;
  }

  snake.unshift(head);
  if (eating) {
    score++;
    food = randomFood();
    if (!food) gameOver = true;
  } else {
    snake.pop();
  }

  render();
  scheduleTick();
}

function render() {
  const fits = process.stdout.columns >= width + 2 && process.stdout.rows >= height + 6;
  let output = "\u001b[H\u001b[2J";
  output += "\u001b[1;32mSNAKE\u001b[0m  Score: " + score + "  Best: arrows/WASD move  P pause  R restart  Q quit\n";

  if (!fits) {
    output += `\nResize the terminal to at least ${width + 2} columns by ${height + 6} rows to play.\n`;
    process.stdout.write(output);
    return;
  }

  const cells = new Map(snake.map((segment, index) => [
    `${segment.x},${segment.y}`,
    index === 0 ? "\u001b[1;32m@\u001b[0m" : "\u001b[32mo\u001b[0m"
  ]));
  if (food) cells.set(`${food.x},${food.y}`, "\u001b[1;31m*\u001b[0m");

  output += "+" + "-".repeat(width) + "+\n";
  for (let y = 0; y < height; y++) {
    output += "|";
    for (let x = 0; x < width; x++) {
      output += cells.get(`${x},${y}`) || " ";
    }
    output += "|\n";
  }
  output += "+" + "-".repeat(width) + "+\n";

  if (paused) output += "Paused. Press P to continue.\n";
  else if (gameOver) output += "Game over! Press R to play again, or Q to quit.\n";
  else output += "Eat the * and avoid the walls and your tail.\n";

  process.stdout.write(output);
}

function setDirection(name) {
  const requested = directions[name];
  if (!requested) return;
  if (requested.x === -direction.x && requested.y === -direction.y) return;
  nextDirection = requested;
}

function handleKey(key) {
  if (!key) return;
  const name = key.name;

  if (key.ctrl && name === "c" || name === "q" || name === "escape") {
    cleanup();
    return;
  }
  if (name === "r") {
    startGame();
    return;
  }
  if (name === "p" && !gameOver) {
    paused = !paused;
    render();
    if (paused) clearTimeout(timer);
    else scheduleTick();
    return;
  }

  if (!gameOver && !paused) {
    const keyDirections = { w: "up", up: "up", s: "down", down: "down", a: "left", left: "left", d: "right", right: "right" };
    setDirection(keyDirections[name]);
  }
}

function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  clearTimeout(timer);
  process.stdin.removeListener("keypress", handleKey);
  process.stdout.removeListener("resize", render);
  process.stdin.setRawMode(false);
  process.stdin.pause();
  process.stdout.write("\u001b[?25h\u001b[?1049l");
}

if (width < MIN_WIDTH || height < MIN_HEIGHT) {
  console.error("Your terminal is too small to start Snake. Make it at least 18 columns by 14 rows.");
  process.exit(1);
}

readline.emitKeypressEvents(process.stdin);
process.stdin.setRawMode(true);
process.stdin.setEncoding("utf8");
process.stdin.on("keypress", handleKey);
process.stdout.on("resize", render);
process.once("exit", () => {
  if (!cleanedUp) {
    clearTimeout(timer);
    process.stdin.setRawMode(false);
    process.stdout.write("\u001b[?25h\u001b[?1049l");
  }
});

process.stdout.write("\u001b[?1049h\u001b[?25l");
startGame();
