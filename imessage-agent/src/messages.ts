// Everything the agent says. Short, plain sentences that read well with VoiceOver.
// The demo route and the responder are simulated; no real emergency service is contacted.

import type { IncidentStatus, RequestSource, Snapshot } from "./guidewing.ts";

export const MENU =
  "GuideWing commands: HELP to request assistance, CANCEL to stop a request, STATUS for an update, " +
  "START, PAUSE or RESUME for the journey, REPEAT for the last message. This is a demo; no real emergency service is contacted.";

export function incidentUpdate(status: IncidentStatus, source: RequestSource, wasDispatched: boolean): string {
  switch (status) {
    case "pending":
      return `${source === "gesture" ? "Open palm recognized. " : ""}Help request started. It will be sent to a responder in 10 seconds. Reply CANCEL to stop it.`;
    case "dispatched":
      return "Your help request was sent to the responder. Waiting for acceptance.";
    case "acknowledged":
      return "A responder accepted your request.";
    case "cancelled":
      return wasDispatched ? "Help request cancelled. The responder was notified." : "Help request cancelled. Nothing was sent.";
    case "resolved":
      return "The responder marked your request as resolved.";
  }
}

export function obstacleWarning(journeyPaused: boolean): string {
  return "Caution: obstruction detected in the path ahead." + (journeyPaused ? " Journey paused. Reply RESUME when ready." : "");
}

export const ARRIVED = "You reached the end of the demo route. Reply START for a new journey.";
export const SERVER_DOWN =
  "The GuideWing server is unreachable right now, so your message was not processed. Please try again in a moment.";
export const NOT_ALLOWED = "This GuideWing demo line only responds to registered numbers.";

const STATUS_WORDS: Record<IncidentStatus, string> = {
  pending: "starting, you can still cancel",
  dispatched: "sent, waiting for a responder",
  acknowledged: "accepted by a responder",
  cancelled: "cancelled",
  resolved: "resolved",
};

export function describeStatus(s: Snapshot): string {
  const j = s.journey;
  const where = j.location.source === "unavailable"
    ? "location unavailable"
    : `${j.location.source === "simulated" ? "simulated location" : "location"} near ${j.location.landmark ?? "an unknown landmark"}`;
  const journey = j.status === "idle" ? "not started"
    : j.status === "ended" ? "ended"
    : `${j.status}${j.status === "paused" && j.pause_reason ? ` (${j.pause_reason.replace("_", " ")})` : ""}, ${Math.round(j.route_progress * 100)}% of the demo route`;
  const help = s.active_incident ? STATUS_WORDS[s.active_incident.status] : "no active request";
  return `Journey: ${journey}, ${where}. Help: ${help}.`;
}
