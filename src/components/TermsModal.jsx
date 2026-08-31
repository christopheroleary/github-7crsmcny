// Placeholder -- there's no app-level Terms & Conditions written yet
// (this is distinct from the gig/client contract terms elsewhere in the
// app, which are a different thing entirely). Adding the link and this
// page now; replace the copy below once real wording exists.
export default function TermsModal({ onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
          <h3 className="day-sheet__section-title" style={{ margin: 0 }}>Terms &amp; conditions</h3>
          <button type="button" className="link-button" onClick={onClose}>Close</button>
        </div>

        <p className="field__hint" style={{ margin: '12px 0 0' }}>
          Full terms aren't written up yet — check back here later, or ask
          admin directly in the meantime.
        </p>

        <div className="form-actions">
          <button type="button" className="btn btn--primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
