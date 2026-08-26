// Prints a standalone HTML document (built by a component's own
// buildPrintHTML) without opening a new window. window.open(..., '_blank')
// is treated as a popup by most browsers unless it happens synchronously
// inside a trusted click handler with nothing awaited first -- easy to
// trip (an async data fetch before the click handler runs, a slow build,
// browser-specific heuristics) and when it trips the print silently never
// happens. A hidden same-page iframe sidesteps popup blocking entirely
// since it never opens a new browsing context.
//
// document.write + an immediate, synchronous print() call, deliberately
// *not* waiting on the iframe's `load` event. Two real bugs came from
// that event:
//   1. Appending an iframe with no src/srcdoc yet implicitly navigates it
//      to about:blank, which can fire its own `load` -- separately from
//      the `load` that follows once the real content is written/set.
//      Printing from that handler could therefore fire twice: once for
//      the real page, once for a second, empty pass.
//   2. `win.print()` called from an async event handler (the `load`
//      fires well after the click that started all this) falls outside
//      what iOS Safari treats as a direct user gesture, so it shows an
//      "this page is trying to print automatically" prompt instead of
//      just printing.
// Calling print() synchronously, in the same tick as document.close(),
// avoids both: there's no `load` event in the loop to double-fire, and
// it's still within the click handler's call stack as far as Safari's
// user-activation check is concerned.
// Escapes text before it's interpolated into one of the print templates.
//
// These templates build a raw HTML string that goes through document.write,
// so any unescaped value in them is a script-injection sink. That was
// tolerable when every value was typed by the person doing the printing
// (self-XSS, little to gain), but receipt scanning changed the threat
// model: a merchant name now originates from a photographed receipt, i.e.
// from whoever handed the musician that piece of paper.
export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// @font-face rules for the standalone documents each print template builds.
// These documents are written via document.write into an iframe that never
// navigated anywhere (see printHtmlDocument above), so they don't inherit
// the app's own stylesheet and need their own copy -- same self-hosted
// files as src/index.css (see the comment there for why), referenced by
// absolute URL since a relative path in a document injected this way isn't
// guaranteed to resolve against the app's own origin the way the app's
// real pages do.
export function fontFaceCss() {
  const base = window.location.origin;
  return `
    @font-face {
      font-family: 'Inter';
      font-style: normal;
      font-weight: 400 600;
      font-display: swap;
      src: url('${base}/fonts/inter-variable.woff2') format('woff2');
    }
    @font-face {
      font-family: 'Space Grotesk';
      font-style: normal;
      font-weight: 500 700;
      font-display: swap;
      src: url('${base}/fonts/space-grotesk-variable.woff2') format('woff2');
    }
    @font-face {
      font-family: 'IBM Plex Mono';
      font-style: normal;
      font-weight: 400;
      font-display: swap;
      src: url('${base}/fonts/ibm-plex-mono-400.woff2') format('woff2');
    }
    @font-face {
      font-family: 'IBM Plex Mono';
      font-style: normal;
      font-weight: 500;
      font-display: swap;
      src: url('${base}/fonts/ibm-plex-mono-500.woff2') format('woff2');
    }
  `;
}

export function printHtmlDocument(html) {
  const iframe = document.createElement('iframe');
  Object.assign(iframe.style, {
    position: 'fixed',
    right: '0',
    bottom: '0',
    width: '0',
    height: '0',
    border: '0',
  });
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();

  const win = iframe.contentWindow;
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    iframe.remove();
  };
  win.addEventListener('afterprint', cleanup);
  win.focus();
  win.print();
  // Safety net for browsers that don't fire afterprint on an iframe
  // (notably older iOS Safari).
  setTimeout(cleanup, 5000);
}
