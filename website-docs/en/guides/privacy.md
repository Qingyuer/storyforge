# Local data, models, and privacy

## Where content is stored

Core creation primarily uses the browser's local database. After binding a disk workspace, author-confirmed synchronization can store supported content there. This does not automatically cloud-sync across browsers, addresses, or devices.

## When content leaves the device

- AI generation, analysis, or review sends task-required material to your configured model provider.
- External image/audio services may receive related requests and assets.
- Submitting official feedback sends your description and attachments into the official feedback workflow.

Local-first does not mean fully offline when using cloud models. Consult each provider's own retention and use policies.

## API keys

Enter credentials only in model settings and understand storage options such as Remember. Never put keys in prose, Prompts, screenshots, or feedback attachments, or share settings files containing credentials.

## Is feedback public?

Official feedback creates GitHub Issues. Prepare descriptions and attachments as public content. Do not submit private manuscripts, personal information, or keys. Attachments are temporarily stored by the official feedback system and automatically removed after about 10 days; this does not mean the Issue text is deleted.

## Offline use and cost

Manual editing, local checks of existing content, and backups need no cloud model. Whether the app itself loads offline depends on installation, cache, and browser state. Remote models require network access; local models require a running local service.

## Website PV and daily UV

The website, knowledge base, and hosted project preview share page views (PV) and daily browser visitors (UV). Reports are available only from the server backend; public pages show no counts. Days follow Beijing time (Asia/Shanghai). A browser counts once per day for UV; refreshes and page navigation add PV, while same-page anchors do not. Existing cumulative PV is retained. Daily reports start with this upgrade, making the first day partial; no historical data is invented. Future shared-entry pages participate, while local creation and previews do not.

UV uses a first-party random cookie valid for 30 days and renewed on visits, restricted to the metrics endpoint. It is not an account or login credential. The website and knowledge base share it. The server stores date-specific deduplication digests for about 31 days, not raw cookies. Aggregates are retained and random retry receipts expire after about a day. No account, IP, browser fingerprint, page URL, query parameters, manuscript, or API key is submitted. Different browsers/devices or cookie deletion create a new identity, so UV is not a count of real people. Blocked cookies still permit PV without inventing UV; disabled scripts, blocked requests, or network errors can undercount.

Continue: [Backup and recovery](/en/guides/backup-restore) · [Model configuration](/en/getting-started/model-config).

## Local errors and explicit feedback

The browser retains at most twenty error types, timestamps, and filtered code locations from the last seven days. The portable launcher separately retains bounded failure and session metadata. These local operational diagnostics are not work-library records, world releases, or project backups, and do not measure first launch, daily activity, or retention.

Diagnostics, screenshots, works, model inputs/outputs, and credentials are not automatically sent. After previewing a summary and opening the official form, you can edit or remove it before explicitly submitting. Submissions enter public Issues; browser errors can be cleared in General settings. See [failure reporting](/en/guides/troubleshooting#problems-and-failure-reports-in-downloaded-builds).


## In-app feedback and usage reporting in development

This client increment has not been officially released. Existing downloads do not gain it automatically.

Under Home → General settings → Problems and suggestions, select Report a problem or Feature suggestion. An unresponsive button, incorrect display, or unexpected result can be reported even without an exception or crash. Enter a title, description, optional reproduction steps and expected result, then confirm sending. Stay in the application to receive the receipt ID. Failed requests keep your input, and retrying unchanged content reuses the ID to prevent duplicates. Error logs are not required.

In-app submissions go to the maintainers' private inbox for 90 days and do not automatically create public GitHub Issues. The app version, OS category and distribution type accompany the report. Bug reports may optionally include the previewed sanitized errors; suggestions do not include errors. Do not enter manuscripts, API keys or passwords. Screenshots, recordings, raw console output and memory dumps are not collected automatically. The separate website form still creates public feedback.

Official clients offer an optional first-launch choice for usage statistics and sanitized errors, with a decline option. General settings controls these independently. Manual feedback does not require analytics. Development environments, debug Android packages and isolated Windows test profiles do not participate in automatic reporting.

Days use Asia/Shanghai time. First launch means the earliest observed foreground activity after reporting becomes available. DAU counts distinct random installation IDs; D1/D7 measure activity on the first/seventh calendar day after first observation. Immature cohorts are not reported as zero retention. Opt-outs, prolonged offline use and cleared local data can cause missing records or new IDs: installations are not people, nor a measured conversion rate for all downloads. IDs are excluded from manuscript backups; portable builds identify browser profiles at their fixed origin.

Activity details expire after about 38 days and error details after 30 days. Aggregates do not retain installation IDs; deduplication records expire after 400 inactive days. Deleting an installation's statistics removes its details and temporarily blocks late retries of that identity. Anonymous aggregates and manually submitted feedback remain separate. Offline deletion is shown as unconfirmed. The local queue holds at most 100 events, with activity retained for at most 30 days and errors for 7 days, and at most five attempts per event. Upload failures never block editing.

Windows retains limited process crash/exit summaries; an unclean exit is only an interruption requiring investigation. Android records uncaught Java exceptions; Android 11 and later also reads this app's system exit reasons for crashes, ANRs and low-memory exits. Older systems have reduced coverage. The app must reopen to read exit records, which the OS may omit. These summaries are not full native stack traces and cannot capture every exit.
