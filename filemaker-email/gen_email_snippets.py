"""Email queue fixes (10/1/26): stuck "Sending" recovery + post-sync send via PSoS.
10/23/26: "Waiting for Sync" status for notes sealed on an offline (MirrorSync) copy (E03-E05).
Run: python3 gen_email_snippets.py  -> writes E01-E05 fmxmlsnippet files next to this script."""
import os
import fmsnippet as F
from fmsnippet import *  # noqa: F401,F403

F.OUT = os.path.dirname(os.path.abspath(__file__))
F.SNF.update({"emailStatus": 120, "emailSentTS": 121, "emailSentTo": 122, "emailResult": 123,
              "emailAttempts": 124, "zzModificationTimestamp": 4, "voidedTS": 110,
              "awaitingSupervisor": 115})

STALE = 900  # seconds a note may sit on Sending before it is treated as interrupted

def psos(name, sid, calc):
    return step(164, "Perform Script on Server",
                f'<WaitForCompletion state="False"/><Calculation>{cdata(calc)}</Calculation>'
                f'<Script id="{sid}" name="{name}"/>')

def performscript_id(name, sid, calc):
    return step(1, "Perform Script",
                f'<Calculation>{cdata(calc)}</Calculation><Script id="{sid}" name="{name}"/>')

# ---------------------------------------------------------------------------
# E01 - Server - Process Session Note Email Queue: paste BELOW
#       Go to Layout [ "SessionNote" (SessionNote) ]  (above the main Perform Find)
# ---------------------------------------------------------------------------
e01 = [
    comment("10/1/26: recover notes stuck on Sending. The send script commits Sending before it rebuilds the "
            "PDF and sends; if that run is cut off (e.g. the MirrorSync Data API session ends mid-send) the note "
            "stays on Sending forever, because neither this queue nor the send script will pick it up. Anything "
            f"on Sending for more than {STALE // 60} minutes is marked Failed so the normal retry below "
            "(emailAttempts < 3) sends it. Records someone has open are left for the next run."),
    perform_find([("Include", [(SN, "status", "==Final"), (SN, "emailStatus", "==Sending")])]),
    if_("Get ( FoundCount ) > 0"),
    goto_record("First"),
    loop(),
    if_(f"Get ( CurrentTimestamp ) - SessionNote::zzModificationTimestamp > {STALE}"),
    setfield(SN, "emailStatus", '"Failed"'),
    setfield(SN, "emailResult",
             'Get ( CurrentTimestamp ) & " - attempt " & SessionNote::emailAttempts & '
             '": interrupted before it finished (left as Sending since " & SessionNote::zzModificationTimestamp & '
             '") - queued for retry"'),
    commit(),
    endif(),
    goto_record("Next", exit_after_last=True),
    endloop(),
    endif(),
    comment("--- end 10/1/26 stuck-Sending recovery ---"),
]
write_steps("E01-Steps-EmailQueue-recover-stuck-Sending.fmxmlsnippet.xml", e01)

# ---------------------------------------------------------------------------
# E02 - MirrorSync 6 (Session Notes), Hub > DidSync: REPLACES the existing
#       Perform Script [ "Server - Process Session Note Email Queue" ... ] step
#       (keep the Set Variable $msLayout above it and the Go to Layout below it)
# ---------------------------------------------------------------------------
q_param = 'JSONSetElement ( "" ; ["limit";25;JSONNumber] )'
e02 = [
    comment("10/1/26: run the queue in its own server session (no wait). Running it inline tied every PDF rebuild "
            "and send to MirrorSync's Data API session - when that session ended mid-send the note was left on "
            "Sending (9/24 and 10/1 notes). If PSoS is refused here, fall back to running it inline."),
    psos("Server - Process Session Note Email Queue", 178, q_param),
    if_("Get ( LastError ) ≠ 0"),
    performscript_id("Server - Process Session Note Email Queue", 178, q_param),
    endif(),
]
write_steps("E02-Steps-MirrorSync-DidSync-queue-PSoS.fmxmlsnippet.xml", e02)

# ---------------------------------------------------------------------------
# 10/23/26 - "Waiting for Sync"
# A note sealed on the iPad's offline (MirrorSync) copy cannot be emailed until it syncs: the
# PSoS in "Send Family Email Now" has no host, so nothing on the note said the email was pending
# and testers sent it by hand (Draper / Stephany 10/22). The device now marks it Waiting for Sync;
# the queue and the send script treat that like blank, so the first run after the sync sends it.
# ---------------------------------------------------------------------------
WAITING = "Waiting for Sync"

# E03 - SessionNote: Send Family Email Now: REPLACES everything from
#       If [ $onServer ]  through its  End If  (keep Exit Script [ Get ( ScriptResult ) ] below)
email_state_js = ('JSONSetElement ( "{}" ; ["emailStatus";SessionNote::emailStatus;JSONString] ; '
                  '["emailSentTS";GetAsText ( SessionNote::emailSentTS );JSONString] ; '
                  '["emailSentTo";SessionNote::emailSentTo;JSONString] )')
e03 = [
    if_("$onServer"),
    performscript_id("SessionNote: Email Sealed PDF (Server)", 177, "$param"),
    elseif("Get ( MultiUserState ) = 0"),
    comment(f"10/23/26: offline copy (MirrorSync) - there is no server to hand the send to. Mark the note "
            f"{WAITING} so the interventionist can see the email is pending; the email queue sends it on the "
            "first run after this note syncs. Left alone if the Email PDF button already marked it Sent."),
    if_('SessionNote::__ID = JSONGetElement ( $param ; "id" ) and IsEmpty ( SessionNote::emailStatus )'),
    setfield(SN, "emailStatus", f'"{WAITING}"'),
    setfield(SN, "emailResult",
             'Get ( CurrentTimestamp ) & " - sealed offline on " & Get ( AccountName ) & '
             '"\'s device; the family email goes out after the next sync"'),
    commit(),
    pjs("setEmailStatus", email_state_js),
    endif(),
    exitscript('JSONSetElement ( "" ; ["sent";False;JSONBoolean] ; ["reason";"offline - waiting for sync";JSONString] ; '
               '["waitingForSync";True;JSONBoolean] ; ["id";JSONGetElement ( $param ; "id" );JSONString] )'),
    else_(),
    psos("SessionNote: Email Sealed PDF (Server)", 177, "$param"),
    endif(),
]
write_steps("E03-Steps-SendNow-offline-Waiting-for-Sync.fmxmlsnippet.xml", e03)

# E04 - Server - Process Session Note Email Queue: REPLACES the main Perform Find
#       (the one right after "--- end 10/1/26 stuck-Sending recovery ---")
e04 = [
    comment(f"10/23/26: also picks up {WAITING} - notes sealed offline that have now synced."),
    perform_find([
        ("Include", [(SN, "status", "==Final"), (SN, "emailStatus", "=")]),
        ("Include", [(SN, "status", "==Final"), (SN, "emailStatus", "==Failed"), (SN, "emailAttempts", "<3")]),
        ("Include", [(SN, "status", "==Final"), (SN, "emailStatus", f'=="{WAITING}"')]),
        ("Exclude", [(SN, "awaitingSupervisor", "1")]),
        ("Exclude", [(SN, "voidedTS", "*")]),
    ]),
]
write_steps("E04-Steps-EmailQueue-find-Waiting-for-Sync.fmxmlsnippet.xml", e04)

# E05 - SessionNote: Email Sealed PDF (Server): REPLACES Set Variable [ $skip ; Case ( ... ) ]
#       Same Case as before; Waiting for Sync no longer falls into the last "any other status" skip.
e05 = [
    comment(f"10/23/26: {WAITING} (sealed offline, now synced) sends like a blank status."),
    setvar("$skip", f'''Case (
  SessionNote::status ≠ "Final" ; "not sealed" ;
  not IsEmpty ( SessionNote::voidedTS ) ; "voided" ;
  SessionNote::awaitingSupervisor = 1 ; "awaiting supervisor signature" ;
  $force ; "" ;
  SessionNote::emailStatus = "Sent" ; "already sent" ;
  SessionNote::emailStatus = "Sending" ; "a send is already in progress" ;
  SessionNote::emailStatus = "Failed" and SessionNote::emailAttempts ≥ $maxAttempts ; "stopped after " & $maxAttempts & " failed attempts" ;
  not IsEmpty ( SessionNote::emailStatus ) and SessionNote::emailStatus ≠ "Failed" and SessionNote::emailStatus ≠ "{WAITING}" ; SessionNote::emailStatus ;
  ""
)'''),
]
write_steps("E05-Steps-EmailSealedPDF-skip-allows-Waiting-for-Sync.fmxmlsnippet.xml", e05)

# E04-FIX (10/23/26) - E04 was pasted over the stuck-Sending Find at the top of the queue instead of the
#       main Find. This puts the recovery Find back: in the queue, select the 10/23 comment + Perform Find
#       right below Go to Layout [ "SessionNote" ], delete them, and paste this in their place. Then delete
#       the old main Perform Find (below "--- end 10/1/26 stuck-Sending recovery ---") and paste E04 there.
write_steps("E04-FIX-Steps-EmailQueue-restore-stuck-Sending-find.fmxmlsnippet.xml", e01[:2])

# E04-FIX-BLOCK (10/23/26) - simpler than E04-FIX + E04: REPLACES, in the queue, everything from the
#       10/23 comment + Perform Find below Go to Layout [ "SessionNote" ] down through the old main
#       Perform Find below "--- end 10/1/26 stuck-Sending recovery ---" (keep the If [ Get ( LastError ) = 401 ...
#       that follows it). Recovery Find on Sending first, then the main Find with Waiting for Sync.
write_steps("E04-FIX-BLOCK-Steps-EmailQueue-recovery-plus-main-find.fmxmlsnippet.xml", e01 + e04)

for f, n in F.written:
    print(f"{f}: {n} steps")
