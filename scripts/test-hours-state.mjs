import { readFile } from "node:fs/promises";
import vm from "node:vm";
const source=await readFile(new URL("../app-hours.js",import.meta.url),"utf8"); const context={Intl,Date,console}; vm.createContext(context); vm.runInContext(source+'\nthis.__hoursState=restaurantHoursState; this.__clock=halifaxClockParts;',context);
const state=context.__hoursState; const clock=context.__clock; function assert(c,m){if(!c)throw new Error(m)}
const overnight={monday:[{open:"18:00",close:"02:00",overnight:true}],tuesday:[],wednesday:[],thursday:[],friday:[],saturday:[],sunday:[]};
const mondayLate=new Date("2026-08-04T01:00:00Z"); // Monday Aug 3, 22:00 ADT
const tuesdayEarly=new Date("2026-08-04T04:30:00Z"); // Tuesday 01:30 ADT
const tuesdayLate=new Date("2026-08-04T07:00:00Z"); // Tuesday 04:00 ADT
assert(clock(mondayLate).day==="monday","Expected Halifax Monday clock conversion"); assert(state(overnight,mondayLate).state==="open","Overnight interval should be open before midnight"); assert(state(overnight,tuesdayEarly).state==="open"&&state(overnight,tuesdayEarly).carriedFromPreviousDay===true,"Overnight interval should remain open after midnight"); assert(state(overnight,tuesdayLate).state==="closed","Overnight interval should close after configured close time");
const split={monday:[],tuesday:[{open:"11:00",close:"14:00",overnight:false},{open:"17:00",close:"22:00",overnight:false}],wednesday:[],thursday:[],friday:[],saturday:[],sunday:[]};
const tue1500=new Date("2026-08-04T18:00:00Z"); // 15:00 ADT
const s=state(split,tue1500); assert(s.state==="closed"&&s.opensLaterToday&&s.opensAt==="17:00","Split service should report next opening later today"); assert(state(null,tue1500).state==="unknown","Missing hours must remain unknown"); console.log("Halifax structured-hours regression passed: timezone, overnight service, split service, and unknown hours are handled without fabrication.");
