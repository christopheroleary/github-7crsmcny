import { useState, useLayoutEffect, useEffect } from 'react';

// A minimal, dependency-free version of the "dim the page, spotlight one
// real element, click Next to advance" pattern popularised by tools like
// Intro.js/Shepherd/React Joyride -- built by hand rather than installed,
// since this exFAT dev drive can't reliably add a new npm dependency (see
// utils/stagePlotIcons.jsx for the same problem hit and solved the same
// way for icons). No tracking, no third-party script -- consistent with
// what the Privacy Policy already promises.
//
// The spotlight is four separate dimmed panels around the target's
// bounding box, not one big overlay with a cutout -- that leaves nothing
// sitting on top of the target itself, so it's genuinely still clickable/
// hoverable through the tour, not just visible. A step can opt into
// `advanceOn: 'click' | 'change'` so a real interaction with the real
// element both does the real thing and moves the tour on, rather than
// needing a separate "Next" click on top of it.
export default function ProductTour({ steps, active, onFinish }) {
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState(null);
  const step = active ? steps[stepIndex] : null;

  // Deliberately NOT a functional setState updater -- `next()` is only ever
  // called from an event handler or a DOM listener callback (a button
  // click, or the advanceOn effect below), never during render, so reading
  // `stepIndex` from the closure here is safe. It used to be an updater
  // function that called `onFinish?.()` (which sets state on the PARENT,
  // e.g. GigsList's tourActive) from inside itself -- React can invoke a
  // setState updater during its own render/reconciliation pass (StrictMode
  // double-invokes it to check purity), which surfaced as "Cannot update a
  // component (GigsList) while rendering a different component
  // (ProductTour)". Side effects that touch another component's state must
  // never live inside an updater callback.
  function next() {
    if (stepIndex >= steps.length - 1) {
      setStepIndex(0);
      onFinish?.();
      return;
    }
    setStepIndex(stepIndex + 1);
  }
  function back() {
    setStepIndex((i) => Math.max(0, i - 1));
  }
  function skip() {
    setStepIndex(0);
    onFinish?.();
  }

  // Keeps the spotlight glued to the real element -- re-measures on
  // window resize and on a short poll while a step is showing, since the
  // page around it (forms opening, sections folding) can reflow without
  // firing a resize event at all.
  //
  // Spotlights `step.spotlightTarget` when given, falling back to
  // `step.target` -- these differ whenever the thing that actually
  // completes the step (e.g. a submit button that's disabled until other
  // fields are filled in) is smaller than the area someone genuinely
  // needs to interact with first. Spotlighting only the button in that
  // case looked broken -- highlighted, but not yet clickable, with
  // nothing telling you why.
  useLayoutEffect(() => {
    if (!step) { setRect(null); return; }
    const spotlightSelector = step.spotlightTarget || step.target;
    function update() {
      if (!spotlightSelector) { setRect(null); return; }
      const el = document.querySelector(spotlightSelector);
      if (!el) { setRect(null); return; }
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    }
    const el = spotlightSelector ? document.querySelector(spotlightSelector) : null;
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const settle = setTimeout(update, 260); // after the smooth-scroll above lands
    update();
    window.addEventListener('resize', update);
    const poll = setInterval(update, 300);
    return () => {
      clearTimeout(settle);
      window.removeEventListener('resize', update);
      clearInterval(poll);
    };
  }, [step]);

  // A real interaction with the target advances the tour, opt-in per step
  // via `advanceOn: 'click' | 'change'` ('change' for a <select> -- picking
  // an option doesn't fire 'click' the way a button press does). Polls for
  // the target rather than looking it up once -- a raw addEventListener
  // attached directly to a DOM node fires BEFORE React's own delegated
  // onClick (native target-phase beats React's bubble-phase root
  // listener), so the moment this runs right after the PREVIOUS step's
  // real interaction, the element that interaction's own React state
  // update was about to reveal (e.g. a form that click just opened) may
  // not exist in the DOM yet. A one-shot querySelector here would just
  // silently find nothing and never attach anything; polling catches it
  // the instant it mounts.
  useEffect(() => {
    if (!step?.advanceOn) return;
    let cleanupListener = null;
    function tryAttach() {
      const el = document.querySelector(step.target);
      if (!el) return false;
      function handleEvent() {
        // A <select>'s 'change' fires even when someone picks the blank
        // placeholder option back again -- only a real, non-empty choice
        // should move the tour on.
        if (step.advanceOn === 'change' && !el.value) return;
        next();
      }
      el.addEventListener(step.advanceOn, handleEvent);
      cleanupListener = () => el.removeEventListener(step.advanceOn, handleEvent);
      return true;
    }
    if (tryAttach()) return () => cleanupListener?.();
    const poll = setInterval(() => {
      if (tryAttach()) clearInterval(poll);
    }, 100);
    return () => { clearInterval(poll); cleanupListener?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  if (!step) return null;

  const pad = 8;
  const cardStyle = rect ? cardPosition(rect, pad) : { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };

  return (
    <div className="product-tour">
      {rect ? (
        <>
          <div className="product-tour__dim" style={{ top: 0, left: 0, right: 0, height: Math.max(0, rect.top - pad) }} />
          <div className="product-tour__dim" style={{ top: rect.top - pad, left: 0, width: Math.max(0, rect.left - pad), height: rect.height + pad * 2 }} />
          <div className="product-tour__dim" style={{ top: rect.top - pad, left: rect.left + rect.width + pad, right: 0, height: rect.height + pad * 2 }} />
          <div className="product-tour__dim" style={{ top: rect.top + rect.height + pad, left: 0, right: 0, bottom: 0 }} />
          <div
            className="product-tour__ring"
            style={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }}
          />
        </>
      ) : (
        <div className="product-tour__dim" style={{ top: 0, left: 0, right: 0, bottom: 0 }} />
      )}

      <div className="product-tour__card" style={cardStyle}>
        <p className="product-tour__count">Step {stepIndex + 1} of {steps.length}</p>
        <h4 className="product-tour__title">{step.title}</h4>
        <p className="product-tour__body">{step.body}</p>
        <div className="product-tour__actions">
          <button type="button" className="link-button" onClick={skip}>Skip tour</button>
          <div style={{ display: 'flex', gap: 8 }}>
            {stepIndex > 0 && (
              <button type="button" className="btn btn--ghost btn--small" onClick={back}>Back</button>
            )}
            {!step.advanceOn && (
              <button type="button" className="btn btn--primary btn--small" onClick={next}>
                {stepIndex < steps.length - 1 ? 'Next' : 'Done'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Prefers below the target, flips above when there's no room -- same
// viewport-aware flip InfoTooltip.jsx already does, so this doesn't
// introduce a second, differently-behaved floating-panel convention.
function cardPosition(rect, pad) {
  const cardWidth = 300;
  const left = Math.min(Math.max(rect.left, 12), window.innerWidth - cardWidth - 12);
  const spaceBelow = window.innerHeight - (rect.top + rect.height);
  if (spaceBelow > 220) {
    return { top: rect.top + rect.height + pad + 10, left };
  }
  return { top: Math.max(rect.top - pad - 10, 12), left, transform: 'translateY(-100%)' };
}
