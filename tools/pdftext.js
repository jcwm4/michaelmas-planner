// Prints {path: [page text, ...]} for each PDF given, using macOS's built-in PDFKit.
// Used by build_search.py:  osascript -l JavaScript tools/pdftext.js a.pdf b.pdf
ObjC.import('Quartz');
ObjC.import('Foundation');
function run(argv) {
  const out = {};
  for (const p of argv) {
    const doc = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(p));
    if (!doc || doc.isNil()) { out[p] = null; continue; }
    const pages = [];
    for (let i = 0; i < doc.pageCount; i++) {
      const s = doc.pageAtIndex(i).string;
      pages.push(s && !s.isNil() ? s.js : '');
    }
    out[p] = pages;
  }
  return JSON.stringify(out);
}
