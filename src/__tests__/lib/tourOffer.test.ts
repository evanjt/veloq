/**
 * Scenario: the tour no longer opens on sign-in. A feed card offers it, Not now
 * can be pressed on it, and a tour can close with a setup slide left unanswered.
 *
 * Expected behaviour: the card offers the tour until it is taken or declined
 * twice, never twice in one session. A tour closed with a setup slide
 * unanswered brings the card back once, in a later session, for those slides
 * only, and after that nothing returns.
 */

import {
  afterLeftoverAnswered,
  afterOfferDeclined,
  afterTourClosed,
  NO_TOUR_OFFER,
  offerEnded,
  setupSlidesAnswerable,
  tourOffer,
  type TourOfferFacts,
} from '@/features/settings/lib/tourOffer';

const unseen: TourOfferFacts = {
  tourEligible: true,
  lastSeenVersion: null,
  record: NO_TOUR_OFFER,
  settledThisSession: false,
  tourSetupSlides: ['notifications', 'backup'],
};

describe('the tour offer', () => {
  it('offers the tour to a signed-in athlete who has never seen it', () => {
    expect(tourOffer(unseen)).toEqual({ kind: 'tour' });
  });

  it('offers nothing where no tour may open, such as demo', () => {
    expect(tourOffer({ ...unseen, tourEligible: false })).toBeNull();
  });

  it('offers nothing once the tour has been seen and nothing was left', () => {
    expect(tourOffer({ ...unseen, lastSeenVersion: '0.4.0' })).toBeNull();
  });

  it('waits for a later session after Not now, then offers once more', () => {
    const record = afterOfferDeclined(NO_TOUR_OFFER);
    expect(offerEnded(record)).toBe(false);
    expect(tourOffer({ ...unseen, record, settledThisSession: true })).toBeNull();
    expect(tourOffer({ ...unseen, record })).toEqual({ kind: 'tour' });
  });

  it('ends the offer at the second Not now', () => {
    const record = afterOfferDeclined(afterOfferDeclined(NO_TOUR_OFFER));
    expect(offerEnded(record)).toBe(true);
    expect(tourOffer({ ...unseen, record })).toBeNull();
  });
});

describe('the setup slides a tour left unanswered', () => {
  const seen: TourOfferFacts = { ...unseen, lastSeenVersion: '0.4.0' };

  it('brings the card back in a later session for the slides left unanswered', () => {
    const record = afterTourClosed({ ...NO_TOUR_OFFER, answers: { backup: 'on' } });
    expect(tourOffer({ ...seen, record, settledThisSession: true })).toBeNull();
    expect(tourOffer({ ...seen, record })).toEqual({
      kind: 'leftover',
      slides: ['notifications'],
    });
  });

  it('offers both when neither was answered, in the order the tour shows them', () => {
    const record = afterTourClosed(NO_TOUR_OFFER);
    expect(tourOffer({ ...seen, record })).toEqual({
      kind: 'leftover',
      slides: ['notifications', 'backup'],
    });
  });

  it('owes nothing when the tour closed with every setup slide answered', () => {
    const record = afterTourClosed({
      ...NO_TOUR_OFFER,
      answers: { notifications: 'never', backup: 'on' },
    });
    expect(tourOffer({ ...seen, record })).toBeNull();
  });

  it('leaves out a slide answered after the tour closed, or already on in Settings when it closed', () => {
    const record = afterTourClosed(NO_TOUR_OFFER);
    expect(tourOffer({ ...seen, record: { ...record, answers: { notifications: 'on' } } })).toEqual(
      { kind: 'leftover', slides: ['backup'] }
    );
    expect(tourOffer({ ...seen, record: afterTourClosed(NO_TOUR_OFFER, ['backup']) })).toEqual({
      kind: 'leftover',
      slides: ['notifications'],
    });
    expect(
      tourOffer({ ...seen, record: afterTourClosed(NO_TOUR_OFFER, ['backup', 'notifications']) })
    ).toBeNull();
  });

  it('keeps an answer given in the tour over what Settings held at the close', () => {
    const record = afterTourClosed({ ...NO_TOUR_OFFER, answers: { backup: 'never' } }, ['backup']);
    expect(record.answers.backup).toBe('never');
  });

  it('offers only the setup slides the tour carries', () => {
    const record = afterTourClosed(NO_TOUR_OFFER);
    expect(tourOffer({ ...seen, record, tourSetupSlides: ['backup'] })).toEqual({
      kind: 'leftover',
      slides: ['backup'],
    });
  });

  it('returns once: answered or declined, and nothing returns after another tour', () => {
    const answered = afterLeftoverAnswered(afterTourClosed(NO_TOUR_OFFER));
    expect(tourOffer({ ...seen, record: answered })).toBeNull();
    expect(tourOffer({ ...seen, record: afterTourClosed(answered) })).toBeNull();
  });
});

describe('the setup slides an account can answer', () => {
  it('keeps the notification slide for an account that can receive pushes', () => {
    expect(setupSlidesAnswerable(['notifications', 'backup'], { push: true })).toEqual([
      'notifications',
      'backup',
    ]);
  });

  it('leaves out the notification slide where pushes cannot arrive, so it is never owed', () => {
    const slides = setupSlidesAnswerable(['notifications', 'backup'], { push: false });
    expect(slides).toEqual(['backup']);
    const closed = afterTourClosed(NO_TOUR_OFFER);
    expect(
      tourOffer({ ...unseen, lastSeenVersion: '0.4.0', record: closed, tourSetupSlides: slides })
    ).toEqual({ kind: 'leftover', slides: ['backup'] });
  });
});
