# HANDOFF — K: drive print routing + Unit Justification (EIS Kids)

Updated 10/1/26 for `Session Note Routing-2.docx` (Central path change, county list). Last verified against DDR `~/Documents/Clients/EIS Kids/DDRs/20260930/EISKids_fmp12.xml` (exported 9/30/26 ~6:16 PM).
Sessions: 9/29–10/1/26, Brad Cranston.

## TL;DR — current state

| Item | Status |
|---|---|
| Allegheny print copies → weekly folder / `Late` | **Live, working** (confirmed by Brad 9/30) |
| Print paths use the server's real K: prefix | **Live, fixed 9/30** |
| Butler print folder = `Butler (101)` | **Live, fixed 9/30** |
| Add Note saves authorized duration onto the note | **Live** (in `Manage: Client` → `addNote`) |
| Diagnostics block for print routing | Written, **not pasted** (optional) |
| Failed print copies are never retried | **Open** |
| Approval gates from routing doc (4 of 5) | **Open** — deferred "after initial testing" |
| Central client path → `Client Files – Central\<Client ID>\` (loose), + Dauphin, Franklin/Fulton | **Live in Sandbox** (verified vs Sandbox DDR 10/1 6:10 PM); not in old production file. Sandbox goes live 10/1 night. |
| Print chain `Else → Exit Script` for unlisted counties | **Live in Sandbox** (10/1) |
| Sandbox synced with production fixes (10/1 6:10 PM DDRs) | Allegheny weekly routing, print K: prefix, `Butler (101)`, addNote authorized duration, and seal-on-server (no wait) in `BF - onUtility - signature` are now in Sandbox. Calcs match production exactly (whitespace aside). Sandbox replaces production 10/1 night. |
| Sandbox go-live cautions | Do **not** run Sandbox `postDeploy` (its last step runs `One Time: Mark Existing Notes Email Skipped`). `Offline: Download` hard-codes `Get ( FileName ) = "EISKids_Sandbox"`. Delete the 4 leftover one-time scripts. |
| County dropdowns: + Franklin/Fulton, − Lebanon/Schuylkill/Westmoreland | **Source edited, not deployed** (10/1) |
| Washington client path dash mismatch | **Open** — unconfirmed |
| One-time scripts `One Time - Push Today's Print Copies` (+ `(Server)`) | **Delete** — done their job |

---

## 1. How a sealed note reaches K:

1. `SessionNote: Seal If Complete` locks the note (`status = Final`) and sets `savedToKDrive = 0`, or holds it with `awaitingSupervisor = 1` until the supervisor signs.
2. FMS schedule → `Server - Process K Drive Queue` finds `status ==Final`, `savedToKDrive ≠ 1`, `awaitingSupervisor ≠ 1`, and loops.
3. For each note it calls `Export Session Note PDF to K Drive` (runs **on the server**), which:
   - builds the **client-file** path → PSoS `Server – Export Session Note PDF to K Drive` → writes `savedToKDriveResult`, sets `savedToKDrive = 1` on `code = "OK"`;
   - builds the **print** path → same server export → writes `savedToKDriveResultPrint`, sets `savedToKDrivePrint = 1` on OK.
4. `Server – Export…` exports `SessionNote::pdfFlat` with BaseElements. It **creates missing folders recursively** (`BE_FolderCreate`) and **never overwrites** (`TARGET_FILE_EXISTS`).

> ⚠ Because missing folders get created, a wrong path never errors. It silently builds a phantom folder tree and reports OK. Every routing bug in this session looked like that.

## 2. The K: drive mapping gotcha (root cause of "print copies missing")

The **server's** `K:` is one level above what staff see as `K:`:

| Staff PC (Data (K:)) | Server-side path the scripts must use |
|---|---|
| `K:\Client Files - Western\…` | `K:\Early Intervention Specialists\EIS - Documents\Client Files - Western\…` |
| `K:\County Prep Folder\…` | `K:\Early Intervention Specialists\EIS - Documents\County Prep Folder\…` |

The client-file paths already had the prefix. The print paths didn't, so from 9/28 to 9/30 print PDFs went into a phantom `K:\County Prep Folder\…` at the **server's** K: root, which staff can't see. Fixed 9/30.
**Open cleanup:** ask whoever administers the server to delete that phantom tree (server K: root → `County Prep Folder`).

Routing spec: `Session_Note_Routing.docx` (Brad has it). Paths in the doc are written from the staff view, so always add the prefix above.

## 3. Print routing — what's live now (`Export Session Note PDF to K Drive`, `#PRINT FILE PATH` section)

Base: `K:\Early Intervention Specialists\EIS - Documents\County Prep Folder\Ready for Printing- from DocuSign`

- **Allegheny (all statuses)** → `…\Allegheny\<week folder>`
  - Week = Sun–Sat containing **today** (`Get(CurrentDate)` on the server), not the session's week.
  - Week folders are made by hand by Mary, named `YYYYMMDD-YYYYMMDD - Mary print on MM.DD` (MM.DD = the Monday after). They exist through 12/12/26.
  - Lookup: `BE_FileListFolder ( $printBase ; 2 )`, normalise CR/LF, strip to the last path segment, match on the `YYYYMMDD-YYYYMMDD` prefix. Fallback: build the exact `… - Mary print on MM.DD` name and test it with `BE_FileExists`.
  - Session date **outside** the current week → `…\Allegheny\Late`.
  - No week folder found → PDF goes loose in `…\Allegheny` (still findable).
  - Note the name: `BE_FileListFolder`, **not** the old `BE_ListFilesInFolder`. FileMaker comments out the old name on paste.
- **Butler, Held only** → `…\Butler (101)`. Loose, no subfolder. Non-Held notes `Exit Script`.
  - Was briefly `Butler (101)Client’s file (cancels and signed)`, copied from a run-on line in the doc. Fixed 9/30. If any PDFs landed in a folder with that name, move them to `Butler (101)` and delete the folder.
- **Chester, Cumberland/Perry, Delaware, Lancaster, Washington, York/Adams** → no print copy (`Exit Script`). This is by design.
- **Dauphin, Franklin/Fulton** have no branch in the live print chain, so they fall through and re-export to the client-file path (`TARGET_FILE_EXISTS`). Fix: `Print-path-else-no-print` adds `Else → Exit Script` after the York/Adams branch.

Final `Exit Script [ Result: $result ]` returns an unset `$result`. Harmless, since nothing reads it.

## 4. Client-file routing (unchanged, matches doc)

- Western (Allegheny, Butler, Washington): `…\Client Files - Western\<LastInitial>\<Last, First>\Session Notes\`
- Eastern (Chester, Delaware): `…\Client Files – Eastern\<Last, First>\Session Notes\`
- Central (Cumberland/Perry, Dauphin, Franklin/Fulton, Lancaster, York/Adams): **changed 10/1** per `Session Note Routing-2.docx` → `…\Client Files – Central\<Client ID>\`, loose (no `Session Notes` subfolder, folder named by ID not name).
  - Live (until the snippet is pasted) still uses `…\Client Files – Central\<Last, First>\Session Notes\` for Cumberland/Perry, Lancaster, York/Adams, and has **no branch** for Dauphin or Franklin/Fulton, so those fail with `INVALID_DESTINATION_PATH`.
  - Client ID = `Client::clientId` via `SessionNote.Client` (field id 17), e.g. `671-76829` (York/Adams), `3636311366` (Lancaster), `2-65262` (Dauphin). Blank ID → path left empty so the export fails visibly rather than writing loose into `Client Files – Central`.
  - Snippet: `Client-file-path-central-by-ClientID` replaces the whole `If [ county = "Allegheny" ] … End If` under `#CLIENT FILE PATH`.
  - PDFs already exported to `Client Files – Central\<Last, First>\Session Notes\` (if the en-dash folder is real) need moving by hand.

**Open:** Washington uses `Client Files – Western` with an **en dash**. Allegheny and Butler use a **hyphen**, which is the real folder (confirmed by successful saves). Washington notes probably land in a phantom en-dash tree. Eastern and Central also use en dashes and are unverified. Check these against the real folder names on K:.

## 5. Unit Justification (session note web viewer)

- The form is the web viewer HTML built by `postDeploy Note`. Source: `~/Documents/Clients/EIS Kids/Code/EISKidsSessionNote/src/index.js` (`checkUnitsDuration()` ~line 761, save validation ~line 1893).
- The rule requires Unit Justification when the calculated units (15 minutes = 1 unit, floored) differ from the authorized duration. **It's skipped when the authorized duration is blank or 0.** That's intentional: there's no authorization yet, so there's nothing to check. No code change needed.
- The authorized duration reaches the form as hidden `#duration` ← `SessionNote::asJSON` `"duration"` ← `SessionNote::duration`.
- **Bug fixed 9/29:** `SessionNote::duration` auto-entered from `Client::duration`, which rClient never fills. Authorizations live on **`ClientUser`** (Service Providers rows; `ClientUser::duration` ← rClient `NLENQNT`). So the check never fired.
  - Fix (live): `Manage: Client` → `addNote` now sets `SessionNote::duration` from `JSONGetElement ( $param ; "serviceProvider.duration" )`. The client page (`~/Documents/Clients/EIS Kids/Code/EISKidsClient/src/index.js`, `handleAddNote()`) already sends the whole provider row.
  - Only affects notes created **after** the fix. Older drafts have a blank duration. A one-time backfill (match on `client_Id` + `ClientUser::userId = SessionNote::earlyInterventionist` + `method = serviceCode`) was offered but not built.
  - Optional hardening (not done): in `asJSON`, fall back to the provider row when `SessionNote::duration` is empty.
- Testing gotcha: hand-entered Service Provider rows on **Test Client** get wiped by the hourly rClient sync. Test on a real child whose authorization comes from rClient.

## 6. Open items / suggested next work

1. **Retry failed print copies.** The queue only looks at `savedToKDrive`, so a failed print copy is never retried. Fix by adding `or (needs print and savedToKDrivePrint ≠ 1)` to the queue find, or by giving the print step its own small queue.
2. **Approval gates** from the routing doc. Only the CF/COTA supervisor gate exists (`awaitingSupervisor`). Still missing before routing: Lancaster 1st sessions, Central/Eastern review meetings, sessions where the child isn't present, and Pre-Approved Teaming.
3. Washington, Eastern and Central dash check (§4). The 10/1 routing doc and the client's message both write `Client Files – Central` with an en dash, but the doc also writes Western that way and the real Western folder is a hyphen. Confirm by looking at K:.
3a. Confirm a Central client folder is named exactly the `clientId` value (e.g. `671-76829`), not `Last, First 671-76829` or similar.
3b. Add a `County` row for Franklin/Fulton (`name` = `Franklin/Fulton`, `id` = rClient `CPRVUID` code). `rClient Syncing` maps CPRVUID → County::name; without the row a Franklin/Fulton child gets rClient's raw `CPRVNAME` and routing won't match. Code unknown until the first child arrives.
3c. Lebanon/Schuylkill/Westmoreland: removed from both web viewer county lists. `County` rows are still there (harmless). Sandbox has 3 Westmoreland clients; the Client page `<select>` shows blank for them.
3d. Deploy both web viewers (`npm run deploy-to-fm` in EISKidsClient and EISKidsSessionNote) after the county list edit.
4. Delete the server-side phantom `K:\County Prep Folder` tree (§2).
5. Delete the one-time scripts `One Time - Push Today's Print Copies` and `… (Server)`.
6. Questions still open in the doc: routing to the Archive drive for discharged clients, and routing 1st sessions to Jessica.
7. Optional: paste the diagnostics snippet (stores `routing.*` in `savedToKDriveResultPrint`), placed just above `Set Field [ SessionNote::savedToKDriveResultPrint; $scriptResult ]`.

## 7. Working notes for whoever picks this up

- DDRs are **UTF-16LE**. Run `iconv -f UTF-16LE -t UTF-8` first, or grep silently finds nothing.
- Script definitions are `<Script …>` blocks that contain `<StepList>`. Same-named `<Script>` elements without it are references.
- Hand Brad paste-ready `fmxmlsnippet` XML (ProofKit `clipboard_write`, elementType `ScriptStep` or `Script`). Lift field and table IDs from the DDR. Key IDs: `SessionNote` status 87, savedToKDrive 94, savedToKDriveResult 95, savedToKDrivePrint 96, savedToKDriveResultPrint 97, sessionDate 14, duration 71, zzModificationTimestamp 4. Layout `SessionNote` id 3. Script `Server – Export Session Note PDF to K Drive` id 82 (the name uses an en dash).
- Anything that touches K: must run **on the server**. Mac clients have no K:, so BE calls return empty. Use a desktop launcher that PSoS's a `(Server)` worker that guards on `PatternCount ( Get ( ApplicationVersion ) ; "Server" )` (there is no `Get ( IsServer )`).
- ProofKit SQL (`execute_filemaker_sql`) disconnects often. Treat the DDR plus `savedToKDriveResult*` JSON as the source of truth.
- Reference snippets in `filemaker-kdrive/`: `Client-file-path-central-by-ClientID` and `Print-path-else-no-print` (10/1, not yet pasted), `Allegheny-print-routing-live` (the live Allegheny block, current paths), `Allegheny-print-routing-diagnostics` (optional, not pasted), `AddNote-authorized-duration` (live in Manage: Client). The one-time scripts are not kept because they are done.
