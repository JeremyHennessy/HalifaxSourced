import { readFile } from "node:fs/promises";
import vm from "node:vm";
const source=await readFile(new URL("../app-hours.js",import.meta.url),"utf8"); const context={Intl,Date,console}; vm.createContext(context); vm.runInContext(source+'\nthis.__hoursState=restaurantHoursState; this.__clock=halifaxClockParts; this.__display=restaurantDisplayedHours;',context);
const state=context.__hoursState; const clock=context.__clock; function assert(c,m){if(!c)throw new Error(m)}
const overnight={monday:[{open:"18:00",close:"02:00",overnight:true}],tuesday:[],wednesday:[],thursday:[],friday:[],saturday:[],sunday:[]};
const mondayLate=new Date("2026-08-04T01:00:00Z"); // Monday Aug 3, 22:00 ADT
const tuesdayEarly=new Date("2026-08-04T04:30:00Z"); // Tuesday 01:30 ADT
const tuesdayLate=new Date("2026-08-04T07:00:00Z"); // Tuesday 04:00 ADT
assert(clock(mondayLate).day==="monday","Expected Halifax Monday clock conversion"); assert(state(overnight,mondayLate).state==="open","Overnight interval should be open before midnight"); assert(state(overnight,tuesdayEarly).state==="open"&&state(overnight,tuesdayEarly).carriedFromPreviousDay===true,"Overnight interval should remain open after midnight"); assert(state(overnight,tuesdayLate).state==="closed","Overnight interval should close after configured close time");
const split={monday:[],tuesday:[{open:"11:00",close:"14:00",overnight:false},{open:"17:00",close:"22:00",overnight:false}],wednesday:[],thursday:[],friday:[],saturday:[],sunday:[]};
const tue1500=new Date("2026-08-04T18:00:00Z"); // 15:00 ADT
const s=state(split,tue1500); assert(s.state==="closed"&&s.opensLaterToday&&s.opensAt==="17:00","Split service should report next opening later today"); assert(state(null,tue1500).state==="unknown","Missing hours must remain unknown"); console.log("Halifax structured-hours regression passed: timezone, overnight service, split service, and unknown hours are handled without fabrication.");

const correctionsContext = { window: {} };
vm.runInNewContext(await readFile(new URL("../data/reviewed-restaurant-corrections.js", import.meta.url), "utf8"), correctionsContext);
const blackSheepCorrection = correctionsContext.window.HALIFAX_RESTAURANT_CORRECTIONS.records.find(item => item.restaurantId === "osm-node-267592027-the-black-sheep");
assert(blackSheepCorrection?.sourceUrl === "https://blacksheephalifax.com/", "Black Sheep must retain official source evidence");
const blackSheep = blackSheepCorrection.fields;
assert(context.__display(blackSheep, new Date("2026-10-25T16:00:00Z")) === blackSheep.openingHours, "Standard hours must remain unchanged before October 26");
assert(context.__display(blackSheep, new Date("2026-10-26T02:30:00Z")) === blackSheep.openingHours, "Before Halifax local midnight on October 25, normal Monday hours are still recorded");
assert(context.__display(blackSheep, new Date("2026-10-26T03:30:00Z")).startsWith("Mo closed;"), "Monday closure begins at Halifax local midnight October 26");
assert(context.__display(blackSheep, new Date("2026-11-14T16:00:00Z")).includes("Sa 09:00-14:00 (Nov 14 only)"), "Private-event November 14 exception must end at 2pm");
assert(context.__display(blackSheep, new Date("2026-11-15T16:00:00Z")).includes("Sa 09:00-22:00"), "One-day November 14 early close must not persist");
assert(context.__display({ openingHours: "unknown source hours" }, new Date("2026-11-14T16:00:00Z")) === "unknown source hours", "Unrelated restaurant hours must be unaffected");
console.log("Official Black Sheep effective-dated hours regression passed.");
