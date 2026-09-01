// Shared with MusiciansList.jsx's "Invite to sign up" button and
// BandMembers.jsx's dep rows -- same signup link and email copy either way,
// so a dep gets the identical invite regardless of which screen sent it.
// `email` is optional: an empty recipient still opens the mail app with the
// subject/body pre-filled, just with no "To" address pre-filled in.
export function buildInviteMailto(name, email = '') {
  const signupUrl = window.location.origin + '/?invite=1&name=' + encodeURIComponent(name);
  const subject = 'Join us on Seeau';
  const body =
    'Hi ' + name + ',\n\n' +
    "We'd like to invite you to create your own account on Seeau so we can book you directly for future gigs.\n\n" +
    'Sign up here: ' + signupUrl + '\n\n' +
    "Once you've signed up, let us know and we'll link your gig history to your new account.\n\nThanks!";
  return (
    'mailto:' + encodeURIComponent(email) +
    '?subject=' + encodeURIComponent(subject) +
    '&body=' + encodeURIComponent(body)
  );
}
