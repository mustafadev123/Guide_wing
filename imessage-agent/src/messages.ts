// Everything the responder agent says. Short and plain.
// The journey, the location and the dispatch organization are simulated; no real emergency service is contacted.

import type { Incident, RequestSource } from "./guidewing.ts";

export const MENU =
  "GuideWing responder commands: ACCEPT to take the waiting request, RESOLVED when it is handled, " +
  "DETAILS for the recorded facts, LIST for open requests. Simulated demo: no real emergency service is contacted.";
export const NOT_ALLOWED = "This GuideWing responder line only responds to registered responder numbers.";
export const SERVER_DOWN =
  "The GuideWing server is unreachable right now, so your message was not processed. Please try again in a moment.";

const VIA: Record<RequestSource, string> = {
  gesture: "an open-palm gesture",
  button: "the Help button",
  imessage: "an iMessage text",
  voice: "a spoken voice command",
  test: "a developer TEST control (TEST request)",
};

export function where(i: Pick<Incident, "location">): string {
  const loc = i.location;
  if (loc.source === "unavailable") return "an unavailable location";
  return `${loc.landmark ?? "an unknown landmark"} (${loc.source === "simulated" ? "simulated location" : "device location"})`;
}

export function age(iso: string | null, now = Date.now()): string {
  if (!iso) return "unknown time";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  return s < 60 ? `${s} s ago` : `${Math.round(s / 60)} min ago`;
}

const clock = (iso: string | null) => (iso ? `${iso.slice(11, 19)} UTC` : "not recorded");

export const newRequest = (i: Incident) =>
  `New help request near ${where(i)}, requested with ${VIA[i.request_source] ?? "an unrecognized input"}. Reply ACCEPT to take it, or DETAILS for more.`;
export const youAccepted = (i: Incident) =>
  `You accepted the request near ${where(i)}. The user has been told a responder accepted. Reply RESOLVED when it is handled.`;
export const acceptedByOther = (i: Incident) =>
  `The request near ${where(i)} was accepted by ${i.responder ?? "another responder"}. No action needed.`;
export const alreadyAccepted = (i: Incident) => `Already accepted by ${i.responder ?? "another responder"}.`;
export const cancelledByUser = (i: Incident) => `The user cancelled the request near ${where(i)}. No action needed.`;
export const youResolved = (i: Incident) => `Request near ${where(i)} marked resolved. Thank you.`;
export const resolvedByOther = (i: Incident) => `The request near ${where(i)} was marked resolved${i.responder ? ` (accepted by ${i.responder})` : ""}.`;

export const pendingNote = (i: Incident) =>
  `A request near ${where(i)} is in the user's 10-second cancellation window. You will get a message if it is sent.`;

export function details(i: Incident): string {
  return [
    `Request near ${where(i)}${i.is_test ? " (TEST)" : ""}.`,
    `Status: ${i.status}. Requested with ${VIA[i.request_source] ?? "an unrecognized input"}.`,
    `Requested ${clock(i.created_at)}, dispatched ${clock(i.dispatched_at)}${i.acknowledged_at ? `, accepted ${clock(i.acknowledged_at)} by ${i.responder}` : ""}.`,
    i.snapshot_url ? "A blurred camera snapshot is on the responder desk." : "No camera snapshot.",
    "Location is from the simulated demo route.",
  ].join("\n");
}

export function list(open: Incident[], now = Date.now()): string {
  if (!open.length) return "No open requests.";
  const label = { pending: "in cancellation window", dispatched: "waiting for acceptance", acknowledged: "accepted" } as Record<string, string>;
  return "Open requests:\n" + open.map((i, n) =>
    `${n + 1}) near ${i.location.landmark ?? "unknown"}: ${label[i.status] ?? i.status}${i.status === "acknowledged" && i.responder ? ` by ${i.responder}` : ""}, ${age(i.created_at, now)}`).join("\n");
}
