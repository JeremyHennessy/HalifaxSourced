"use strict";

function activateMapResultFromKeyboard(event) {
  const row = event.currentTarget;
  if (!row || !["Enter", " "].includes(event.key)) return;
  if (event.target.closest("a,button,input,select,textarea")) return;
  event.preventDefault();
  focusMapResult(row.dataset.mapResultId);
  highlightMapResult(row.dataset.mapResultId, false);
}

function bindMapResultKeyboard(row) {
  if (!row || row.dataset.keyboardBound === "true") return;
  row.dataset.keyboardBound = "true";
  row.addEventListener("keydown", activateMapResultFromKeyboard);
}

document.addEventListener("focusin", (event) => {
  bindMapResultKeyboard(event.target.closest?.("[data-map-result-id]"));
});

document.addEventListener("pointerover", (event) => {
  bindMapResultKeyboard(event.target.closest?.("[data-map-result-id]"));
});

document.querySelectorAll("[data-map-result-id]").forEach(bindMapResultKeyboard);
