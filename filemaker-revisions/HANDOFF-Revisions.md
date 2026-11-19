# Session Note Revisions: install guide

Built 9/16/26 from the EISKids_Sandbox DDR (20260916) and the client meeting notes.

## What it does

1. **Revise Note** (a header button, shown only on **Final** notes; works online or offline):
   - asks for a reason
   - copies the note and commits the copy, then voids the original (status `Void`, linked both ways)
   - opens the copy with signatures cleared, status `draft`, and a snapshot of the original stored on it
2. Each save of a revision rebuilds `changeLog`, one line per change: `Session Date changed from 9/11/2026 to 9/12/2026`.
3. The PDF gets extra page(s) listing every change, and the file is named `..._REV1.pdf` so the K: drive keeps both PDFs.
4. Signatures: nothing new. `SessionNote: Seal If Complete` already requires the EI, the caregiver and the supervisor (when the EI has one). The copy starts unsigned, so all of them sign again.
5. Billing export: the revision goes out in the next normal batch once it's Final, and `Void` is never exported. The same run writes **revisions.xlsx**: one row per voided original that billing had already received, once its replacement has also gone out.
6. Payroll export: pays only notes that are **H - Held** and **Final** in the date range. It used to pay every note in the range, including canceled notes and drafts.
7. Deleting an unfinished revision from the client list discards it and sets the original back to Final. Final and Void notes can't be deleted.
8. **Voided Notes Report**: a new option in the client app's Export dialog. It lists every note voided in a date range (by void date) with its replacement, whether or not billing has seen it, and saves `VoidedNotes_<start>_to_<end>.xlsx`. It changes nothing, so it can be run any number of times.

## Install order

Everything is in this folder. To regenerate: `python3 gen_revision_snippets.py`.

| # | Where | What |
|---|---|---|
| 1 | Manage Database → **SessionNote** → Fields | Paste `01-SessionNote-new-fields`. Fallback: create them by hand (Text unless noted): `revisionOf_Id`, `revisionNumber` (Number), `revisionReason`, `originalSnapshot`, `changeLog`, `supersededBy_Id`, `voidedTS` (Timestamp), `voidedBy`, `voidReported` (Number), `voidReportedTS` (Timestamp) |
| 2 | Manage Database → new table **ExportRevision** | Paste `02-ExportRevision-table-fields` (27 text fields). Then create layout **`ExportRevision - Processing`** on that table, like `ExportPayroll - Processing` |
| 3 | Layout **sync_SessionNote** | Add the 10 new fields so MirrorSync carries them, and regenerate the MirrorSync config if it asks |
| 4 | Field **SessionNote::asJSON** | Replace the last line with the block below |
| 5 | Field **SessionNote::asJSONClientArray** | Add `;[ "revisionNumber" ; SessionNote::revisionNumber ; JSONString ]` |
| 6 | New script **`SessionNote: Build Change Log`** | Paste `03` |
| 7 | New script **`SessionNote: Create Revision`** | Paste `04` (needs 6 to exist first so the Perform Script reference resolves) |
| 8 | **Manage: SessionNote** | Select the `End If` that closes `If [ $commitErr <> 0 ]`, then paste `05`. It lands just above `Perform Script [ "SessionNote: Seal If Complete" ]` |
| 9 | **Manage: Document**, saveServer branch | Select the `End If` that closes the signature block (right after `Set Variable [ $endPage … EndPage ]`), then paste `06`. It must land **above** `Set Variable [ $saved ; DynaPDF.Save ]` |
| 10 | File name suffix, **4 places** | Paste `07` right after the `End If` that closes the Held/county file-name block in: **Manage: Document** `save`, `saveEmail`, `saveServer`, and **Export Session Note PDF to K Drive** (there, above `If [ $currentFile ≠ $fileName ]`) |
| 10b | Void file name, **same 4 places** | Paste `07b` directly below `07`'s `End If`. A voided note's PDF becomes `…_VOID.pdf` (a voided revision `…_REV1_VOID.pdf`) |
| 11 | New script **`Export: Revision Report`** | Paste `08` (needs the layout from step 2) |
| 12 | **Manage: Export**, `sessionNotes` | Select the `Perform Find` (omit exported/draft/invalid), paste `09`, then delete the old find. Select the `Export Records` step and paste `10` (it lands above `Close Window`) |
| 13 | **Manage: Export**, `payroll` | Select `Perform Find [ sessionDateCalc: $dates ]`, paste `11`, then delete the old find |
| 14 | **Manage: Client**, `deleteSessionNote` | Select the `Perform Find`, paste `12`, then delete the old `If [ not Get ( LastError ) ]` / `Delete Record` / `End If` |
| 14b | **Manage: Client**, voided notes report | Select the last step of the `exportPayroll` branch (the `# (comment)` just above `Else If [ $mode = "loadDashboard" ]`) and paste `13`. It adds an `Else If [ $mode = "exportVoidedNotes" ]` branch |
| 15 | **Manage: Export**, `sessionNotes` (bug fix) | Four variables read from the **Import** table instead of SessionNote, so those billing columns come from whatever the Import record holds. Change `$serviceCoordinatorName` → `SessionNote::serviceCoordinatorName`, `$whatWeDidToday` → `SessionNote::whatWeDidToday`, `$whatTargets` → `SessionNote::whatTargets`, `$who` → `SessionNote::who` |
| 16 | Both web viewers | `npm run deploy-to-fm` in **EISKidsSessionNote** and **EISKidsClient** |

After each paste, look for `<Field Missing>` or `<unknown>` script references. If you see one, a name didn't match: check the field or script name exists, spelled exactly as above.

### Step 4: asJSON

Replace the final `[ "awaitingSignaturesOnly" … ]` line with:

```
  [ "awaitingSignaturesOnly" ; SessionNote::awaitingSignaturesOnly ; JSONString ] ;
  [ "revisionNumber" ; SessionNote::revisionNumber ; JSONString ] ;
  [ "revisionReason" ; SessionNote::revisionReason ; JSONString ] ;
  [ "changeLog" ; SessionNote::changeLog ; JSONString ] ;
  [ "voidedTS" ; SessionNote::voidedTS ; JSONString ] ;
  [ "voidedBy" ; SessionNote::voidedBy ; JSONString ]
```

### Privileges

`SessionNote: Create Revision` edits a note that is already Final (to void it), and step 14 edits a Void note. If record-level access blocks interventionists from editing sealed notes, turn on **Run script with full access privileges** for `SessionNote: Create Revision` and `Manage: Client`. Otherwise the void fails, and the script says so in a dialog rather than failing silently.

## Test script

1. Open a Final note → **Revise Note** → enter a reason. The window reloads with a yellow "REVISION 1" banner and a `DRAFT` status. The original shows **Void** (struck through) in the client list.
2. Change the date and start time → Save. Open "Changes from the original": two lines.
3. Create PDF: page 2 lists the changes, and the file is `…_REV1.pdf`.
4. Have the EI sign, then the caregiver link, then the supervisor link → the note seals to Final.
5. Billing export: the revision appears in sessionNotes.xlsx, the original doesn't, and revisions.xlsx has one row. Run it again: no revisions.xlsx, because the void was already reported.
6. Payroll for that period: only Held + Final notes. The voided original isn't there; the signed revision is.
7. Revise a note, then delete the draft revision from the client list → the original is back to Final.
8. Export → **Voided Notes Report** covering today → one row per voided note. "Replacement Note Status" shows whether the revision is signed, and "Reported To Billing On" shows the billing run that sent it, or why it hasn't been sent. Run it again and you get the same rows.

## Decisions and consequences

- **The original is voided when the copy is made** (client's call). Payroll only takes Final notes, so a revised session is **missing from payroll until the revision is fully signed**. If payroll runs in that window, the session is left out.
- **Anyone who can open a note can revise it**, offline included. MirrorSync carries the copy and the void. The signature links and PDF are still online-only, as before.
- **`Void` is a new status**, separate from the existing `invalid`.
- **Revision chains:** a revision can itself be revised. The report follows the chain to the newest note, but its "Changes" column shows only the newest revision's changes, compared with the note it directly replaced.
- The **field list** in the change log is at the top of `SessionNote: Build Change Log` (`$map`). It's the only place it lives. Signatures, PDFs, export flags and auto-entered staff and client names are deliberately left out.

## Found along the way, not changed

- **The billing export ignores the date range the user picks.** It exports every unexported note that isn't draft or invalid.
- **The billing export includes unfinished notes.** Ordinary notes have an empty status until sealed, and the export only omits `draft`, so unsigned notes go to billing. Revisions are protected because they're set to `draft`. Worth raising with the client.
- `Manage: Export` sets `Export::Reflection _Re_` twice. It's harmless.
