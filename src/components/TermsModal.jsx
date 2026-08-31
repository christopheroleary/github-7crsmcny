// LAST UPDATED 2026-08-31. Contracting party is currently the sole trader
// "Chris O'Leary, trading as Seeau" -- update this (and the matching
// line in PrivacyModal.jsx) the moment incorporation completes or the app
// is renamed again. That's a real change, not just cosmetic: a Ltd
// company's liability is generally limited to the company, a sole
// trader's isn't -- re-check the Liability section below applies as
// intended once that changes.
const LAST_UPDATED = '31 August 2026';
const PROVIDER = "Chris O'Leary, trading as Seeau";

function Section({ title, children }) {
  return (
    <section style={{ marginTop: 18 }}>
      <h4 style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, margin: '0 0 6px' }}>{title}</h4>
      <div className="field__hint" style={{ lineHeight: 1.6 }}>{children}</div>
    </section>
  );
}

// A real starting draft, not a placeholder -- covers what this app
// actually does (bookings, Pro billing, Stripe payouts between users).
// Worth a solicitor's review before treating it as final, especially the
// payment-facilitation and liability sections, given real money moves
// through the app.
export default function TermsModal({ onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 620 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
          <h3 className="day-sheet__section-title" style={{ margin: 0 }}>Terms &amp; Conditions</h3>
          <button type="button" className="link-button" onClick={onClose}>Close</button>
        </div>
        <p className="field__hint" style={{ margin: '4px 0 0', fontStyle: 'italic' }}>Last updated {LAST_UPDATED}</p>

        <Section title="1. Acceptance">
          <p style={{ margin: 0 }}>
            By creating an account or using Seeau, you agree to these
            terms. If you don't agree, please don't use the app. These terms
            are between you and {PROVIDER} ("we", "us").
          </p>
        </Section>

        <Section title="2. What Seeau is">
          <p style={{ margin: 0 }}>
            Seeau is a booking and admin tool for bands — rosters, day
            sheets, setlists, invoicing, and payment tracking. We aren't a
            party to any booking agreement between a band and a client, and
            we aren't a payment institution: subscription billing and
            payouts between users run through Stripe, a regulated payment
            provider, under Stripe's own terms.
          </p>
        </Section>

        <Section title="3. Accounts">
          <p style={{ margin: 0 }}>
            You're responsible for the accuracy of the information on your
            account and for keeping your login secure. Band leaders and
            admins can invite musicians to join a band's roster; each person
            is responsible for their own account once created.
          </p>
        </Section>

        <Section title="4. Pro subscription">
          <p style={{ margin: 0 }}>
            Some features require a Pro subscription, billed monthly via
            Stripe. It renews automatically until you cancel — you can
            cancel any time from Money → Manage subscription, and you'll
            keep Pro access until the end of the period you've already paid
            for. We don't offer refunds for partial billing periods unless
            required by law.
          </p>
        </Section>

        <Section title="5. Payments between users">
          <p style={{ margin: 0 }}>
            Where a band leader pays a musician through the app — via Stripe
            Connect payout or by using the bank details shown to make a
            manual transfer — that payment is between those two people. We
            facilitate it by showing the right information and, where Stripe
            Connect is set up, passing the payment through Stripe, but we
            don't guarantee payment and we're not a party to any dispute
            about whether or how much is owed. Sort out fee disagreements
            directly; the day sheet and claim records are there to help you
            do that with a clear paper trail.
          </p>
        </Section>

        <Section title="6. Acceptable use">
          <p style={{ margin: '0 0 8px' }}>Please don't:</p>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li>Use the app for anything unlawful, or to harass or defraud anyone;</li>
            <li>Submit an expense claim, receipt, or availability record you know to be false;</li>
            <li>Try to access another person's account or data you're not authorised to see;</li>
            <li>Interfere with the app's normal operation (e.g. attempting to overload or reverse-engineer it).</li>
          </ul>
        </Section>

        <Section title="7. Your content">
          <p style={{ margin: 0 }}>
            You keep ownership of anything you upload — photos, receipts,
            setlists, messages. You're responsible for having the right to
            upload it, and you give us permission to store and display it
            back to you and to the other people it's meant to be shared
            with (e.g. your bandmates on a gig day sheet).
          </p>
        </Section>

        <Section title="8. Availability">
          <p style={{ margin: 0 }}>
            We aim to keep the app available and reliable, but it's provided
            "as is" without a guaranteed uptime — features, including
            third-party ones like receipt scanning or Stripe payouts, can
            occasionally be unavailable. We'll try to give notice of planned
            downtime or significant changes where practical.
          </p>
        </Section>

        <Section title="9. Liability">
          <p style={{ margin: 0 }}>
            To the extent the law allows, we're not liable for indirect or
            consequential losses (like a missed gig or lost earnings)
            arising from using the app, and our total liability to you is
            limited to the amount you've paid us in Pro subscription fees in
            the 12 months before a claim. Nothing here limits liability for
            things the law doesn't allow us to limit, like death or personal
            injury caused by our negligence, or fraud.
          </p>
        </Section>

        <Section title="10. Ending your account">
          <p style={{ margin: 0 }}>
            You can stop using the app at any time — ask via the Feedback
            button and we'll close your account. We may suspend or close an
            account that breaches these terms. See the Privacy Policy for
            how long we keep data after that.
          </p>
        </Section>

        <Section title="11. Changes to these terms">
          <p style={{ margin: 0 }}>
            If we make a material change, we'll update the date above and
            let you know in the app. Continuing to use Seeau after
            that means you accept the updated terms.
          </p>
        </Section>

        <Section title="12. Governing law">
          <p style={{ margin: 0 }}>
            These terms are governed by the law of England and Wales, and
            any dispute will be handled by the courts of England and Wales.
          </p>
        </Section>

        <Section title="13. Contact">
          <p style={{ margin: 0 }}>
            Use the Feedback button (top right of the app) for any question
            about these terms.
          </p>
        </Section>

        <div className="form-actions">
          <button type="button" className="btn btn--primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
