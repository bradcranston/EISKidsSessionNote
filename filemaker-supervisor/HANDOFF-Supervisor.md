# Supervisor queue, validation and locking: install guide

Built 9/16/26 from the client meeting notes and the 12:37 DDR. Snippets are in this folder. To regenerate: `python3 gen_supervisor_snippets.py`.

## What changes

**Locking (Seal If Complete, S03)**
- An **H - Held** note locks once the EI and the caregiver have signed and every other requirement passes.
- **Any other status** (canceled or absent) locks once the EI has signed.
- **The supervisor signature no longer blocks the lock**, so it doesn't hold up payroll or billing. It only holds the note out of the K: drive queue (`awaitingSupervisor = 1`) until the supervisor signs.

**Note widget**
- **Signature gates:**
  - The EI pad won't open until every non-signature requirement passes. The errors are listed at the top.
  - The caregiver pad won't open until the EI has signed and everything passes. It's refused on non-held notes.
- **Auto-lock:** when the caregiver finishes signing (taps outside the pad), the note saves and locks immediately.
- **Caregiver link:** "Copy Parent Signature Link" runs the same gate as the caregiver pad and saves before copying.
- **Supervisor link:** the "Copy Supervisor Signature Link" button is removed. The BetterForms route still works server-side.
- **Supervisor section:** below the form.
  - The assigned supervisor gets a signature pad.
  - Everyone else sees "Waiting on the supervisor signature (name)".
  - Once signed, it shows the signature, name, credentials and date.

**Supervisor sign (S04):** the script stamps the supervisor's name and credentials from their user record onto the note. It then rebuilds the PDF, which prints them under the signature (S06), and queues the note for the K: drive.

**Dashboard (client app):** two panels.
- **Clients:** the list as before.
- **Session Notes:**
  - **Supervisors** get "Awaiting your signature" on top.
  - **Everyone** gets recent notes (last 30 days, plus anything not yet locked), with All / Not completed / Locked filters and a search. Each row has View Client and View Session Note.
  - **Admins** see all notes. Record-level access decides who sees what, so nothing new is needed there.

**Supervisor visibility (On Open, S02):** this fixes the lookup. Supervisors could previously only see their own notes.

## Install order

| # | Where | What |
|---|---|---|
| 0 | **Manage: Client** | **Untick "Run script with full access privileges".** It was turned on for the delete guard and exposes every client to every user. The delete guard works without it |
| 1 | Manage Database → **SessionNote** → Fields | Paste `S01`, which adds 5 fields: `supervisorUserId`, `awaitingSupervisor` (Number), `supervisorName`, `supervisorCredentials`, `supervisorSignedTS` (Timestamp) |
| 2 | Layout **sync_SessionNote** | Add the 5 new fields (MirrorSync) |
| 3 | Field **SessionNote::asJSON** | Add the lines under "asJSON" below |
| 4 | Field **SessionNote::asJSONDashboardArray** | Replace the whole calculation with the one below. It's stored, so it recalculates for every record on OK |
| 5 | **On Open** | Select the `If [ 0 ]` … `End If` block that sets `UserAccount::gLoggedIn` (including the two disabled lines), paste `S02` below it, then delete the old block |
| 6 | **SessionNote: Seal If Complete** | Select all steps, delete them, and paste `S03` (88 steps) |
| 7 | New script **`SessionNote: Supervisor Sign`** | Paste `S04`. Turn on **full access**, since supervisors edit a locked note |
| 8 | **Manage: SessionNote**, `load` branch | Select `Set Variable [ $data ; JSONSetElement ( $data ; ["online" … ] ) ]`, paste `S05` below it, then delete the old step |
| 8b | **Manage: SessionNote**, `save` branch | Select `Set Variable [ $widgetWantsLock ; … = "true" ]`, paste `S13` below it, then delete the old step. `JSONGetElement` returns a JSON boolean as `1`, so the old comparison with `"true"` could never pass |
| 9 | **Manage: Document**, `saveServer` | Inside `If [ not IsEmpty ( SessionNote::supervisorSignature ) ]`, select the `Set Variable [ $write ; DynaPDF.InsertImage … supervisorSignature … ]` step and paste `S06` |
| 10 | **Server - Process K Drive Queue** | Select the `Perform Find` (status ==Final / omit savedToKDrive 1), paste `S07`, then delete the old find |
| 11 | **SessionNote: Create Revision** | Select `Set Field [ SessionNote::voidReportedTS ; "" ]` and paste `S08` |
| 12 | New script **`Dashboard: Session Notes`** | Paste `S09`. **Do not** give it full access |
| 13 | **Manage: Client**, `loadDashboard` | Select `Perform JavaScript in Web Viewer [ "loadClientList" … ]` and paste `S10` |
| 14 | **Manage: Document**, `close` | Inside `If [ Get ( LayoutTableName ) = "Client" ]`, select `Perform JavaScript in Web Viewer [ "refreshSessionNotes" … ]` and paste `S11` |
| 15 | New script **`One Time: Relock Notes`** | Paste `S12`. Run it **once** as an admin on the server copy after everything else is in. It locks notes that were stuck only on the supervisor signature, and canceled notes that have an EI signature |
| 16 | Both web viewers | `npm run deploy-to-fm` in **EISKidsSessionNote** and **EISKidsClient** |

### Step 3: asJSON

Add these lines before the closing `)`, with a `;` after the previous line:

```
  [ "supervisorSignatureBase64" ; SessionNote::supervisorSignatureBase64 ; JSONString ] ;
  [ "supervisorUserId" ; SessionNote::supervisorUserId ; JSONString ] ;
  [ "awaitingSupervisor" ; SessionNote::awaitingSupervisor ; JSONString ] ;
  [ "supervisorName" ; SessionNote::supervisorName ; JSONString ] ;
  [ "supervisorCredentials" ; SessionNote::supervisorCredentials ; JSONString ] ;
  [ "supervisorSignedTS" ; SessionNote::supervisorSignedTS ; JSONString ]
```

### Step 4: asJSONDashboardArray

```
JSONSetElement ( "{}" ;
  [ "date" ; SessionNote::sessionDate ; JSONString ]
 ;[ "id" ; SessionNote::__ID ; JSONString ]
 ;[ "note" ; SessionNote::sessionType ; JSONString ]
 ;[ "clientFirstName" ; SessionNote::clientFirstName ; JSONString ]
 ;[ "clientLastName" ; SessionNote::clientLastName ; JSONString ]
 ;[ "eIFirstName" ; SessionNote::eIFirstName ; JSONString ]
 ;[ "eILastName" ; SessionNote::eILastName ; JSONString ]
 ;[ "eICredentials" ; SessionNote::eICredentials ; JSONString ]
 ;[ "status" ; SessionNote::status ; JSONString ]
 ;[ "sessionStatus" ; SessionNote::sessionStatus ; JSONString ]
 ;[ "awaitingSupervisor" ; SessionNote::awaitingSupervisor ; JSONString ]
 ;[ "supervisorUserId" ; SessionNote::supervisorUserId ; JSONString ]
 ;[ "revisionNumber" ; SessionNote::revisionNumber ; JSONString ]
)
```

`eIFirstName`, `eILastName` and `eICredentials` are auto-enter lookups, so they are real stored values and the stored calc stays valid.

## Privileges

| Script | Full access | Why |
|---|---|---|
| `Manage: Client` | **Off** | It loads and searches clients, and record-level access must apply |
| `Dashboard: Session Notes` | **Off** | Its ExecuteSQL must respect record-level access (own / team / all) |
| `SessionNote: Supervisor Sign` | On | The supervisor edits a locked note |
| `SessionNote: Create Revision` | On | As before |

## Test script

1. **Held note, EI signing:** leave a required field empty and tap the EI pad. It won't open, and the errors are listed.
2. **Held note, caregiver signing:**
   1. Fill everything in and tap the caregiver pad before the EI has signed. It won't open ("The interventionist must sign before the caregiver").
   2. The EI signs, then the caregiver signs and taps outside the pad. The note saves and locks.
3. **Canceled note:** enter a description and the EI signature, then save. It locks, and the caregiver pad is refused.
4. **Caregiver link:**
   1. On a held note with the EI unsigned, "Copy Parent Signature Link" is refused.
   2. After the EI signs, it saves and then copies the link.
   3. The caregiver signs in the browser, and the note locks.
5. **Supervisor queue:**
   1. Lock a note for an EI who has a supervisor. It's locked (payroll-ready), `awaitingSupervisor = 1`, and it doesn't go to the K: drive.
   2. Log in as that supervisor. The dashboard shows it under "Awaiting your signature".
   3. Open it, sign, and tap Sign as Supervisor. The section shows the signature, name and credentials, and the PDF prints them under the signature.
   4. The note leaves the queue and archives on the next K: drive run.
   5. Log in as a different supervisor and open the same note. It shows "Waiting on the supervisor signature (name)" with no pad.
6. **Dashboard filters:** check the filter counts, the search box, View Client / View Session Note, and that closing a note refreshes the list.
7. **Visibility:** log in as an interventionist and confirm the dashboard shows only their own clients and notes.

## Needs a visual check

- **Supervisor name on the PDF (S06).** It's drawn at `$supX = 260`, `$supY = 146` (bottom-up), 6pt, directly under the supervisor signature image. I couldn't see the template, so check a PDF. If it overlaps printed text, change those two numbers in the pasted steps.

## Known limits

- An EI can still edit fields after signing, until the caregiver signs. The note locks as soon as the caregiver signs.
- If an EI's supervisor changes after a note locks, the note stays with the supervisor recorded when it locked (`supervisorUserId`).
- "Not completed" notes are shown however old they are. If production has a lot of abandoned drafts, the list will be long. Run `One Time: Relock Notes` first; it will lock any that are actually complete.

---

# Addendum: Scheduling Notes (9/16/26)

**Rule:** the field is always visible and always editable. On a **held** note it is **required whenever the next session date or time is blank**; "Discharge" is the usual entry for counties that require a date. Next session date and time are no longer required on their own.

| # | Where | What |
|---|---|---|
| A1 | Manage Database → **SessionNote** → Fields | Paste `S14`, which adds `schedulingNotes` (Text) |
| A2 | Layout **sync_SessionNote** | Add `schedulingNotes` (MirrorSync) |
| A3 | Field **SessionNote::asJSON** | Add `[ "schedulingNotes" ; SessionNote::schedulingNotes ; JSONString ]`, with a `;` after the previous line |
| A4 | **Manage: Document**, `saveServer` | Select `Set Variable [ $write ; … "Next Session Time HH" … ]` and paste `S15`. It fills the blank box on the PDF |
| A5 | **SessionNote: Build Change Log** | Select `Set Variable [ $map ; … ]`, paste `S16` below it, then delete the old step. Scheduling Notes changes then appear on a revision's change log |
| A6 | Session note web viewer | `npm run deploy-to-fm` in EISKidsSessionNote |

**Check:** the PDF box is filled through the template field named **"Next Session Additional Information"**. That's the name the billing export column uses, and it's the only unused next-session field. If the box stays empty on a test PDF, the template calls it something else; look it up in `$fields` in the Data Viewer.

**Not changed:** the billing export already has a blank "Next Session Additional Information" column. It is left blank unless billing wants the notes in it.

---

# Addendum: supervisor ids only for matching roles (9/17/26)

**The problem:** on the Accounts page, the COTA and CF supervisor dropdowns are only rebuilt for an account that has that role. When you open a COTA user who has a supervisor and then a non-COTA user, the hidden dropdown still holds the first user's supervisor, and Save writes it onto the second account. On 9/17 this had affected **15 accounts**: 11 interventionists pointing at one COTA supervisor, and 4 admins. None of them had a note waiting on a supervisor.

| # | Where | What |
|---|---|---|
| B1 | **Manage: UserAccount**, `save` branch | Select `Set Variable [ $cotaSupervisorId ; JSONGetElement ( $param ; "cotaSupervisorId" ) ]`, paste `S18` below it, then delete the old `$cfSupervisorId` and `$cotaSupervisorId` steps |
| B2 | New script **`One Time: Clear Mismatched Supervisors`** | Paste `S19` and give it **full access**. Run it once as Admin. It lists what it cleared |
| B3 | Client web viewer | `npm run deploy-to-fm` in EISKidsClient. The Accounts page now empties a hidden supervisor dropdown and never sends a supervisor for a role the account doesn't have |

---

# Addendum: Check & Lock, and honest lock status (9/17/26)

**Why notes fell through the cracks:** after a locking save, the widget marked the note Final and view-only on screen without checking whether FileMaker had actually locked it. `Manage: SessionNote` called `Seal If Complete` but never passed its answer back. If the lock was refused, the user saw "Final", closed the note, and it stayed unlocked.

**Now:**
- `Manage: SessionNote` returns the lock result with the last save step.
- The widget only shows Final when FileMaker locked the note. Otherwise it opens **"Saved - not locked"** with the reason (for example, which signature didn't reach FileMaker).
- A **Check & Lock** header button appears on any unlocked note:
  - It lists every outstanding requirement, using the same `validateForm()` as Save.
  - When the note passes, it offers **Lock Note**, which runs a normal locking save.

| # | Where | What |
|---|---|---|
| C1 | **Manage: SessionNote**, `save` → `commit` | Select `Perform Script [ "SessionNote: Seal If Complete" … ]` and paste `S20` (`Set Variable [ $seal ; Get ( ScriptResult ) ]`) |
| C2 | **Manage: SessionNote**, `save` branch | Select the **last** `Perform JavaScript in Web Viewer [ "saveProgress" … ]` (the one with "ok ; If ( $err = 0 …"), paste `S21` below it, then delete the old step. Leave the first `saveProgress` step (the "final and can no longer be changed" one) alone |
| C3 | Session note web viewer | `npm run deploy-to-fm` in EISKidsSessionNote |

The widget copes with an older script that doesn't send the result: it behaves as before. So deploying the web viewer before C1/C2 won't break anything.
