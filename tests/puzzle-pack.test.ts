import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { applyUciMove, canonicalFen } from "../lib/chess";

type PuzzleFamily = "pirc" | "kid" | "kia";

interface PuzzlePackManifest {
  id: string;
  version: number;
  generatedAt: string;
  source: string;
  sourceSnapshot: string;
  license: string;
  count: number;
  checksum: string;
  thematicCount: number;
  ratingRange: [number, number];
  filters: {
    minimumPopularity: number;
    minimumPlays: number;
    duplicatesRemoved: boolean;
  };
  rowsRead: number;
}

interface PackedPuzzle {
  id: string;
  fenBeforeOpponentMove: string;
  moves: string[];
  learnerColor: "white" | "black";
  rating: number;
  popularity: number;
  nbPlays: number;
  openingFamily?: PuzzleFamily;
  source: {
    provider: string;
    snapshot: string;
    url: string;
    license: string;
  };
}

const packData = Promise.all([
  readFile(new URL("../public/data/puzzle-manifest.json", import.meta.url), "utf8"),
  readFile(new URL("../public/data/puzzles.json", import.meta.url), "utf8"),
]).then(([manifestJson, puzzlesJson]) => ({
  manifest: JSON.parse(manifestJson) as PuzzlePackManifest,
  puzzles: JSON.parse(puzzlesJson) as PackedPuzzle[],
  checksum: `sha256:${createHash("sha256").update(puzzlesJson).digest("hex")}`,
}));

test("the puzzle manifest describes the complete 3,000-puzzle artifact", async () => {
  const { manifest, puzzles, checksum } = await packData;
  const thematicPuzzles = puzzles.filter(({ openingFamily }) =>
    openingFamily === "pirc" || openingFamily === "kid" || openingFamily === "kia",
  );
  const ratings = puzzles.map(({ rating }) => rating);
  const popularity = puzzles.map((puzzle) => puzzle.popularity);
  const playCounts = puzzles.map((puzzle) => puzzle.nbPlays);

  assert.equal(manifest.count, 3_000);
  assert.equal(manifest.checksum, checksum);
  assert.equal(puzzles.length, manifest.count);
  assert.equal(thematicPuzzles.length, manifest.thematicCount);
  assert.equal(manifest.thematicCount, 600);
  assert.deepEqual(
    [Math.min(...ratings), Math.max(...ratings)],
    manifest.ratingRange,
  );
  assert.equal(
    Math.min(...popularity) >= manifest.filters.minimumPopularity,
    true,
  );
  assert.equal(
    Math.min(...playCounts) >= manifest.filters.minimumPlays,
    true,
  );
  assert.equal(manifest.filters.duplicatesRemoved, true);
  assert.equal(new Set(puzzles.map(({ id }) => id)).size, manifest.count);
  assert.equal(manifest.rowsRead >= manifest.count, true);
  assert.equal(Number.isNaN(Date.parse(manifest.generatedAt)), false);
});

test("every packed puzzle carries provenance matching the manifest", async () => {
  const { manifest, puzzles } = await packData;
  const failures: string[] = [];

  assert.equal(
    manifest.source,
    "https://database.lichess.org/lichess_db_puzzle.csv.zst",
  );
  assert.equal(manifest.license, "CC0-1.0");

  for (const puzzle of puzzles) {
    if (puzzle.source.provider !== "lichess") {
      failures.push(`${puzzle.id}: provider ${puzzle.source.provider}`);
    }
    if (puzzle.source.snapshot !== manifest.sourceSnapshot) {
      failures.push(`${puzzle.id}: snapshot ${puzzle.source.snapshot}`);
    }
    if (puzzle.source.license !== manifest.license) {
      failures.push(`${puzzle.id}: license ${puzzle.source.license}`);
    }
    try {
      const sourceUrl = new URL(puzzle.source.url);
      if (sourceUrl.protocol !== "https:" || sourceUrl.hostname !== "lichess.org") {
        failures.push(`${puzzle.id}: source URL ${puzzle.source.url}`);
      }
    } catch {
      failures.push(`${puzzle.id}: invalid source URL ${puzzle.source.url}`);
    }
  }

  assert.equal(failures.length, 0, failures.slice(0, 20).join("\n"));
});

test("all packed Lichess lines are legal and end on a learner ply", async () => {
  const { puzzles } = await packData;
  const failures: string[] = [];

  for (const puzzle of puzzles) {
    if (puzzle.moves.length < 2 || puzzle.moves.length % 2 !== 0) {
      failures.push(`${puzzle.id}: expected setup plus an odd-length solution`);
      continue;
    }

    let fen: string;
    try {
      fen = canonicalFen(puzzle.fenBeforeOpponentMove);
      for (const [index, move] of puzzle.moves.entries()) {
        fen = applyUciMove(fen, move).afterFen;
        if (index === 0) {
          const learnerToMove = fen.split(" ")[1] === "w" ? "white" : "black";
          if (learnerToMove !== puzzle.learnerColor) {
            failures.push(
              `${puzzle.id}: ${puzzle.learnerColor} learner but ${learnerToMove} moves`,
            );
          }
        }
      }
    } catch (error) {
      failures.push(
        `${puzzle.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  assert.equal(failures.length, 0, failures.slice(0, 20).join("\n"));
});
