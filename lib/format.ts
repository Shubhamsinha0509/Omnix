import { differenceInMinutes, format, isToday, isYesterday } from "date-fns";

/** "Just now", "12 min ago", "3h ago", "Yesterday", "Nov 18" — the design's list times. */
export function shortWhen(date: Date, now = new Date()) {
  const minutes = differenceInMinutes(now, date);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (isToday(date)) return `${Math.floor(minutes / 60)}h ago`;
  if (isYesterday(date)) return "Yesterday";
  return format(date, date.getFullYear() === now.getFullYear() ? "MMM d" : "MMM d, yyyy");
}

/**
 * A model id as people read it: "nvidia/nemotron-3-ultra-550b-a55b:free" → "Nemotron 3 Ultra",
 * "deepseek/deepseek-chat-v3.1" → "Deepseek Chat V3.1". Size suffixes (550b, a55b) drop off.
 */
export function modelLabel(id: string) {
  const name = id.split("/").pop()?.replace(/:.*$/, "") ?? id;
  const words = name
    .split("-")
    .filter((word) => !/^a?\d+b$/i.test(word))
    .slice(0, 3)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  return words.join(" ") || id;
}
