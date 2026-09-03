import { WHATS_NEW } from '../data/whatsNew.js';

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

// Opened from either the header megaphone button or the footer's "What's
// new" link (App.jsx owns the shared open/seen state, since those two
// triggers are siblings with no other common parent) -- same
// modal-overlay/modal-panel chrome as PrivacyModal/TermsModal, but with
// its own header/scroll-body/footer split (.whats-new-panel below)
// instead of .modal-panel's default single-scroll-everything -- the list
// can run to several dozen entries, and the title/Close row scrolling
// away with them (as it did before) is exactly what made the notification
// panel's own frozen header worth copying here.
export default function WhatsNewModal({ onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel whats-new-panel" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className="whats-new-header">
          <h3 className="day-sheet__section-title" style={{ margin: 0 }}>What's new</h3>
          <button type="button" className="link-button" onClick={onClose}>Close</button>
        </div>

        <div className="whats-new-scroll">
          {WHATS_NEW.length === 0 ? (
            <p className="field__hint">Nothing to show yet.</p>
          ) : (
            <ul className="whats-new-list">
              {WHATS_NEW.map((entry) => (
                <li key={entry.id} className="whats-new-item">
                  <p className="whats-new-item__date">{formatDate(entry.date)}</p>
                  <p className="whats-new-item__title">{entry.title}</p>
                  <p className="whats-new-item__body">{entry.body}</p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="form-actions">
          <button type="button" className="btn btn--primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
