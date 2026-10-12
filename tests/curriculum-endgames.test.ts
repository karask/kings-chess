import assert from "node:assert/strict";
import test from "node:test";

import {
  chessCurriculum,
  endgameEssentials,
  familyEssentials,
  type OpeningFamily,
} from "../lib/curriculum";

const openingFamilies: readonly OpeningFamily[] = ["pirc", "kid", "kia"];

test("the essentials lane includes the three foundational endgame families", () => {
  assert.deepEqual(
    endgameEssentials.map(({ endingType }) => endingType).sort(),
    ["king-and-pawn", "minor-piece", "rook"],
  );

  for (const lesson of endgameEssentials) {
    assert.ok(
      familyEssentials.some(({ id }) => id === lesson.id),
      `${lesson.id} is missing from the rotating essentials lane`,
    );
  }

  assert.equal(chessCurriculum.endgameEssentials, endgameEssentials);
});

test("every endgame lesson is actionable and connects all three opening families", () => {
  const ids = new Set<string>();

  for (const lesson of endgameEssentials) {
    assert.equal(ids.has(lesson.id), false, `duplicate lesson id: ${lesson.id}`);
    ids.add(lesson.id);

    assert.ok(lesson.decisionRules.length >= 3, `${lesson.id} needs three decision rules`);
    assert.ok(lesson.technicalCheckpoint.length > 20, `${lesson.id} needs a technical checkpoint`);
    assert.ok(lesson.transferQuestion.endsWith("?"), `${lesson.id} needs a question prompt`);

    assert.deepEqual(
      Object.keys(lesson.familyApplications).sort(),
      [...openingFamilies].sort(),
    );

    for (const family of openingFamilies) {
      assert.ok(
        lesson.familyApplications[family].length > 30,
        `${lesson.id} needs a concrete ${family.toUpperCase()} application`,
      );
    }
  }
});

test("all family-essential ids remain stable and unique", () => {
  const ids = familyEssentials.map(({ id }) => id);
  assert.equal(new Set(ids).size, ids.length);
});
