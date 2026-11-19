"""
Paste-ready snippets for the supervisor queue / validation + locking project.

    python3 gen_supervisor_snippets.py

Same rules as filemaker-revisions: no XML comments, one script per file, names
resolve on paste (new fields use id 0). Existing ids from the 2026-09-16 12:37 DDR.
"""
import os
import fmsnippet as F
from fmsnippet import *  # noqa: F401,F403 - step builders

F.OUT = os.path.dirname(os.path.abspath(__file__))
SNF.update({"supervisorSignatureBase64": 99, "supervisorStaffId": 101, "staffId": 10,
            "serviceCode": 20, "sessionStatus": 58, "cancellationDescription": 70,
            "awaitingSignaturesOnly": 92, "eISignatureBase64": 49, "parentSignatureBase64": 50})
UA = "UserAccount"

# Layout ids used below
LAYOUTS.update({"SessionNote": 3, "SessionNote - Processing": 10})

def sql1(col, table, where_col, var):
    return (f'ExecuteSQL ( "SELECT \\"{col}\\" FROM \\"{table}\\" WHERE \\"{where_col}\\" = ?" ; "" ; "" ; {var} )')

MY_ID = sql1("__ID", "UserAccount", "username", "Get ( AccountName )")

def jtrue(json_expr, key):
    """JSONGetElement returns a JSON boolean as the NUMBER 1/0 (Claris docs), not the
    text "true". Accept both, so it is right whichever way the caller encoded it."""
    return f'Let ( ~v = JSONGetElement ( {json_expr} ; "{key}" ) ; ~v = 1 or ~v = "true" )'

def seal_result(sealed, reason, extra=""):
    return (f'JSONSetElement ( "" ; ["sealed";{sealed};JSONBoolean] ; ["reason";"{reason}";JSONString]'
            + extra + " )")

# ==========================================================================
# S01 - SessionNote fields
# ==========================================================================

write_fields("S01-SessionNote-supervisor-fields.fmxmlsnippet.xml", [
    ("supervisorUserId", "Text", "Supervisor: UserAccount::__ID of the supervisor who must sign. Set when the note locks."),
    ("awaitingSupervisor", "Number", "Supervisor: 1 while the note is locked but still waiting on the supervisor signature. Keeps it out of the K: drive queue and puts it in the supervisor's dashboard queue."),
    ("supervisorName", "Text", "Supervisor: name stamped from the user record when the supervisor signs. Printed on the PDF."),
    ("supervisorCredentials", "Text", "Supervisor: credentials (title) stamped from the user record when the supervisor signs. Printed on the PDF."),
    ("supervisorSignedTS", "TimeStamp", "Supervisor: when the supervisor signature was completed."),
])

# ==========================================================================
# S02 - On Open: fix supervisor visibility (supervisor ids are __IDs, not staffIds)
# ==========================================================================

write_steps("S02-Steps-OnOpen-gLoggedIn.fmxmlsnippet.xml", [
    comment("9/16/26: cfSupervisorId / cotaSupervisorId hold the supervisor's UserAccount __ID (that is what the Accounts "
            "page saves). The old lookup compared them to the supervisor's staffId, never matched, and supervisors "
            "could only see their own notes. gLoggedIn is still a list of STAFF ids - the SessionNote record-level "
            "access calc filters on staffId."),
    if_('PatternCount ( Get ( AccountPrivilegeSetName ) ; "Supervisor" )'),
    setvar("$userId", MY_ID),
    setvar("$staffId", sql1("staffId", "UserAccount", "username", "Get ( AccountName )")),
    setvar("$team", 'ExecuteSQL ( "SELECT \\"staffId\\" FROM \\"UserAccount\\" WHERE \\"cfSupervisorId\\" = ? OR \\"cotaSupervisorId\\" = ?" ; "" ; "" ; $userId ; $userId )'),
    setfield(UA, "gLoggedIn", "ValuesRemoveEmptyValues ( $staffId & ¶ & $team )"),
    elseif('Get ( AccountPrivilegeSetName ) = "Interventionist" or Get ( AccountPrivilegeSetName ) = "COTA" or Get ( AccountPrivilegeSetName ) = "CF"'),
    setfield(UA, "gLoggedIn", sql1("staffId", "UserAccount", "username", "Get ( AccountName )")),
    endif(),
])

# ==========================================================================
# S03 - SessionNote: Seal If Complete (full replacement)
# ==========================================================================

SUPERVISOR_PICK = """Let ( [
  ~staff  = SessionNote::staffId
; ~cf     = Trim ( ExecuteSQL ( "SELECT \\"cfSupervisorId\\" FROM \\"UserAccount\\" WHERE \\"staffId\\" = ?" ; "" ; "" ; ~staff ) )
; ~cota   = Trim ( ExecuteSQL ( "SELECT \\"cotaSupervisorId\\" FROM \\"UserAccount\\" WHERE \\"staffId\\" = ?" ; "" ; "" ; ~staff ) )
; ~isCota = Left ( Trim ( SessionNote::serviceCode ) ; 4 ) = "COTA"
; ~pick   = If ( ~isCota ; ~cota ; ~cf )
; ~pick   = If ( IsEmpty ( ~pick ) ; If ( ~isCota ; ~cf ; ~cota ) ; ~pick )
] ;
JSONSetElement ( ""
; ["required" ; not IsEmpty ( ~pick ) ; JSONBoolean]
; ["userId"   ; ~pick ; JSONString]
)
)"""

REBUILD_CALC = 'JSONSetElement(""\n;["mode";"saveServer";JSONString]\n;["id";SessionNote::__ID;JSONString]\n)'
REBUILD_PDF = step(164, "Perform Script on Server",
    '<WaitForCompletion state="True"/>'
    + "<Calculation>" + cdata(REBUILD_CALC) + "</Calculation>"
    + '<Script id="0" name="Manage: Document"/>')

write_steps("S03-Script-SessionNote-Seal-If-Complete.fmxmlsnippet.xml", [
    comment("Description: locks a session note once the interventionist (and caregiver, for a held session) have signed, "
            "and routes it to the K: drive once any required supervisor has signed too."),
    comment("PARAMETER: {\"id\": \"<SessionNote __ID>\", \"requirementsMet\": true|false}\n"
            "RETURNS: {\"sealed\": true|false, \"reason\": \"...\", \"awaitingSupervisor\": true|false}\n"
            "Safe to call on every save and every signature - it only acts when something is ready."),
    comment("Rules (9/16/26 meeting):\n"
            "- H - Held: locks when EI + caregiver have signed and every other requirement passes.\n"
            "- Any other session status (canceled / absent): locks when the EI has signed.\n"
            "- The supervisor signature does NOT block the lock, payroll or billing. It only holds the note out of the "
            "K: drive queue (awaitingSupervisor = 1) until the supervisor signs.\n"
            "Change log: 9/16/26 bc - supervisor no longer required to lock; canceled notes need the EI signature only; "
            "supervisor ids are UserAccount __IDs."),
    blank(),
    error_capture(True),
    allow_abort(False),
    comment("------------------------------\nFind the note\n------------------------------"),
    setvar("$id", 'JSONGetElement ( Get ( ScriptParameter ) ; "id" )'),
    if_("IsEmpty ( $id )"),
    exitscript(seal_result("False", "no id in parameter")),
    endif(),
    if_('Get ( LayoutTableName ) <> "SessionNote" or SessionNote::__ID <> $id'),
    gotolayout("SessionNote"),
    setvar("$find", '"==" & $id'),
    perform_find([("Include", [(SN, "__ID", "$find")])]),
    endif(),
    if_("Get ( FoundCount ) = 0 or SessionNote::__ID <> $id"),
    exitscript(seal_result("False", "note not found")),
    endif(),
    blank(),
    setvar("$finishSupervisor", "False"),
    comment("------------------------------\nAlready locked\n------------------------------\n"
            "The only thing left to do on a locked note is finish the supervisor step, once their signature lands "
            "(SessionNote: Supervisor Sign, or the BetterForms link)."),
    if_("GetAsBoolean ( SessionNote::viewOnly )"),
    if_("SessionNote::awaitingSupervisor = 1 and not IsEmpty ( SessionNote::supervisorSignatureBase64 )"),
    setvar("$finishSupervisor", "True"),
    else_(),
    exitscript(seal_result("False", "already sealed", ' ; ["awaitingSupervisor";SessionNote::awaitingSupervisor = 1;JSONBoolean]')),
    endif(),
    endif(),
    blank(),
    if_("not $finishSupervisor"),
    comment("------------------------------\nRequirement 1: everything except signatures\n------------------------------\n"
            "Either the widget passes requirementsMet (its validateForm() just passed everything), or it stored "
            "awaitingSignaturesOnly = true on an earlier save (every requirement passed except signatures - the "
            "route a BetterForms caregiver signature takes)."),
    if_('not ( ' + jtrue("Get ( ScriptParameter )", "requirementsMet") + ' or Lower ( Trim ( SessionNote::awaitingSignaturesOnly ) ) = "true" )'),
    exitscript(seal_result("False", "note still has non-signature requirements outstanding")),
    endif(),
    blank(),
    comment("------------------------------\nRequirement 2: signatures for this kind of session\n------------------------------\n"
            "Test the Base64 fields, not the calculated containers - those can lag a commit."),
    setvar("$isHeld", 'Trim ( SessionNote::sessionStatus ) = "H - Held"'),
    setvar("$missing", 'List (\n'
                       '  If ( IsEmpty ( SessionNote::eISignatureBase64 ) ; "EI signature" ; "" )\n'
                       '; If ( $isHeld and IsEmpty ( SessionNote::parentSignatureBase64 ) ; "Parent/caregiver signature" ; "" )\n'
                       ')'),
    if_("not IsEmpty ( $missing )"),
    exitscript('JSONSetElement ( "" ; ["sealed";False;JSONBoolean] ; ["reason";"awaiting signatures";JSONString] ; ["missing";Substitute ( $missing ; ¶ ; ", " );JSONString] )'),
    endif(),
    blank(),
    comment("------------------------------\nLock it\n------------------------------\n"
            "Rebuild the PDF first so the stored copy shows every signature collected so far."),
    REBUILD_PDF,
    commit(),
    setvar("$supervisor", SUPERVISOR_PICK),
    setvar("$supervisorRequired", 'GetAsBoolean ( JSONGetElement ( $supervisor ; "required" ) )'),
    setfield(SN, "status", '"Final"'),
    setfield(SN, "viewOnly", "1"),
    if_("$supervisorRequired"),
    if_("IsEmpty ( SessionNote::supervisorUserId )"),
    setfield(SN, "supervisorUserId", 'JSONGetElement ( $supervisor ; "userId" )'),
    endif(),
    if_("IsEmpty ( SessionNote::supervisorSignatureBase64 )"),
    comment("Into the supervisor's queue. Not queued for the K: drive until they sign."),
    setfield(SN, "awaitingSupervisor", "1"),
    setfield(SN, "savedToKDrive", '""'),
    commit(),
    exitscript(seal_result("True", "locked - awaiting supervisor", ' ; ["awaitingSupervisor";True;JSONBoolean]')),
    endif(),
    comment("The supervisor already signed (link used before the lock) - finish below."),
    setvar("$finishSupervisor", "True"),
    else_(),
    setfield(SN, "awaitingSupervisor", "0"),
    comment("No supervisor - straight into the K: drive queue (status Final AND savedToKDrive not 1)."),
    setfield(SN, "savedToKDrive", "0"),
    commit(),
    exitscript(seal_result("True", "locked", ' ; ["awaitingSupervisor";False;JSONBoolean]')),
    endif(),
    endif(),
    blank(),
    comment("------------------------------\nSupervisor has signed - stamp, rebuild, route to the K: drive\n------------------------------\n"
            "Name and credentials are copied onto the note so the PDF keeps showing who signed even if the user "
            "record changes later."),
    if_("$finishSupervisor"),
    setvar("$supId", "SessionNote::supervisorUserId"),
    setfield(SN, "supervisorName", 'Trim ( ' + sql1("firstName", "UserAccount", "__ID", "$supId") + ' & " " & ' + sql1("lastName", "UserAccount", "__ID", "$supId") + ' )'),
    setfield(SN, "supervisorCredentials", sql1("credentials", "UserAccount", "__ID", "$supId")),
    setfield(SN, "supervisorSignedTS", "Get ( CurrentTimestamp )"),
    setfield(SN, "awaitingSupervisor", "0"),
    comment("Empty pdfFlat as well as rebuilding: if the rebuild cannot run (offline), the K: drive export sees no "
            "stored file name and rebuilds it on the server."),
    setfield(SN, "pdfFlat", '""'),
    commit(),
    REBUILD_PDF,
    commit(),
    setfield(SN, "savedToKDrive", "0"),
    commit(),
    exitscript(seal_result("True", "supervisor signed", ' ; ["supervisorSigned";True;JSONBoolean] ; ["awaitingSupervisor";False;JSONBoolean]')),
    endif(),
])

# ==========================================================================
# S04 - SessionNote: Supervisor Sign (new)
# ==========================================================================

def sup_fail(msg):
    return [pjs("supervisorSignFailed", msg), exitscript('"failed"')]

write_steps("S04-Script-SessionNote-Supervisor-Sign.fmxmlsnippet.xml", [
    comment("Description: saves the supervisor signature from the sessionNote web viewer and finishes the note."),
    comment("PARAMETER: {\"signature\": \"data:image/png;base64,...\"}\n"
            "Context: the SessionNote - wv window showing the note.\n"
            "Only the assigned supervisor (SessionNote::supervisorUserId) may sign."),
    comment("Creation Date: 9/16/26  By: bc"),
    blank(),
    error_capture(True),
    allow_abort(False),
    setvar("$signature", 'JSONGetElement ( Get ( ScriptParameter ) ; "signature" )'),
    setvar("$noteId", "SessionNote::__ID"),
    setvar("$myId", MY_ID),
    blank(),
    if_('Get ( LayoutTableName ) <> "SessionNote" or IsEmpty ( $noteId )'),
    *sup_fail('"Open the session note first."'),
    endif(),
    if_('SessionNote::status <> "Final" or SessionNote::awaitingSupervisor <> 1'),
    *sup_fail('"This note is not waiting on a supervisor signature."'),
    endif(),
    if_("IsEmpty ( $myId ) or $myId <> SessionNote::supervisorUserId"),
    *sup_fail('"Only the assigned supervisor can sign this note."'),
    endif(),
    if_('IsEmpty ( $signature ) or Left ( $signature ; 10 ) <> "data:image"'),
    *sup_fail('"Please sign in the box first."'),
    endif(),
    blank(),
    setfield(SN, "supervisorSignatureBase64", "$signature"),
    commit(),
    setvar("$saveError", "Get ( LastError )"),
    if_("$saveError <> 0"),
    *sup_fail('"The signature could not be saved (FileMaker error " & $saveError & ")."'),
    endif(),
    performscript("SessionNote: Seal If Complete", 'JSONSetElement ( "" ; ["id" ; $noteId ; JSONString] )'),
    setvar("$result", "Get ( ScriptResult )"),
    blank(),
    comment("Show the finished note either way - the signature is saved even if routing reported a problem."),
    performscript("Manage: SessionNote", 'JSONSetElement ( "" ; ["mode" ; "load" ; JSONString] ; ["sessionNoteId" ; $noteId ; JSONString] )'),
    if_('not ' + jtrue("$result", "supervisorSigned")),
    *sup_fail('"Your signature was saved, but the note could not be finished: " & JSONGetElement ( $result ; "reason" )'),
    endif(),
    exitscript('"ok"'),
])

# ==========================================================================
# S05 - Manage: SessionNote load - who is looking
# ==========================================================================

write_steps("S05-Steps-ManageSessionNote-load-user.fmxmlsnippet.xml", [
    comment("9/16/26: the widget needs to know who is viewing, to offer the supervisor signature pad only to the assigned supervisor."),
    setvar("$data", 'JSONSetElement ( $data\n'
                    '; ["online" ; Get ( HostName ) = "EIS FM Server" ; JSONBoolean]\n'
                    '; ["currentUserId" ; ' + MY_ID + ' ; JSONString]\n'
                    '; ["supervisorAssignedName" ; Let ( ~sup = JSONGetElement ( $data ; "supervisorUserId" ) ;\n'
                    '     Trim ( ' + sql1("firstName", "UserAccount", "__ID", "~sup") + ' & " " & ' + sql1("lastName", "UserAccount", "__ID", "~sup") + ' ) ) ; JSONString]\n'
                    ')'),
])

# ==========================================================================
# S06 - Manage: Document - supervisor name + credentials on the PDF
# ==========================================================================

write_steps("S06-Steps-ManageDocument-supervisor-name.fmxmlsnippet.xml", [
    comment("Supervisor name and credentials under the supervisor signature (page 1, bottom-up coordinates).\n"
            "$supX / $supY are the top-left of the text. Adjust them if it collides with the template's printed labels."),
    if_("not IsEmpty ( SessionNote::supervisorName )"),
    setvar("$supX", "260"),
    setvar("$supY", "146"),
    setvar("$write", 'MBS ( "DynaPDF.SetFont" ; $pdf ; "Helvetica" ; "regular" ; 6 ; 1 ; "Unicode" )'),
    setvar("$write", 'MBS ( "DynaPDF.WriteFTextEx" ; $pdf ; $supX ; $supY ; 130 ; -1 ; "left" ;\n'
                     '  Substitute ( SessionNote::supervisorName & If ( IsEmpty ( SessionNote::supervisorCredentials ) ; "" ; ", " & SessionNote::supervisorCredentials ) ; "\\\\" ; "\\\\\\\\" ) )'),
    endif(),
])

# ==========================================================================
# S07 - Server - Process K Drive Queue find
# ==========================================================================

write_steps("S07-Steps-KDriveQueue-find.fmxmlsnippet.xml", [
    comment("9/16/26: locked notes still waiting on the supervisor stay out of the archive until they sign."),
    perform_find([
        ("Include", [(SN, "status", "==Final")]),
        ("Exclude", [(SN, "savedToKDrive", "1")]),
        ("Exclude", [(SN, "awaitingSupervisor", "1")]),
    ]),
])

# ==========================================================================
# S08 - SessionNote: Create Revision - also reset the supervisor fields
# ==========================================================================

write_steps("S08-Steps-CreateRevision-supervisor-reset.fmxmlsnippet.xml", [
    comment("The revision is signed again from scratch, supervisor included."),
    *[setfield(SN, f, '""') for f in ["supervisorUserId", "awaitingSupervisor", "supervisorName",
                                     "supervisorCredentials", "supervisorSignedTS"]],
])

# ==========================================================================
# S09 - Dashboard: Session Notes (new)
# ==========================================================================

CUTOFF = ('Let ( ~d = Get ( CurrentDate ) - 30 ;\n'
          '  Year ( ~d ) & "-" & Right ( "0" & Month ( ~d ) ; 2 ) & "-" & Right ( "0" & Day ( ~d ) ; 2 ) )')

write_steps("S09-Script-Dashboard-Session-Notes.fmxmlsnippet.xml", [
    comment("Description: pushes the Session Notes half of the dashboard into the Client web viewer."),
    comment("Context: a window with the \"web\" web viewer (Client - wv).\n"
            "Called by Manage: Client (loadDashboard) and by Manage: Document (close), so the list is current after a note is closed.\n"
            "DO NOT give this script full access. It relies on record-level access: interventionists see their own notes, "
            "supervisors their team's, admins everything."),
    comment("Creation Date: 9/16/26  By: bc"),
    blank(),
    error_capture(True),
    setvar("$cutoff", CUTOFF),
    setvar("$myId", MY_ID),
    setvar("$roles", sql1("role", "UserAccount", "username", "Get ( AccountName )")),
    blank(),
    comment("Recent = session date in the last 30 days, plus anything not yet locked however old. sessionDate is stored "
            "as YYYY-MM-DD text, so a string comparison is a date comparison and uses the index."),
    setvar("$notes", 'ExecuteSQL ( "SELECT \\"asJSONDashboardArray\\" FROM \\"SessionNote\\" WHERE \\"sessionDate\\" >= ? OR \\"status\\" IS NULL OR \\"status\\" NOT IN (\'Final\',\'Void\') ORDER BY \\"sessionDate\\" DESC" ; "" ; "," ; $cutoff )'),
    setvar("$queue", 'ExecuteSQL ( "SELECT \\"asJSONDashboardArray\\" FROM \\"SessionNote\\" WHERE \\"awaitingSupervisor\\" = 1 AND \\"supervisorUserId\\" = ? ORDER BY \\"sessionDate\\" DESC" ; "" ; "," ; $myId )'),
    comment("ExecuteSQL returns ? on an error - never hand that to JSON."),
    setvar("$payload", 'JSONSetElement ( "{}"\n'
                       '; ["notes" ; "[" & If ( Left ( $notes ; 1 ) = "?" ; "" ; $notes ) & "]" ; JSONArray]\n'
                       '; ["queue" ; "[" & If ( Left ( $queue ; 1 ) = "?" or IsEmpty ( $myId ) ; "" ; $queue ) & "]" ; JSONArray]\n'
                       '; ["cutoff" ; $cutoff ; JSONString]\n'
                       '; ["sqlError" ; Left ( $notes ; 1 ) = "?" ; JSONBoolean]\n'
                       '; ["me.id" ; $myId ; JSONString]\n'
                       '; ["me.isSupervisor" ; PatternCount ( $roles ; "Supervisor" ) > 0 ; JSONBoolean]\n'
                       '; ["me.isAdmin" ; PatternCount ( $roles ; "\\"Admin\\"" ) > 0 or Get ( AccountPrivilegeSetName ) = "[Full Access]" or Get ( AccountPrivilegeSetName ) = "Admin" ; JSONBoolean]\n'
                       ')'),
    pjs("loadDashboardNotes", "$payload"),
    exitscript("True"),
])

# ==========================================================================
# S10 - Manage: Client loadDashboard / S11 - Manage: Document close
# ==========================================================================

write_steps("S10-Steps-ManageClient-loadDashboard-notes.fmxmlsnippet.xml", [
    comment("Session Notes half of the dashboard."),
    performscript("Dashboard: Session Notes", '""'),
])

write_steps("S11-Steps-ManageDocument-close-refresh.fmxmlsnippet.xml", [
    comment("Keep the dashboard's session note list current too."),
    performscript("Dashboard: Session Notes", '""'),
])

# ==========================================================================
# S12 - One time: lock notes that were only waiting on the supervisor
# ==========================================================================

write_steps("S12-Script-One-Time-Relock-Notes.fmxmlsnippet.xml", [
    comment("Description: ONE TIME, after installing S03. Runs the new lock rules over every unlocked note, so notes "
            "that were stuck only because the supervisor had not signed (or canceled notes with just an EI signature) "
            "lock now instead of on their next save."),
    comment("Run it once as an admin, on the server copy, then leave it disabled. Safe to re-run: Seal If Complete ignores "
            "notes that are not ready."),
    blank(),
    error_capture(True),
    allow_abort(False),
    newwindow_card("SessionNote - Processing"),
    perform_find([
        ("Include", [(SN, "eISignatureBase64", "*")]),
        ("Exclude", [(SN, "status", "==Final")]),
        ("Exclude", [(SN, "status", "==Void")]),
    ]),
    if_("Get ( FoundCount ) = 0"),
    dialog('"Relock notes"', '"No unlocked notes with an EI signature were found."'),
    closewindow(),
    exitscript("0"),
    endif(),
    setvar("$checked", "Get ( FoundCount )"),
    setvar("$locked", "0"),
    setvar("$awaiting", "0"),
    goto_record("First"),
    loop(),
    setvar("$id", "SessionNote::__ID"),
    comment("A canceled note only ever needed its description - the old form passed it without flagging awaitingSignaturesOnly."),
    setvar("$met", 'Trim ( SessionNote::sessionStatus ) <> "H - Held" and not IsEmpty ( SessionNote::cancellationDescription )'),
    performscript("SessionNote: Seal If Complete",
                  'JSONSetElement ( "" ; ["id" ; $id ; JSONString] ; ["requirementsMet" ; $met ; JSONBoolean] )'),
    setvar("$r", "Get ( ScriptResult )"),
    if_(jtrue("$r", "sealed")),
    setvar("$locked", "$locked + 1"),
    setvar("$awaiting", '$awaiting + ( ' + jtrue("$r", "awaitingSupervisor") + ' )'),
    endif(),
        goto_record("Next", exit_after_last=True),
    endloop(),
    closewindow(),
    dialog('"Relock notes"', '"Checked " & $checked & " unlocked notes.¶Locked: " & $locked & "¶Of those, waiting on a supervisor: " & $awaiting'),
    exitscript("$locked"),
])

# ==========================================================================
# S13 - Manage: SessionNote - widget lock flag (same boolean trap)
# ==========================================================================

write_steps("S13-Steps-ManageSessionNote-widgetWantsLock.fmxmlsnippet.xml", [
    comment("9/16/26: the widget sends viewOnly as a JSON boolean, which JSONGetElement returns as 1 - never equal to the text \"true\". Accept both."),
    setvar("$widgetWantsLock", '$step = "commit" and ' + jtrue("$data", "viewOnly")),
])

# ==========================================================================
# S14-S16 - Scheduling Notes (9/16/26)
# ==========================================================================

write_fields("S14-SessionNote-schedulingNotes-field.fmxmlsnippet.xml", [
    ("schedulingNotes", "Text", "Scheduling Notes. Required by the form when the next session date or time is blank "
     "(e.g. \"Discharge\"). Printed in the PDF box under Date/Time of Next Session."),
])

write_steps("S15-Steps-ManageDocument-schedulingNotes-pdf.fmxmlsnippet.xml", [
    comment("Scheduling Notes -> the blank box under Date/Time of Next Session on the PDF template. The template's field "
            "is named \"Next Session Additional Information\" (same name as the billing export column). If the box stays "
            "empty on the PDF, check the name in $fields."),
    setvar("$write", 'MBS ( "DynaPDF.SetTextFieldValue" ; $pdf ; "Next Session Additional Information" ; SessionNote::schedulingNotes )'),
])

# ==========================================================================
# S17 - App version in the client app header
# ==========================================================================

write_steps("S17-Steps-ManageClient-app-version.fmxmlsnippet.xml", [
    comment("App version in the header. DatabaseVersion is a constant calc in each copy of the file, so an offline iPad "
            "reports its own copy's version - which is the point."),
    pjs("setAppVersion", 'ExecuteSQL ( "SELECT \\"DatabaseVersion\\" FROM \\"MirrorSync\\" FETCH FIRST 1 ROWS ONLY" ; "" ; "" )'),
])

# ==========================================================================
# S18 / S19 - Supervisor ids only for matching roles (9/17/26)
# ==========================================================================

LAYOUTS.update({"UserAccount - Processing": 14})

def has_role(roles_expr, role):
    """Exact element match in the role JSON array - "COTA Supervisor" must not count as "COTA"."""
    return (f'Let ( [ ~list = JSONListValues ( {roles_expr} ; "" ) ; ~list = If ( Left ( ~list ; 1 ) = "?" ; {roles_expr} ; ~list ) ] ; '
            f'not IsEmpty ( FilterValues ( ~list ; "{role}" ) ) )')

write_steps("S18-Steps-ManageUserAccount-supervisor-by-role.fmxmlsnippet.xml", [
    comment("9/17/26: a COTA supervisor is only kept for a COTA user, a CF supervisor only for a CF user. The Accounts page "
            "used to send the previous account's hidden supervisor along with a non-COTA/CF account."),
    setvar("$cfSupervisorId", f'If ( {has_role("$role", "CF")} ; JSONGetElement ( $param ; "cfSupervisorId" ) ; "" )'),
    setvar("$cotaSupervisorId", f'If ( {has_role("$role", "COTA")} ; JSONGetElement ( $param ; "cotaSupervisorId" ) ; "" )'),
])

write_steps("S19-Script-One-Time-Clear-Mismatched-Supervisors.fmxmlsnippet.xml", [
    comment("Description: ONE TIME. Clears cotaSupervisorId on every account without the COTA role, and cfSupervisorId on "
            "every account without the CF role. Safe to re-run."),
    comment("Run once as an admin. Give it full access - accounts can only see their own UserAccount record otherwise."),
    blank(),
    error_capture(True),
    allow_abort(False),
    newwindow_card("UserAccount - Processing"),
    step(23, "Show All Records"),
    setvar("$cleared", '""'),
    goto_record("First"),
    loop(),
    setvar("$roles", "UserAccount::role"),
    setvar("$fix", '""'),
    if_('not IsEmpty ( UserAccount::cotaSupervisorId ) and not ' + has_role("$roles", "COTA")),
    setfield("UserAccount", "cotaSupervisorId", '""'),
    setvar("$fix", '"COTA"'),
    endif(),
    if_('not IsEmpty ( UserAccount::cfSupervisorId ) and not ' + has_role("$roles", "CF")),
    setfield("UserAccount", "cfSupervisorId", '""'),
    setvar("$fix", 'List ( $fix ; "CF" )'),
    endif(),
    if_("not IsEmpty ( $fix )"),
    commit(),
    setvar("$cleared", 'List ( $cleared ; UserAccount::username & " (" & Substitute ( $fix ; ¶ ; " + " ) & ")" )'),
    endif(),
    goto_record("Next", exit_after_last=True),
    endloop(),
    closewindow(),
    dialog('"Clear mismatched supervisors"',
           'If ( IsEmpty ( $cleared ) ; "Nothing to clear." ; "Cleared " & ValueCount ( $cleared ) & " account(s):¶¶" & $cleared )'),
    exitscript("ValueCount ( $cleared )"),
])

# ==========================================================================
# S20 / S21 - Manage: SessionNote reports the lock result back to the widget (9/17/26)
# ==========================================================================

write_steps("S20-Steps-ManageSessionNote-capture-seal.fmxmlsnippet.xml", [
    comment("9/17/26: keep Seal If Complete's answer so the widget only shows the note as locked when it really is, "
            "and can say why when it is not."),
    setvar("$seal", "Get ( ScriptResult )"),
])

SAVE_PROGRESS = """JSONSetElement ( "{}"
	; [ "saveId" ; $saveId ; JSONString ]
	; [ "seq" ; $seq ; JSONNumber ]
	; [ "step" ; $step ; JSONString ]
	; [ "ok" ; If ( $err = 0 ; 1 ; 0 ) ; JSONBoolean ]
	; [ "error" ; $err ; JSONNumber ]
	; [ "skipped" ; Substitute ( $skipped ; Char ( 13 ) ; ", " ) ; JSONString ]
	; [ "message" ; If ( $err = 0 ; "" ;
			"FileMaker error " & $err
			& If ( IsEmpty ( $errDetail ) ; "" ; " on " & $errDetail )
			& ". Your changes are still on screen - try saving again." ) ; JSONString ]
	; [ "seal" ; If ( Left ( $seal ; 1 ) = "{" ; $seal ; "{}" ) ; JSONObject ]
)"""

write_steps("S21-Steps-ManageSessionNote-saveProgress.fmxmlsnippet.xml", [
    comment("Report this step back to the web viewer. \"seal\" is only filled on the commit step (9/17/26)."),
    pjs("saveProgress", SAVE_PROGRESS),
])

for name, n in F.written:
    print(f"{n:4d}  {name}")
