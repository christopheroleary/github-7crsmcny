import { useState } from 'react';
import { supabase } from '../supabaseClient';
import { useCurrentProfile } from '../context/ProfileContext.jsx';
import { notify } from '../utils/toastService.js';

// LAST UPDATED 2026-08-31. Data controller is currently the sole trader
// "Chris O'Leary, trading as Seeau" -- update this (and the
// matching line in TermsModal.jsx) the moment incorporation completes or
// the app is renamed again, since a Ltd company is a different legal
// entity from a sole trader, not just a different name on the page.
const LAST_UPDATED = '31 August 2026';
const CONTROLLER = "Chris O'Leary, trading as Seeau";

function Section({ title, children }) {
  return (
    <section style={{ marginTop: 18 }}>
      <h4 style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, margin: '0 0 6px' }}>{title}</h4>
      <div className="field__hint" style={{ lineHeight: 1.6 }}>{children}</div>
    </section>
  );
}

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
      <div className="modal-panel" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 620 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
          <h3 className="day-sheet__section-title" style={{ margin: 0 }}>Privacy Policy</h3>
          <button type="button" className="link-button" onClick={onClose}>Close</button>
        </div>
        <p className="field__hint" style={{ margin: '4px 0 0', fontStyle: 'italic' }}>Last updated {LAST_UPDATED}</p>

        <Section title="Who we are">
          <p style={{ margin: 0 }}>
            Seeau is provided by {CONTROLLER} (the "data controller" for the
            purposes of UK data protection law). This policy explains what
            personal data we collect through the app, why, and what your
            rights are over it.
          </p>
        </Section>

        <Section title="What we collect">
          <p style={{ margin: '0 0 8px' }}>Depending on how you use the app, this can include:</p>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li><strong>Account details</strong> — name, email, phone number, profile photo, home address, instruments played, and your app preferences.</li>
            <li><strong>Gig and booking information</strong> — which gigs and bands you're on, availability, repertoire, and equipment you can bring.</li>
            <li><strong>Payment information</strong> — bank account details for receiving payment, Stripe account and subscription status, and records of expense/mileage/income claims (including any receipt photos you choose to upload).</li>
            <li><strong>Device and usage information</strong> — your device type, browser, screen size, IP address, and when you last used the app, kept for troubleshooting (see "Device and usage data" below — you can opt out of this).</li>
            <li><strong>Messages and communications</strong> — in-app gig chat messages, feedback you send us, and push-notification settings, where you choose to use those features.</li>
          </ul>
        </Section>

        <Section title="Why we collect it">
          <p style={{ margin: 0 }}>
            Mainly because it's necessary to provide the service you've asked
            for — booking gigs, organising a band's roster, and paying
            musicians correctly can't work without this information. Where
            processing isn't strictly necessary for that (like the diagnostic
            logging below), we rely on our legitimate interest in keeping the
            app working reliably, or on your explicit consent, which you can
            withdraw at any time.
          </p>
        </Section>

        <Section title="Who we share it with">
          <p style={{ margin: '0 0 8px' }}>
            We don't sell your data, and we don't share it for advertising. A
            small number of specialist providers process data on our behalf,
            strictly to run the service:
          </p>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li><strong>Supabase</strong> — hosts our database and handles sign-in.</li>
            <li><strong>Stripe</strong> — processes Pro subscription payments and Connect payouts to musicians. Stripe never shares your full card details with us.</li>
            <li><strong>Anthropic (Claude)</strong> — reads the shop, date and amount off a receipt photo, only when you choose to scan one rather than type an expense in by hand. It isn't used to train their AI.</li>
          </ul>
          <p style={{ margin: '8px 0 0' }}>
            We only ever disclose personal data elsewhere if the law requires
            it.
          </p>
        </Section>

        <Section title="Device and usage data">
          <p style={{ margin: 0 }}>
            So the admin can sort things out when something breaks, we note a
            few basics — your device, browser, screen size, IP address and
            when you last used the app — at most once every 30 minutes per
            device. That's the full extent of it: no adverts, no analytics
            trackers, nothing handed to third-party marketing companies.
            Admins never have this logging happen on their own account.
          </p>
          {!isAdmin && (
            <label className="field" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, margin: '12px 0 0' }}>
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
        </Section>

        <Section title="How long we keep it">
          <p style={{ margin: 0 }}>
            Receipt photos are kept for around six years, in line with
            HMRC's record-keeping requirements — even if you delete the
            expense they're attached to, since that's what the retention
            period is for. Most other account and gig data is kept for as
            long as your account is active, and removed within a reasonable
            period after it's closed, except where we're legally required
            to keep financial records for longer.
          </p>
        </Section>

        <Section title="Your rights">
          <p style={{ margin: 0 }}>
            You can ask to see the personal data we hold about you, have
            inaccurate data corrected, ask us to delete it, or object to how
            it's used, at any time — get in touch via the Feedback button in
            the app. You can also complain to the UK Information
            Commissioner's Office (ico.org.uk) if you think we've got
            something wrong.
          </p>
        </Section>

        <Section title="Keeping it secure">
          <p style={{ margin: 0 }}>
            Access to your data is restricted to you and admins of bands
            you're part of — enforced at the database level, not just hidden
            in the app's screens. Bank details are shown masked by default
            wherever they appear on screen.
          </p>
        </Section>

        <Section title="Changes to this policy">
          <p style={{ margin: 0 }}>
            If this policy changes in a way that matters, we'll update the
            date at the top and let you know in the app.
          </p>
        </Section>

        <Section title="Contact us">
          <p style={{ margin: 0 }}>
            Use the Feedback button (top right of the app) for any privacy
            question or request — it goes straight to admin.
          </p>
        </Section>

        <div className="form-actions">
          <button type="button" className="btn btn--primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
