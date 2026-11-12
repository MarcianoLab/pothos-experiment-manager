const SESSION_TIME_ZONE = "Asia/Jerusalem";

function localTimestamp(value: string | Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: SESSION_TIME_ZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)!.value;
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    time: `${part("hour")}:${part("minute")}:${part("second")}`,
  };
}

export function sessionTimingMetadata(createdAt: string, savedAt: Date) {
  const start = localTimestamp(createdAt);
  const end = localTimestamp(savedAt);
  return [
    { field: "session_start_date", value: start.date },
    { field: "session_start_time", value: start.time },
    // The end is the save/export time, including exports made during a session.
    { field: "session_end_date", value: end.date },
    { field: "session_end_time", value: end.time },
    { field: "session_time_zone", value: SESSION_TIME_ZONE },
  ];
}
