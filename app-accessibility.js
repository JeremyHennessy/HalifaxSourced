"use strict";

document.addEventListener("keydown", (event) => {
  const row = event.target.closest?.("[data-map-result-id]");
  if (!row || !["Enter", " "].includes(event.key)) return;
  if (event.target.closest("a,button,input,select,textarea")) return;
  event.preventDefault();
  focusMapResult(row.dataset.mapResultId);
});
