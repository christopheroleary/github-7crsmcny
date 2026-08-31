import { useState } from 'react';
import { supabase } from '../supabaseClient';
import { useCurrentProfile } from '../context/ProfileContext.jsx';
import { notify } from '../utils/toastService.js';

// Moved out of the old single MyProfile.jsx page into the app-wide footer
// (AppFooter.jsx) -- privacy/data info is something people look for once,
// rarely, not content worth permanent tab space. The opt-out toggle's
// current value comes straight off the already-loaded ProfileContext
// (usage_logging_opt_out is part of its own select()) -- no extra fetch
// needed just to open this.
export default function PrivacyModal({ onClose }) {
  const { profile, isAdmin, refreshProfile } = useCurrentProfile();
  const [saving, setSaving] = useState(false);
  const [optOut, setOptOut] = useState(Boolean(profile?.usage_logging_opt_out));

  // Takes effect from the NEXT sign-in / app open onward -- maybeLogSession
  // only runs once per load in ProfileContext.jsx, so a session already in
  // progress when this is flipped doesn't retroactively un-log anything,
  // there's simply nothing further to opt out of until the next one fires.
  async function handleToggle(checked) {
    setOptOut(checked);
    setSaving(true);
    const { error } = await supabase.from('profiles').update({ usage_logging_opt_out: checked }).eq('id', profile.id);
    setSaving(false);
    if (error) {
      setOptOut(!checked);
      notify("Couldn't save: " + error.message);
      return;
    }
    // So the header, and anywhere else reading useCurrentProfile(), picks
    // up the change immediately rather than on next reload.
    await refreshProfile();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
          <h3 className="day-sheet__section-title" style={{ margin: 0 }}>Privacy &amp; your data</h3>
          <button type="button" className="link-button" onClick={onClose}>Close</button>
        </div>

        <p className="field__hint" style={{ margin: '12px 0 0' }}>
          So the admin can sort things out when something breaks, we note a few basics: your device,
          browser, screen size, IP address and when you last used the app. That's all — no adverts,
          no tracking, and nothing handed to analytics companies.
        </p>
        {/* Receipt scanning is the one place data leaves this app, so it's
            called out separately rather than folded into the paragraph
            above -- a receipt photo can carry your name and part of a card
            number, and people should see that plainly before they use it. */}
        <p className="field__hint" style={{ margin: '10px 0 0' }}>
          <strong>Scanned receipts.</strong> Your receipt photo is sent to Anthropic's Claude to read
          the shop, date and amounts off it. It isn't used to train their AI. The photo stays private
          here — only you and the admin can open it — and we keep it for about six years, because
          that's what HMRC asks for. A receipt can show your name or part of a card number, so scan
          what you're happy to keep; typing an expense in by hand always works too.
        </p>
        {/* Admins never have this logging happen at all (see
            ProfileContext.jsx), so showing them a toggle for it would just
            be confusing -- it'd already look "off" with nothing to opt out of. */}
        {!isAdmin && (
          <label className="field" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, margin: '14px 0 0' }}>
            <input
              type="checkbox"
              checked={optOut}
              onChange={(e) => handleToggle(e.target.checked)}
              disabled={saving}
              style={{ width: 'auto' }}
            />
            <span style={{ fontSize: 13, fontWeight: 600 }}>Don't log my device and usage info</span>
          </label>
        )}

        <div className="form-actions">
          <button type="button" className="btn btn--primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
