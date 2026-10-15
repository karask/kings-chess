import assert from "node:assert/strict";
import test from "node:test";
import { Chess } from "chess.js";
import { assessMove, explainMove, type ExplainMoveInput } from "../lib/coaching";
import { EngineCancelledError, type StockfishClient } from "../lib/engine";
import type { EngineAnalysis, EngineSearchOptions } from "../lib/types";

const start = new Chess().fen();
const input: ExplainMoveInput = {
  beforeFen: start, playedMove: "a2a3", bestMove: "g1f3", family: "kia", classification: "mistake",
  playedLine: ["a2a3", "e7e5", "g1f3"], bestLine: ["g1f3", "d7d5", "g2g3"],
  bestScore: { type: "cp", value: 30 }, playedScore: { type: "cp", value: -100 },
};

function result(fen: string, pv: string[], value: number): EngineAnalysis {
  return { generation: 1, fen, perspective: new Chess(fen).turn(), bestMove: pv[0], ponderMove: null, elapsedMs: 1,
    lines: [{ multipv: 1, depth: 12, pv, score: { type: "cp", value } }] };
}

function comparisonEngine(probe?: (fen: string, options: EngineSearchOptions) => Promise<EngineAnalysis>) {
  const calls: Array<{ fen: string; options: EngineSearchOptions }> = [];
  const engine: Pick<StockfishClient, "analyze"> = { async analyze(fen, options = {}) {
    calls.push({ fen, options });
    if (new Chess(fen).turn() === "b") return probe ? probe(fen, options) : result(fen, ["e7e5", "f3e5", "b8c6"], -55);
    return options.searchMoves ? result(fen, input.playedLine, -100) : result(fen, input.bestLine, 30);
  } };
  return { calls, engine };
}

test("quiet move comparison explains concrete facts without upgrading them to tactical proof", () => {
  const explanation = explainMove(input);
  assert.equal(explanation.confidence, "limited");
  assert.equal(explanation.lesson?.basis, "position");
  assert.ok(explanation.lesson?.yourMove);
  assert.match(explanation.lesson?.alternative ?? "", /f3/);
  assert.ok(explanation.lesson?.takeaway);
  assert.ok(explanation.evidence.every((item) => item.kind === "position"));
  assert.equal(explanation.lesson?.responseCheck, undefined);
});

test("targeted reply check keeps full history, flips opponent score, and does not imply prevention", async () => {
  const { calls, engine } = comparisonEngine();
  const assessment = await assessMove(engine, { initialFen: start, moves: [], playedMove: input.playedMove, family: "kia" });
  assert.equal(calls.length, 5);
  const last = calls.at(-1)!;
  assert.deepEqual(last.options.history, { initialFen: start, moves: ["g1f3"] });
  assert.deepEqual(last.options.searchMoves, ["e7e5"]);
  assert.equal(last.options.nodes, 40_000);
  assert.equal(last.options.moveTimeMs, 750);
  assert.deepEqual(assessment.responseProbe?.score, { type: "cp", value: 55 });
  assert.deepEqual(assessment.responseProbe?.line, ["g1f3", "e7e5", "f3e5", "b8c6"]);
  assert.match(assessment.lesson?.responseCheck ?? "", /still possible.*Nf3/);
  assert.match(assessment.lesson?.responseCheck ?? "", /\+0\.55 from your side/);
  assert.match(assessment.lesson?.responseCheck ?? "", /does not prevent/);
  assert.equal(assessment.classification, "mistake");
  assert.deepEqual(JSON.parse(JSON.stringify(assessment)), assessment);
  assert.deepEqual(explainMove({ ...assessment, family: "kia" }).lesson, assessment.lesson);
});

test("stale, bound, or illegal extra reply analysis does not manufacture a comparison", async () => {
  for (const mode of ["stale", "bound", "illegal"] as const) {
    const { engine } = comparisonEngine(async (fen) => {
      const analysis = result(fen, mode === "illegal" ? ["e7e5", "f3f7"] : ["e7e5", "f3e5"], -40);
      if (mode === "stale") analysis.perspective = "w";
      if (mode === "bound") analysis.lines[0].score!.bound = "lower";
      return analysis;
    });
    const assessment = await assessMove(engine, { initialFen: start, moves: [], playedMove: input.playedMove, family: "kia" });
    assert.equal(assessment.responseProbe, undefined);
    assert.equal(assessment.lesson?.responseCheck, undefined);
    assert.equal(assessment.classification, "mistake");
  }
});

test("optional reply search failure preserves the assessment; cancellation still propagates", async () => {
  const { engine } = comparisonEngine(async () => { throw new Error("Optional search timed out"); });
  const assessment = await assessMove(engine, { initialFen: start, moves: [], playedMove: input.playedMove, family: "kia" });
  assert.equal(assessment.classification, "mistake");
  assert.equal(assessment.responseProbe, undefined);
  const { engine: cancelled } = comparisonEngine(async () => { throw new EngineCancelledError(); });
  await assert.rejects(assessMove(cancelled, { initialFen: start, moves: [], playedMove: input.playedMove, family: "kia" }), EngineCancelledError);
});

test("malformed or mismatched stored reply probes cannot create response text", () => {
  for (const line of [["g1f3", "e7e5", "f3f7"], ["a2a3", "e7e5", "g1f3"], ["g1f3", "d7d5", "g2g3"]]) {
    const explanation = explainMove({ ...input, responseProbe: { reply: "e7e5", line, score: { type: "cp", value: 100 } } });
    assert.equal(explanation.lesson?.responseCheck, undefined);
  }
});

test("a central capture alternative explains why the same pawn advance is no longer legal", () => {
  const board = new Chess(); board.move("e4"); board.move("d5");
  const explanation = explainMove({
    beforeFen: board.fen(), playedMove: "b1c3", bestMove: "e4d5", family: "kia", classification: "mistake",
    playedLine: ["b1c3", "d5d4"], bestLine: ["e4d5", "d8d5"],
  });
  assert.ok(explanation.lesson?.alternative);
  assert.match(explanation.lesson?.responseCheck ?? "", /After exd5, d4 is no longer a legal reply/);
  assert.equal(explanation.confidence, "limited");
});
