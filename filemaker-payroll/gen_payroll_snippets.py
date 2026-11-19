"""
Generate the paste-ready FileMaker snippets for the two payroll export options.

    python3 gen_payroll_snippets.py

Reuses the step builders from ../filemaker-revisions/gen_revision_snippets.py
(only the helper section above "01 - New SessionNote fields" is loaded, so this
does not rewrite the revision snippets). Field ids checked against the
2026-10-19 DDR; new fields use id="0" and resolve by name on paste.
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
_src = open(os.path.join(HERE, "..", "filemaker-revisions", "gen_revision_snippets.py"), encoding="utf-8").read()
exec(_src[:_src.index("# 01 - New SessionNote fields")].rsplit("# ====", 1)[0])
OUT = HERE
LAYOUTS["ExportPayroll - Processing"] = 19

# ==========================================================================
# P1 - New SessionNote fields
# ==========================================================================

write_fields("P1-SessionNote-payroll-fields.fmxmlsnippet.xml", [
    ("payrollExported", "Number", "Payroll: 1 once this note has gone out on a payroll export (either option)."),
    ("payrollExportedTS", "TimeStamp", "Payroll: when the last payroll export that included this note was run."),
])

# ==========================================================================
# P2 - Manage: Client, exportPayroll: pass the newOnly choice through
# ==========================================================================

write_steps("P2-Steps-ManageClient-exportPayroll-build.fmxmlsnippet.xml", [
    comment("10/19/26: newOnly comes from the Export dialog. True = Payroll Export (New Only)."),
    setvar("$build",
           'JSONSetElement ( ""\n'
           '; ["mode" ; "payroll" ; JSONString]\n'
           '; ["startDate" ; $startDate ; JSONString]\n'
           '; ["endDate" ; $endDate ; JSONString]\n'
           '; ["newOnly" ; GetAsBoolean ( JSONGetElement ( $param ; "newOnly" ) ) ; JSONBoolean]\n'
           ')'),
])

# ==========================================================================
# P3 - Manage: Export, payroll: choose the find
# ==========================================================================

HELD_FINAL = [(SN, "sessionDateCalc", "$dates"), (SN, "sessionStatus", "==H - Held"), (SN, "status", "==Final")]

write_steps("P3-Steps-ManageExport-payroll-find.fmxmlsnippet.xml", [
    comment("10/19/26: two payroll options. Both pay HELD + FINAL notes in the date range. New Only also skips "
            "notes already sent on an earlier payroll export (payrollExported = 1), the same way the session "
            "note export skips notes already sent to billing."),
    setvar("$newOnly", 'GetAsBoolean ( JSONGetElement ( $param ; "newOnly" ) )'),
    if_("$newOnly"),
    setvar("$path", 'Substitute ( $path ; ".xlsx" ; "_New.xlsx" )'),
    perform_find([("Include", HELD_FINAL), ("Exclude", [(SN, "payrollExported", "1")])]),
    setvar("$findErr", "Get ( LastError )"),
    else_(),
    perform_find([("Include", HELD_FINAL)]),
    setvar("$findErr", "Get ( LastError )"),
    endif(),
    if_("$findErr"),
    dialog('"Payroll"', 'If ( $newOnly ; "No new session notes to pay in that date range." ; "No session notes found" )'),
    closewindow(),
    exitscript(),
    endif(),
])

# ==========================================================================
# P4 - Manage: Export, payroll: mark what went out
# ==========================================================================

write_steps("P4-Steps-ManageExport-payroll-mark-exported.fmxmlsnippet.xml", [
    setvar("$exportErr", "Get ( LastError )"),
    comment("10/19/26: mark every note in this payroll file as paid so New Only leaves it out next time. "
            "Runs only after the file is written, so a failed export marks nothing."),
    if_("$exportErr = 0"),
    setvar("$exportTS", "Get ( CurrentTimestamp )"),
    setvar("$notMarked", '""'),
    gotolayout("SessionNote - Processing"),
    goto_record("First"),
    loop(),
    setfield(SN, "payrollExported", "1"),
    setfield(SN, "payrollExportedTS", "$exportTS"),
    if_("Get ( LastError ) <> 0"),
    setvar("$notMarked", 'List ( $notMarked ; SessionNote::clientFirstName & " " & SessionNote::clientLastName & " - " & SessionNote::sessionDate )'),
    endif(),
    commit(),
    goto_record("Next", exit_after_last=True),
    endloop(),
    if_("not IsEmpty ( $notMarked )"),
    dialog('"Payroll"',
           '"The payroll file was saved, but these notes are open on another computer and could not be marked as paid. '
           'They will appear again in the next New Only payroll export. Take them out of that file so they are not paid twice:¶¶" & $notMarked'),
    endif(),
    else_(),
    dialog('"Payroll"', '"The payroll file could not be saved (error " & $exportErr & "). No notes were marked as paid."'),
    endif(),
])

for name, n in written:
    print(f"{n:4}  {name}")
