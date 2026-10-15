import type { MoveAssessment } from "../lib/coaching";

export function MoveLesson({ lesson, bestSan, classification }: {
  lesson: NonNullable<MoveAssessment["lesson"]>;
  bestSan: string;
  classification: MoveAssessment["classification"];
}) {
  const correction = ["inaccuracy", "mistake", "blunder"].includes(classification);
  return <dl className="move-lesson">
    <div><dt>Your move</dt><dd>{lesson.yourMove}</dd></div>
    {lesson.opponentReply ? <div><dt>Opponent’s response</dt><dd>{lesson.opponentReply}</dd></div> : null}
    {lesson.alternative ? <div><dt>{correction ? `Why ${bestSan} helps` : `Alternative: ${bestSan}`}</dt><dd>{lesson.alternative}
      {lesson.responseCheck ? <p className="lesson-response-check"><strong>Checked response:</strong> {lesson.responseCheck}</p> : null}
    </dd></div> : null}
    <div className="lesson-takeaway"><dt>Remember</dt><dd>{lesson.takeaway}</dd></div>
  </dl>;
}
