import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { formatFullDate, formatShortDate } from '../utils/formatDate.js';
import { notify } from '../utils/toastService.js';
import { toWhatsAppNumber } from '../utils/phone.js';

function CopyButton({ text, label }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      notify("Couldn't copy — select and copy the text manually.");
    }
  }

  return (
    <button type="button" className="btn btn--ghost btn--small" onClick={handleCopy}>
      {copied ? 'Copied!' : label}
    </button>
  );
}

function generateShareCode() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let code = '';
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export default function GigWhatsAppGroup({ gig }) {
  const [recipients, setRecipients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [inviteLink, setInviteLink] = useState(gig.whatsapp_invite_link || '');
  const [editingLink, setEditingLink] = useState(!gig.whatsapp_invite_link);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [shareCode, setShareCode] = useState(gig.share_code || null);

  // Short code instead of the raw gig id — WhatsApp shows plain-text URLs
  // as-is (no custom link text possible), so keeping this short is the only
  // way to make it look tidy once pasted into a message.
  useEffect(() => {
    if (gig.share_code) { setShareCode(gig.share_code); return; }
    const code = generateShareCode();
    supabase.from('gigs').update({ share_code: code }).eq('id', gig.id).then(({ error }) => {
      if (!error) setShareCode(code);
    });
  }, [gig.id, gig.share_code]);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: lineup }, { data: leaders }, { data: invites }] = await Promise.all([
      supabase
        .from('gig_lineup')
        .select('profile_id, placeholder_id, profiles(full_name, phone), placeholder_musicians(name, phone)')
        .eq('gig_id', gig.id),
      supabase
        .from('band_leaders')
        .select('profile_id, profiles!band_leaders_profile_id_fkey(full_name, phone)')
        .eq('band_id', gig.band_id),
      supabase
        .from('gig_whatsapp_invites')
        .select('profile_id, placeholder_id, sent_at')
        .eq('gig_id', gig.id),
    ]);

    const sentMap = new Map();
    for (const inv of invites || []) {
      sentMap.set(inv.profile_id || inv.placeholder_id, inv.sent_at);
    }

    const people = [
      ...(lineup || []).map((l) => ({
        key: l.profile_id || l.placeholder_id,
        profileId: l.profile_id,
        placeholderId: l.placeholder_id,
        name: l.profiles?.full_name || l.placeholder_musicians?.name,
        phone: l.profiles?.phone || l.placeholder_musicians?.phone,
      })),
      ...(leaders || []).map((l) => ({
        key: l.profile_id,
        profileId: l.profile_id,
        placeholderId: null,
        name: l.profiles?.full_name,
        phone: l.profiles?.phone,
      })),
    ].filter((p) => p.name && p.key);

    const seen = new Set();
    const deduped = people.filter((p) => {
      if (seen.has(p.key)) return false;
      seen.add(p.key);
      return true;
    });
    deduped.forEach((p) => { p.sentAt = sentMap.get(p.key) || null; });
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
    if (error) { notify("Couldn't save invite link: " + error.message); return; }
    setSaved(true);
    setEditingLink(false);
    setTimeout(() => setSaved(false), 1500);
  }

  async function markSent(person) {
    const now = new Date().toISOString();
    setRecipients((prev) => prev.map((p) => (p.key === person.key ? { ...p, sentAt: now } : p)));

    const { data: userData } = await supabase.auth.getUser();
    const row = {
      gig_id: gig.id,
      profile_id: person.profileId || null,
      placeholder_id: person.placeholderId || null,
      sent_at: now,
      sent_by: userData?.user?.id || null,
    };
    const onConflict = person.profileId ? 'gig_id,profile_id' : 'gig_id,placeholder_id';
    const { error } = await supabase.from('gig_whatsapp_invites').upsert(row, { onConflict });
    if (error) console.warn("Couldn't record sent invite:", error.message);
  }

  const venueName = gig.venues?.name || 'the venue';
  const groupTitle = formatShortDate(gig.gig_date) + ' – ' + venueName;
  const gigLink = shareCode ? window.location.origin + '/?gig=' + shareCode : null;

  // Times deliberately left out — they can change in the app after this
  // message is sent, and a stale time in WhatsApp would disagree with the
  // app (the actual source of truth). The gig link below always shows
  // current times instead.
  const summaryMessage =
    (gig.bands?.name || 'Gig') + ' — ' + venueName + '\n' +
    formatFullDate(gig.gig_date) +
    (gig.venues?.address ? '\n📍 ' + gig.venues.address : '') +
    (gig.parking_notes ? '\nParking: ' + gig.parking_notes : '') +
    (gigLink ? '\n\nFull gig details: ' + gigLink : '');

  const withPhone = recipients.filter((p) => toWhatsAppNumber(p.phone));
  const nextPerson = withPhone.find((p) => !p.sentAt);

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

          <div>
            <span className="field__hint" style={{ display: 'block', marginBottom: 4 }}>
              3. In WhatsApp: Group Info → Invite via Link → Copy Link — then paste it here
            </span>
            {!editingLink ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>✓ Invite link saved</span>
                <button type="button" className="link-button" onClick={() => setEditingLink(true)}>
                  Change
                </button>
              </div>
            ) : (
              <form onSubmit={handleSaveLink} style={{ display: 'flex', gap: 8 }}>
                <input
                  type="url"
                  placeholder="https://chat.whatsapp.com/…"
                  value={inviteLink}
                  onChange={(e) => setInviteLink(e.target.value)}
                  style={{ flex: 1 }}
                  autoFocus
                />
                <button type="submit" className="btn btn--primary btn--small" disabled={saving}>
                  {saved ? 'Saved!' : saving ? 'Saving…' : 'Save'}
                </button>
              </form>
            )}
          </div>

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
                    onClick={() => markSent(nextPerson)}
                  >
                    Send next invite ({withPhone.filter((p) => p.sentAt).length + 1} of {withPhone.length}) — {nextPerson.name}
                  </a>
                ) : (
                  <p className="field__hint">✓ All invites sent.</p>
                )}
                <ul className="field__hint" style={{ marginTop: 8, paddingLeft: 18, lineHeight: 1.7 }}>
                  {recipients.map((p) => {
                    const wa = toWhatsAppNumber(p.phone);
                    const status = !wa
                      ? 'no phone'
                      : p.sentAt
                        ? 'sent ' + formatShortDate(p.sentAt.slice(0, 10))
                        : 'pending';
                    return <li key={p.key}>{p.name} — {status}</li>;
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
