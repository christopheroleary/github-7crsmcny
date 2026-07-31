import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { formatFullDate, formatShortDate } from '../utils/formatDate.js';

// wa.me needs digits-only, international format, no leading 0 or +.
// UK-specific: 07700 900123 -> 447700900123. Numbers already starting
// with a country code (44 or +44) are left as-is.
function toWhatsAppNumber(phone) {
  if (!phone) return null;
  const digits = phone.replace(/[^\d]/g, '');
  if (!digits) return null;
  if (digits.startsWith('44')) return digits;
  if (digits.startsWith('0')) return '44' + digits.slice(1);
  return digits;
}

function CopyButton({ text, label }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      alert("Couldn't copy — select and copy the text manually.");
    }
  }

  return (
    <button type="button" className="btn btn--ghost btn--small" onClick={handleCopy}>
      {copied ? 'Copied!' : label}
    </button>
  );
}

export default function GigWhatsAppGroup({ gig }) {
  const [recipients, setRecipients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [inviteLink, setInviteLink] = useState(gig.whatsapp_invite_link || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: lineup }, { data: leaders }] = await Promise.all([
      supabase
        .from('gig_lineup')
        .select('profiles(full_name, phone), placeholder_musicians(name, phone)')
        .eq('gig_id', gig.id),
      supabase
        .from('band_leaders')
        .select('profiles!band_leaders_profile_id_fkey(full_name, phone)')
        .eq('band_id', gig.band_id),
    ]);

    const people = [
      ...(lineup || []).map((l) => ({
        name: l.profiles?.full_name || l.placeholder_musicians?.name,
        phone: l.profiles?.phone || l.placeholder_musicians?.phone,
      })),
      ...(leaders || []).map((l) => ({ name: l.profiles?.full_name, phone: l.profiles?.phone })),
    ].filter((p) => p.name);

    // De-dupe (a leader who's also in the lineup shouldn't get two rows)
    const seen = new Set();
    const deduped = people.filter((p) => {
      const key = p.name + '|' + (p.phone || '');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    deduped.sort((a, b) => a.name.localeCompare(b.name));

    setRecipients(deduped);
    setLoading(false);
  }, [gig.id, gig.band_id]);

  useEffect(() => { load(); }, [load]);

  async function handleSaveLink(e) {
    e.preventDefault();
    setSaving(true);
    const { error } = await supabase
      .from('gigs')
      .update({ whatsapp_invite_link: inviteLink.trim() || null })
      .eq('id', gig.id);
    setSaving(false);
    if (error) { alert("Couldn't save invite link: " + error.message); return; }
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  const venueName = gig.venues?.name || 'the venue';
  const groupTitle = formatShortDate(gig.gig_date) + ' – ' + venueName;

  const timesLine = [
    gig.load_in_time && 'Load-in ' + gig.load_in_time.slice(0, 5),
    gig.start_time && 'On stage ' + gig.start_time.slice(0, 5),
    gig.end_time && 'Finish ' + gig.end_time.slice(0, 5),
  ].filter(Boolean).join(' · ');

  const summaryMessage =
    (gig.bands?.name || 'Gig') + ' — ' + venueName + '\n' +
    formatFullDate(gig.gig_date) + '\n' +
    (timesLine || '') +
    (gig.venues?.address ? '\n📍 ' + gig.venues.address : '') +
    (gig.parking_notes ? '\nParking: ' + gig.parking_notes : '') +
    '\n\nAny questions, ask away in here!';

  return (
    <div style={{ marginTop: 32 }}>
      <div className="section-header">
        <h2 className="section-header__title">WhatsApp group</h2>
      </div>

      <p className="field__hint" style={{ marginBottom: 16 }}>
        WhatsApp doesn't allow apps to create groups or add members directly — this prepares
        everything so it's copy/paste from here into WhatsApp. Create the group yourself, paste
        the title and first message below, then send each person their own invite link.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 480 }}>
        <div>
          <span className="field__label">1. Group title</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <code style={{ flex: 1, padding: '6px 10px', background: 'var(--paper-raised)', borderRadius: 6, border: '1px solid var(--line)' }}>
              {groupTitle}
            </code>
            <CopyButton text={groupTitle} label="Copy" />
          </div>
        </div>

        <div>
          <span className="field__label">2. First message (paste after creating the group)</span>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 4 }}>
            <pre style={{ flex: 1, whiteSpace: 'pre-wrap', padding: '6px 10px', background: 'var(--paper-raised)', borderRadius: 6, border: '1px solid var(--line)', fontFamily: 'inherit', margin: 0 }}>
              {summaryMessage}
            </pre>
            <CopyButton text={summaryMessage} label="Copy" />
          </div>
        </div>

        <form onSubmit={handleSaveLink}>
          <span className="field__label">3. Group invite link (Group Info → Invite via Link)</span>
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <input
              type="url"
              placeholder="https://chat.whatsapp.com/…"
              value={inviteLink}
              onChange={(e) => setInviteLink(e.target.value)}
              style={{ flex: 1 }}
            />
            <button type="submit" className="btn btn--primary btn--small" disabled={saving}>
              {saved ? 'Saved!' : saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>

      <div style={{ marginTop: 20 }}>
        <span className="field__label">4. Send each person their invite</span>
        {loading ? (
          <p className="state-message">Loading lineup…</p>
        ) : recipients.length === 0 ? (
          <p className="state-message">No one on the roster yet.</p>
        ) : !inviteLink ? (
          <p className="field__hint" style={{ marginTop: 8 }}>Save the invite link above first.</p>
        ) : (
          <ul className="simple-list" style={{ marginTop: 8 }}>
            {recipients.map((p, i) => {
              const waNumber = toWhatsAppNumber(p.phone);
              const inviteText =
                'Hi ' + p.name.split(' ')[0] + '! Here\'s the WhatsApp group for ' +
                venueName + ' on ' + formatShortDate(gig.gig_date) + ': ' + inviteLink;
              const href = waNumber
                ? 'https://wa.me/' + waNumber + '?text=' + encodeURIComponent(inviteText)
                : null;

              return (
                <li className="simple-list__item" key={i}>
                  <div className="simple-list__row">
                    <span className="simple-list__title">{p.name}</span>
                    {href ? (
                      <a
                        className="btn btn--primary btn--small"
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Send invite
                      </a>
                    ) : (
                      <span className="field__hint">No phone number</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
