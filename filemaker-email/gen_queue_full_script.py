"""10/23/26: whole "Server - Process Session Note Email Queue" (script 178) as one paste.
Built from the last correct version in a DDR (default: DDR 20261022) with only the main Perform Find
swapped for E04 (adds Waiting for Sync). Every other step is the DDR's own XML minus StepText /
DisplayCalculation, so it pastes back unchanged.
Run: python3 gen_queue_full_script.py [path/to/EISKids_fmp12.xml]
Paste: open the script, Select All steps, Delete, then Paste."""
import os
import re
import subprocess
import sys
import xml.etree.ElementTree as ET

import gen_email_snippets as G  # also writes E01-E05, harmless

HERE = os.path.dirname(os.path.abspath(__file__))
DDR = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    HERE, "..", "..", "..", "DDRs", "20261022", "EISKids_fmp12.xml")
OUT = "E06-FULL-Script-EmailQueue.fmxmlsnippet.xml"

raw = open(DDR, "rb").read()
text = raw.decode("utf-16") if raw[:2] in (b"\xff\xfe", b"\xfe\xff") else raw.decode("utf-8")
cat = text[text.find("<ScriptCatalog"):]
body = re.search(r'<Script [^>]*id="178" name="[^"]*">(.*?)\n\t*</Script>', cat, re.S).group(1)
steps = re.findall(r"<Step [^>]*>.*?</Step>", body, re.S)


def clean(step):
    step = re.sub(r"\s*<StepText>.*?</StepText>", "", step, flags=re.S)
    step = re.sub(r"\s*<DisplayCalculation>.*?</DisplayCalculation>", "", step, flags=re.S)
    return re.sub(r">\s+<", "><", step)


finds = [i for i, s in enumerate(steps) if 'name="Perform Find"' in s]
assert len(finds) == 2 and "==Sending" in steps[finds[0]], "expected the 10/1/26 Sending find, then the main find"
main = finds[1]
assert "==Failed" in steps[main] and "Waiting for Sync" not in steps[main]

out = [clean(s) for s in steps[:main]] + G.e04 + [clean(s) for s in steps[main + 1:]]
# Keep the description in step with the find.
out[0] = out[0].replace("( emailStatus is empty OR ( emailStatus = Failed AND emailAttempts &lt; 3 ) )",
                        "( emailStatus is empty OR Waiting for Sync OR ( emailStatus = Failed AND emailAttempts &lt; 3 ) )")
assert "Waiting for Sync OR" in out[0], "description text changed - update the replace above"

G.F.write_steps(OUT, out)
ET.parse(os.path.join(HERE, OUT))
print(f"{OUT}: {len(out)} steps (DDR had {len(steps)})")
