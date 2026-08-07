import { useState } from 'react';
import { supabase } from '../supabaseClient';
import { useCurrentProfile } from '../context/ProfileContext.jsx';

const MAX_LENGTH = 2000;

// Reachable from anywhere via the header button (App.jsx) -- feedback is
// usually prompted by whatever screen someone's actually looking at, so it
// shouldn't require navigating to a settings page first. `page` is passed
// in as light context for admin, not used for anything security-relevant.
export default function FeedbackModal({ onClose, page }) {
  const { profile } = useCurrentProfile();
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (!message.trim()) {
      setError('Write something first.');
      return;
    }
    if (!profile?.id) {
      setError("Couldn't identify your account — try signing in again.");
      return;
    }

    setSaving(true);
    const { error: saveError } = await supabase.from('feedback').insert({
      profile_id: profile.id,
      message: message.trim(),
      page: page || null,
    });
    setSaving(false);

    if (saveError) {
      setError(saveError.message);
      return;
    }
    setSent(true);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
          <h3 className="day-sheet__section-title" style={{ margin: 0 }}>Send feedback</h3>
          <button type="button" className="link-button" onClick={onClose}>Close</button>
        </div>

        {sent ? (
          <>
            <p className="form-success" style={{ margin: '12px 0' }}>
              Thanks — that's gone straight to admin.
            </p>
            <div className="form-actions">
              <button type="button" className="btn btn--primary" onClick={onClose}>Done</button>
            </div>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <p className="field__hint" style={{ marginBottom: 12 }}>
              Bug, idea, or anything not working the way you'd expect — this goes directly to admin, nobody else
              can see it.
            </p>
            <label className="field">
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value.slice(0, MAX_LENGTH))}
                rows={5}
                placeholder="What's on your mind?"
                autoFocus
                required
              />
              <span className="field__hint" style={{ display: 'block', textAlign: 'right', marginTop: 2 }}>
                {message.length}/{MAX_LENGTH}
              </span>
            </label>
            {error && <p className="form-error">{error}</p>}
            <div className="form-actions">
              <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn--primary" disabled={saving}>
                {saving ? 'Sending…' : 'Send feedback'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
