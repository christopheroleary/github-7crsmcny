// Small reusable avatar bubble -- shows the profile picture if one's set,
// otherwise a two-letter initial (first letter of first name + first
// letter of surname, e.g. "Chris O'Leary" -> "CO"). A single word name
// just shows that one letter rather than crashing or repeating it. Used
// everywhere a musician's picture appears at thumbnail size (roster rows,
// gig day sheets, the dep-finder wizard, the header icon, My Profile's own
// preview), all sharing the same .avatar-preview CSS so they only need
// updating in one place.
function getInitials(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

export default function Avatar({ url, name, size = 'small' }) {
  const initials = getInitials(name);
  return (
    <span className={'avatar-preview avatar-preview--' + size}>
      {url ? <img src={url} alt="" /> : <span className="avatar-preview__placeholder">{initials}</span>}
    </span>
  );
}
