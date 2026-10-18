/** Why a slot query was refused. Thrown by the slot library for bad input; never for "no slots". */
export type SlotInputErrorCode =
  | "unknown_time_zone"
  | "invalid_date"
  | "invalid_time"
  | "end_before_start"
  | "invalid_weekday"
  | "invalid_duration"
  | "invalid_step"
  | "invalid_buffer"
  | "invalid_notice"
  | "invalid_advance"
  | "invalid_range"
  | "invalid_instant"
  | "invalid_capacity"
  | "invalid_encoding";

export class SlotInputError extends Error {
  readonly code: SlotInputErrorCode;

  constructor(code: SlotInputErrorCode, message: string) {
    super(message);
    this.name = "SlotInputError";
    this.code = code;
  }
}
