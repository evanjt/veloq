/**
 * The feed card that offers the tour, which no longer opens on sign-in.
 *
 * The card offers the tour when the session's ask is its own (`launchSurfaces`),
 * which it may be from the first session. Inside the quiet period the tour holds
 * back the notification slide, so nothing asks for notifications then. Not now offers it once more in a later session,
 * and a second Not now ends the offer. The tour is where notifications and
 * backup are set up, and each setup slide records Turn on, Never remind me
 * again, or nothing. A tour that closes with one left unanswered brings the
 * card back once, in a later session after the quiet period, opening the tour
 * at those slides only. A slide held back counts as unanswered, so it is offered
 * then. After that nothing returns, and Settings holds both.
 */

/** A tour slide that asks the athlete to set something up. */
export type SetupSlide = 'notifications' | 'backup';

export type SetupAnswer = 'on' | 'never';

/** The setup slides in the order the tour shows them. */
export const SETUP_SLIDES: readonly SetupSlide[] = ['notifications', 'backup'];

/** The setup slides a tour taken in the quiet period leaves out. */
export const QUIET_PERIOD_HELD_SLIDES: readonly SetupSlide[] = ['notifications'];

/** The Not nows that end the offer. */
export const TOUR_OFFER_DECLINES = 2;

export interface TourOfferRecord {
  /** Not now pressed on the offer, counted across sessions. */
  declines: number;
  /**
   * The card owed for setup slides a tour left unanswered, then spent once it is
   * answered either way. Null before a tour has closed.
   */
  leftover: 'owed' | 'spent' | null;
  /** What each setup slide was answered with. A slide swiped past has none. */
  answers: Partial<Record<SetupSlide, SetupAnswer>>;
}

export const NO_TOUR_OFFER: TourOfferRecord = { declines: 0, leftover: null, answers: {} };

export interface TourOfferFacts {
  /** A tour may be offered: someone is signed in and it is not demo. */
  tourEligible: boolean;
  /** The seen flag, null until the tour is finished or the offer is ended. */
  lastSeenVersion: string | null;
  record: TourOfferRecord;
  /** The card was answered or a tour closed in this session, so it waits for the next. */
  settledThisSession: boolean;
  /** The setup slides the tour carries. */
  tourSetupSlides: readonly SetupSlide[];
  /** The quiet period holds, or its days of use are not yet counted. */
  quietPeriod: boolean;
}

/** The whole tour less the setup slides it holds back, or the slides a tour left unanswered. */
export type TourOffer =
  { kind: 'tour'; held: SetupSlide[] } | { kind: 'leftover'; slides: SetupSlide[] };

export function offerEnded(record: TourOfferRecord): boolean {
  return record.declines >= TOUR_OFFER_DECLINES;
}

/** What the card offers, or null when it does not show. */
export function tourOffer(facts: TourOfferFacts): TourOffer | null {
  if (!facts.tourEligible || facts.settledThisSession) return null;
  const { record } = facts;
  if (facts.lastSeenVersion === null) {
    if (offerEnded(record)) return null;
    const held = facts.quietPeriod
      ? QUIET_PERIOD_HELD_SLIDES.filter((slide) => facts.tourSetupSlides.includes(slide))
      : [];
    return { kind: 'tour', held };
  }
  if (record.leftover !== 'owed' || facts.quietPeriod) return null;
  const slides = SETUP_SLIDES.filter(
    (slide) => facts.tourSetupSlides.includes(slide) && record.answers[slide] === undefined
  );
  return slides.length > 0 ? { kind: 'leftover', slides } : null;
}

/**
 * The setup slides an account can answer. The notification slide offers no
 * buttons where pushes cannot arrive, so it is never owed there.
 */
export function setupSlidesAnswerable(
  slides: readonly SetupSlide[],
  can: { push: boolean }
): SetupSlide[] {
  return slides.filter((slide) => slide !== 'notifications' || can.push);
}

export function afterOfferDeclined(record: TourOfferRecord): TourOfferRecord {
  return { ...record, declines: record.declines + 1 };
}

/**
 * A tour closed: the card is owed once, for whatever setup it left unanswered.
 * What is already on in Settings counts as Turn on, so no slide asks for it again.
 */
export function afterTourClosed(
  record: TourOfferRecord,
  setUp: readonly SetupSlide[] = []
): TourOfferRecord {
  const answers = { ...record.answers };
  for (const slide of setUp) answers[slide] ??= 'on';
  return { ...record, answers, leftover: record.leftover ?? 'owed' };
}

/** The leftover card was taken or declined, so it never returns. */
export function afterLeftoverAnswered(record: TourOfferRecord): TourOfferRecord {
  return { ...record, leftover: 'spent' };
}

export function afterSetupAnswered(
  record: TourOfferRecord,
  slide: SetupSlide,
  answer: SetupAnswer
): TourOfferRecord {
  return { ...record, answers: { ...record.answers, [slide]: answer } };
}

/** The stored record, read leniently: a row that does not parse is no record. */
export function parseTourOffer(stored: string | null): TourOfferRecord {
  if (!stored) return NO_TOUR_OFFER;
  try {
    const row = JSON.parse(stored) as Partial<TourOfferRecord>;
    const answers: TourOfferRecord['answers'] = {};
    for (const slide of SETUP_SLIDES) {
      const answer = row.answers?.[slide];
      if (answer === 'on' || answer === 'never') answers[slide] = answer;
    }
    return {
      declines: typeof row.declines === 'number' ? row.declines : 0,
      leftover: row.leftover === 'owed' || row.leftover === 'spent' ? row.leftover : null,
      answers,
    };
  } catch {
    return NO_TOUR_OFFER;
  }
}
