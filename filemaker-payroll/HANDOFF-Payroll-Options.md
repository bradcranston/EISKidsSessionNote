# Payroll Export: two options — install guide

Built 10/19/26 from the EISKids_Sandbox DDR (20261019). Client request: keep the payroll export as it is, and add one that gives only what is "new" in the date range, like the session note export.

## What it does

The Export dialog now has two payroll choices. Both take a start and end date and pay **H - Held** + **Final** notes in that range (the 9/16 rule).

| Option | Includes | File name |
|---|---|---|
| **Payroll Export (All in Date Range)** | every Held + Final note in the range: the current behavior | `Payroll<start>_<end>.xlsx` |
| **Payroll Export (New Only)** | the same, minus any note already sent on an earlier payroll export | `Payroll<start>_<end>_New.xlsx` |

- **Both options mark** every note in the file as paid (`payrollExported = 1`, `payrollExportedTS`). Running All for a range and then New Only for the same range gives nothing new, so you can't double-pay by mixing them.
- Notes are marked **only after** the file is written. A failed export marks nothing.
- A note someone has open can't be marked. The export still includes it, and a dialog lists it, because it will show up again in the next New Only file.
- **First run:** no note has been marked yet, so the first New Only run for a range matches All. Notes start counting as paid from that run on.
- **Revisions:** `SessionNote: Create Revision` duplicates the note and doesn't clear these two fields, so a revision of a paid note counts as paid too, and New Only won't pay that session twice. If a revision changes the date, times or session status of a session that was already paid, New Only won't pick up the change. Use All for that period or adjust payroll by hand.

## Install order

To regenerate: `python3 gen_payroll_snippets.py` (it borrows the builders from `../filemaker-revisions`).

| # | Where | What |
|---|---|---|
| 1 | Manage Database → **SessionNote** → Fields | Paste `P1`. Fallback: create `payrollExported` (Number) and `payrollExportedTS` (Timestamp) by hand. **Don't** add them to `sync_SessionNote`: only the server sets them, and keeping them off MirrorSync means an offline copy can't clear them |
| 2 | **Manage: Client**, `exportPayroll` branch | Select `Set Variable [ $build … ]`, paste `P2` (comment + new `$build` that adds `newOnly`), then delete the old `$build` step. The `Perform Script [ "Manage: Export" … ]` below it stays as it is |
| 3 | **Manage: Export**, `payroll` branch | Select `Set Variable [ $path … "Payroll" … ]`, paste `P3`. Then delete the old block below it: the 9/16 `# comment`, `Perform Find [ … H - Held … Final ]`, and the `If [ Get ( LastError ) ]` … `End If` (dialog / Close Window / Exit Script). P3 replaces all of it |
| 4 | **Manage: Export**, `payroll` branch | Select `Export Records [ "$path" … ExportPayroll … ]`, paste `P4`. It lands above `Close Window` |
| 5 | Web viewer | `npm run deploy-to-fm` in **EISKidsClient** |

After each paste, look for `<Field Missing>`. The two new fields must exist before you paste P3 and P4.

## Test script

1. Export → **Payroll Export (New Only)** for last week. You get `…_New.xlsx` with the Held + Final notes, and each note has `payrollExported = 1`.
2. Run New Only again for the same week: "No new session notes to pay in that date range."
3. Sign one more Held note from that week to Final, then run New Only again: the file has only that note (two rows: In and Out).
4. **All in Date Range** for the same week: every Held + Final note, same as before this change.
5. Open a note on a second computer and run New Only for its date: the file includes it and the dialog names it. Close it and run again: it's in this file too, then marked.
