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

`GEMINI_MODEL` configures the older **incident briefing** separately and remains unchanged. Both adapters share `GEMINI_API_KEY`.

## What happens on Generate

1. React sends `{ "range": "day", "include_tests": false }` to `POST /api/analytics/summary`. `range` accepts `day`, `week` or `loaded`. Extra fields, including client-supplied records, are rejected.
2. The backend reads the latest 500 stored incidents and filters by creation time using its UTC clock: the previous 24 hours, previous seven days, or all loaded records. TEST requests are excluded by default. Future/invalid creation dates are excluded. This is not a complete all-time query; older matching records can be outside the limit.
3. Python computes total requests, mutually exclusive current statuses, dispatch-to-acceptance and acceptance-to-resolution means plus sample counts. Missing, invalid or reversed timestamp pairs are excluded from that mean. Means are rounded to one decimal second; missing means are `null`, never zero by default. The UI's live metrics use the browser clock, so a clock mismatch or range-boundary crossing can differ from the server snapshot.
4. A background thread calls Gemini with **only** range, TEST inclusion, record limit, counts, timing means and sample sizes. It sends no incident IDs, request keys, responder names, locations/coordinates, timelines, camera frames, snapshots or raw incident records. The existing incident-briefing path has a different payload; this privacy boundary describes analytics only.
5. The browser checks the existing job and displays a labeled, concise interpretation alongside exact recorded metrics, snapshot time and scope. The prompt asks for qualitative commentary without numerals. Validation checks length, the simulated label, absence of numerals and restricted instruction language. It reduces unsupported output but does not prove semantic accuracy. Read the figures as authoritative.

## Endpoints, caching and storage

| Endpoint | Purpose |
|---|---|
| GET `/api/analytics/config` | Safe configured/provider/model/record-limit metadata; configured means a key was supplied, not that Google accepted it |
| POST `/api/analytics/summary` | Explicit generation from a server-computed selection; returns a snapshot and job status |
| GET `/api/analytics/summary/{job_id}` | Read an existing job only; never calls Gemini or recomputes metrics |

Response fields are `job_id`, `status`, `provider`, `model`, `range`, `include_tests`, `as_of`, `from_at`, `scope`, `metrics`, `text`, `reason`, `cached` and `retry_after_s`. Metric fields are `total`, `counts`, `accepted_seconds`, `accepted_sample`, `resolved_seconds`, `resolved_sample`. Status is `pending`, `ready`, `not_configured`, `empty`, `failed` or `rejected`.

The SHA-256 job identity includes prompt version, model, selection and aggregate figures. It excludes drifting timestamps, so unchanged figures reuse the original snapshot time. Ready results are reused for 15 minutes after completion. Failures/rejections are reused for a 30-second cooldown. Only explicit POST requests can retry/regenerate; GET status never does. The process allows at most two different pending summaries and stores up to 64 jobs, evicting finished jobs when needed.

**AI jobs and text live in backend RAM, not SQLite or a file.** Restart clears them. An existing job can still be read after its generation-cache interval until eviction. Stored incident records remain in SQLite. Analytics adds no schema migration or changes to lifecycle commands; the normal incident-list read still settles overdue deadlines as it always did. Navigating away or refreshing drops the displayed summary and makes no automatic provider request.

## Failure and rehearsal

- Missing key: disabled Generate and local setup instructions. **Check setup** rereads configuration after restart; no Gemini call.
- Key rejected or API access denied: check the key's project and permissions, edit `.env`, restart.
- Model unavailable: set `GEMINI_ANALYTICS_MODEL` to an accessible structured-output model and restart.
- HTTP 400: Gemini rejected the request format/configuration. This is not a temporary outage. The initial implementation used the wrong MIME enum; the corrected request is covered by a regression assertion and a successful live call.
- Quota/rate limit: recorded figures remain available; check Google AI Studio quota and retry later. The server's short cooldown does not guarantee Google quota has recovered.
- Timeout/network/provider or output-validation failure: error text is visible; ordinary request/journey/analytics behavior continues. The provider HTTP timeout is 15 seconds.
- Status polling stops after 45 seconds or a connection failure. **Check summary** reads the same job without a new external request. A missing job after restart returns to **Generate summary**, requiring explicit activation.

Verified with synthetic data and stubbed Gemini HTTP: **78 backend tests**, **five Node tests**, strict TypeScript/production build, and **27 browser checks** against a separate test database. Checks covered payload privacy, filtering/timing definitions, caching/deduplication/cooldown, HTTP errors, malformed/rejected responses, browser generation/recovery, keyboard access, responsive layouts, and continued help/cancellation.

Initial verification used an empty local key and mocked Gemini responses. After the key was configured, a live diagnostic identified an HTTP 400 caused by an incorrect MIME enum. With `APPLICATION_JSON`, **one synthetic live request to the configured `gemini-3.8-flash` returned a valid, accepted summary** on 2026-10-10. The corrected integration passes all **80 backend cases**, including explicit HTTP 400/401 error handling. No real incident data was sent in the diagnostic and no key was printed or changed. Restart the running backend to load the fix, then rehearse Generate from your dashboard. This live synthetic check does not establish physical-phone/screen-reader behavior or general model output quality.
