/* King's Study Stockfish coordinator. Runs as a classic Web Worker. */

let engine = null;
let ready = false;
let activeJob = null;
let pendingJob = null;
let stoppedGeneration = null;

function send(message) {
  self.postMessage(message);
}

function cancelPending(reason) {
  if (!pendingJob) return;
  send({ type: "cancelled", generation: pendingJob.generation, reason });
  pendingJob = null;
}

function searchCommand(limits, searchMoves) {
  const parts = ["go"];
  if (Number.isInteger(limits.depth)) parts.push("depth", String(limits.depth));
  if (Number.isInteger(limits.moveTimeMs)) parts.push("movetime", String(limits.moveTimeMs));
  if (Number.isInteger(limits.nodes)) parts.push("nodes", String(limits.nodes));
  if (parts.length === 1) parts.push("depth", "16");
  if (searchMoves?.length) parts.push("searchmoves", ...searchMoves);
  return parts.join(" ");
}

function positionCommand(job) {
  if (!job.history) return `position fen ${job.fen}`;
  const moves = job.history.moves.length ? ` moves ${job.history.moves.join(" ")}` : "";
  return `position fen ${job.history.initialFen}${moves}`;
}

function start(job) {
  if (!engine || !ready || activeJob) {
    pendingJob = job;
    return;
  }
  activeJob = job;
  stoppedGeneration = null;
  engine.postMessage(`setoption name MultiPV value ${job.multiPv}`);
  // Opponent strength must never leak into the following coach analysis.
  engine.postMessage(`setoption name Skill Level value ${job.skillLevel ?? 20}`);
  engine.postMessage(positionCommand(job));
  engine.postMessage(searchCommand(job.limits, job.searchMoves));
}

function startPending() {
  if (!pendingJob || activeJob || !ready) return;
  const next = pendingJob;
  pendingJob = null;
  start(next);
}

function engineFailed(message) {
  send({ type: "error", message });
  try {
    engine?.terminate();
  } catch {
    // The browser may already have torn the nested worker down.
  }
  engine = null;
  ready = false;
  activeJob = null;
  pendingJob = null;
}

function onEngineMessage(event) {
  if (typeof event.data !== "string") {
    if (event.data && typeof event.data === "object" && "percent" in event.data) {
      send({ type: "progress", progress: event.data });
    }
    return;
  }

  const line = event.data.trim();
  if (line === "uciok") {
    engine.postMessage("isready");
    return;
  }
  if (line === "readyok") {
    ready = true;
    send({ type: "ready" });
    startPending();
    return;
  }

  if (!activeJob || (!line.startsWith("info ") && !line.startsWith("bestmove "))) return;
  const generation = activeJob.generation;
  send({ type: "line", generation, line });

  if (line.startsWith("bestmove ")) {
    activeJob = null;
    stoppedGeneration = null;
    startPending();
  }
}

function initialize(engineUrl) {
  if (engine) {
    if (ready) send({ type: "ready" });
    return;
  }
  if (typeof Worker !== "function" || typeof WebAssembly !== "object") {
    engineFailed("This browser cannot run the Stockfish WebAssembly worker.");
    return;
  }

  try {
    const resolvedUrl = new URL(
      engineUrl || "/engine/stockfish-18-lite-single.js",
      self.location.href,
    ).href;
    engine = new Worker(resolvedUrl);
    engine.onmessage = onEngineMessage;
    engine.onerror = (event) => {
      engineFailed(event.message || "Stockfish failed to load.");
    };
    engine.postMessage("uci");
  } catch (error) {
    engineFailed(error instanceof Error ? error.message : "Stockfish failed to initialize.");
  }
}

self.onmessage = (event) => {
  const message = event.data;
  if (!message || typeof message !== "object") return;

  switch (message.type) {
    case "init":
      initialize(message.engineUrl);
      break;

    case "analyze": {
      const job = {
        generation: message.generation,
        fen: message.fen,
        multiPv: message.multiPv,
        skillLevel: message.skillLevel,
        history: message.history,
        searchMoves: message.searchMoves,
        limits: message.limits || {},
      };
      cancelPending("superseded");
      if (activeJob) {
        pendingJob = job;
        if (stoppedGeneration !== activeJob.generation) {
          stoppedGeneration = activeJob.generation;
          engine.postMessage("stop");
        }
      } else {
        start(job);
      }
      break;
    }

    case "stop":
      if (pendingJob && (message.generation == null || pendingJob.generation === message.generation)) {
        cancelPending(message.reason || "stopped");
      }
      if (activeJob && (message.generation == null || activeJob.generation === message.generation)) {
        stoppedGeneration = activeJob.generation;
        engine?.postMessage("stop");
      }
      break;

    case "dispose":
      cancelPending("disposed");
      try {
        engine?.postMessage("quit");
        engine?.terminate();
      } finally {
        engine = null;
        activeJob = null;
        ready = false;
        self.close();
      }
      break;
  }
};
