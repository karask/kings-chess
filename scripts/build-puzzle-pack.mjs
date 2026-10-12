#!/usr/bin/env node

import { createWriteStream, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";

const outputPath = resolve(process.argv[2] || "public/data/puzzles.json");
const manifestPath = resolve(process.argv[3] || "public/data/puzzle-manifest.json");
const sourceUrl = "https://database.lichess.org/lichess_db_puzzle.csv.zst";
const snapshot = "2026-08-02";
const targetThematic = 600;
const buckets = [
  { min: 800, max: 1099, target: 500, rows: [] },
  { min: 1100, max: 1299, target: 650, rows: [] },
  { min: 1300, max: 1499, target: 650, rows: [] },
  { min: 1500, max: 1699, target: 400, rows: [] },
  { min: 1700, max: 1900, target: 200, rows: [] },
];
const thematic = [];
const seen = new Set();
let rowsRead = 0;

function parse(line) {
  const columns = line.split(",");
  if (columns.length < 10 || columns[0] === "PuzzleId") return null;
  const [id, fenBeforeOpponentMove, moveText, ratingText, deviationText, popularityText, playsText, themeText, gameUrl, openingText = ""] = columns;
  const rating = Number(ratingText);
  const popularity = Number(popularityText);
  const nbPlays = Number(playsText);
  if (!id || !fenBeforeOpponentMove || !moveText || !Number.isFinite(rating)) return null;
  if (rating < 800 || rating > 1900 || popularity < 80 || nbPlays < 40) return null;
  const moves = moveText.trim().split(/\s+/);
  if (moves.length < 2) return null;
  const key = `${fenBeforeOpponentMove}|${moves.join(" ")}`;
  if (seen.has(key)) return null;
  return {
    id,
    fenBeforeOpponentMove,
    moves,
    learnerColor: fenBeforeOpponentMove.split(" ")[1] === "w" ? "black" : "white",
    rating,
    ratingDeviation: Number(deviationText),
    popularity,
    nbPlays,
    themes: themeText.trim().split(/\s+/).filter(Boolean),
    phase: themeText.includes("opening") ? "opening" : themeText.includes("endgame") ? "endgame" : "middlegame",
    openingTag: openingText.trim() || undefined,
    prompt: "Calculate the full line before moving.",
    explanation: "This position comes from the CC0 Lichess puzzle corpus. Replay the best defence and name the tactical motif after solving.",
    source: { provider: "lichess", snapshot, url: gameUrl || sourceUrl, license: "CC0-1.0" },
  };
}

function isFamilyPuzzle(row) {
  return /(^|\s)(Pirc_Defense|Kings_Indian_Defense|Kings_Indian_Attack)(\s|$)/.test(row.openingTag || "");
}

function complete() {
  return thematic.length >= targetThematic && buckets.every((bucket) => bucket.rows.length >= bucket.target);
}

function save() {
  const rows = [
    ...thematic.slice(0, targetThematic).map((row) => ({ ...row, openingFamily: row.openingTag.includes("Pirc") ? "pirc" : row.openingTag.includes("Attack") ? "kia" : "kid" })),
    ...buckets.flatMap((bucket) => bucket.rows.slice(0, bucket.target)),
  ];
  mkdirSync(dirname(outputPath), { recursive: true });
  const serializedRows = `${JSON.stringify(rows)}\n`;
  const stream = createWriteStream(outputPath);
  stream.end(serializedRows);
  const manifest = {
    id: "lichess-starter-2026-08",
    version: 1,
    generatedAt: new Date().toISOString(),
    source: sourceUrl,
    sourceSnapshot: snapshot,
    license: "CC0-1.0",
    count: rows.length,
    checksum: `sha256:${createHash("sha256").update(serializedRows).digest("hex")}`,
    thematicCount: Math.min(thematic.length, targetThematic),
    ratingRange: [800, 1900],
    filters: { minimumPopularity: 80, minimumPlays: 40, duplicatesRemoved: true },
    rowsRead,
  };
  mkdirSync(dirname(manifestPath), { recursive: true });
  const manifestStream = createWriteStream(manifestPath);
  manifestStream.end(`${JSON.stringify(manifest, null, 2)}\n`);
  process.stderr.write(`Built ${rows.length} puzzles after reading ${rowsRead} rows.\n`);
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", (line) => {
  rowsRead += 1;
  const row = parse(line);
  if (!row) return;
  const key = `${row.fenBeforeOpponentMove}|${row.moves.join(" ")}`;
  if (isFamilyPuzzle(row) && thematic.length < targetThematic) {
    thematic.push(row);
    seen.add(key);
  } else {
    const bucket = buckets.find((candidate) => row.rating >= candidate.min && row.rating <= candidate.max && candidate.rows.length < candidate.target);
    if (bucket) {
      bucket.rows.push(row);
      seen.add(key);
    }
  }
  if (complete()) input.close();
});
input.on("close", () => {
  if (!complete()) {
    process.stderr.write(`Warning: source ended before every quota was filled (${thematic.length} thematic).\n`);
  }
  save();
  if (process.stdin.destroy) process.stdin.destroy();
});
