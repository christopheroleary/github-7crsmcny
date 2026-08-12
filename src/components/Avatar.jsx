// Small reusable avatar bubble -- shows the profile picture if one's set,
// otherwise the first letter of the name. Used everywhere a musician's
// picture appears at thumbnail size (roster rows, gig day sheets, the
// dep-finder wizard, the header icon), all sharing the same .avatar-preview
// CSS so they only need updating in one place.
export default function Avatar({ url, name, size = 'small' }) {
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <span className={'avatar-preview avatar-preview--' + size}>
      {url ? <img src={url} alt="" /> : <span className="avatar-preview__placeholder">{initial}</span>}
    </span>
  );
}
