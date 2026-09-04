// Hand-written, user-facing changelog for the "What's new" panel
// (WhatsNewModal.jsx) -- deliberately NOT generated from git commit
// messages. Commit titles describe the problem that existed ("fix profile
// permission gaps"), which reads as alarming rather than reassuring, and
// most commits (migrations, refactors, internal-only fixes) aren't things
// a user should ever see. Add a short entry here when something a user
// would actually notice ships -- skip anything purely internal, and frame
// a fix as the improvement ("X now shows Y"), never as the bug that used
// to exist.
//
// Newest first. `id` just needs to be unique and sort after whatever came
// before it for the "have you seen the latest" check in App.jsx to work --
// a date-based slug gets that for free.
export const WHATS_NEW = [
  {
    id: '2026-09-04-offline-everything',
    date: '2026-09-04',
    title: 'Way more of the app works with no signal',
    body: "Chat, tasks, payment claims, suppliers, song requests and the stage plot now all stay readable at a gig with no signal, the same \"showing what was last saved\" behaviour gig details already had. The dashboard, gig list, calendar and grid views are steadier on a shaky signal too.",
  },
  {
    id: '2026-09-04-offline-backing-tracks',
    date: '2026-09-04',
    title: 'Backing tracks, saved for when there’s no signal',
    body: "Save a backing track to your phone ahead of a gig and it'll still play — tempo, pitch and click track included — even with no signal on the night.",
  },
  {
    id: '2026-09-04-chat-reactions',
    date: '2026-09-04',
    title: 'React to a message, and a compose box that actually wraps',
    body: "Gig chat now supports a thumbs-up on any message, and the message box grows as you type instead of scrolling sideways — Shift+Enter for a line break, Enter to send.",
  },
  {
    id: '2026-09-03-duplicate-cleanup',
    date: '2026-09-03',
    title: 'Clean up duplicate songs and venues',
    body: "Repertoire and Venues now flag likely duplicates — like the same song added twice with slightly different spelling — and suggest which one to keep based on how much it's actually used. Merging keeps the best of both versions and takes a couple of clicks.",
  },
  {
    id: '2026-09-03-setlist-vocals',
    date: '2026-09-03',
    title: 'Setlists show who can sing lead',
    body: "Each song on a setlist now shows who on the roster can front it, pulled straight from everyone's own repertoire — handy for spotting a gap before the gig, not during it.",
  },
  {
    id: '2026-09-03-dep-invoices',
    date: '2026-09-03',
    title: 'Pay deps who don’t use the app',
    body: 'A dep can now invoice for a gig even without an account of their own — attach a PDF or a link, and it slots in alongside everyone else’s claims.',
  },
  {
    id: '2026-09-02-tasks',
    date: '2026-09-02',
    title: 'A task list that mostly fills itself in',
    body: 'The new Tasks widget surfaces things worth doing — an unpaid invoice, an unconfirmed roster spot — automatically, plus room to add your own reminders.',
  },

  // ---- Backfilled 2026-09-04, covering the previous ~2 months. Grouped by
  // theme rather than one entry per commit -- see the note at the top of
  // this file for why. Dated to the day the feature actually shipped.
  {
    id: '2026-09-01-gig-photos',
    date: '2026-09-01',
    title: 'Gig photos, with a caption drafted for you',
    body: 'Upload photos from the night straight from your phone, and let the app draft a social media caption from them — you still choose whether to post it.',
  },
  {
    id: '2026-09-01-rename-seeau',
    date: '2026-09-01',
    title: 'A new name: Seeau',
    body: 'The app has a new name — same account, same everything else.',
  },
  {
    id: '2026-09-01-band-invite-links',
    date: '2026-09-01',
    title: 'Invite a new band member with one link',
    body: 'Share a single link to bring someone into a band, instead of setting them up by hand.',
  },
  {
    id: '2026-08-29-stage-plot',
    date: '2026-08-29',
    title: 'See the stage plan before you arrive',
    body: 'Every gig can now have its own stage plot — who stands where, what gear goes where — visible to the whole band ahead of time.',
  },
  {
    id: '2026-08-28-performance-mode',
    date: '2026-08-28',
    title: 'Performance mode, for the stage',
    body: 'A distraction-free, full-screen setlist view built for actually being on stage — swipe through songs one-handed between numbers.',
  },
  {
    id: '2026-08-28-backing-tracks',
    date: '2026-08-28',
    title: 'Backing tracks, tempo and pitch adjustable live',
    body: "Upload a band's backing tracks once, then nudge the tempo or pitch on the fly at the gig — with a click track if you need one.",
  },
  {
    id: '2026-08-28-notification-badge',
    date: '2026-08-28',
    title: 'Never miss a notification',
    body: "Install the app to your home screen and it now shows an unread badge on the icon, just like a normal app — even when it's closed.",
  },
  {
    id: '2026-08-27-public-band-page',
    date: '2026-08-27',
    title: 'A free public page for your band',
    body: "Every band gets its own shareable public page — a simple way to look professional to a new client before they've even asked for a quote.",
  },
  {
    id: '2026-08-27-song-requests',
    date: '2026-08-27',
    title: 'Let guests request a song',
    body: 'A QR code guests can scan on the night to request a song, straight into the setlist view for whoever needs to see it.',
  },
  {
    id: '2026-08-25-receipt-scan',
    date: '2026-08-25',
    title: 'Scan a receipt, done',
    body: 'Take a photo of a receipt and the app reads the shop, date and amount for you — no more typing expenses in by hand.',
  },
  {
    id: '2026-08-25-arcade',
    date: '2026-08-25',
    title: 'Something for the break',
    body: 'A few simple games — Snake, a music-themed Wordle, noughts and crosses — for the quiet ten minutes between sets.',
  },
  {
    id: '2026-08-24-news-widget',
    date: '2026-08-24',
    title: 'Music news on your dashboard',
    body: 'A daily digest of UK music-industry news, right on the Dashboard.',
  },
  {
    id: '2026-08-14-stripe',
    date: '2026-08-14',
    title: 'Get paid online',
    body: "Clients can now pay an invoice by card online, and musicians can have their fee land straight in their bank — both handled securely through Stripe.",
  },
  {
    id: '2026-08-13-calendar-view',
    date: '2026-08-13',
    title: 'A proper calendar view',
    body: 'Gigs now have a full month calendar view, alongside the existing list and grid — tap a day to add a gig straight from it.',
  },
  {
    id: '2026-08-12-gig-chat',
    date: '2026-08-12',
    title: "Gig chat, without the WhatsApp sprawl",
    body: "A simple chat thread on each gig — iMessage-style — for the roster to sort out who's bringing what, without a separate group chat to manage.",
  },
  {
    id: '2026-08-12-suppliers',
    date: '2026-08-12',
    title: 'Track your suppliers',
    body: 'Add photographers, caterers and other vendors working a gig, with a ready-made follow-up email template for each.',
  },
  {
    id: '2026-08-12-nearby-places',
    date: '2026-08-12',
    title: 'Nearby food, fuel and parking, instantly',
    body: "The day sheet now shows what's actually near the venue — food, fuel, hotels, car parks — loading instantly since it's looked up once and cached, not fetched fresh on every phone.",
  },
  {
    id: '2026-08-12-profile-pictures',
    date: '2026-08-12',
    title: 'See who you’re working with',
    body: 'Everyone can now add a profile picture, shown on the roster, day sheet and dep-finder — a face is easier to place than a name alone.',
  },
  {
    id: '2026-08-10-esignatures',
    date: '2026-08-10',
    title: 'Real signatures on contracts',
    body: 'Contracts can now be signed with an actual drawn signature rather than a typed name, with a full record of when and how it was signed.',
  },
  {
    id: '2026-08-07-mileage',
    date: '2026-08-07',
    title: 'Mileage tracking done properly',
    body: "Log mileage per gig or on its own, at the correct HMRC rate — ready to hand over at tax time without reconstructing it from memory.",
  },
  {
    id: '2026-08-03-setlist-import',
    date: '2026-08-03',
    title: 'Paste in a whole setlist at once',
    body: "Paste a setlist straight from a text or a PDF and the app matches each song against your library automatically, flagging anything it isn't sure about.",
  },
  {
    id: '2026-08-01-quotes-contracts',
    date: '2026-08-01',
    title: 'Quotes and contracts, not just invoices',
    body: 'Send a proper Quote and a Contract with e-signing, each with its own page you can share with the client — the same document flow invoices already had.',
  },
  {
    id: '2026-08-01-theme-picker',
    date: '2026-08-01',
    title: 'Make it look like yours',
    body: "An app-wide colour theme to pick from, plus your own colours on a band's invoices, quotes and contracts.",
  },
  {
    id: '2026-07-30-band-leaders',
    date: '2026-07-30',
    title: 'Band leaders',
    body: "A band can now have its own leader with real admin powers — rostering, invoicing, finding deps — scoped to just their band, no full admin access needed.",
  },
  {
    id: '2026-07-28-fee-splitting',
    date: '2026-07-28',
    title: 'Gig pay splits itself out automatically',
    body: "Once a gig's fee is set, the app works out everyone's share on its own — musicians, DJ, roadie and captain bonus included — instead of it being worked out by hand every time.",
  },
  {
    id: '2026-07-28-roadie-dj-captain',
    date: '2026-07-28',
    title: 'Roadie, DJ and captain roles',
    body: 'Gigs can now have a designated roadie, DJ and band captain on the roster, each with their own bonus.',
  },
  {
    id: '2026-07-26-claim-resubmit',
    date: '2026-07-26',
    title: 'Fix a rejected claim without starting over',
    body: 'A rejected payment claim can now be amended and resubmitted in place, with the reason it was rejected shown up front.',
  },
  {
    id: '2026-07-26-fuzzy-search',
    date: '2026-07-26',
    title: 'Find anything, fast',
    body: "Every list — gigs, venues, clients, musicians — now has proper search that copes with a rough spelling, not just an exact match.",
  },
  {
    id: '2026-07-16-claim-invoice',
    date: '2026-07-16',
    title: 'Download your claim as a proper invoice',
    body: "A musician's payment claim now generates a real, downloadable invoice PDF, and bank details save to your profile so you're not retyping them every time.",
  },
  {
    id: '2026-07-09-calendar-subscribe',
    date: '2026-07-09',
    title: 'Subscribe to your gigs',
    body: 'Add your gig calendar to Apple, Google or Outlook — new gigs and date changes show up there on their own.',
  },
  {
    id: '2026-07-05-notifications',
    date: '2026-07-05',
    title: 'In-app notifications',
    body: "A notification bell with real history, so you can see what's changed without it having already scrolled past in a push alert.",
  },
  {
    id: '2026-07-03-install',
    date: '2026-07-03',
    title: 'Install it to your home screen',
    body: 'The app can now be added to your home screen like a real app, with its own icon — no app store needed.',
  },
  {
    id: '2026-07-02-offline',
    date: '2026-07-02',
    title: 'Works without signal',
    body: 'Gig details now stay available even with no signal — handy for a venue in the middle of nowhere.',
  },
  {
    id: '2026-07-02-permissions',
    date: '2026-07-02',
    title: 'Everyone sees what they need to',
    body: "The app now shows a different view depending on who's looking — admin, band leader or musician — rather than one-size-fits-all.",
  },
];
