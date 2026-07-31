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
  const [sentCount, setSentCount] = useState(0);

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
  const gigLink = window.location.origin + '/?gig=' + gig.id;

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
    '\n\nFull gig details: ' + gigLink;

  const withPhone = recipients.filter((p) => toWhatsAppNumber(p.phone));
  const nextPerson = withPhone[sentCount];

  function waHref(person) {
    const text =
      'Hi ' + person.name.split(' ')[0] + '! Here\'s the WhatsApp group for ' +
      venueName + ' on ' + formatShortDate(gig.gig_date) + ': ' + inviteLink;
    return 'https://wa.me/' + toWhatsAppNumber(person.phone) + '?text=' + encodeURIComponent(text);
  }

  return (
    <div style={{ marginTop: 32 }}>
      <div className="section-header">
        <h2 className="section-header__title">WhatsApp group</h2>
      </div>

      <details>
        <summary className="field__hint" style={{ cursor: 'pointer', userSelect: 'none' }}>
          Set up group for this gig
        </summary>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10, maxWidth: 420 }}>
          <p className="field__hint" style={{ margin: 0 }}>
            WhatsApp doesn't let apps create groups automatically, so create it yourself and use
            these to fill it in — works the same on desktop (WhatsApp Web/Desktop) as on a phone.
          </p>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ flex: 1 }}>1. Group title</span>
            <CopyButton text={groupTitle} label="Copy" />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ flex: 1 }}>2. Welcome message (paste after creating the group)</span>
            <CopyButton text={summaryMessage} label="Copy" />
          </div>

          <form onSubmit={handleSaveLink}>
            <span className="field__hint" style={{ display: 'block', marginBottom: 4 }}>
              3. In WhatsApp: Group Info → Invite via Link → Copy Link — then paste it here
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
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

          <div>
            <span className="field__hint" style={{ display: 'block', marginBottom: 4 }}>
              4. Send invites — WhatsApp only lets one chat open per tap, so this queues them one at a time
            </span>
            {loading ? (
              <p className="state-message">Loading lineup…</p>
            ) : !inviteLink ? (
              <p className="field__hint">Save the invite link above first.</p>
            ) : withPhone.length === 0 ? (
              <p className="field__hint">No one on the roster has a phone number on file yet.</p>
            ) : (
              <>
                {nextPerson ? (
                  <a
                    className="btn btn--primary btn--small"
                    href={waHref(nextPerson)}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setSentCount((n) => n + 1)}
                  >
                    Send next invite ({sentCount + 1} of {withPhone.length}) — {nextPerson.name}
                  </a>
                ) : (
                  <p className="field__hint">✓ All invites sent.</p>
                )}
                <ul className="field__hint" style={{ marginTop: 8, paddingLeft: 18, lineHeight: 1.7 }}>
                  {recipients.map((p, i) => {
                    const wa = toWhatsAppNumber(p.phone);
                    const waIndex = wa ? withPhone.indexOf(p) : -1;
                    const status = !wa ? 'no phone' : waIndex < sentCount ? 'sent ✓' : 'pending';
                    return <li key={i}>{p.name} — {status}</li>;
                  })}
                </ul>
              </>
            )}
          </div>
        </div>
      </details>
    </div>
  );
}
