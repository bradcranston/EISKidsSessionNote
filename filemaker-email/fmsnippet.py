"""Shared fmxmlsnippet step builders (copied from filemaker-revisions/gen_revision_snippets.py). Set fmsnippet.OUT before writing."""
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
