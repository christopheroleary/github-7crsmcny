// Prints a standalone HTML document (built by a component's own
// buildPrintHTML) without opening a new window. window.open(..., '_blank')
// is treated as a popup by most browsers unless it happens synchronously
// inside a trusted click handler with nothing awaited first -- easy to
// trip (an async data fetch before the click handler runs, a slow build,
// browser-specific heuristics) and when it trips the print silently never
// happens. A hidden same-page iframe sidesteps popup blocking entirely
// since it never opens a new browsing context.
//
// Loaded via `srcdoc` rather than document.open/write/close -- the latter
// races the iframe's initial about:blank "load" event (the handler can
// end up attached after that fires, so it never fires again once the
// real content is written) and left the frame permanently un-printed
// with no error in testing. srcdoc is a real navigation, so `load` fires
// once, reliably, after the written document and its sub-resources
// (fonts, the band logo image) are actually ready.
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

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    iframe.remove();
  };

  iframe.onload = () => {
    const win = iframe.contentWindow;
    win.addEventListener('afterprint', cleanup);
    win.focus();
    win.print();
    // Safety net for browsers that don't fire afterprint on an iframe
    // (notably older iOS Safari).
    setTimeout(cleanup, 5000);
  };

  document.body.appendChild(iframe);
  iframe.srcdoc = html;
}
