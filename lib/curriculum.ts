export type OpeningFamily = "pirc" | "kid" | "kia";

export type LearnerColor = "white" | "black";

export type CurriculumPhase =
  | "foundation"
  | "structure"
  | "transfer"
  | "maintenance";

export type FamilyEssential = {
  id: string;
  title: string;
  principle: string;
  decisionRules: readonly {
    cue: string;
    response: string;
    reason: string;
  }[];
  misconception: string;
  transferQuestion: string;
};

export type EndgameEssential = FamilyEssential & {
  endingType: "king-and-pawn" | "minor-piece" | "rook";
  familyApplications: Readonly<Record<OpeningFamily, string>>;
  technicalCheckpoint: string;
};

export type OpeningBranch = {
  id: string;
  name: string;
  priority: "core" | "common" | "critical" | "extension";
  recognition: string;
  setup: readonly string[];
  plans: readonly string[];
  opponentPlans: readonly string[];
  pawnBreaks: readonly string[];
  tacticalMotifs: readonly string[];
  dangerSignals: readonly string[];
  recallCue: string;
};

export type OpeningModule = {
  family: OpeningFamily;
  name: string;
  learnerColor: LearnerColor;
  role: string;
  repertoireEntry: string;
  promise: string;
  honestLimits: readonly string[];
  learningObjectives: readonly string[];
  sharedTransfer: readonly string[];
  branches: readonly OpeningBranch[];
};

export type ModelGameSummary = {
  id: string;
  family: OpeningFamily;
  title: string;
  branchId: string;
  resultPerspective: "thematic-win" | "opponent-counterplay" | "quiet-conversion";
  startingStory: string;
  turningPoints: readonly string[];
  lesson: string;
  guessTheMovePrompts: readonly string[];
};

export type OpeningRecallPrompt = {
  id: string;
  family: OpeningFamily;
  branchId: string;
  phase: CurriculumPhase;
  fen: string;
  orientation: LearnerColor;
  prompt: string;
  choices: readonly {
    id: string;
    label: string;
  }[];
  correctChoiceId: string;
  acceptedMoves?: readonly string[];
  explanation: string;
  concepts: readonly string[];
};

export type MasteryStandard = {
  id: "recall" | "understanding" | "discrimination" | "application" | "transfer";
  label: string;
  evidence: string;
  defaultGate: string;
  failureResponse: string;
};

export type TrainingAllocation = {
  id: "bootcamp" | "maintenance";
  label: string;
  percentages: {
    openingsAndStructures: number;
    tacticsAndCalculation: number;
    endgames: number;
    modelGamesAndSelfAnalysis: number;
  };
  weeklyLoop: readonly string[];
};

const strategicFamilyEssentials = [
  {
    id: "inventory-the-center",
    title: "Read the centre before choosing a wing",
    principle:
      "The familiar fianchetto is only the starting shell. The centre decides whether the position calls for a break, a blockade, or patient improvement.",
    decisionRules: [
      {
        cue: "The opponent has built an unchallenged e4-d4 centre.",
        response: "Prepare ...e5 or ...c5 before starting a wing attack.",
        reason: "A broad centre becomes a strength if it is allowed to advance on ideal terms.",
      },
      {
        cue: "The centre is closed with d5 against ...e5.",
        response: "Compare the kingside ...f5 race with queenside counterplay before committing.",
        reason: "Closed pawn chains tell both players where space and pawn breaks belong.",
      },
      {
        cue: "The centre can still open immediately.",
        response: "Finish king safety and calculate forcing central exchanges first.",
        reason: "A wing pawn move is slow when files can open around an uncastled king.",
      },
    ],
    misconception: "The King's Indian family is not a fixed piece-placement recipe.",
    transferQuestion: "What is the centre's current tension, and which pawn break changes it in your favour?",
  },
  {
    id: "earn-the-pawn-break",
    title: "Prepare the break, do not merely remember it",
    principle:
      "The same pawn break can be excellent, premature, or impossible depending on development, king safety, and the squares it concedes.",
    decisionRules: [
      {
        cue: "...f5 is available in a closed KID centre.",
        response: "Check that e5 is supported and that the king is not opened by exf5.",
        reason: "The attack works when the centre remains stable long enough for pieces to join.",
      },
      {
        cue: "...c5 attacks d4 in a Pirc or KID structure.",
        response: "Count pressure on d4 and calculate d5, dxc5, and e5 replies.",
        reason: "The break is a concrete challenge, not a decorative thematic move.",
      },
      {
        cue: "White wants e4-e5 in the KIA.",
        response: "Verify control of d5 and f5 and decide where the f3-knight belongs afterward.",
        reason: "Closing the centre should gain a usable kingside space advantage, not strand the pieces.",
      },
    ],
    misconception: "A thematic move is not automatically a timely move.",
    transferQuestion: "What must be true before your intended pawn break works tactically?",
  },
  {
    id: "fianchetto-bishop",
    title: "Treat the fianchetto bishop as a strategic asset",
    principle:
      "The g2 or g7 bishop can restrain the centre, support an attack, or become a bad bishop behind a locked chain. Its value depends on diagonals, not on its opening label.",
    decisionRules: [
      {
        cue: "The long diagonal is blocked by your own e5 pawn.",
        response: "Look for a later ...exd4, ...c6, or piece route that gives the bishop a new job.",
        reason: "A temporarily blocked bishop can still support the king and future central play.",
      },
      {
        cue: "The opponent offers to exchange the fianchetto bishop.",
        response: "Evaluate dark-square safety and attacking speed before consenting.",
        reason: "The exchange may remove a key defender even when material stays equal.",
      },
      {
        cue: "The opponent's centre sits on dark squares.",
        response: "Preserve lines toward b2/e5/d4 and use pawn breaks to expose them.",
        reason: "The bishop becomes powerful when the central targets can no longer be supported by pawns.",
      },
    ],
    misconception: "A fianchetto bishop is not automatically strong simply because the diagonal is long.",
    transferQuestion: "Which future exchange or pawn move improves this bishop most?",
  },
  {
    id: "race-with-prophylaxis",
    title: "Race only after measuring the opponent",
    principle:
      "Many Pirc and KID positions feature attacks on opposite wings, but one useful defensive move can be worth more than another attacking pawn push.",
    decisionRules: [
      {
        cue: "Both sides are attacking on opposite wings.",
        response: "Compare forcing moves and count tempi to the first concrete threat.",
        reason: "Visual space does not reveal which attack lands first.",
      },
      {
        cue: "A queenside file is about to open against your king.",
        response: "Consider ...a6, ...c6, a king step, or an exchange of attackers.",
        reason: "Prophylaxis can buy the tempo that makes the counterattack sound.",
      },
      {
        cue: "Your intended attack needs several quiet manoeuvres.",
        response: "Identify the opponent's most forcing reply before beginning the route.",
        reason: "A plan is only real if the opponent cannot interrupt it profitably.",
      },
    ],
    misconception: "More pawns pointed at the king does not necessarily mean a faster attack.",
    transferQuestion: "If both plans continue without interruption, whose first forcing move arrives sooner?",
  },
  {
    id: "move-order-dag",
    title: "Recognize positions, not move-order stories",
    principle:
      "Pirc, KID, KIA, English, Reti, and anti-system move orders transpose. The board position is the source of truth.",
    decisionRules: [
      {
        cue: "The same pawn structure arrived through a different sequence.",
        response: "Reuse the plan only after checking whose move it is and where every minor piece sits.",
        reason: "One extra tempo or a differently placed knight can reverse a tactical detail.",
      },
      {
        cue: "An opponent avoids the named opening.",
        response: "Classify the centre and development rather than forcing the opening label.",
        reason: "A coherent repertoire must remain playable when no ECO name applies.",
      },
    ],
    misconception: "Reaching the familiar shell does not guarantee the familiar position.",
    transferQuestion: "Which concrete difference from the remembered tabiya changes the plan?",
  },
  {
    id: "candidate-discipline",
    title: "Use the same thinking loop in every phase",
    principle:
      "Opening knowledge should shorten candidate generation, not replace calculation.",
    decisionRules: [
      {
        cue: "You recognize the position.",
        response: "Still scan checks, captures, threats, and the opponent's last-move idea.",
        reason: "Familiarity is exactly when automatic play creates avoidable blunders.",
      },
      {
        cue: "No forcing move decides the position.",
        response: "Compare the thematic break, the worst-piece improvement, and one prophylactic move.",
        reason: "This produces a small, relevant candidate set without guessing.",
      },
    ],
    misconception: "Knowing the plan does not make a blunder check optional.",
    transferQuestion: "What changed on the opponent's last move, and which candidate exploits or answers it?",
  },
] as const satisfies readonly FamilyEssential[];

export const endgameEssentials = [
  {
    id: "endgame-king-and-pawn",
    title: "Count the pawn ending before trading into it",
    endingType: "king-and-pawn",
    principle:
      "A simplified pawn ending is still concrete calculation: locate the key squares, determine the opposition, count both king routes, and preserve any useful reserve tempo.",
    decisionRules: [
      {
        cue: "A Pirc or KID central break could trade the last pieces.",
        response: "Mark each candidate passed pawn, count both king routes, and compare the races before exchanging.",
        reason: "The space-gaining centre may become either a target or a distant passer once the pieces disappear.",
      },
      {
        cue: "A KIA c4 or c3-d4 exchange leaves a queenside majority.",
        response: "Activate the king before fixing the pawns, then create the passer with the fewest pawn moves.",
        reason: "Keeping pawn tension preserves tempi and makes it harder for the defending king to blockade the majority.",
      },
      {
        cue: "Only kings and one relevant pawn wing remain.",
        response: "Identify the pawn's key squares, take the opposition when it gains entry, and recount after every pawn move.",
        reason: "One square of king access or one spare pawn move often changes the theoretical result.",
      },
    ],
    misconception: "Fewer pieces do not make a pawn ending safe to enter by intuition.",
    transferQuestion: "After the proposed exchange, which king reaches which key square first, and who owns the last reserve tempo?",
    familyApplications: {
      pirc: "After ...c5 or ...e5 dissolves White's centre, compare king activity with the resulting queenside majority before simplifying further.",
      kid: "In Exchange and closed-centre structures, decide whether White's space becomes a passed pawn or a fixed target when the last pieces leave.",
      kia: "Use c4 or c3-d4 to create a workable queenside majority, then improve the king before committing its pawns.",
    },
    technicalCheckpoint: "From a king-and-one-pawn position, name the key squares, the opposition, and the result before making a move.",
  },
  {
    id: "endgame-minor-piece",
    title: "Match the minor piece to the pawn structure",
    endingType: "minor-piece",
    principle:
      "Bishops want open diagonals and targets on both wings; knights want stable outposts and fixed pawns. Judge the surviving piece by the structure it will have to play, not its opening reputation.",
    decisionRules: [
      {
        cue: "A closed Pirc or KID centre leaves Bg7 behind the e5 pawn.",
        response: "Compare a freeing break with exchanging the bishop for White's best blockader before accepting a bad bishop.",
        reason: "The bishop can become excellent if the centre opens, but it is poor if the pawn chain stays fixed without a useful target.",
      },
      {
        cue: "The KIA bishop on g2 survives into an ending against a knight.",
        response: "Open a second wing, keep your pawns off the bishop's colour, and fix enemy pawns on that colour.",
        reason: "A bishop stretches the knight when play exists on both wings and its own pawns do not obstruct it.",
      },
      {
        cue: "The position is closed on one wing with a protected central outpost.",
        response: "Prefer the knight or remove its outpost before trading the other minor piece.",
        reason: "A secure knight can blockade and attack fixed pawns while a bishop has no entry diagonal.",
      },
    ],
    misconception: "The fianchetto bishop is neither automatically worth preserving nor automatically bad when its diagonal closes.",
    transferQuestion: "After the next pawn break or exchange, will the position favour long-range play or a stable blockade?",
    familyApplications: {
      pirc: "Central exchanges decide whether Bg7 becomes an active long-range piece or should remove a knight controlling the dark squares.",
      kid: "In closed centres, weigh the freeing ...f5/...c6 break against White's d5 or c5 knight outposts before choosing exchanges.",
      kia: "The g2 bishop gains value when c4 or c3-d4 opens a second wing; avoid burying it behind fixed light-square pawns.",
    },
    technicalCheckpoint: "Name the best outpost, the bishop's useful diagonal, and which side benefits from play on both wings.",
  },
  {
    id: "endgame-rook",
    title: "Choose rook activity before pawn collecting",
    endingType: "rook",
    principle:
      "Active rooks, king cutoffs, and placement behind passed pawns usually matter more than grabbing one pawn. Know the Lucena bridge for winning and the Philidor third-rank defence for holding.",
    decisionRules: [
      {
        cue: "A KID Exchange position gives Black an open d-file.",
        response: "Occupy the file, seek an entry rank, or cut off the enemy king before chasing a flank pawn.",
        reason: "The active rook created by ...Rxd8 is the compensation that makes the queenless structure playable.",
      },
      {
        cue: "A Pirc or KIA central break creates a passed pawn.",
        response: "Place the rook behind the passer—your own or the opponent's—and bring the king toward the remaining pawns.",
        reason: "The rook gains checking distance and keeps working as the passed pawn advances.",
      },
      {
        cue: "One side has rook and pawn versus rook with the defending king cut off.",
        response: "Build the Lucena bridge when attacking; reach the Philidor third rank or use distant side checks when defending.",
        reason: "Recognizing the theoretical setup replaces guesswork with a known winning or drawing method.",
      },
    ],
    misconception: "An extra pawn does not compensate for a passive rook and a king trapped by checks.",
    transferQuestion: "Can your rook become active, get behind the passer, or cut off the king before either side takes a pawn?",
    familyApplications: {
      pirc: "The ...c5 and ...e5 breaks often open a central file; claim it before harvesting the loosened centre pawns.",
      kid: "Treat the rook on d8 in Exchange structures as an active asset and preserve its entry squares with tempo.",
      kia: "After c4 or c3-d4 opens files, use the rook behind a queenside passer while the king handles the other wing.",
    },
    technicalCheckpoint: "Identify the active rook, the useful king cutoff, and whether Lucena, Philidor, or side checks govern the position.",
  },
] as const satisfies readonly EndgameEssential[];

export const familyEssentials = [
  ...strategicFamilyEssentials,
  ...endgameEssentials,
] as const satisfies readonly FamilyEssential[];

export const openingModules = {
  pirc: {
    family: "pirc",
    name: "Pirc Defence",
    learnerColor: "black",
    role: "Black's compact answer to 1.e4, built around ...d6, ...Nf6, ...g6, and a timed central challenge.",
    repertoireEntry: "1.e4 d6 2.d4 Nf6 3.Nc3 g6",
    promise:
      "A narrow family of recurring structures in which Black learns to attack an advanced centre rather than memorize a different defence for every branch.",
    honestLimits: [
      "White receives space and several direct attacking setups, so passive shell-building is dangerous.",
      "The Austrian and 150 Attack contain forcing lines that must be recalled accurately.",
      "Early deviations may remain Modern, Philidor, or independent positions rather than a true Pirc.",
    ],
    learningObjectives: [
      "Choose between ...e5 and ...c5 from the centre and development, not from habit.",
      "Meet opposite-side castling with concrete counterplay while respecting king safety.",
      "Recognize when pressure on e4 or d4 permits ...Nxe4, ...c5, or a queenside expansion.",
    ],
    sharedTransfer: [
      "KID-style pressure on a broad pawn centre.",
      "Dark-square defence around a fianchettoed king.",
      "Opposite-wing race calculation that also appears in sharp KIA games.",
    ],
    branches: [
      {
        id: "pirc-austrian",
        name: "Austrian Attack",
        priority: "critical",
        recognition: "White builds e4-d4-f4 and intends e5, often followed by direct kingside play.",
        setup: ["1.e4 d6", "2.d4 Nf6", "3.Nc3 g6", "4.f4"],
        plans: [
          "Develop with ...Bg7 and ...O-O only after checking e5 tactics.",
          "Challenge d4 with ...c5 or strike with ...e5 when the resulting centre is sound.",
          "Use ...Na6/...Nc6 and queen pressure to make White defend the centre.",
        ],
        opponentPlans: ["e5 space gain", "f5 attack", "Bd3/Qe1-h4 battery"],
        pawnBreaks: ["...c5", "...e5", "...b5 in suitable queenside structures"],
        tacticalMotifs: ["pressure on e4", "...Nxe4 clearance", "queen checks on b6/a5"],
        dangerSignals: ["e5 attacks f6 with tempo", "an uncastled king on e8", "automatic ...O-O into e5-f5"],
        recallCue: "White has committed f-pawn support: challenge the centre before the attack runs itself.",
      },
      {
        id: "pirc-150",
        name: "150 Attack / Be3-Qd2",
        priority: "critical",
        recognition: "White places Be3, Qd2, often f3, and prepares long castling plus h-pawn play.",
        setup: ["Be3", "Qd2", "f3 or Nf3", "O-O-O"],
        plans: [
          "Prepare queenside space with ...c6 and ...b5 when the centre permits it.",
          "Exchange the h6 bishop only after evaluating the dark squares around g8.",
          "Use ...Nbd7, ...Qc7, and central counterplay so the attack cannot proceed for free.",
        ],
        opponentPlans: ["Bh6 exchange", "h4-h5", "g4", "e5 when Black is undeveloped"],
        pawnBreaks: ["...c5", "...b5", "...e5"],
        tacticalMotifs: ["...Nxe4 against loose support", "...b4 on Nc3", "sacrifices on e4/c3"],
        dangerSignals: ["opening the h-file for White", "queenside expansion before castling long", "ignoring e5"],
        recallCue: "Against long castling, central speed and king safety decide whether ...b5 is attack or self-harm.",
      },
      {
        id: "pirc-classical",
        name: "Classical System",
        priority: "core",
        recognition: "White develops Nf3 and Be2, castles short, and keeps the centre flexible.",
        setup: ["Nf3", "Be2", "O-O"],
        plans: [
          "Use ...e5 to establish a compact central foothold when d5 can be met productively.",
          "Choose ...c5 when direct pressure on d4 yields useful open files.",
          "Improve with ...Nbd7, ...c6, or ...Re8 according to White's central choice.",
        ],
        opponentPlans: ["Re1 and Bf1", "d5 space", "h3/Be3/Qd2 without long castling"],
        pawnBreaks: ["...e5", "...c5", "...d5 in rare fully prepared positions"],
        tacticalMotifs: ["e4 pressure", "central exchanges opening Bg7", "...Nxe4 with pins"],
        dangerSignals: ["drifting without a central break", "blocking Bg7 indefinitely", "premature queenside pawns"],
        recallCue: "White is solid rather than forcing: claim a central challenge and then improve the worst piece.",
      },
      {
        id: "pirc-fianchetto",
        name: "Fianchetto System",
        priority: "common",
        recognition: "White uses g3 and Bg2, reducing immediate mating threats but strengthening central control.",
        setup: ["g3", "Bg2", "Nge2 or Nf3"],
        plans: [
          "Contest e4/d4 with ...e5 or ...c5 before White completes effortless development.",
          "Expect a manoeuvring game and improve the queenside knight deliberately.",
          "Use open central files rather than inventing a kingside pawn storm against Bg2.",
        ],
        opponentPlans: ["h3/Be3", "d5 space", "a4 to restrain queenside expansion"],
        pawnBreaks: ["...e5", "...c5"],
        tacticalMotifs: ["central pins", "pressure on d4", "Bg7 discoveries after exchanges"],
        dangerSignals: ["assuming the quiet setup has no central threat", "weakening dark squares with ...f5 too early"],
        recallCue: "The attack is quieter, so win time by challenging the centre, not by forcing a wing race.",
      },
      {
        id: "pirc-byrne-deviations",
        name: "Byrne/Bg5 and Early Deviations",
        priority: "common",
        recognition: "White pins Nf6 with Bg5 or delays d4/Nc3 to keep independent options.",
        setup: ["early Bg5", "2.Nf3", "2.f4", "2.Nc3", "2.d3"],
        plans: [
          "Question the pin with ...h6 only when the resulting dark squares are safe.",
          "Use ...c6 or ...Nbd7 to prepare a central break without losing move-order flexibility.",
          "Classify Philidor, Modern, and KIA transpositions instead of forcing a Pirc label.",
        ],
        opponentPlans: ["Qd2 and long castling", "f4 without d4", "quiet KIA development"],
        pawnBreaks: ["...e5", "...c5", "...b5 only after the centre is stable"],
        tacticalMotifs: ["bishop traps after ...h6/g5", "Nf6 pins", "queen pressure on d4"],
        dangerSignals: ["chasing Bg5 while behind in development", "using the standard shell against an altered centre"],
        recallCue: "Name the actual centre first; the opening name is secondary.",
      },
    ],
  },
  kid: {
    family: "kid",
    name: "King's Indian Defence",
    learnerColor: "black",
    role: "Black's main family against 1.d4/c4/Nf3 when White builds a broad centre.",
    repertoireEntry: "1.d4 Nf6 2.c4 g6 3.Nc3 Bg7 4.e4 d6",
    promise:
      "Recurring centre chains, manoeuvres, and pawn breaks provide depth from one coherent family rather than a wide catalogue of unrelated openings.",
    honestLimits: [
      "The KID is strategically and tactically demanding; it reduces breadth, not depth.",
      "London, Torre, Colle, English, and Reti move orders may never transpose to the classical KID centre.",
      "The familiar kingside attack is only one branch; Fianchetto and Exchange structures require different play.",
    ],
    learningObjectives: [
      "Read whether the centre calls for ...e5, ...c5, or patient development.",
      "Execute the closed-centre ...f5 plan without ignoring White's queenside breakthrough.",
      "Defend space-disadvantaged positions actively and recognize when simplification helps Black.",
    ],
    sharedTransfer: [
      "Pirc pressure on e4/d4 and dark-square control.",
      "KIA centre-chain attacks with colors and tempi reversed.",
      "Universal skills in pawn races, prophylaxis, and worst-piece improvement.",
    ],
    branches: [
      {
        id: "kid-classical-closed",
        name: "Classical / Closed Centre",
        priority: "core",
        recognition: "After ...e5 and d5, the pawn chains lock and play divides between wings.",
        setup: ["Nf3", "Be2", "O-O", "...e5", "d5"],
        plans: [
          "Reroute Ne7, prepare ...f5, and bring pieces toward the kingside only after checking c5/c6 counterplay.",
          "Use ...Nh5, ...f5, ...f4, and ...g5-g4 when the centre remains closed.",
          "Insert ...a5 or ...c6 when it meaningfully slows b4-c5.",
        ],
        opponentPlans: ["b4-c5 queenside break", "Nd3 and c5 outposts", "minor-piece exchanges that slow the attack"],
        pawnBreaks: ["...f5", "...c6", "...g5-g4"],
        tacticalMotifs: ["...f4 forks", "sacrifices on g3/h3", "...Nxe4 before the centre closes"],
        dangerSignals: ["White opens the c-file first", "...f5 leaves e6/g6 loose", "attack launched without enough pieces"],
        recallCue: "Closed centre: compare ...f5 speed with b4-c5 speed before choosing the next attacker.",
      },
      {
        id: "kid-samisch",
        name: "Sämisch",
        priority: "critical",
        recognition: "White plays f3 to hold e4 and support Be3/Qd2, often with long-castling ideas.",
        setup: ["f3", "Be3", "Qd2"],
        plans: [
          "Secure the king and choose ...e5 or ...c5 based on White's development.",
          "Attack the dark squares created by f3 while respecting White's space.",
          "Use queenside play when White castles long; avoid a slow automatic kingside plan.",
        ],
        opponentPlans: ["Qd2 and O-O-O", "g4", "d5 space", "h4-h5"],
        pawnBreaks: ["...e5", "...c5", "...b5 in long-castled lines"],
        tacticalMotifs: ["...Nxe4 if c3 is overloaded", "queen checks on a5", "dark-square sacrifices"],
        dangerSignals: ["castling into a prepared pawn storm without central play", "opening the centre with the king on e8"],
        recallCue: "f3 makes e4 firm but costs a tempo and dark squares; strike where White's king choice permits.",
      },
      {
        id: "kid-four-pawns",
        name: "Four Pawns Attack",
        priority: "critical",
        recognition: "White uses c4, d4, e4, and f4 to seize maximum space before completing development.",
        setup: ["c4", "d4", "e4", "f4"],
        plans: [
          "Finish king safety, then attack the pawn chain with ...c5 or ...e5.",
          "Target the squares and lagging development behind the impressive pawn front.",
          "Calculate every central exchange because one opened file can decide the game quickly.",
        ],
        opponentPlans: ["e5 gaining space", "Nf3/Be2/O-O consolidation", "d5 cramping Black"],
        pawnBreaks: ["...c5", "...e5"],
        tacticalMotifs: ["central pins", "...Nxe4", "queen checks after the centre opens"],
        dangerSignals: ["passive development with no challenge", "premature ...f5 against four connected pawns"],
        recallCue: "Maximum space means maximum obligation: attack the base before White consolidates.",
      },
      {
        id: "kid-fianchetto",
        name: "Fianchetto Variation",
        priority: "common",
        recognition: "White fianchettos Bg2 and castles short, placing extra control on central and queenside dark squares.",
        setup: ["Nf3", "g3", "Bg2", "O-O"],
        plans: [
          "Use ...c5 and queenside pressure more often than a standard ...f5 mating race.",
          "Develop ...Nbd7, ...e5, or ...Nc6 according to d5 and central exchanges.",
          "Seek active files and good piece trades if White neutralizes the kingside.",
        ],
        opponentPlans: ["d5 space", "e4 and h3", "Rb1/b4", "pressure on the long diagonal"],
        pawnBreaks: ["...c5", "...e5", "...b5 in Benoni-like structures"],
        tacticalMotifs: ["pressure on d4", "long-diagonal discoveries", "queenside exchange sacrifices"],
        dangerSignals: ["autopilot ...f5 into a secure king", "allowing d5 with no counter-break"],
        recallCue: "Against Bg2, seek central and queenside activity before assuming a kingside race exists.",
      },
      {
        id: "kid-averbakh",
        name: "Averbakh System",
        priority: "common",
        recognition: "White develops Be2 and Bg5 before Nf3, discouraging an easy ...e5/...f5 sequence.",
        setup: ["Be2", "Bg5"],
        plans: [
          "Challenge the centre with ...c5 while White's kingside knight is undeveloped.",
          "Use ...Na6 or ...Nbd7 without allowing the pin to dictate every move.",
          "Question Bg5 only when ...h6 does not create a target or waste a vital tempo.",
        ],
        opponentPlans: ["Qd2", "d5", "h4", "restraining ...f5"],
        pawnBreaks: ["...c5", "...e5 in suitable move orders"],
        tacticalMotifs: ["queen pressure on a5", "d4 overload", "bishop retreats after ...h6"],
        dangerSignals: ["forcing ...f5 through the pin", "losing central time by chasing Bg5"],
        recallCue: "Bg5 restrains the familiar plan; answer with central play, not irritation.",
      },
      {
        id: "kid-petrosian",
        name: "Petrosian System",
        priority: "common",
        recognition: "White closes with d5 early and uses a restrained setup to slow Black's kingside play.",
        setup: ["Nf3", "Be2", "...e5", "d5 before O-O"],
        plans: [
          "Use ...a5 to restrain b4 and gain time for the kingside regrouping.",
          "Choose between ...Na6, ...Nbd7, and ...c6 based on White's queenside pieces.",
          "Do not manufacture an attack before development is complete.",
        ],
        opponentPlans: ["b4-c5", "Bg5", "Nd2-c4"],
        pawnBreaks: ["...f5", "...c6"],
        tacticalMotifs: ["...Nxe4 before full support", "queenside pawn targets", "f-file pressure"],
        dangerSignals: ["White achieves c5 without concession", "...f5 opens e6 before pieces are ready"],
        recallCue: "White is slowing the race; restrain b4, complete the regrouping, then break.",
      },
      {
        id: "kid-exchange",
        name: "Exchange Variation",
        priority: "common",
        recognition: "White exchanges on e5 and often queens, replacing the mating race with an active ending.",
        setup: ["...e5", "dxe5", "...dxe5", "Qxd8", "...Rxd8"],
        plans: [
          "Use the active rook on d8 and develop quickly before White stabilizes.",
          "Fight for d4/d3 and improve the queenside knight.",
          "Judge simplification by piece activity and pawn structure, not by disappointment that queens came off.",
        ],
        opponentPlans: ["Nd5", "Bg5", "rook control of the d-file", "queenside majority play"],
        pawnBreaks: ["...c6 followed by ...Be6", "...f5 only when development supports it"],
        tacticalMotifs: ["d-file pins", "...Nxe4", "back-rank development tactics"],
        dangerSignals: ["ceding d5 permanently", "playing attack moves in an endgame-shaped position"],
        recallCue: "Queens are gone: activity, d-file control, and square ownership replace the kingside script.",
      },
      {
        id: "kid-anti-systems",
        name: "London, Torre, and Colle Anti-Systems",
        priority: "core",
        recognition: "White develops without c4/e4, so the classical KID centre never appears automatically.",
        setup: ["early Bf4 or Bg5", "e3", "Nf3", "c3 in Colle setups"],
        plans: [
          "Challenge d4 with ...c5 and exploit White's slower central expansion.",
          "Develop the KID shell only while it serves the actual centre.",
          "Use ...d6, ...Nbd7, and ...e5 when the break gains space without leaving holes.",
        ],
        opponentPlans: ["solid development", "h3/Bh2", "Nbd2/e4 break", "Ne5 outpost"],
        pawnBreaks: ["...c5", "...e5", "...b6 in selected structures"],
        tacticalMotifs: ["Qb6 pressure", "e5 central fork", "Bf4 targets"],
        dangerSignals: ["playing ...e5 into a prepared dxe5", "waiting until White gets e4 for free"],
        recallCue: "No c4/e4 centre means no automatic KID plan; claim central space while it is available.",
      },
      {
        id: "kid-english-reti",
        name: "English and Reti Move Orders",
        priority: "core",
        recognition: "White begins with c4/Nf3/g3 and may transpose to a KID or keep an independent English centre.",
        setup: ["1.c4 or 1.Nf3", "g3", "Bg2", "delayed d4/e4"],
        plans: [
          "Enter the KID with ...e5 or ...d6 only when White has built the corresponding centre.",
          "Against a pure English, contest d4 and b4 while completing development.",
          "Track move-order tactics around ...e5, d4, and Nxe5 rather than relying on the name.",
        ],
        opponentPlans: ["b4 expansion", "d4 transposition", "e3/d4 restrained centre", "Rb1"],
        pawnBreaks: ["...e5", "...c5", "...d5 when it can be achieved cleanly"],
        tacticalMotifs: ["e4/d4 occupation", "long-diagonal pressure", "b4 counterplay"],
        dangerSignals: ["assuming d4 will eventually appear", "using a closed-centre kingside plan in an open English"],
        recallCue: "Wait for the pawn structure to identify itself; keep the setup flexible until then.",
      },
    ],
  },
  kia: {
    family: "kia",
    name: "King's Indian Attack",
    learnerColor: "white",
    role: "White's flexible Nf3-g3-Bg2-d3-O-O framework, with the plan chosen from Black's centre.",
    repertoireEntry: "1.Nf3 followed by g3, Bg2, d3, O-O, and usually Nbd2/e4",
    promise:
      "A consistent development family that reaches familiar decisions without claiming the same attacking plan works against every black setup.",
    honestLimits: [
      "Black can equalize comfortably if White plays the shell without a timely central claim.",
      "Against ...d5 and ...c5, White may need c4 or c3-d4 rather than an automatic e5 attack.",
      "Move orders can transpose to Reti, English, reversed Pirc, or Dutch positions.",
    ],
    learningObjectives: [
      "Choose e5, c4, or c3-d4 from Black's centre.",
      "Build a kingside attack only when the centre is closed and the pieces can reach useful squares.",
      "Play quiet symmetrical and queenside positions without pretending they are failed KIA attacks.",
    ],
    sharedTransfer: [
      "KID closed-centre manoeuvres with an extra tempo and reversed colors.",
      "Pirc understanding of dark-square fianchetto structures.",
      "General skill in switching from an intended opening to the position actually reached.",
    ],
    branches: [
      {
        id: "kia-versus-e6",
        name: "KIA versus ...e6 / French-style Centre",
        priority: "core",
        recognition: "Black supports d5 with ...e6; White can often close with e5 and build a kingside space advantage.",
        setup: ["Nf3", "g3", "Bg2", "d3", "Nbd2", "e4-e5"],
        plans: [
          "Reroute Nf1-h2/g4 and coordinate Qe2, h4-h5, and Nf1 only after e5 is secure.",
          "Watch Black's ...f6 break and be ready to reinforce or open the e-file.",
          "Improve the queenside pieces while the attack is being prepared.",
        ],
        opponentPlans: ["...f6 challenge", "...b5 queenside space", "...c4 gaining queenside room"],
        pawnBreaks: ["e5", "h4-h5", "c4 when the centre demands it"],
        tacticalMotifs: ["e5-e6", "sacrifices on h7", "Ng5/Qh5 batteries"],
        dangerSignals: ["e5 loses d5/f5 control", "an attack with the queenside undeveloped", "ignoring ...f6"],
        recallCue: "A stable e5 chain grants kingside space; route pieces before pushing every pawn.",
      },
      {
        id: "kia-versus-c5",
        name: "KIA versus ...c5 / Sicilian-style Setup",
        priority: "core",
        recognition: "Black attacks d4 from c5 and may use ...Nc6, ...g6, and ...Bg7 before White closes the centre.",
        setup: ["...c5", "...Nc6", "often ...g6/Bg7"],
        plans: [
          "Use c3 to support d4 when a broad central claim is available.",
          "Choose e5 only after checking d5, f5, and Black's ...d5 break.",
          "Develop Qe2/Re1 and keep both central breaks available.",
        ],
        opponentPlans: ["...d5 equalizing break", "...e5 clamp", "queenside expansion"],
        pawnBreaks: ["c3-d4", "e5", "b4 in selected Reti structures"],
        tacticalMotifs: ["Nxe5 tactics", "e-file pressure", "long-diagonal clashes"],
        dangerSignals: ["closing with e5 while d5 collapses", "letting ...d5 arrive in one move"],
        recallCue: "Against ...c5, decide whether the position wants c3-d4 before committing to e5.",
      },
      {
        id: "kia-versus-d5",
        name: "KIA versus ...d5 / Classical Centre",
        priority: "core",
        recognition: "Black occupies d5 directly and may build ...c5/e5, leaving White little time for a purely quiet setup.",
        setup: ["...d5", "...Nf6", "often ...c5"],
        plans: [
          "Challenge with c4 or prepare c3-d4 before Black owns the entire centre.",
          "If Black advances ...d4, undermine the chain rather than attacking on the wing.",
          "Use the fianchetto bishop against d5/b7 as central lines open.",
        ],
        opponentPlans: ["...c5 and ...Nc6", "...e5 broad centre", "...d4 space gain"],
        pawnBreaks: ["c4", "c3 followed by d4", "e4-e5 only when supported"],
        tacticalMotifs: ["pressure on d5", "Qa4+ pins", "e5 discovered attacks"],
        dangerSignals: ["allowing ...d4 with no undermining plan", "starting h4 while the centre can open"],
        recallCue: "Black has claimed d5: answer the centre before beginning the KIA manoeuvre carousel.",
      },
      {
        id: "kia-mirrored",
        name: "Mirrored Fianchetto",
        priority: "common",
        recognition: "Both sides fianchetto and may place pawns on e4/e5, producing a balanced manoeuvring game.",
        setup: ["Nf3/Nf6", "g3/g6", "Bg2/Bg7", "e4/e5"],
        plans: [
          "Complete development and identify the better central break rather than forcing a kingside attack.",
          "Use c3-d4, c4, or a queenside expansion according to Black's setup.",
          "Improve the least active knight and keep the centre flexible.",
        ],
        opponentPlans: ["...d5", "...c5", "symmetrical simplification"],
        pawnBreaks: ["c3-d4", "c4", "f4 only with concrete support"],
        tacticalMotifs: ["long-diagonal discoveries", "central forks", "back-rank tactics"],
        dangerSignals: ["assuming an attack because the opening is called KIA", "weakening the king in symmetry"],
        recallCue: "Symmetry rewards the first useful break, not the first pawn storm.",
      },
      {
        id: "kia-versus-dutch",
        name: "KIA versus Dutch-style ...f5",
        priority: "common",
        recognition: "Black commits ...f5 and often ...g6, weakening e6 and the dark squares while gaining kingside space.",
        setup: ["...f5", "...Nf6", "...g6/Bg7"],
        plans: [
          "Pressure e5/f5 with e4, Nh4, and a timely f4 or exf5.",
          "Open the centre if Black's king attack advances ahead of development.",
          "Keep the g2 bishop relevant against b7 while contesting e5.",
        ],
        opponentPlans: ["...e5", "...Nc6", "...Qe8-h5", "kingside expansion"],
        pawnBreaks: ["e4", "exf5", "f4", "c4 against a rigid centre"],
        tacticalMotifs: ["Qb3+", "e6 weakness", "Nh4 hitting f5"],
        dangerSignals: ["closing the centre in Black's favour", "allowing ...f4 with no retreat square"],
        recallCue: "...f5 creates space and targets; pressure e5/f5 before Black coordinates the attack.",
      },
      {
        id: "kia-early-e5",
        name: "Early ...e5 and Reversed-Pirc Structures",
        priority: "common",
        recognition: "Black occupies e5 before White has played e4, so an automatic KIA centre may be too slow.",
        setup: ["...d6", "...e5", "often ...f5"],
        plans: [
          "Use c4 to challenge d5 and prevent Black from owning every central square.",
          "Play e4 only after checking ...e4 advances and f-file tactics.",
          "Treat the position as a Reti or reversed Pirc when that description fits better.",
        ],
        opponentPlans: ["...f5-f4", "...Nf6", "...g6/Bg7", "central space clamp"],
        pawnBreaks: ["c4", "e4", "b4 in suitable English structures"],
        tacticalMotifs: ["central pawn forks", "Qa4+", "Nxe5 after pins"],
        dangerSignals: ["letting ...e4 dislodge Nf3", "playing d3/e4 with no challenge to d4"],
        recallCue: "Black took e5 first; contest the rest of the centre instead of copying a memorized order.",
      },
    ],
  },
} as const satisfies Record<OpeningFamily, OpeningModule>;

export const modelGameSummaries = [
  {
    id: "pirc-model-central-strike",
    family: "pirc",
    title: "The centre is the target, not the scenery",
    branchId: "pirc-austrian",
    resultPerspective: "thematic-win",
    startingStory:
      "White builds the Austrian pawn centre and begins kingside development. Black completes only the development needed to make ...c5 concrete.",
    turningPoints: [
      "Black declines a premature wing move and increases pressure on d4.",
      "A central exchange opens Bg7 and makes e4 a tactical target.",
      "Only after White's centre fragments does Black expand on the queenside.",
    ],
    lesson: "The Pirc succeeds when the centre is provoked into targets before the counterattack begins.",
    guessTheMovePrompts: [
      "Which break attacks the base of White's centre?",
      "After the centre opens, which piece improves most?",
      "What is White's forcing reply to your intended break?",
    ],
  },
  {
    id: "pirc-model-opposite-wings",
    family: "pirc",
    title: "One defensive tempo wins the race",
    branchId: "pirc-150",
    resultPerspective: "opponent-counterplay",
    startingStory:
      "White castles long and advances the h-pawn. Black has queenside space but mistakes visual progress for a faster attack.",
    turningPoints: [
      "Black pushes ...b5 before resolving the central e5 threat.",
      "White opens a line with tempo and forces Black into defence.",
      "The review identifies the missing prophylactic move that would have made queenside play viable.",
    ],
    lesson: "Opposite-wing positions are tempo calculations; an attack is not sound merely because it is thematic.",
    guessTheMovePrompts: [
      "What is White threatening before ...b5?",
      "Which defensive move buys time without abandoning counterplay?",
      "Whose first forcing move arrives sooner?",
    ],
  },
  {
    id: "pirc-model-quiet",
    family: "pirc",
    title: "From compact opening to playable ending",
    branchId: "pirc-fianchetto",
    resultPerspective: "quiet-conversion",
    startingStory:
      "White fianchettos and avoids a direct attack. Black contests the centre, trades one cramped piece, and reaches an equal active ending.",
    turningPoints: [
      "...e5 fixes the centre without blocking every piece permanently.",
      "A timely central exchange activates Bg7 and a rook file.",
      "Black improves the worst knight instead of launching ...f5 against a secure king.",
    ],
    lesson: "A successful Pirc game can be an active ending; not every game needs a kingside crisis.",
    guessTheMovePrompts: [
      "Which piece is currently worst placed?",
      "Which exchange releases Bg7?",
      "Does ...f5 create a target or merely weaken e6?",
    ],
  },
  {
    id: "kid-model-classical-race",
    family: "kid",
    title: "Count the race before playing ...f5",
    branchId: "kid-classical-closed",
    resultPerspective: "thematic-win",
    startingStory:
      "The centre closes with d5. Black restrains b4 for one move, reroutes the knight, and then opens the f-file with every major piece ready.",
    turningPoints: [
      "...a5 removes White's easiest queenside tempo.",
      "...f5 is played only after e5 and g6 are tactically secure.",
      "A pawn sacrifice opens lines while White's queenside breakthrough remains one move away.",
    ],
    lesson: "The famous KID attack is a coordinated race, not a sequence of automatic pawn pushes.",
    guessTheMovePrompts: [
      "Can White play b4-c5 before your first forcing kingside move?",
      "Which knight route adds an attacker without blocking the queen?",
      "What changes if White exchanges the dark-squared bishop?",
    ],
  },
  {
    id: "kid-model-fianchetto-counterplay",
    family: "kid",
    title: "Change wings when the king is secure",
    branchId: "kid-fianchetto",
    resultPerspective: "opponent-counterplay",
    startingStory:
      "Black begins a standard kingside expansion against a well-defended fianchetto. White neutralizes it and takes over the queenside.",
    turningPoints: [
      "The first ...f5 gains no target and weakens e6.",
      "White opens the b- and c-files before Black has a forcing threat.",
      "The better plan was ...c5 with pressure on d4 and active queenside pieces.",
    ],
    lesson: "The opponent's setup can move the correct KID plan from one wing to the other.",
    guessTheMovePrompts: [
      "Which king is actually vulnerable?",
      "What target does ...f5 create here?",
      "Which break makes Bg7 relevant immediately?",
    ],
  },
  {
    id: "kid-model-exchange-ending",
    family: "kid",
    title: "Use the open d-file before it disappears",
    branchId: "kid-exchange",
    resultPerspective: "quiet-conversion",
    startingStory:
      "White trades queens on d8. Black uses the recapturing rook actively, develops with tempo, and contests d4 before White can install a knight on d5.",
    turningPoints: [
      "The rook remains active rather than retreating automatically.",
      "A minor-piece exchange removes White's best blockader.",
      "The king enters the ending once tactical activity has stabilized the position.",
    ],
    lesson: "When queens leave, replace attacking imagery with activity, files, and square control.",
    guessTheMovePrompts: [
      "Which white piece most wants d5?",
      "Can Black develop with tempo on e4 or d4?",
      "Which trade improves the remaining minor piece?",
    ],
  },
  {
    id: "kia-model-e5-attack",
    family: "kia",
    title: "Close first, route second, attack third",
    branchId: "kia-versus-e6",
    resultPerspective: "thematic-win",
    startingStory:
      "White secures e5, reroutes the f3-knight, and only then advances the h-pawn. Every attacking move adds a piece or removes a defender.",
    turningPoints: [
      "Nf1 makes h2/g3 available without abandoning the centre.",
      "White answers ...f6 before continuing the pawn storm.",
      "The final pawn break opens a file for pieces already in place.",
    ],
    lesson: "The KIA attack is built through centre control and piece routes; the pawn storm is the last step.",
    guessTheMovePrompts: [
      "Where should the f3-knight route after e5?",
      "How will Black challenge the centre?",
      "Which piece must join before h5 is forcing?",
    ],
  },
  {
    id: "kia-model-central-correction",
    family: "kia",
    title: "Use c4 when e5 is the wrong story",
    branchId: "kia-versus-d5",
    resultPerspective: "quiet-conversion",
    startingStory:
      "Black claims d5 and c5. White abandons the automatic kingside script, undermines with c4, and turns the g2 bishop into a central piece.",
    turningPoints: [
      "c4 prevents Black from maintaining an ideal broad centre.",
      "A central exchange opens pressure on b7 and d5.",
      "White reaches a flexible middlegame with no opening advantage to memorize but clear targets to play against.",
    ],
    lesson: "A system succeeds when it helps identify the necessary deviation from the system.",
    guessTheMovePrompts: [
      "What happens if Black advances ...d4 unchallenged?",
      "Which break activates Bg2?",
      "Is e5 supported well enough to close the centre?",
    ],
  },
  {
    id: "kia-model-autopilot-loss",
    family: "kia",
    title: "The attack that never had a target",
    branchId: "kia-mirrored",
    resultPerspective: "opponent-counterplay",
    startingStory:
      "Both sides castle into secure fianchettos. White plays h4-h5-f4 by name, while Black opens the centre and uses the weakened king.",
    turningPoints: [
      "White begins a wing attack before fixing the centre.",
      "Black's central break arrives with tempo on White's loose pieces.",
      "The post-game correction is quiet development and a c3-d4 challenge.",
    ],
    lesson: "A KIA shell does not create a kingside target by itself.",
    guessTheMovePrompts: [
      "What concrete weakness does h4 attack?",
      "Which central break does Black have immediately?",
      "Which undeveloped piece should move before another pawn?",
    ],
  },
] as const satisfies readonly ModelGameSummary[];

export const openingRecallPrompts = [
  {
    id: "recall-pirc-austrian-develop",
    family: "pirc",
    branchId: "pirc-austrian",
    phase: "foundation",
    fen: "rnbqkb1r/ppp1pp1p/3p1np1/8/3PPP2/2N5/PPP3PP/R1BQKBNR b KQkq - 0 4",
    orientation: "black",
    prompt: "White has built the Austrian centre. Which move completes the defining pressure piece without committing the central break yet?",
    choices: [
      { id: "bg7", label: "...Bg7" },
      { id: "b5", label: "...b5" },
      { id: "h5", label: "...h5" },
    ],
    correctChoiceId: "bg7",
    acceptedMoves: ["f8g7"],
    explanation: "...Bg7 develops, pressures the long diagonal, and preserves the choice between ...c5 and ...e5.",
    concepts: ["development", "centre pressure", "move-order flexibility"],
  },
  {
    id: "recall-pirc-150-counterplay",
    family: "pirc",
    branchId: "pirc-150",
    phase: "structure",
    fen: "rnbq1rk1/ppp1ppbp/3p1np1/8/3PP3/2N1B3/PPPQ1PPP/2KR1BNR b - - 5 6",
    orientation: "black",
    prompt: "White has castled long. Which preparation supports queenside counterplay while keeping the centre under control?",
    choices: [
      { id: "c6", label: "...c6, preparing ...b5 and supporting d5" },
      { id: "h5", label: "...h5, racing immediately" },
      { id: "bh8", label: "...Bh8, preserving the bishop at any cost" },
    ],
    correctChoiceId: "c6",
    acceptedMoves: ["c7c6"],
    explanation: "...c6 is a useful preparatory move; a direct ...b5 or kingside pawn move must still survive White's e5 ideas.",
    concepts: ["opposite-wing race", "preparation", "central prophylaxis"],
  },
  {
    id: "recall-pirc-classical-break",
    family: "pirc",
    branchId: "pirc-classical",
    phase: "foundation",
    fen: "rnbq1rk1/ppp1ppbp/3p1np1/8/3PP3/2N2N2/PPP1BPPP/R1BQ1RK1 b - - 5 6",
    orientation: "black",
    prompt: "White is safely developed but has not advanced d5. Which thematic central claim is the repertoire's first training choice?",
    choices: [
      { id: "e5", label: "...e5" },
      { id: "a6", label: "...a6" },
      { id: "ne4", label: "...Ne4" },
    ],
    correctChoiceId: "e5",
    acceptedMoves: ["e7e5"],
    explanation: "...e5 challenges the broad centre and asks White to choose between d5, exchanges, and quieter development.",
    concepts: ["central break", "classical Pirc", "pawn tension"],
  },
  {
    id: "recall-pirc-fianchetto-centre",
    family: "pirc",
    branchId: "pirc-fianchetto",
    phase: "structure",
    fen: "rnbq1rk1/ppp1ppbp/3p1np1/8/3PP3/2N3P1/PPP1NPBP/R1BQK2R b KQ - 4 6",
    orientation: "black",
    prompt: "White's king will be secure on the same wing. What should Black contest before inventing an attack?",
    choices: [
      { id: "centre", label: "The e4-d4 centre with ...e5" },
      { id: "hfile", label: "The h-file with ...h5-h4" },
      { id: "bishop", label: "The g2 bishop with ...Bh3" },
    ],
    correctChoiceId: "centre",
    acceptedMoves: ["e7e5"],
    explanation: "The quiet fianchetto reduces immediate mating chances, so central contact is the productive source of play.",
    concepts: ["centre before wing", "fianchetto", "plan selection"],
  },
  {
    id: "recall-pirc-byrne-pin",
    family: "pirc",
    branchId: "pirc-byrne-deviations",
    phase: "structure",
    fen: "rnbqk2r/ppp1ppbp/3p1np1/6B1/3PP3/2N5/PPPQ1PPP/R3KBNR b KQkq - 3 5",
    orientation: "black",
    prompt: "Bg5 changes the move-order. Which calm move prepares central and queenside play without chasing the bishop?",
    choices: [
      { id: "c6", label: "...c6" },
      { id: "h6", label: "...h6 immediately" },
      { id: "a5", label: "...a5, expanding before development" },
    ],
    correctChoiceId: "c6",
    acceptedMoves: ["c7c6"],
    explanation: "...c6 preserves king safety and supports later central or queenside expansion; pawn-chasing can create permanent dark-square weaknesses.",
    concepts: ["pin", "move order", "dark squares"],
  },
  {
    id: "recall-kid-closed-f5",
    family: "kid",
    branchId: "kid-classical-closed",
    phase: "foundation",
    fen: "r1bq1rk1/ppp1npbp/3p1np1/3Pp3/2P1P3/2N5/PP2BPPP/R1BQNRK1 b - - 2 9",
    orientation: "black",
    prompt: "The centre is closed and White has begun a knight regrouping. Which move clears the f-pawn and prepares Black's characteristic break?",
    choices: [
      { id: "nd7", label: "...Nd7, preparing ...f5" },
      { id: "a6", label: "...a6" },
      { id: "b5", label: "...b5" },
    ],
    correctChoiceId: "nd7",
    acceptedMoves: ["f6d7"],
    explanation: "...Nd7 clears the f-pawn so ...f5 can attack e4 and gain space; every later review must still compare that plan with White's b4-c5 timing.",
    concepts: ["closed centre", "pawn-chain direction", "race"],
  },
  {
    id: "recall-kid-samisch-safety",
    family: "kid",
    branchId: "kid-samisch",
    phase: "foundation",
    fen: "rnbqk2r/ppp1ppbp/3p1np1/8/2PPP3/2N2P2/PP4PP/R1BQKBNR b KQkq - 0 5",
    orientation: "black",
    prompt: "White has committed f3 but has not revealed the king. What is the sound development priority?",
    choices: [
      { id: "castle", label: "...O-O" },
      { id: "h5", label: "...h5" },
      { id: "b5", label: "...b5" },
    ],
    correctChoiceId: "castle",
    acceptedMoves: ["e8g8"],
    explanation: "King safety keeps both ...e5 and ...c5 available; the correct wing attack depends on where White castles.",
    concepts: ["king safety", "Sämisch", "preserve options"],
  },
  {
    id: "recall-kid-four-pawns-safety",
    family: "kid",
    branchId: "kid-four-pawns",
    phase: "foundation",
    fen: "rnbqk2r/ppp1ppbp/3p1np1/8/2PPPP2/2N5/PP4PP/R1BQKBNR b KQkq - 0 5",
    orientation: "black",
    prompt: "Four white pawns occupy the centre, but White is behind in development. Which move makes the coming counterstrike safer?",
    choices: [
      { id: "castle", label: "...O-O" },
      { id: "c6", label: "...c6" },
      { id: "nh5", label: "...Nh5" },
    ],
    correctChoiceId: "castle",
    acceptedMoves: ["e8g8"],
    explanation: "Castling removes tactical checks from the central calculation; ...c5 or ...e5 can follow with the king secure.",
    concepts: ["development lead", "king safety", "central counterstrike"],
  },
  {
    id: "recall-kid-fianchetto-c5",
    family: "kid",
    branchId: "kid-fianchetto",
    phase: "structure",
    fen: "rnbq1rk1/ppp1ppbp/3p1np1/8/2PP4/5NP1/PP2PPBP/RNBQ1RK1 b - - 1 6",
    orientation: "black",
    prompt: "White's fianchetto makes a direct mating race less convincing. Which break attacks the centre and creates queenside play?",
    choices: [
      { id: "c5", label: "...c5" },
      { id: "g5", label: "...g5" },
      { id: "bh3", label: "...Bh3" },
    ],
    correctChoiceId: "c5",
    acceptedMoves: ["c7c5"],
    explanation: "...c5 makes immediate contact with d4 and gives Black concrete play where White's structure is located.",
    concepts: ["Fianchetto KID", "queenside counterplay", "attack the base"],
  },
  {
    id: "recall-kid-averbakh-c5",
    family: "kid",
    branchId: "kid-averbakh",
    phase: "structure",
    fen: "rnbq1rk1/ppp1ppbp/3p1np1/6B1/2PPP3/2N5/PP2BPPP/R2QK1NR b KQ - 3 6",
    orientation: "black",
    prompt: "Bg5 restrains the easy ...e5/...f5 story. Which central break is the practical training choice?",
    choices: [
      { id: "c5", label: "...c5" },
      { id: "h6", label: "...h6" },
      { id: "ne4", label: "...Ne4" },
    ],
    correctChoiceId: "c5",
    acceptedMoves: ["c7c5"],
    explanation: "...c5 challenges d4 while White's kingside knight and king remain undeveloped; the bishop pin need not be chased.",
    concepts: ["Averbakh", "central counterplay", "ignore cosmetic pin"],
  },
  {
    id: "recall-kid-petrosian-a5",
    family: "kid",
    branchId: "kid-petrosian",
    phase: "structure",
    fen: "rnbq1rk1/ppp2pbp/3p1np1/3Pp3/2P1P3/2N2N2/PP2BPPP/R1BQK2R b KQ - 0 7",
    orientation: "black",
    prompt: "White has closed early and wants b4-c5. Which restraining move buys time for Black's regrouping?",
    choices: [
      { id: "a5", label: "...a5" },
      { id: "g5", label: "...g5" },
      { id: "nxd5", label: "...Nxd5, liquidating immediately" },
    ],
    correctChoiceId: "a5",
    acceptedMoves: ["a7a5"],
    explanation: "...a5 slows b4 and preserves the closed centre while Black organizes the kingside pieces.",
    concepts: ["prophylaxis", "Petrosian system", "race timing"],
  },
  {
    id: "recall-kid-exchange-plan",
    family: "kid",
    branchId: "kid-exchange",
    phase: "transfer",
    fen: "rnbr2k1/ppp2pbp/5np1/4p3/2P1P3/2N2N2/PP2BPPP/R1B1K2R b KQ - 0 9",
    orientation: "black",
    prompt: "Queens have been exchanged. Which move uses the active d8-rook to contest the centre immediately?",
    choices: [
      { id: "rd4", label: "...Rd4, activate on the open file" },
      { id: "g5", label: "...g5, start a pawn storm" },
      { id: "rd7", label: "...Rd7, retreat and wait" },
    ],
    correctChoiceId: "rd4",
    acceptedMoves: ["d8d4"],
    explanation: "...Rd4 makes the queenless middlegame concrete: the rook becomes active on the open file and pressures the central squares before White consolidates.",
    concepts: ["phase transition", "rook activity", "square control"],
  },
  {
    id: "recall-kid-london-c5",
    family: "kid",
    branchId: "kid-anti-systems",
    phase: "foundation",
    fen: "rnbq1rk1/ppp1ppbp/3p1np1/8/3P1B2/4PN2/PPP1BPPP/RN1Q1RK1 b - - 1 6",
    orientation: "black",
    prompt: "White has a London shell rather than a c4/e4 KID centre. Which move challenges d4 immediately?",
    choices: [
      { id: "c5", label: "...c5" },
      { id: "nh5", label: "...Nh5" },
      { id: "b6", label: "...b6" },
    ],
    correctChoiceId: "c5",
    acceptedMoves: ["c7c5"],
    explanation: "Without c4/e4, Black can attack d4 directly; copying a closed-centre KID manoeuvre would concede time.",
    concepts: ["anti-system", "classify actual centre", "...c5"],
  },
  {
    id: "recall-kid-reti-transpose",
    family: "kid",
    branchId: "kid-english-reti",
    phase: "transfer",
    fen: "rnbq1rk1/ppp1ppbp/3p1np1/8/2PP4/5NP1/PP2PPBP/RNBQ1RK1 b - - 0 6",
    orientation: "black",
    prompt: "White has now played both c4 and d4. Which move claims a KID-style centre while preserving active play?",
    choices: [
      { id: "e5", label: "...e5" },
      { id: "a6", label: "...a6" },
      { id: "c6", label: "...c6" },
    ],
    correctChoiceId: "e5",
    acceptedMoves: ["e7e5"],
    explanation: "The Reti move order has supplied the central structure needed for ...e5; recognize the position, not its history.",
    concepts: ["transposition", "English/Reti", "position recognition"],
  },
  {
    id: "recall-kia-e6-route",
    family: "kia",
    branchId: "kia-versus-e6",
    phase: "foundation",
    fen: "r1bq1rk1/p2nbppp/1pn1p3/2ppP3/8/3P1NP1/PPPN1PBP/R1BQR1K1 w - - 1 10",
    orientation: "white",
    prompt: "The e5 chain is stable. Which knight move begins the characteristic route without weakening the king?",
    choices: [
      { id: "nf1", label: "Nf1" },
      { id: "nb3", label: "Nb3" },
      { id: "c4", label: "c4 immediately" },
    ],
    correctChoiceId: "nf1",
    acceptedMoves: ["d2f1"],
    explanation: "Nf1 clears d2 and prepares h2/g3 routes; the attack still requires an answer to Black's ...f6 break.",
    concepts: ["knight route", "closed centre", "attack preparation"],
  },
  {
    id: "recall-kia-c5-c3",
    family: "kia",
    branchId: "kia-versus-c5",
    phase: "structure",
    fen: "r1bqk2r/pp2npbp/2np2p1/2p1p3/4P3/3P1NP1/PPPN1PBP/R1BQ1RK1 w kq - 1 8",
    orientation: "white",
    prompt: "Black controls d4 from c5. Which move prepares a central claim before committing to a wing attack?",
    choices: [
      { id: "c3", label: "c3, preparing d4" },
      { id: "h4", label: "h4" },
      { id: "ng5", label: "Ng5" },
    ],
    correctChoiceId: "c3",
    acceptedMoves: ["c2c3"],
    explanation: "c3 gives White a principled d4 break and keeps e5 as a later decision rather than an automatic commitment.",
    concepts: ["Sicilian-style centre", "c3-d4", "flexibility"],
  },
  {
    id: "recall-kia-d5-undermine",
    family: "kia",
    branchId: "kia-versus-d5",
    phase: "structure",
    fen: "r1bqkb1r/pp3ppp/2n2n2/2p1p3/3pP3/3P1NP1/PPP2PBP/RNBQ1RK1 w kq - 0 7",
    orientation: "white",
    prompt: "Black has advanced ...d4 and owns space. Which move prepares to undermine the chain instead of ignoring it?",
    choices: [
      { id: "c3", label: "c3" },
      { id: "h4", label: "h4" },
      { id: "nh4", label: "Nh4" },
    ],
    correctChoiceId: "c3",
    acceptedMoves: ["c2c3"],
    explanation: "c3 attacks the base on d4 and opens a future role for the queenside pieces; a wing attack would be too slow.",
    concepts: ["pawn-chain base", "central undermining", "anti-autopilot"],
  },
  {
    id: "recall-kia-mirror-develop",
    family: "kia",
    branchId: "kia-mirrored",
    phase: "foundation",
    fen: "rnbq1rk1/ppp2pbp/3p1np1/4p3/4P3/3P1NP1/PPP2PBP/RNBQ1RK1 w - - 0 7",
    orientation: "white",
    prompt: "The position is symmetrical and neither king is a target. Which move completes the KIA development without forcing a story?",
    choices: [
      { id: "nbd2", label: "Nbd2" },
      { id: "h4", label: "h4" },
      { id: "bg5", label: "Bg5" },
    ],
    correctChoiceId: "nbd2",
    acceptedMoves: ["b1d2"],
    explanation: "Nbd2 improves a piece and supports future central decisions; symmetry offers no justification for an immediate pawn storm.",
    concepts: ["mirrored structure", "development", "no target"],
  },
  {
    id: "recall-kia-dutch-pressure",
    family: "kia",
    branchId: "kia-versus-dutch",
    phase: "structure",
    fen: "rnbq1rk1/ppp3bp/3p1np1/4pp2/4P3/3P1NP1/PPPN1PBP/R1BQ1RK1 w - - 0 8",
    orientation: "white",
    prompt: "Black's ...f5 gives space but leaves a target. Which manoeuvre increases pressure without fixing the centre prematurely?",
    choices: [
      { id: "nh4", label: "Nh4" },
      { id: "b4", label: "b4" },
      { id: "exf5", label: "exf5 automatically" },
    ],
    correctChoiceId: "nh4",
    acceptedMoves: ["f3h4"],
    explanation: "Nh4 adds pressure to f5 and keeps the choice of exf5 or f4; the concrete centre still decides the final break.",
    concepts: ["Dutch structure", "target f5", "preserve tension"],
  },
  {
    id: "recall-kia-early-e5-c4",
    family: "kia",
    branchId: "kia-early-e5",
    phase: "transfer",
    fen: "rnbqk2r/ppp1b1pp/3p1n2/4pp2/8/3P1NP1/PPP1PPBP/RNBQ1RK1 w kq - 3 6",
    orientation: "white",
    prompt: "Black occupied e5 before White played e4. Which break contests the remaining central space?",
    choices: [
      { id: "c4", label: "c4" },
      { id: "e4", label: "e4 without calculation" },
      { id: "h4", label: "h4" },
    ],
    correctChoiceId: "c4",
    acceptedMoves: ["c2c4"],
    explanation: "c4 attacks d5 and treats the position as a flexible Reti/reversed-Pirc structure rather than forcing the standard KIA order.",
    concepts: ["early ...e5", "c4 break", "opening reclassification"],
  },
] as const satisfies readonly OpeningRecallPrompt[];

export const masteryStandards = [
  {
    id: "recall",
    label: "Delayed recall",
    evidence: "The learner finds an accepted move without a hint after the position has left short-term memory.",
    defaultGate: "At least 85% no-hint accuracy across two reviews separated by seven or more days.",
    failureResponse: "Shorten the interval, show the branch cue after commitment, and retest from a transposed move order.",
  },
  {
    id: "understanding",
    label: "Plan and threat",
    evidence: "The learner identifies the opponent's threat, relevant pawn break, worst piece, and one viable plan.",
    defaultGate: "Correct plan/threat response on four of the last five attempts.",
    failureResponse: "Return to the branch summary and a model-game turning point before testing the position again.",
  },
  {
    id: "discrimination",
    label: "Contrastive recognition",
    evidence: "The learner distinguishes a familiar tabiya from a near-match where one piece or tempo changes the plan.",
    defaultGate: "Correctly explain the changed plan in three consecutive contrast pairs.",
    failureResponse: "Present the positions side by side and require the learner to name the concrete difference first.",
  },
  {
    id: "application",
    label: "Start-position application",
    evidence: "The learner plays the tabiya without an immediate tactical collapse and pursues a position-appropriate plan.",
    defaultGate: "Three representative sparring games without a one-move tactical loss in the opening phase.",
    failureResponse: "Turn the first self-caused error into a personal puzzle and restart immediately before that decision.",
  },
  {
    id: "transfer",
    label: "Real-game transfer",
    evidence: "The learner recognizes the structure through unfamiliar move orders and improves real-game decisions.",
    defaultGate: "Master nodes covering about 90% of actual encounters plus every curated forcing line.",
    failureResponse: "Increase review priority by encounter frequency, error cost, forgetting risk, and personal weakness.",
  },
] as const satisfies readonly MasteryStandard[];

export const defaultTrainingAllocation = [
  {
    id: "bootcamp",
    label: "Opening-family bootcamp",
    percentages: {
      openingsAndStructures: 30,
      tacticsAndCalculation: 40,
      endgames: 15,
      modelGamesAndSelfAnalysis: 15,
    },
    weeklyLoop: [
      "Review due opening positions by move and explanation.",
      "Solve mixed unseen tactics plus one focused family motif block.",
      "Play at least one slower game and annotate it without an engine first.",
      "Start three short sparring games from the weakest tabiya.",
      "Convert the first meaningful game error into a delayed personal puzzle.",
    ],
  },
  {
    id: "maintenance",
    label: "General-chess maintenance",
    percentages: {
      openingsAndStructures: 18,
      tacticsAndCalculation: 40,
      endgames: 20,
      modelGamesAndSelfAnalysis: 22,
    },
    weeklyLoop: [
      "Review only due or newly encountered repertoire positions.",
      "Keep most tactics mixed and unlabeled so recognition is tested.",
      "Include defensive, quiet-move, and no-tactic decisions.",
      "Analyze slower games unaided before revealing engine lines.",
      "Promote recurring game errors above generic content in the review queue.",
    ],
  },
] as const satisfies readonly TrainingAllocation[];

export const chessCurriculum = {
  version: 1,
  thesis: "One structural opening family, followed by deliberate transfer into general chess.",
  familyEssentials,
  endgameEssentials,
  openingModules,
  modelGameSummaries,
  openingRecallPrompts,
  masteryStandards,
  defaultTrainingAllocation,
  reviewPriorityFormula: "encounter frequency × error cost × forgetting risk × personal weakness",
} as const;
