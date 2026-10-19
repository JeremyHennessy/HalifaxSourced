import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import corrections from '../../restaurant-corrections.js';
const context = { window: {} };
vm.runInNewContext(await readFile(new URL('../../data/reviewed-restaurant-corrections.js', import.meta.url), 'utf8'), context);
export const reviewedCorrections = context.window.HALIFAX_RESTAURANT_CORRECTIONS;
export function applyReviewedCorrections(records) { return corrections.apply(records, reviewedCorrections); }
