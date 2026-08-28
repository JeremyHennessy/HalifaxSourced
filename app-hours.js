"use strict";
const HALIFAX_TIME_ZONE = "America/Halifax";
const HALIFAX_WEEKDAYS = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];

function halifaxClockParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: HALIFAX_TIME_ZONE, weekday: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { day: String(values.weekday || "").toLowerCase(), minutes: Number(values.hour || 0) * 60 + Number(values.minute || 0) };
}
function hoursMinutes(value) { const m=String(value||"").match(/^(\d{2}):(\d{2})$/); return m ? Number(m[1])*60+Number(m[2]) : null; }
function previousWeekday(day){ const i=HALIFAX_WEEKDAYS.indexOf(day); return i<0?null:HALIFAX_WEEKDAYS[(i+6)%7]; }
function restaurantHoursState(weekly, date = new Date()) {
  if (!weekly || typeof weekly !== "object") return { state:"unknown", reason:"structured_hours_unavailable" };
  const now=halifaxClockParts(date); const todays=Array.isArray(weekly[now.day])?weekly[now.day]:[];
  for(const interval of todays){ const open=hoursMinutes(interval.open), close=hoursMinutes(interval.close); if(open===null||close===null)continue; if(interval.overnight){ if(now.minutes>=open)return {state:"open",closesAt:interval.close,overnight:true}; } else if(now.minutes>=open&&now.minutes<close)return {state:"open",closesAt:interval.close,overnight:false}; }
  const prev=previousWeekday(now.day); for(const interval of Array.isArray(weekly[prev])?weekly[prev]:[]){ if(!interval.overnight)continue; const close=hoursMinutes(interval.close); if(close!==null&&now.minutes<close)return {state:"open",closesAt:interval.close,overnight:true,carriedFromPreviousDay:true}; }
  const upcoming=todays.map((interval)=>({interval,open:hoursMinutes(interval.open)})).filter((x)=>x.open!==null&&x.open>now.minutes).sort((a,b)=>a.open-b.open)[0];
  if(upcoming)return {state:"closed",opensAt:upcoming.interval.open,opensLaterToday:true};
  return {state:"closed",reason:"no_current_interval"};
}
