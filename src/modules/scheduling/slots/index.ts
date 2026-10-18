/**
 * Casevoya slot library. Pure TypeScript: no I/O, no clock (time is passed in), no runtime
 * dependency, so it runs on Cloudflare Workers, in Node and in the browser.
 */
export { SlotInputError, type SlotInputErrorCode } from "./errors";
export { addDays, assertTimeZone, isTimeZone, localToUtc, offsetMinutes, utcToLocal, weekdayOf, type LocalTime } from "./zone";
export { insideAny, intersect, merge, overlapsAny, pad, subtract, type Interval } from "./intervals";
export { expandSchedule, validateSchedule, type DateOverride, type ScheduleInput, type WeeklyRule } from "./windows";
export { generateSlots, isOfferedStart, type SlotInput, type SlotStart } from "./slots";
export { decodeStarts, encodeStarts } from "./encode";
