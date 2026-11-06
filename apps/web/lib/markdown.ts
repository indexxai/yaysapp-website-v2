import { docHtml } from '@yays/shared';
export { docHtml, mdToHtml } from '@yays/shared';

/** Saves a document as a Word file (.doc made of HTML, which Word opens). */
export function downloadWord(title: string, md: string) {
  const blob = new Blob(['﻿', docHtml(title, md)], { type: 'application/msword' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `${title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Document'}.doc`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
/** Opens the browser's print dialog for the document, where "Save as PDF" is available. */
export function printPdf(title: string, md: string) {
  const w = window.open('', '_blank', 'noopener=no');
  if (!w) return false;
  w.document.write(docHtml(title, md)); w.document.close();
  w.focus(); setTimeout(() => w.print(), 200);
  return true;
}
