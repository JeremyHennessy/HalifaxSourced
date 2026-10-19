import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";

// Validators and builders execute the same permission predicate as the browser.
const integrity = createRequire(import.meta.url)("../../source-integrity.js");
const context = {
  window: {}, URL,
  safeUrl: (value) => {
    try { return integrity.safeSource(value) ? new URL(value).href : null; }
    catch { return null; }
  }
};
vm.createContext(context);
vm.runInContext(readFileSync(new URL("../../app-media.js", import.meta.url), "utf8"), context);
export const mediaPermitted = record => context.mediaRecordState(record) === "approved";
export const referenceProblems = record => Array.from(context.referenceMediaProblems(record));
export const mediaRecordState = record => context.mediaRecordState(record);

