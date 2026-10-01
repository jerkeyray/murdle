import type { Duo } from "./api";
export function duoStatus(duo?: Duo): string {
  if (!duo) return "Play together";
  if (duo.status === "pending") return duo.inviterId === duo.viewerId ? "Invitation sent" : "Invited you";
  const day = duo.today;
  if (!day) return "Play together";
  if (day.state === "won") return "Solved";
  if (day.state !== "playing") return "Missed";
  return day.currentPlayer === duo.viewerId ? "Your turn" : "Their turn";
}
