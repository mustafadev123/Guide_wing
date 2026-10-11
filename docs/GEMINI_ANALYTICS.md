# Gemini analytics summaries

Implemented 2026-10-10 in the responder dashboard. Gemini explains recorded queue counts and response timings; Python computes the figures. This is optional commentary on a simulated workflow. It does not control journeys, decide who receives help, or generate durable completed-response reports.

## Set up your existing key

1. Open **`Guide_wing/.env`**, beside `README.md`. It already exists on this machine. Keep its other settings. If setting up a new checkout with no `.env`, copy `.env.example` once.
2. Set the server variables below, replacing the placeholder locally:

   ```dotenv
   GEMINI_API_KEY=your_existing_google_ai_studio_key
   GEMINI_ANALYTICS_MODEL=gemini-3.8-flash
   ```

   `GEMINI_ANALYTICS_MODEL` is optional; that value is the default. Do not put the key in a frontend file, a `VITE_` variable, documentation or a commit. `.env` is git-ignored. This adapter uses the **Gemini Developer API**, not a Vertex AI service-account credential. Creating a key is unnecessary if you already have one.
3. From a PowerShell terminal in `Guide_wing`, stop the existing launcher-managed server and restart with a frontend rebuild:

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\stop.ps1
   powershell -ExecutionPolicy Bypass -File scripts\start.ps1 -Rebuild
   ```

   Keep your usual `-Camera 1`, `-Video ...` or `-Lan` options when appropriate. Use `-NoVision` for a button-only rehearsal. The launcher reads `.env`; running Uvicorn directly requires exporting the variables yourself. Restart is required after changing a key or model.
4. Open `http://127.0.0.1:8000/responder`, choose **Analytics**, choose a date range and click **Generate summary**. Create a request from `/user` first if there are no records. `/dev` requests are excluded unless you select **Include developer TEST requests**. An empty selection makes no Gemini call.

Google account/API access, model availability and quota still apply to your key. An optional model override must support structured JSON output. The REST request uses `generationConfig.responseFormat.text.mimeType: "APPLICATION_JSON"`, an enum value defined in Google's [API reference](https://ai.google.dev/api/generate-content#TextResponseFormat). The string `application/json` is valid for the HTTP content-type header but is rejected in that enum field. Model access can change; see the [model deprecation page](https://ai.google.dev/gemini-api/docs/deprecations) and [API-key guide](https://ai.google.dev/gemini-api/docs/api-key).

`GEMINI_MODEL` configures incident response reviews independently of aggregate `GEMINI_ANALYTICS_MODEL`; both default to `gemini-3.8-flash` and share the server `GEMINI_API_KEY`.

## What happens on Generate

1. React sends `{ "range": "day", "include_tests": false }` to `POST /api/analytics/summary`. `range` accepts `day`, `week` or `loaded`. Extra fields, including client-supplied records, are rejected.
2. The backend reads the latest 500 stored incidents and filters by creation time using its UTC clock: the previous 24 hours, previous seven days, or all loaded records. TEST requests are excluded by default. Future/invalid creation dates are excluded. This is not a complete all-time query; older matching records can be outside the limit.
3. Python computes total requests, mutually exclusive current statuses, dispatch-to-acceptance and acceptance-to-resolution means plus sample counts. Missing, invalid or reversed timestamp pairs are excluded from that mean. Means are rounded to one decimal second; missing means are `null`, never zero by default. The UI's live metrics use the browser clock, so a clock mismatch or range-boundary crossing can differ from the server snapshot.
4. Python also derives resolved/cancelled percentages, open count, cancellation stage (before/after dispatch), request-source counts, timing medians/slowest values and minute conversions. A background thread sends only these aggregates, selection/scope and a suggested rehearsal focus to Gemini. No incident IDs, request keys, names, locations, timelines, frames, snapshots or raw rows are sent. The incident-briefing adapter has a different payload; this privacy boundary describes analytics only.
5. The report has three sections: **Queue outcomes**, **Response times**, and **Next rehearsal check**. It uses concrete figures and sample sizes, then suggests a focused workflow check without inventing causes, benchmarks or trends. Output numbers must match values supplied in the server facts. Required sections, length, simulated labeling and restricted instructions are checked too. These checks do not prove correct contextual use of a number or semantic accuracy; recorded figures remain authoritative.

## Endpoints, caching and storage

| Endpoint | Purpose |
|---|---|
| GET `/api/analytics/config` | Safe configured/provider/model/record-limit metadata; configured means a key was supplied, not that Google accepted it |
| POST `/api/analytics/summary` | Explicit generation from a server-computed selection; returns a snapshot and job status |
| GET `/api/analytics/summary/{job_id}` | Read an existing job only; never calls Gemini or recomputes metrics |

Response fields are `job_id`, `status`, `provider`, `model`, `range`, `include_tests`, `as_of`, `from_at`, `scope`, `metrics`, `text`, `sections`, `reason`, `cached` and `retry_after_s`. Ready `sections` contains `overview`, `response_times`, `next_check`; `text` preserves the same content as joined paragraphs. Metric fields are `total`, `counts`, `accepted_seconds`, `accepted_sample`, `resolved_seconds`, `resolved_sample`. Status is `pending`, `ready`, `not_configured`, `empty`, `failed` or `rejected`.

The SHA-256 job identity includes prompt version (now 2), model, selection, metrics and the interpretation context. It excludes moving timestamps, so unchanged figures reuse the original snapshot time. Ready results are reused for 15 minutes; failures/rejections for 30 seconds. Only explicit POST can regenerate; GET status never does. At most two different jobs generate concurrently and up to 64 jobs are held in RAM.

**AI jobs and text live in backend RAM, not SQLite or a file.** Restart clears them. An existing job can still be read after its generation-cache interval until eviction. Stored incident records remain in SQLite. Analytics adds no schema migration or changes to lifecycle commands; the normal incident-list read still settles overdue deadlines as it always did. Navigating away or refreshing drops the displayed summary and makes no automatic provider request.

## Failure and rehearsal

**Since 2026-10-11 (branch `summary-fallback`):**
- Every summary response carries `instant_sections`: a two-part summary (queue outcomes, response times) written by `analytics.instant_sections()` from the same server-computed figures. It is returned immediately and is present for `pending`, `ready`, `failed`, `rejected` and `not_configured`; it is `null` only for an empty selection.
- The responder panel (title "Summary") shows it at once and replaces it with Gemini's sections when the job becomes `ready`.
- Timeouts, network errors and HTTP 5xx get **one quiet retry** after 2 s. HTTP 4xx and rejected output are not retried.
- The browser polls for up to 90 s, then stops silently.
- The panel no longer shows provider errors, retry buttons, setup instructions or a missing-key message; the reasons below remain in the API response and the server log for diagnosis.


- Missing key: disabled Generate and local setup instructions. **Check setup** rereads configuration after restart; no Gemini call.
- Key rejected or API access denied: check the key's project and permissions, edit `.env`, restart.
- Model unavailable: set `GEMINI_ANALYTICS_MODEL` to an accessible structured-output model and restart.
- HTTP 400: Gemini rejected the request format/configuration. This is not a temporary outage. The initial implementation used the wrong MIME enum; the corrected request is covered by a regression assertion and a successful live call.
- Quota/rate limit: recorded figures remain available; check Google AI Studio quota and retry later. The server's short cooldown does not guarantee Google quota has recovered.
- Timeout/network/provider or output-validation failure: error text is visible; ordinary request/journey/analytics behavior continues. The provider HTTP timeout is 40 seconds (raised from 15 s on 2026-10-11: a live gemini-3.8-flash report took longer than 15 s), below the 45-second browser status polling.
- Status polling stops after 45 seconds or a connection failure. **Check summary** reads the same job without a new external request. A missing job after restart returns to **Generate summary**, requiring explicit activation.

Verified with synthetic data and stubbed Gemini HTTP: **78 backend tests**, **five Node tests**, strict TypeScript/production build, and **27 browser checks** against a separate test database. Checks covered payload privacy, filtering/timing definitions, caching/deduplication/cooldown, HTTP errors, malformed/rejected responses, browser generation/recovery, keyboard access, responsive layouts, and continued help/cancellation.

Initial verification used an empty local key and mocked Gemini responses. After the key was configured, a live diagnostic identified an HTTP 400 caused by an incorrect MIME enum. With `APPLICATION_JSON`, **one synthetic live request to the configured `gemini-3.8-flash` returned a valid, accepted summary** on 2026-10-10. The corrected integration passes all **80 backend cases**, including explicit HTTP 400/401 error handling. No real incident data was sent in the diagnostic and no key was printed or changed. Restart the running backend to load the fix, then rehearse Generate from your dashboard. This live synthetic check does not establish physical-phone/screen-reader behavior or general model output quality.

Current report revision: **84 backend cases, five Node cases, TypeScript/build and 12 additional browser checks passed**. The final three-section prompt also returned an accepted live Gemini report from synthetic counts and timings with the existing private key. Browser checks used a temporary database and stubbed provider. They verified separate report headings, visible figures, accessible live updates, responsive layout, and one briefing fact per line, including resolution when recorded. No real incident data was used for provider diagnostics. Restart the backend and refresh the website to load this revision; keys stay unchanged.

## Incident history response reviews

Incident history now has a separate Gemini response review with **What the timeline shows** and **Response pattern**. It interprets the handoff and server-computed elapsed stages rather than re-listing location/timestamps. Source facts remain expandable with one fact per line. A resolved state means a responder marked it resolved; actual assistance and request/cancellation reasons are not recorded. The prompt must not invent those details or infer the attached image.

Use `GEMINI_MODEL=gemini-3.8-flash` for incident reviews. Google rejected the old gemini-2.5-flash configuration for this account with HTTP 404. Its current model-access policy is documented on the linked deprecation page. This machine has no GEMINI_MODEL override, so the updated default takes effect after restart; the API key is unchanged. An explicit legacy override must be updated separately. Restart the backend and refresh the browser after installing.

GET /api/incidents/{id}/briefing returns additive `ai_model`, `ai_review` (outcome/timing), and `ai_retry_after_s` alongside existing provider/text/deterministic/ai_status/ai_reason fields. Reading an eligible review starts/joins async generation. Its fact hash refreshes when recorded facts change; old workers cannot replace newer results. Failed/rejected reviews have a 30-second cooldown and explicit Retry AI review; there is no timer-driven automatic regeneration after failure.

Only input method, status, location source, timeline types/times, computed elapsed seconds and snapshot attachment are sent. Coordinates, landmarks, responder identities, IDs and image content are excluded from this revised incident payload. Numerical validation is partial and does not prove contextual correctness. Synthetic live review succeeded; a later live attempt returned a temporary HTTP 503, correctly surfaced with retry. No private history was sent in provider diagnostics.

Incident-review revision verified: all **88 backend cases** passed, strict TypeScript/build passed, and **14 additional browser checks** covered delayed generation, cache reuse, expandable multiline facts, specific model errors, cooldown/explicit retry, and 1440/390/320-pixel layouts. Synthetic live requests diagnosed the old model HTTP 404 and produced accepted reviews on gemini-3.8-flash; a temporary HTTP 503 was surfaced correctly and a later explicit test succeeded. No actual history or private key was printed/sent in those diagnostic payloads. Device/screen-reader behavior and semantic accuracy are not established by these checks.

Incident review prompt version 3 requests only outcome and timing. The missing-information section is removed from both generation and display; existing factual grounding remains.

Incident generation has a 45-second transport timeout; its display polls pending work for up to 60 seconds. Timeout, connection, malformed response and HTTP service failures have separate safe messages. Failures still require an explicit retry after the cooldown. A synthetic live diagnostic reproduced HTTP 503 and the previous 15-second TimeoutError; removing the unknowns section did not produce a schema rejection in those calls.
