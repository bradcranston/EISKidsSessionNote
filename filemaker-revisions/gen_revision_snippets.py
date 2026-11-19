"""
Generate the paste-ready FileMaker snippets for the Session Note revision workflow.

    python3 gen_revision_snippets.py

Rules learned the hard way (see HANDOFF): no XML comments anywhere in a snippet,
and one script per file. Field / layout / script references resolve by NAME on
paste, so new fields use id="0". Step ids are the step type and must be exact.
Existing SessionNote field ids come from the 2026-09-16 DDR.
"""
import os
import xml.etree.ElementTree as ET
from xml.sax.saxutils import escape

OUT = os.path.dirname(os.path.abspath(__file__))

# --------------------------------------------------------------------------
# Step builders
# --------------------------------------------------------------------------

def cdata(c):
    assert "]]>" not in c
    return f"<![CDATA[{c}]]>"

def step(sid, name, inner="", enable=True):
    return (f'<Step enable="{"True" if enable else "False"}" id="{sid}" name="{name}">'
            f'<DisableStepCollapsed state="False"/>{inner}</Step>')

def comment(t=""):
    return step(89, "# (comment)", f'<Restore state="False"/><Text>{escape(t)}</Text>')

def blank():
    return step(89, "# (comment)", '<Restore state="False"/>')

def error_capture(on=True):
    return step(86, "Set Error Capture", f'<Set state="{on}"/>')

def allow_abort(on=False):
    return step(85, "Allow User Abort", f'<Set state="{on}"/>')

def setvar(name, calc):
    return step(141, "Set Variable",
                f"<Value><Calculation>{cdata(calc)}</Calculation></Value>"
                f"<Repetition><Calculation>{cdata('1')}</Calculation></Repetition>"
                f"<Name>{name}</Name>")

SN = "SessionNote"
# Existing SessionNote field ids (DDR 2026-09-16). New fields use id 0.
SNF = {
    "__ID": 1, "sessionDate": 14, "sessionStartTime": 15, "sessionEndTime": 16,
    "serviceUnits": 17, "clientFirstName": 18, "clientLastName": 19,
    "serviceCode": 20, "eISignatureBase64": 49, "parentSignatureBase64": 50,
    "fileExport": 65, "sessionDateCalc": 67, "viewOnly": 85, "status": 87,
    "exported": 88, "pdfFlat": 90, "exportedTS": 91, "awaitingSignaturesOnly": 92,
    "savedToKDrive": 94, "savedToKDriveResult": 95, "savedToKDrivePrint": 96,
    "savedToKDriveResultPrint": 97, "gLink": 98, "supervisorSignatureBase64": 99,
    "supervisorStaffId": 101, "sessionStatus": 58,
}

def fref(table, name):
    fid = SNF.get(name, 0) if table == SN else 0
    return f'<Field table="{table}" id="{fid}" name="{escape(name)}"/>'

def setfield(table, name, calc):
    return step(76, "Set Field", f"<Calculation>{cdata(calc)}</Calculation>{fref(table, name)}")

def if_(c):
    return step(68, "If", f'<Restore state="False"/><Calculation>{cdata(c)}</Calculation>')

def elseif(c):
    return step(125, "Else If", f'<Restore state="False"/><Calculation>{cdata(c)}</Calculation>')

def else_():
    return step(69, "Else", '<Restore state="False"/>')

def endif():
    return step(70, "End If")

def loop():
    return step(71, "Loop", '<Restore state="False"/><FlushType value="Always"/>')

def exitloopif(c):
    return step(72, "Exit Loop If", f"<Calculation>{cdata(c)}</Calculation>")

def endloop():
    return step(73, "End Loop")

def commit():
    return ('<Step enable="True" id="75" name="Commit Records/Requests">'
            '<NoInteract state="True"/><Option state="False"/><ESSForceCommit state="False"/>'
            '<DisableStepCollapsed state="False"/></Step>')

def exitscript(c=None):
    return step(103, "Exit Script", f"<Calculation>{cdata(c)}</Calculation>" if c else "")

LAYOUTS = {"SessionNote - Processing": 10, "SessionNote - wv": 7, "SessionNote": 3,
           "ExportRevision - Processing": 0}

def gotolayout(name):
    return step(6, "Go to Layout",
                f'<LayoutDestination value="SelectedLayout"/><Layout id="{LAYOUTS[name]}" name="{name}"/>')

def newwindow_card(layout):
    return step(122, "New Window",
                '<LayoutDestination value="SelectedLayout"/>'
                '<NewWndStyles DimParentWindow="Yes" Toolbars="No" MenuBar="No" Style="Card" '
                'Close="No" Minimize="No" Maximize="No" Resize="No" Styles="3222274064"/>'
                f'<Layout id="{LAYOUTS[layout]}" name="{layout}"/>')

def closewindow():
    return step(121, "Close Window",
                '<LimitToWindowsOfCurrentFile state="True"/><Window value="Current"/>')

def performscript(name, calc):
    return step(1, "Perform Script",
                f'<Calculation>{cdata(calc)}</Calculation><Script id="0" name="{escape(name)}"/>')

def pjs(fn, param):
    return step(175, "Perform JavaScript in Web Viewer",
                f'<ObjectName><Calculation>{cdata(chr(34) + "web" + chr(34))}</Calculation></ObjectName>'
                f'<FunctionName><Calculation>{cdata(chr(34) + fn + chr(34))}</Calculation></FunctionName>'
                f'<Parameters Count="1"><P><Calculation>{cdata(param)}</Calculation></P></Parameters>')

def gotoobject_web():
    return step(145, "Go to Object",
                f'<ObjectName><Calculation>{cdata(chr(34) + "web" + chr(34))}</Calculation></ObjectName>'
                f'<Repetition><Calculation>{cdata("1")}</Calculation></Repetition>')

def perform_find(requests):
    """requests: list of (operation, [(table, field, text), ...]) - operation Include / Exclude."""
    rows = ""
    for op, crits in requests:
        rows += f'<RequestRow operation="{op}">'
        for table, field, text in crits:
            rows += f"<Criteria>{fref(table, field)}<Text>{escape(text)}</Text></Criteria>"
        rows += "</RequestRow>"
    return step(28, "Perform Find", f'<Restore state="True"/><Query>{rows}</Query>')

def goto_record(where, exit_after_last=False):
    ex = '<Exit state="True"/>' if exit_after_last else ""
    return ('<Step enable="True" id="16" name="Go to Record/Request/Page">'
            f'<NoInteract state="True"/>{ex}<DisableStepCollapsed state="False"/>'
            f'<RowPageLocation value="{where}"/></Step>')

def newrecord():
    return step(7, "New Record/Request")

def duplicate_record():
    return step(8, "Duplicate Record/Request")

def dialog(title, msg):
    return step(87, "Show Custom Dialog",
                f"<Title><Calculation>{cdata(title)}</Calculation></Title>"
                f"<Message><Calculation>{cdata(msg)}</Calculation></Message>"
                '<Buttons><Button CommitState="True"><Calculation><![CDATA["OK"]]></Calculation></Button>'
                '<Button CommitState="False"/><Button CommitState="False"/></Buttons>')

def export_records(path_var, table, fields):
    entries = "".join(f"<ExportEntry>{fref(table, f)}</ExportEntry>" for f in fields)
    return ('<Step enable="True" id="36" name="Export Records">'
            '<NoInteract state="True"/><CreateDirectories state="True"/>'
            '<DisableStepCollapsed state="False"/><Restore state="True"/><AutoOpen state="True"/>'
            '<CreateEmail state="False"/>'
            '<Profile FieldDelimiter="&#9;" IsPredefined="-1" FieldNameRow="-1" DataType="XLXE"/>'
            f"<UniversalPathList>{path_var}</UniversalPathList>"
            '<UseFieldNames state="False"/>'
            '<ExportOptions FormatUsingCurrentLayout="False" CharacterSet="Unicode"/>'
            f"<ExportEntries>{entries}</ExportEntries></Step>")

# --------------------------------------------------------------------------
# Writers + validation
# --------------------------------------------------------------------------

written = []

def write_steps(filename, steps):
    xml = ('<?xml version="1.0" encoding="UTF-8"?>\n<fmxmlsnippet type="FMObjectList">\n'
           + "\n".join(steps) + "\n</fmxmlsnippet>\n")
    root = ET.fromstring(xml.split("\n", 1)[1])
    depth = 0
    for s in root.findall("Step"):
        n = s.get("name")
        if n in ("End If", "End Loop"):
            depth -= 1
        assert depth >= 0, f"{filename}: unbalanced at {n}"
        if n in ("If", "Loop"):
            depth += 1
    assert depth == 0, f"{filename}: unbalanced If/Loop (depth {depth})"
    with open(os.path.join(OUT, filename), "w", encoding="utf-8") as f:
        f.write(xml)
    written.append((filename, len(root.findall("Step"))))

def field_xml(name, dtype="Text", comment_text=""):
    index = 'autoIndex="True" index="None"' if dtype != "Number" else 'autoIndex="True" index="None"'
    return (f'<Field id="0" dataType="{dtype}" fieldType="Normal" name="{name}">'
            f"<Comment>{escape(comment_text)}</Comment>"
            '<AutoEnter allowEditing="True" constant="False" furigana="False" lookup="False" calculation="False">'
            "<ConstantData/></AutoEnter>"
            '<Validation messageCalc="False" message="False" maxLength="False" valuelist="False" '
            'calculation="False" alwaysValidateCalculation="False" type="OnlyDuringDataEntry">'
            '<NotEmpty value="False"/><Unique value="False"/><Existing value="False"/>'
            '<StrictValidation value="False"/></Validation>'
            f'<Storage {index} indexLanguage="English" global="False" maxRepetition="1"/>'
            "</Field>")

def write_fields(filename, fields):
    xml = ('<?xml version="1.0" encoding="UTF-8"?>\n<fmxmlsnippet type="FMObjectList">\n'
           + "\n".join(field_xml(*f) for f in fields) + "\n</fmxmlsnippet>\n")
    ET.fromstring(xml.split("\n", 1)[1])
    with open(os.path.join(OUT, filename), "w", encoding="utf-8") as f:
        f.write(xml)
    written.append((filename, len(fields)))

# ==========================================================================
# 01 - New SessionNote fields
# ==========================================================================

SESSIONNOTE_NEW_FIELDS = [
    ("revisionOf_Id", "Text", "Revision: __ID of the note this one replaces. Empty on an original."),
    ("revisionNumber", "Number", "Revision: 1 for the first revision, 2 for a revision of a revision. Empty on an original."),
    ("revisionReason", "Text", "Revision: why the note was revised, entered in the Revise Note dialog."),
    ("originalSnapshot", "Text", "Revision: JSON of the reportable fields of the replaced note, taken when the copy was made."),
    ("changeLog", "Text", "Revision: one line per changed field, rebuilt on every save. Printed on page 2 of the PDF."),
    ("supersededBy_Id", "Text", "Void: __ID of the revision that replaced this note."),
    ("voidedTS", "TimeStamp", "Void: when this note was voided."),
    ("voidedBy", "Text", "Void: account that voided this note."),
    ("voidReported", "Number", "Void: 1 once this void has gone to billing on a revision report."),
    ("voidReportedTS", "TimeStamp", "Void: when the revision report including this void was run."),
]
write_fields("01-SessionNote-new-fields.fmxmlsnippet.xml", SESSIONNOTE_NEW_FIELDS)

# ==========================================================================
# 02 - ExportRevision table fields
# ==========================================================================

EXPORT_REVISION_FIELDS = [
    "exportId", "Client Last Name", "Client First Name", "Local ID", "County", "Staff ID",
    "Interventionist", "Original Session Date", "Original Start", "Original End",
    "Original Units", "Original Service Code", "Original Session Status",
    "Original Exported On", "Voided On", "Voided By", "Revision Number",
    "Revised Session Date", "Revised Start", "Revised End", "Revised Units",
    "Revised Service Code", "Revised Session Status", "Revision Reason", "Changes",
    "Replacement Note Status", "Reported To Billing On",
]
write_fields("02-ExportRevision-table-fields.fmxmlsnippet.xml",
             [(f, "Text", "") for f in EXPORT_REVISION_FIELDS])

# ==========================================================================
# 03 - Script: SessionNote: Build Change Log
# ==========================================================================

# [key, label, type]. type: text | num | date | time | bool
CHANGE_MAP = [
    ["sessionDate", "Session Date", "date"],
    ["sessionStartTime", "Start Time", "time"],
    ["sessionEndTime", "End Time", "time"],
    ["serviceUnits", "Service Units", "num"],
    ["travelMinutes", "Travel Minutes", "num"],
    ["unitJustification", "Unit Justification", "text"],
    ["sessionStatus", "Session Status", "text"],
    ["cancellationDescription", "Cancellation/Absence Description", "text"],
    ["serviceCode", "Service Code", "text"],
    ["sessionType", "Session Type", "text"],
    ["location", "Location", "text"],
    ["county", "County", "text"],
    ["parentFirstName", "Caregiver First Name", "text"],
    ["parentLastName", "Caregiver Last Name", "text"],
    ["childPresentStatus", "Child Present", "text"],
    ["childAbsentReason", "Child Absent Reason", "text"],
    ["othersPresent", "Others Present", "text"],
    ["whatWeDidTodayPresent", "Present at Session", "text"],
    ["ifspOutcomes", "IFSP Outcomes", "text"],
    ["specificTargets", "Specific Targets", "text"],
    ["outcomeUpdates", "Child and Family Outcome Update", "text"],
    ["whatWeDidToday", "What We Did Today", "text"],
    ["coachingOb", "Observation (Ob)", "bool"],
    ["coachingDT", "Direct Teaching (DT)", "bool"],
    ["coachingDemN", "Demonstration with Narration (DemN)", "bool"],
    ["coachingGP", "Guided Practice (GP)", "bool"],
    ["coachingCP", "Caregiver Practice (CP)", "bool"],
    ["coachingSF", "Specific Feedback (SF)", "bool"],
    ["coachingPS", "Problem Solving (PS)", "bool"],
    ["coachingRe", "Reflection (Re)", "bool"],
    ["coachingOther", "Other Strategy", "text"],
    ["target1Progress", "Target 1 Progress", "text"],
    ["target1Notes", "Target 1 Notes", "text"],
    ["target2Progress", "Target 2 Progress", "text"],
    ["target2Notes", "Target 2 Notes", "text"],
    ["whatTargets", "Family Plan - What (targets)", "text"],
    ["howActivities", "Family Plan - How (strategies)", "text"],
    ["whenWhere", "Family Plan - When and Where", "text"],
    ["who", "Family Plan - Who", "text"],
    ["successLooks", "What Success Will Look Like", "text"],
    ["nextSessionDate", "Next Session Date", "date"],
    ["nextSessionTime", "Next Session Time", "time"],
    ["schedulingNotes", "Scheduling Notes", "text"],
]
import json
map_literal = json.dumps(CHANGE_MAP, separators=(",", ":"))
fm_map = '"' + map_literal.replace("\\", "\\\\").replace('"', '\\"') + '"'

SNAPSHOT_CALC = """While ( [
    ~map = $map
  ; ~n = ValueCount ( JSONListKeys ( ~map ; "" ) )
  ; ~i = 0
  ; ~out = "{}"
] ;
  ~i < ~n ;
[
    ~key = JSONGetElement ( ~map ; "[" & ~i & "][0]" )
  ; ~out = JSONSetElement ( ~out ; ~key ; GetField ( "SessionNote::" & ~key ) ; JSONString )
  ; ~i = ~i + 1
] ;
  ~out
)"""

DIFF_CALC = """While ( [
    ~map = $map
  ; ~n = ValueCount ( JSONListKeys ( ~map ; "" ) )
  ; ~i = 0
  ; ~log = ""
] ;
  ~i < ~n ;
[
    ~key   = JSONGetElement ( ~map ; "[" & ~i & "][0]" )
  ; ~label = JSONGetElement ( ~map ; "[" & ~i & "][1]" )
  ; ~type  = JSONGetElement ( ~map ; "[" & ~i & "][2]" )
  ; ~old   = Trim ( JSONGetElement ( $original ; ~key ) )
  ; ~new   = Trim ( JSONGetElement ( $current ; ~key ) )

  // Checkboxes: "", "0" and "false" are all unchecked
  ; ~same  = If ( ~type = "bool" ;
                  GetAsBoolean ( ~old ) = GetAsBoolean ( ~new ) ;
                  Exact ( ~old ; ~new ) )

  ; ~fmt   = "Let ( [ v = $v ; t = $t ] ;
      Case (
        t = \\"bool\\" ; If ( GetAsBoolean ( v ) ; \\"checked\\" ; \\"unchecked\\" ) ;
        IsEmpty ( v ) ; \\"(blank)\\" ;
        t = \\"date\\" and Middle ( v ; 5 ; 1 ) = \\"-\\" ;
            GetAsNumber ( Middle ( v ; 6 ; 2 ) ) & \\"/\\" & GetAsNumber ( Middle ( v ; 9 ; 2 ) ) & \\"/\\" & Left ( v ; 4 ) ;
        t = \\"time\\" and PatternCount ( v ; \\":\\" ) ;
            Let ( [ h = GetAsNumber ( Left ( v ; Position ( v ; \\":\\" ; 1 ; 1 ) - 1 ) ) ;
                    m = Middle ( v ; Position ( v ; \\":\\" ; 1 ; 1 ) + 1 ; 2 ) ] ;
              Case ( Mod ( h ; 12 ) = 0 ; 12 ; Mod ( h ; 12 ) ) & \\":\\" & m & If ( h < 12 ; \\" AM\\" ; \\" PM\\" ) ) ;
        t = \\"text\\" ; Quote ( Substitute ( v ; [ Char ( 13 ) ; \\" / \\" ] ; [ Char ( 10 ) ; \\" / \\" ] ) ) ;
        v
      )
    )"

  ; $t = ~type
  ; $v = ~old
  ; ~oldText = Evaluate ( ~fmt )
  ; $v = ~new
  ; ~newText = Evaluate ( ~fmt )

  ; ~log = If ( ~same ; ~log ;
               List ( ~log ; ~label & " changed from " & ~oldText & " to " & ~newText ) )
  ; ~i = ~i + 1
] ;
  ~log
)"""

write_steps("03-Script-SessionNote-Build-Change-Log.fmxmlsnippet.xml", [
    comment("Description: builds the change log for a revised session note."),
    comment("PARAMETER: {\"mode\": \"snapshot\"} - returns JSON of every reportable field on the current record. "
            "Create Revision stores this on the copy as originalSnapshot.\n"
            "{\"mode\": \"diff\"} - compares the current record with its originalSnapshot and writes one line "
            "per changed field to SessionNote::changeLog, e.g. Session Date changed from 9/11/2026 to 9/12/2026"),
    comment("Context: the SessionNote record you want. It works on the CURRENT record, it does not find one."),
    comment("Creation Date: 9/16/26  By: bc"),
    blank(),
    error_capture(True),
    allow_abort(False),
    setvar("$mode", 'JSONGetElement ( Get ( ScriptParameter ) ; "mode" )'),
    blank(),
    comment("------------------------------\nThe field list - the ONLY place it lives.\n------------------------------\n"
            "[ field name ; label printed on page 2 ; type ]. type controls formatting: date (stored 2026-09-11), "
            "time (stored 13:30), bool (checkbox), num, text. To report another field, add it here - snapshots taken "
            "before the change simply show it as (blank)."),
    setvar("$map", fm_map),
    blank(),
    setvar("$current", SNAPSHOT_CALC),
    blank(),
    if_('$mode = "snapshot"'),
    exitscript("$current"),
    endif(),
    blank(),
    comment("------------------------------\ndiff\n------------------------------"),
    if_("IsEmpty ( SessionNote::revisionOf_Id ) or IsEmpty ( SessionNote::originalSnapshot )"),
    exitscript('"not a revision"'),
    endif(),
    setvar("$original", "SessionNote::originalSnapshot"),
    comment("The formatter is Evaluate()d with $v and $t so the one expression serves both the old and new value."),
    setvar("$log", DIFF_CALC),
    if_("not Exact ( $log ; SessionNote::changeLog )"),
    setfield(SN, "changeLog", "$log"),
    commit(),
    endif(),
    exitscript("$log"),
])

# ==========================================================================
# 04 - Script: SessionNote: Create Revision
# ==========================================================================

def fail(msg_calc):
    return [pjs("revisionFailed", msg_calc), exitscript('"failed"')]

RESET_ON_COPY = [
    "eISignatureBase64", "parentSignatureBase64", "supervisorSignatureBase64", "supervisorStaffId",
    "pdfFlat", "fileExport", "gLink", "exported", "exportedTS", "awaitingSignaturesOnly",
    "savedToKDrive", "savedToKDriveResult", "savedToKDrivePrint", "savedToKDriveResultPrint",
    "viewOnly", "changeLog", "supersededBy_Id", "voidedTS", "voidedBy", "voidReported", "voidReportedTS",
]

write_steps("04-Script-SessionNote-Create-Revision.fmxmlsnippet.xml", [
    comment("Description: voids a Final session note and opens a copy of it to correct."),
    comment("Called by the Revise Note button in the sessionNote web viewer.\n"
            "PARAMETER: {\"reason\": \"why\"}\n"
            "Context: the SessionNote - wv window showing the note to revise."),
    comment("Order matters. The copy is made and committed BEFORE the original is voided, so a failed duplicate "
            "can never leave a voided note with no replacement."),
    comment("Creation Date: 9/16/26  By: bc"),
    blank(),
    error_capture(True),
    allow_abort(False),
    setvar("$reason", 'Trim ( JSONGetElement ( Get ( ScriptParameter ) ; "reason" ) )'),
    setvar("$origId", "SessionNote::__ID"),
    blank(),
    comment("------------------------------\nGuards\n------------------------------"),
    if_('Get ( LayoutTableName ) <> "SessionNote" or IsEmpty ( $origId )'),
    *fail('"Open the session note you want to revise first."'),
    endif(),
    if_('SessionNote::status <> "Final"'),
    *fail('"Only a final, signed session note can be revised. This note is " & If ( IsEmpty ( SessionNote::status ) ; "still in progress" ; SessionNote::status ) & "."'),
    endif(),
    if_("not IsEmpty ( SessionNote::supersededBy_Id )"),
    *fail('"This note has already been revised."'),
    endif(),
    if_("IsEmpty ( $reason )"),
    *fail('"Please enter a reason for the revision."'),
    endif(),
    blank(),
    comment("------------------------------\nSnapshot the original, then copy it\n------------------------------"),
    commit(),
    performscript("SessionNote: Build Change Log", 'JSONSetElement ( "" ; ["mode" ; "snapshot" ; JSONString] )'),
    setvar("$snapshot", "Get ( ScriptResult )"),
    setvar("$revisionNumber", "GetAsNumber ( SessionNote::revisionNumber ) + 1"),
    blank(),
    duplicate_record(),
    setvar("$dupError", "Get ( LastError )"),
    if_("$dupError <> 0"),
    *fail('"The note could not be copied (FileMaker error " & $dupError & "). Nothing was changed."'),
    endif(),
    comment("__ID is an auto-enter calc. Make certain the copy has its own - a shared primary key breaks "
            "MirrorSync and every ExecuteSQL lookup by id."),
    if_("SessionNote::__ID = $origId or IsEmpty ( SessionNote::__ID )"),
    setfield(SN, "__ID", "Get ( UUID )"),
    endif(),
    setvar("$newId", "SessionNote::__ID"),
    blank(),
    comment("The copy starts unsigned and un-exported. Status draft keeps it out of the billing export until "
            "SessionNote: Seal If Complete marks it Final after every signature is in."),
    setfield(SN, "status", '"draft"'),
    *[setfield(SN, f, '""') for f in RESET_ON_COPY],
    setfield(SN, "revisionOf_Id", "$origId"),
    setfield(SN, "revisionNumber", "$revisionNumber"),
    setfield(SN, "revisionReason", "$reason"),
    setfield(SN, "originalSnapshot", "$snapshot"),
    commit(),
    setvar("$copyError", "Get ( LastError )"),
    if_("$copyError <> 0"),
    *fail('"The revised copy could not be saved (FileMaker error " & $copyError & "). The original note was NOT voided."'),
    endif(),
    blank(),
    comment("------------------------------\nVoid the original\n------------------------------"),
    newwindow_card("SessionNote - Processing"),
    setvar("$find", '"==" & $origId'),
    perform_find([("Include", [(SN, "__ID", "$find")])]),
    setvar("$voided", "False"),
    if_("Get ( FoundCount ) = 1"),
    setfield(SN, "status", '"Void"'),
    setfield(SN, "viewOnly", "1"),
    setfield(SN, "supersededBy_Id", "$newId"),
    setfield(SN, "voidedTS", "Get ( CurrentTimestamp )"),
    setfield(SN, "voidedBy", "Get ( AccountName )"),
    commit(),
    setvar("$voided", "Get ( LastError ) = 0"),
    endif(),
    closewindow(),
    blank(),
    comment("------------------------------\nShow the copy in this window\n------------------------------"),
    setvar("$find", '"==" & $newId'),
    perform_find([("Include", [(SN, "__ID", "$find")])]),
    performscript("Manage: SessionNote",
                  'JSONSetElement ( "" ; ["mode" ; "load" ; JSONString] ; ["sessionNoteId" ; $newId ; JSONString] )'),
    if_("not $voided"),
    dialog('"Revision created"',
           '"The revised copy was created, but the original note could not be voided - it may be open in another window or on another device.¶¶Close the original and ask an administrator to set its status to Void."'),
    endif(),
    exitscript('"ok"'),
])

# ==========================================================================
# 05 - Manage: SessionNote - rebuild change log on commit
# ==========================================================================

write_steps("05-Steps-ManageSessionNote-change-log-on-commit.fmxmlsnippet.xml", [
    comment("Revisions: refresh the change log before sealing, so any PDF built from here on - including the one "
            "shown to signers - lists every change."),
    if_("not IsEmpty ( SessionNote::revisionOf_Id )"),
    performscript("SessionNote: Build Change Log", 'JSONSetElement ( "" ; ["mode" ; "diff" ; JSONString] )'),
    endif(),
])

# ==========================================================================
# 06 - Manage: Document saveServer - change log page
# ==========================================================================

PAGE_TOP, PAGE_BOTTOM, LEFT, WIDTH = 54, 738, 54, 504

def new_page():
    return [
        setvar("$r", 'MBS ( "DynaPDF.AppendPage" ; $pdf )'),
        setvar("$r", 'MBS ( "DynaPDF.SetPageFormat" ; $pdf ; "US Letter" )'),
        setvar("$r", 'MBS ( "DynaPDF.SetFont" ; $pdf ; "Helvetica" ; "regular" ; 10 ; 1 ; "Unicode" )'),
        setvar("$y", str(PAGE_TOP)),
    ]

def write_block(text_var, gap):
    """Measure, break the page if it will not fit, write, advance $y."""
    return [
        setvar("$h", f'GetAsNumber ( MBS ( "DynaPDF.GetFTextHeightEx" ; $pdf ; {WIDTH} ; "left" ; {text_var} ) )'),
        if_(f"$y + $h > {PAGE_BOTTOM}"),
        setvar("$r", 'MBS ( "DynaPDF.EndPage" ; $pdf )'),
        *new_page(),
        endif(),
        setvar("$r", f'MBS ( "DynaPDF.WriteFTextEx" ; $pdf ; {LEFT} ; $y ; {WIDTH} ; -1 ; "left" ; {text_var} )'),
        setvar("$y", f"$y + $h + {gap}"),
    ]

ESC = 'Substitute ( {0} ; "\\\\" ; "\\\\\\\\" )'  # FileMaker: Substitute ( x ; "\\" ; "\\\\" )

write_steps("06-Steps-ManageDocument-revision-page.fmxmlsnippet.xml", [
    comment("------------------------------\nRevision change log - page 2\n------------------------------\n"
            "Only on a revised note. Drawn after page 1 is finished (its EndPage is above) and before DynaPDF.Save.\n"
            "Page 1 was drawn bottom-up; this page is drawn top-down, and the setting is put back at the end.\n"
            "Text is measured before it is written so a long change log carries onto further pages. Backslashes are "
            "doubled because WriteFTextEx treats \\ as the start of a formatting tag."),
    if_("GetAsNumber ( SessionNote::revisionNumber ) > 0"),
    setvar("$r", 'MBS ( "DynaPDF.SetPageCoords" ; $pdf ; "TopDown" )'),
    *new_page(),
    setvar("$r", 'MBS ( "DynaPDF.SetFont" ; $pdf ; "Helvetica" ; "bold" ; 15 ; 1 ; "Unicode" )'),
    setvar("$text", '"REVISED SESSION NOTE - REVISION " & SessionNote::revisionNumber'),
    *write_block("$text", 8),
    setvar("$r", 'MBS ( "DynaPDF.SetFont" ; $pdf ; "Helvetica" ; "regular" ; 10 ; 1 ; "Unicode" )'),
    setvar("$text", ESC.format(
        'List (\n'
        '  "Child: " & SessionNote::clientFirstName & " " & SessionNote::clientLastName & "    Local ID: " & SessionNote::localId\n'
        '; "Session date: " & GetAsText ( SessionNote::sessionDateCalc ) & "    Service code: " & SessionNote::serviceCode\n'
        '; "Early interventionist: " & SessionNote::eIFirstName & " " & SessionNote::eILastName\n'
        '; "Reason for revision: " & SessionNote::revisionReason\n'
        '; "This revision replaces and voids the previously finalized note for this session."\n'
        ')')),
    *write_block("$text", 10),
    setvar("$r", f'MBS ( "DynaPDF.SetLineWidth" ; $pdf ; 0.75 )'),
    setvar("$r", f'MBS ( "DynaPDF.MoveTo" ; $pdf ; {LEFT} ; $y )'),
    setvar("$r", f'MBS ( "DynaPDF.LineTo" ; $pdf ; {LEFT + WIDTH} ; $y )'),
    setvar("$r", 'MBS ( "DynaPDF.StrokePath" ; $pdf )'),
    setvar("$y", "$y + 14"),
    setvar("$r", 'MBS ( "DynaPDF.SetFont" ; $pdf ; "Helvetica" ; "bold" ; 11 ; 1 ; "Unicode" )'),
    setvar("$text", '"Changes from the original note"'),
    *write_block("$text", 6),
    setvar("$r", 'MBS ( "DynaPDF.SetFont" ; $pdf ; "Helvetica" ; "regular" ; 10 ; 1 ; "Unicode" )'),
    setvar("$changes", ESC.format("SessionNote::changeLog")),
    if_("IsEmpty ( $changes )"),
    setvar("$changes", '"No field changes were recorded."'),
    endif(),
    setvar("$i", "0"),
    loop(),
    setvar("$i", "$i + 1"),
    exitloopif("$i > ValueCount ( $changes )"),
    setvar("$text", 'Char ( 8226 ) & "  " & GetValue ( $changes ; $i )'),
    *write_block("$text", 4),
    endloop(),
    setvar("$y", "$y + 12"),
    setvar("$text", '"The caregiver, early interventionist and supervisor (if applicable) signatures on page 1 were given for this revision."'),
    *write_block("$text", 0),
    setvar("$r", 'MBS ( "DynaPDF.EndPage" ; $pdf )'),
    setvar("$r", 'MBS ( "DynaPDF.SetPageCoords" ; $pdf ; "BottomUp" )'),
    endif(),
])

# ==========================================================================
# 07 - File name suffix (paste in 4 places)
# ==========================================================================

write_steps("07-Steps-revision-file-name-suffix.fmxmlsnippet.xml", [
    comment("Revisions get their own file name so the K: drive export (which never overwrites) keeps the original "
            "PDF and the revised one side by side."),
    if_("GetAsNumber ( SessionNote::revisionNumber ) > 0"),
    setvar("$fileName", 'Let ( [ ~suffix = "_REV" & SessionNote::revisionNumber ] ;\n'
                        '  If ( Right ( $fileName ; 4 ) = ".pdf" ;\n'
                        '    Left ( $fileName ; Length ( $fileName ) - 4 ) & ~suffix & ".pdf" ;\n'
                        '    $fileName & ~suffix )\n)'),
    endif(),
])

# 07b - paste directly below 07's End If, in the same 4 places
write_steps("07b-Steps-void-file-name-suffix.fmxmlsnippet.xml", [
    comment("10/21/26 bc: a voided note's PDF is labeled _VOID (after any _REV), e.g. ..._REV1_VOID.pdf."),
    if_('SessionNote::status = "Void"'),
    setvar("$fileName", 'If ( Right ( $fileName ; 4 ) = ".pdf" ;\n'
                        '  Left ( $fileName ; Length ( $fileName ) - 4 ) & "_VOID.pdf" ;\n'
                        '  $fileName & "_VOID" )'),
    endif(),
])

# ==========================================================================
# 08 - Script: Export: Revision Report  (billing batch + on-demand voided notes)
# ==========================================================================

ER = "ExportRevision"
SQL1 = lambda col, idvar: f'ExecuteSQL ( "SELECT \\"{col}\\" FROM \\"SessionNote\\" WHERE \\"__ID\\" = ?" ; "" ; "" ; {idvar} )'

# Columns filled from the voided original ($o) - everything else comes from its replacement ($n)
ORIGINAL_COLS = set(EXPORT_REVISION_FIELDS[1:16] + ["Reported To Billing On"])

def get_folder_path():
    return step(181, "Get Folder Path",
                '<AllowFolderCreation state="True"/>'
                f'<Repetition><Calculation>{cdata("1")}</Calculation></Repetition>'
                f'<DialogTitle><Calculation>{cdata(chr(34) + "Save Voided Notes Report To" + chr(34))}</Calculation></DialogTitle>'
                f'<DefaultLocation><Calculation>{cdata("Get ( DesktopPath )")}</Calculation></DefaultLocation>'
                '<Name>$folder</Name>')

write_steps("08-Script-Export-Revision-Report.fmxmlsnippet.xml", [
    comment("Description: reports voided session notes, one row per voided original, beside the note that replaced it."),
    comment("PARAMETER mode \"batch\" (default) - {\"folder\": \"<folder ending in a slash>\"}\n"
            "  Called at the end of the billing export (Manage: Export, sessionNotes) AFTER that batch is marked exported. "
            "Writes revisions.xlsx for the billing team and marks each row voidReported so it is only sent once.\n"
            "PARAMETER mode \"range\" - {\"mode\": \"range\", \"startDate\": \"9/1/2026\", \"endDate\": \"9/30/2026\"}\n"
            "  Called from the client app's Export dialog (Voided Notes Report). Every note VOIDED in the date range, "
            "whether or not billing has seen it. Asks for a folder, writes VoidedNotes_<start>_to_<end>.xlsx and changes nothing.\n"
            "RESULT: number of rows written"),
    comment("Batch mode reports a voided original only when:\n"
            "- it had itself been exported (billing never saw one that was not - nothing to void), and\n"
            "- the revision that finally replaced it has been exported too, so billing receives the void and the "
            "replacement together. A revision still waiting on signatures holds its row back to a later batch.\n"
            "Both modes follow a revision chain to the newest note."),
    comment("Creation Date: 9/16/26  By: bc"),
    blank(),
    error_capture(True),
    allow_abort(False),
    setvar("$param", "Get ( ScriptParameter )"),
    setvar("$mode", 'If ( JSONGetElement ( $param ; "mode" ) = "range" ; "range" ; "batch" )'),
    setvar("$folder", 'JSONGetElement ( $param ; "folder" )'),
    setvar("$rows", "0"),
    setvar("$exportId", "Get ( UUIDNumber )"),
    blank(),
    if_('$mode = "range"'),
    setvar("$startDate", 'JSONGetElement ( $param ; "startDate" )'),
    setvar("$endDate", 'JSONGetElement ( $param ; "endDate" )'),
    comment("voidedTS is a timestamp - cover the whole of both days"),
    setvar("$range", '$startDate & " 12:00:00 AM..." & $endDate & " 11:59:59 PM"'),
    get_folder_path(),
    if_("Get ( LastError ) <> 0 or IsEmpty ( $folder )"),
    exitscript("0"),
    endif(),
    newwindow_card("SessionNote - Processing"),
    endif(),
    blank(),
    gotolayout("SessionNote - Processing"),
    if_('$mode = "range"'),
    perform_find([("Include", [(SN, "status", "==Void"), (SN, "voidedTS", "$range")])]),
    else_(),
    perform_find([
        ("Include", [(SN, "status", "==Void"), (SN, "exported", "1")]),
        ("Exclude", [(SN, "voidReported", "1")]),
    ]),
    endif(),
    if_("Get ( LastError ) <> 0 or Get ( FoundCount ) = 0"),
    if_('$mode = "range"'),
    dialog('"Voided Notes Report"', '"No session notes were voided between " & $startDate & " and " & $endDate & "."'),
    closewindow(),
    endif(),
    exitscript("0"),
    endif(),
    blank(),
    goto_record("First"),
    loop(),
    comment("Newest note in the revision chain"),
    setvar("$latestId", 'While ( [\n'
                        '    ~id = SessionNote::supersededBy_Id\n'
                        '  ; ~guard = 0\n'
                        '] ;\n'
                        '  ~guard < 50 ;\n'
                        '[\n'
                        '    ~next = ExecuteSQL ( "SELECT \\"supersededBy_Id\\" FROM \\"SessionNote\\" WHERE \\"__ID\\" = ?" ; "" ; "" ; ~id )\n'
                        '  ; ~guard = If ( IsEmpty ( ~next ) ; 50 ; ~guard + 1 )\n'
                        '  ; ~id = If ( IsEmpty ( ~next ) ; ~id ; ~next )\n'
                        '] ;\n'
                        '  ~id\n'
                        ')'),
    setvar("$latestExported", "GetAsNumber ( " + SQL1("exported", "$latestId") + " ) = 1"),
    blank(),
    if_('$mode = "range" or ( not IsEmpty ( $latestId ) and $latestExported )'),
    comment("Original (this record)"),
    setvar("$o", 'JSONSetElement ( "{}"\n'
                 '; ["Client Last Name" ; SessionNote::clientLastName ; JSONString]\n'
                 '; ["Client First Name" ; SessionNote::clientFirstName ; JSONString]\n'
                 '; ["Local ID" ; SessionNote::localId ; JSONString]\n'
                 '; ["County" ; SessionNote::county ; JSONString]\n'
                 '; ["Staff ID" ; SessionNote::staffId ; JSONString]\n'
                 '; ["Interventionist" ; SessionNote::eIFirstName & " " & SessionNote::eILastName ; JSONString]\n'
                 '; ["Original Session Date" ; GetAsText ( SessionNote::sessionDateCalc ) ; JSONString]\n'
                 '; ["Original Start" ; SessionNote::sessionStartTime ; JSONString]\n'
                 '; ["Original End" ; SessionNote::sessionEndTime ; JSONString]\n'
                 '; ["Original Units" ; SessionNote::serviceUnits ; JSONString]\n'
                 '; ["Original Service Code" ; SessionNote::serviceCode ; JSONString]\n'
                 '; ["Original Session Status" ; SessionNote::sessionStatus ; JSONString]\n'
                 '; ["Original Exported On" ; If ( SessionNote::exported = 1 ; GetAsText ( SessionNote::exportedTS ) ; "Never exported" ) ; JSONString]\n'
                 '; ["Voided On" ; GetAsText ( SessionNote::voidedTS ) ; JSONString]\n'
                 '; ["Voided By" ; SessionNote::voidedBy ; JSONString]\n'
                 '; ["Reported To Billing On" ; Case (\n'
                 '      $mode = "batch" ; GetAsText ( Get ( CurrentTimestamp ) ) ;\n'
                 '      SessionNote::voidReported = 1 ; GetAsText ( SessionNote::voidReportedTS ) ;\n'
                 '      SessionNote::exported = 1 ; "Not yet - waiting on revision" ;\n'
                 '      "Not needed - never exported" ) ; JSONString]\n'
                 ')'),
    comment("Replacement (newest revision)"),
    setvar("$revDate", SQL1("sessionDate", "$latestId")),
    setvar("$n", 'JSONSetElement ( "{}"\n'
                 '; ["Revision Number" ; ' + SQL1("revisionNumber", "$latestId") + ' ; JSONString]\n'
                 '; ["Revised Session Date" ; If ( Middle ( $revDate ; 5 ; 1 ) = "-" ; GetAsNumber ( Middle ( $revDate ; 6 ; 2 ) ) & "/" & GetAsNumber ( Middle ( $revDate ; 9 ; 2 ) ) & "/" & Left ( $revDate ; 4 ) ; $revDate ) ; JSONString]\n'
                 '; ["Revised Start" ; ' + SQL1("sessionStartTime", "$latestId") + ' ; JSONString]\n'
                 '; ["Revised End" ; ' + SQL1("sessionEndTime", "$latestId") + ' ; JSONString]\n'
                 '; ["Revised Units" ; ' + SQL1("serviceUnits", "$latestId") + ' ; JSONString]\n'
                 '; ["Revised Service Code" ; ' + SQL1("serviceCode", "$latestId") + ' ; JSONString]\n'
                 '; ["Revised Session Status" ; ' + SQL1("sessionStatus", "$latestId") + ' ; JSONString]\n'
                 '; ["Revision Reason" ; ' + SQL1("revisionReason", "$latestId") + ' ; JSONString]\n'
                 '; ["Changes" ; ' + SQL1("changeLog", "$latestId") + ' ; JSONString]\n'
                 '; ["Replacement Note Status" ; Let ( ~s = ' + SQL1("status", "$latestId") + ' ;\n'
                 '      Case ( IsEmpty ( $latestId ) ; "No replacement found" ; ~s = "Final" ; "Final (signed)" ; ~s = "draft" ; "Awaiting signatures" ; ~s ) ) ; JSONString]\n'
                 ')'),
    blank(),
    gotolayout("ExportRevision - Processing"),
    newrecord(),
    setfield(ER, "exportId", "$exportId"),
    *[setfield(ER, f, f'JSONGetElement ( {"$o" if f in ORIGINAL_COLS else "$n"} ; "{f}" )')
      for f in EXPORT_REVISION_FIELDS[1:]],
    commit(),
    gotolayout("SessionNote - Processing"),
    if_('$mode = "batch"'),
    setfield(SN, "voidReported", "1"),
    setfield(SN, "voidReportedTS", "Get ( CurrentTimestamp )"),
    commit(),
    endif(),
    setvar("$rows", "$rows + 1"),
    endif(),
    goto_record("Next", exit_after_last=True),
    endloop(),
    blank(),
    if_("$rows > 0"),
    gotolayout("ExportRevision - Processing"),
    setvar("$find", "$exportId"),
    perform_find([("Include", [(ER, "exportId", "$find")])]),
    setvar("$path", 'If ( $mode = "range" ;\n'
                    '  $folder & "VoidedNotes_" & Substitute ( $startDate ; "/" ; "-" ) & "_to_" & Substitute ( $endDate ; "/" ; "-" ) & ".xlsx" ;\n'
                    '  $folder & "revisions.xlsx" )'),
    export_records("$path", ER, EXPORT_REVISION_FIELDS[1:]),
    endif(),
    if_('$mode = "range"'),
    closewindow(),
    endif(),
    exitscript("$rows"),
])

# ==========================================================================
# 13 - Manage: Client - exportVoidedNotes branch
# ==========================================================================

ISO_TO_DATE = ('Let ( [\n'
               '  ~data = JSONGetElement ( $param ; "{k}" )\n'
               '; ~year = GetValue ( Substitute ( ~data ; "-" ; ¶ ) ; 1 )\n'
               '; ~month = GetValue ( Substitute ( ~data ; "-" ; ¶ ) ; 2 )\n'
               '; ~day = GetValue ( Substitute ( ~data ; "-" ; ¶ ) ; 3 )\n'
               '] ;\n'
               'Date ( ~month ; ~day ; ~year )\n'
               ')')

write_steps("13-Steps-ManageClient-exportVoidedNotes.fmxmlsnippet.xml", [
    elseif('$mode = "exportVoidedNotes"'),
    comment("Voided Notes Report from the Export dialog. Dates arrive as 2026-09-01 from the date pickers."),
    setvar("$startDate", ISO_TO_DATE.format(k="startDate")),
    setvar("$endDate", ISO_TO_DATE.format(k="endDate")),
    performscript("Export: Revision Report",
                  'JSONSetElement ( ""\n'
                  '; ["mode" ; "range" ; JSONString]\n'
                  '; ["startDate" ; GetAsText ( $startDate ) ; JSONString]\n'
                  '; ["endDate" ; GetAsText ( $endDate ) ; JSONString]\n'
                  ')'),
    blank(),
])

# ==========================================================================
# 09 - Manage: Export billing - find + report call
# ==========================================================================

write_steps("09-Steps-ManageExport-billing-find.fmxmlsnippet.xml", [
    comment("Void added 9/16/26: a voided original never goes out again, even if it was voided before its first export."),
    perform_find([
        ("Exclude", [(SN, "exported", "1")]),
        ("Exclude", [(SN, "status", "draft")]),
        ("Exclude", [(SN, "status", "invalid")]),
        ("Exclude", [(SN, "status", "Void")]),
    ]),
])

write_steps("10-Steps-ManageExport-call-revision-report.fmxmlsnippet.xml", [
    comment("Revision report for billing - revisions.xlsx in the same folder. Runs after this batch is marked "
            "exported so revisions in this batch count."),
    performscript("Export: Revision Report",
                  'JSONSetElement ( "" ; ["folder" ; Left ( $path ; Length ( $path ) - Length ( "sessionNotes.xlsx" ) ) ; JSONString] )'),
])

# ==========================================================================
# 11 - Manage: Export payroll find
# ==========================================================================

write_steps("11-Steps-ManageExport-payroll-find.fmxmlsnippet.xml", [
    comment("9/16/26: payroll pays HELD sessions that are FINAL (fully signed) only. Before this, the find was the "
            "date range alone, so canceled, no-show, draft and invalid notes were all paid. Void notes are not "
            "Final, so a revised session is paid from its revision once that is signed."),
    perform_find([("Include", [
        (SN, "sessionDateCalc", "$dates"),
        (SN, "sessionStatus", "==H - Held"),
        (SN, "status", "==Final"),
    ])]),
])

# ==========================================================================
# 12 - Manage: Client deleteSessionNote guard
# ==========================================================================

write_steps("12-Steps-ManageClient-delete-guard.fmxmlsnippet.xml", [
    comment("9/16/26: Final and Void notes are the legal record and cannot be deleted. Deleting an unfinished "
            "REVISION abandons it and puts the original back to Final."),
    setvar("$findError", "Get ( LastError )"),
    if_('$findError = 0 and ( SessionNote::status = "Final" or SessionNote::status = "Void" )'),
    dialog('"Cannot delete"', '"Final and voided session notes cannot be deleted. Open the note and use Revise Note to correct it."'),
    elseif("$findError = 0"),
    setvar("$restoreId", "SessionNote::revisionOf_Id"),
    step(9, "Delete Record/Request", '<NoInteract state="True"/>'),
    if_("not IsEmpty ( $restoreId ) and Get ( LastError ) = 0"),
    setvar("$find", '"==" & $restoreId'),
    perform_find([("Include", [(SN, "__ID", "$find")])]),
    if_('Get ( FoundCount ) = 1 and SessionNote::status = "Void"'),
    setfield(SN, "status", '"Final"'),
    setfield(SN, "supersededBy_Id", '""'),
    setfield(SN, "voidedTS", '""'),
    setfield(SN, "voidedBy", '""'),
    commit(),
    endif(),
    endif(),
    endif(),
])

for name, n in written:
    print(f"{n:4d}  {name}")
