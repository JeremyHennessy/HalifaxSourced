// Pure, offline accounting for the existing bounded BiblioCommons page walk.
// This module describes the plan; it does not make requests or change selected pages.
export function descendingPageNumbers(totalPages, pageLimit) {
  const count = Math.max(1, Math.min(Number(totalPages) || 1, Number(pageLimit) || 1));
  return Array.from({ length: count }, (_, index) => count - index);
}

export function planLibraryPagination(firstPageText, pageLimit) {
  const text = String(firstPageText ?? "");
  const totalMatch = text.match(/\b\d+\s+to\s+\d+\s+of\s+([\d,]+)\s+items\b/i);
  const reportedCountLabel = /\b\d+\s+to\s+\d+\s+of\b/i.test(text);
  const rawTotalItemCount = totalMatch ? Number(totalMatch[1].replace(/,/g, "")) : null;
  // Keep the legacy arithmetic for page selection. The diagnostic projection
  // below is separately bounded so huge or oddly grouped text stays JSON-safe.
  const legacyExpectedPageCount = totalMatch ? Math.ceil(rawTotalItemCount / 20) : 1;
  const canonicalGrouping = totalMatch && /^(?:\d+|\d{1,3}(?:,\d{3})*)$/.test(totalMatch[1]);
  const countOverflow = totalMatch && (!Number.isSafeInteger(rawTotalItemCount)
    || !Number.isSafeInteger(legacyExpectedPageCount));
  const parsedExpectedPageCount = countOverflow ? null : (totalMatch ? legacyExpectedPageCount : null);
  let fallbackToOneReason = null;
  let parseQuality;
  let parseReason;
  if (!totalMatch) {
    fallbackToOneReason = reportedCountLabel
      ? "reported_total_count_malformed"
      : "reported_total_count_missing";
    parseQuality = reportedCountLabel ? "malformed" : "missing";
    parseReason = fallbackToOneReason;
  } else if (countOverflow) {
    parseQuality = "overflow";
    parseReason = "reported_total_count_out_of_safe_range";
  } else if (!canonicalGrouping) {
    parseQuality = "malformed";
    parseReason = "invalid_thousands_grouping";
  } else if (rawTotalItemCount <= 0) {
    parseQuality = "malformed";
    parseReason = "non_positive_total_item_count";
    fallbackToOneReason = "non_positive_expected_page_count";
  } else {
    parseQuality = "valid";
    parseReason = null;
  }
  if (totalMatch && legacyExpectedPageCount === 0) {
    fallbackToOneReason = "non_positive_expected_page_count";
  }

  // This selection expression deliberately matches the prior importer:
  // missing counts select one page; parsed zero and overflow retain their old
  // behavior through descendingPageNumbers.
  const pageNumbers = descendingPageNumbers(legacyExpectedPageCount, pageLimit);
  return {
    parsedExpectedPageCount,
    parseQuality,
    parseReason,
    fallbackToOneReason,
    pageLimit: Number.isSafeInteger(pageLimit) ? pageLimit : null,
    enumeratedPageCount: pageNumbers.length,
    pageCapTruncated: totalMatch !== null && legacyExpectedPageCount > pageNumbers.length,
    pageNumbers
  };
}
