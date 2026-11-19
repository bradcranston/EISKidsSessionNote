// Session Note Form Handler
const form = document.getElementById('sessionNoteForm');
const sessionStartTime = document.getElementById('sessionStartTime');
const sessionEndTime = document.getElementById('sessionEndTime');
const totalMinutes = document.getElementById('totalMinutes');

// Dirty-state tracking — show/hide floating save bar
let isDirty = false;

function markDirty() {
  if (isDirty) return;
  isDirty = true;
  const bar = document.getElementById('floatingSaveBar');
  if (bar) bar.classList.add('visible');
}

function markClean() {
  isDirty = false;
  // Saved or freshly loaded, so no pad is holding ink that isn't on the note
  draftState.ink = {};
  draftState.inkStale = {};
  const bar = document.getElementById('floatingSaveBar');
  if (bar) bar.classList.remove('visible');
}

// ===== DRAFTS (11/5/26) =====
// Everything typed lives only in this page until Save, so when the web viewer
// reloads it is gone (Stephanie Wilson lost a note twice on 11/5/26 tapping
// Time of Next Session). While the user types, a copy goes to FileMaker's
// SessionNote: Draft:
//  - hold: after each pause in typing. Kept in a FileMaker variable - no
//    commit, no focus change - and survives the page reloading.
//  - store: only once no field has focus (or the page is being hidden). Also
//    written to the NoteDraft table and committed, so it survives FileMaker Go
//    closing. A commit while a field has focus could take the keyboard away.
// Only when Manage: SessionNote load says draftsSupported, so an offline file
// that has no SessionNote: Draft yet never receives these calls.
// 11/9/26: signatures were left out as large and quick to redo, but a caregiver
// may be gone by the time a reload is noticed (Leah Carone, 11/9/26: signed note
// came back as an incomplete draft). A pad drawn on since the last save now
// goes in draft.signatures, apart from draft.fields. A signature already on the
// saved note is never copied into a draft, so drafts stay small.
const DRAFT_SCRIPT = 'SessionNote: Draft';
const DRAFT_HOLD_DELAY_MS = 1500;
const DRAFT_STORE_DELAY_MS = 1000;
// 11/16/26: how long the pen must stay up on an open pad before its ink is
// stored. Emily Russell's FileMaker crashed on 11/12/26 with the caregiver pad
// still open; the ink was only held in memory, so Restore brought back the
// note without it.
const DRAFT_PEN_IDLE_STORE_MS = 2000;
const DRAFT_EXCLUDED_KEYS = ['eISignatureBase64', 'parentSignatureBase64'];
const DRAFT_SIGNATURE_PADS = { eISignature: 'eISignatureBase64', parentSignature: 'parentSignatureBase64' };

const draftState = {
  enabled: false,
  noteId: '',
  holdTimer: null,
  storeTimer: null,
  penIdleTimer: null,
  penDown: false,  // a finger or pen is on a signature pad right now
  lastSent: '',    // fields JSON last handed to FileMaker
  lastStored: '',  // fields JSON last written to NoteDraft
  pending: null,   // { draft, source } shown on the restore banner
  goals: [],       // goal list from the last load, to rebuild the pills on restore
  ink: {},         // signature field -> image, only for ink not yet saved
  inkStale: {},    // pad id -> true when strokes were added since ink was read
};

function callDraftScript(mode, extra) {
  if (!window.FileMaker || !draftState.noteId) return;
  const param = JSON.stringify(Object.assign({ mode, noteId: draftState.noteId }, extra || {}));
  try {
    // 5 = suspend and resume: never cancels or queues behind a running script
    if (typeof window.FileMaker.PerformScriptWithOption === 'function') {
      window.FileMaker.PerformScriptWithOption(DRAFT_SCRIPT, param, '5');
    } else {
      window.FileMaker.PerformScript(DRAFT_SCRIPT, param);
    }
  } catch (err) {
    console.log('Draft call failed:', err);
  }
}

function getDraftFields() {
  const data = getFormData();
  DRAFT_EXCLUDED_KEYS.forEach(key => delete data[key]);
  return data;
}

// Read a pad only when it has new strokes - encoding one means scanning it.
function refreshDraftInk() {
  Object.keys(draftState.inkStale).forEach(canvasId => {
    const key = DRAFT_SIGNATURE_PADS[canvasId];
    const value = getSignatureAsBase64(canvasId);
    if (value) draftState.ink[key] = value;
    else delete draftState.ink[key];
  });
  draftState.inkStale = {};
}

function getDraftPayload() {
  refreshDraftInk();
  const payload = { fields: getDraftFields() };
  if (Object.keys(draftState.ink).length > 0) {
    payload.signatures = Object.assign({}, draftState.ink);
  }
  return payload;
}

function noteSignatureDrawn(canvasId) {
  if (!DRAFT_SIGNATURE_PADS[canvasId]) return;
  draftState.inkStale[canvasId] = true;
  scheduleDraft();
  schedulePenIdleStore();
}

function notePenDown() {
  draftState.penDown = true;
  clearTimeout(draftState.penIdleTimer);
}

function notePenUp() {
  draftState.penDown = false;
}

// Stores normally wait for the pad to close, because a store commits. A signer
// who stops and hands the iPad back may leave it open, so once the pen has
// been up a while the ink is stored anyway. A new stroke cancels the wait.
function schedulePenIdleStore() {
  clearTimeout(draftState.penIdleTimer);
  draftState.penIdleTimer = setTimeout(() => {
    if (draftState.penDown || fieldHasFocus()) return;
    sendDraft('store');
  }, DRAFT_PEN_IDLE_STORE_MS);
}

function noteSignatureCleared(canvasId) {
  if (!DRAFT_SIGNATURE_PADS[canvasId]) return;
  delete draftState.inkStale[canvasId];
  delete draftState.ink[DRAFT_SIGNATURE_PADS[canvasId]];
  scheduleDraft();
}

function signaturePadActive() {
  return Object.keys(DRAFT_SIGNATURE_PADS).some(id => {
    const pad = document.getElementById(id);
    return !!pad && !!pad._active;
  });
}

// Typing while the restore banner is up is protected too. That replaces the
// older draft, but its offered SaveJournal row already keeps a copy on the
// server, and Restore still works from draftState.pending.
function draftsActive() {
  return draftState.enabled && isDirty
    && !document.body.classList.contains('view-only') && !isSaveInProgress();
}

function fieldHasFocus() {
  const el = document.activeElement;
  return !!el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
}

function sendDraft(mode) {
  if (!draftsActive()) return;
  const payload = getDraftPayload();
  const json = JSON.stringify(payload);
  if (mode === 'hold' && json === draftState.lastSent) return;
  if (mode === 'store' && json === draftState.lastStored) return;
  callDraftScript(mode, { draft: Object.assign({ noteId: draftState.noteId, savedAt: Date.now() }, payload) });
  draftState.lastSent = json;
  if (mode === 'store') draftState.lastStored = json;
}

function scheduleDraftStore() {
  clearTimeout(draftState.storeTimer);
  draftState.storeTimer = setTimeout(() => {
    // A store commits, which must not land mid-signature. Hold already has the
    // ink. The next focusout, or the pad closing, tries again.
    if (fieldHasFocus() || signaturePadActive()) return;
    sendDraft('store');
  }, DRAFT_STORE_DELAY_MS);
}

function scheduleDraft() {
  if (!draftsActive()) return;
  clearTimeout(draftState.holdTimer);
  draftState.holdTimer = setTimeout(() => {
    sendDraft('hold');
    scheduleDraftStore();
  }, DRAFT_HOLD_DELAY_MS);
}

function cancelDraftTimers() {
  clearTimeout(draftState.holdTimer);
  clearTimeout(draftState.storeTimer);
  clearTimeout(draftState.penIdleTimer);
}

// The page is going away or into the background: store now, focus or not.
function flushDraft() {
  cancelDraftTimers();
  sendDraft('store');
}

function hideDraftBanner() {
  const banner = document.getElementById('draftBanner');
  if (banner) banner.hidden = true;
}

function showDraftBanner(draft, changedCount, signatureCount) {
  const banner = document.getElementById('draftBanner');
  if (!banner) return;
  const when = new Date(Number(draft.savedAt) || 0);
  const whenText = isNaN(when.getTime()) || !draft.savedAt ? '' :
    when.toLocaleString([], { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const detail = document.getElementById('draftBannerDetail');
  if (detail) {
    const parts = [];
    if (changedCount > 0) {
      parts.push(changedCount + (changedCount === 1 ? ' field differs' : ' fields differ') + ' from the saved note');
    }
    if (signatureCount > 0) {
      parts.push(signatureCount + (signatureCount === 1 ? ' signature was' : ' signatures were') + ' not saved');
    }
    detail.textContent = 'This note has changes that were never saved'
      + (whenText ? ' (last edited ' + whenText + ')' : '')
      + ' - ' + parts.join(', ') + '.'
      + ' Restore puts them back in the form; tap Save Session Note afterwards to keep them.';
  }
  banner.hidden = false;
}

// Called at the end of populateForm, once the form shows the saved note.
function setupDrafts(data, isLocked) {
  hideDraftBanner();
  cancelDraftTimers();
  draftState.noteId = data.noteId || '';
  draftState.enabled = isTruthy(data.draftsSupported) && !!draftState.noteId;
  draftState.lastSent = '';
  draftState.lastStored = '';
  draftState.pending = null;
  draftState.goals = Array.isArray(data.goals) ? data.goals : [];
  if (!draftState.enabled || isLocked) return;

  const draft = data.draft && typeof data.draft === 'object' ? data.draft : null;
  if (!draft || !draft.fields || typeof draft.fields !== 'object') return;

  // Compare only what the draft holds - that is all Restore would change
  const saved = getDraftFields();
  let changed = 0;
  Object.keys(draft.fields).forEach(key => {
    if (DRAFT_EXCLUDED_KEYS.includes(key)) return;
    const a = draft.fields[key] === undefined || draft.fields[key] === null ? '' : String(draft.fields[key]);
    const b = saved[key] === undefined || saved[key] === null ? '' : String(saved[key]);
    if (a !== b) changed += 1;
  });

  const draftInk = draft.signatures && typeof draft.signatures === 'object' ? draft.signatures : {};
  const unsavedSignatures = Object.values(DRAFT_SIGNATURE_PADS)
    .filter(key => draftInk[key] && draftInk[key] !== (data[key] || '')).length;

  if (changed === 0 && unsavedSignatures === 0) {
    // Nothing the saved note doesn't already have - drop it quietly.
    callDraftScript('clear');
    return;
  }

  draftState.pending = { draft, source: data.draftSource || '' };
  showDraftBanner(draft, changed, unsavedSignatures);
  callDraftScript('offered', { draft, source: draftState.pending.source });
}

function restoreDraft() {
  const pending = draftState.pending;
  if (!pending) return;
  const fields = pending.draft.fields;
  applyFieldValues(fields);

  // Goals are pills over a hidden input - rebuild them from the restored value
  if (draftState.goals.length > 0) {
    const selected = String(fields.ifspOutcomes || '').split(', ').filter(g => draftState.goals.includes(g));
    buildGoalsPillSelect('ifspOutcomesContainer', 'ifspOutcomes', draftState.goals, selected);
  }
  ['outcomeUpdates_q1', 'outcomeUpdates_q2'].forEach(id => {
    const el = document.getElementById(id);
    if (el) autoResizeSubfield(el);
  });
  calculateUnitsFromTime();
  handleSessionTypeChange();
  handleLocationChange();
  handleSessionStatusChange();
  checkNextSessionDate();
  syncPresentWidget();

  // Signatures last, once any pad the restored status reveals is showing.
  // Drawing one never triggers the caregiver auto-lock; Save is still the
  // user's step. Kept as unsaved ink so a second reload can't lose it.
  const restoredInk = pending.draft.signatures && typeof pending.draft.signatures === 'object'
    ? pending.draft.signatures : {};
  Object.keys(DRAFT_SIGNATURE_PADS).forEach(canvasId => {
    const key = DRAFT_SIGNATURE_PADS[canvasId];
    if (!restoredInk[key]) return;
    const pad = document.getElementById(canvasId);
    if (pad) pad._cleared = false;
    loadSignatureFromBase64(canvasId, restoredInk[key]);
    draftState.ink[key] = restoredInk[key];
  });

  hideDraftBanner();
  draftState.pending = null;
  callDraftScript('restored', { draft: pending.draft, source: pending.source });
  // Still unsaved: show the save bar, and FileMaker already holds this draft
  markDirty();
  draftState.lastSent = JSON.stringify(getDraftPayload());
  draftState.lastStored = pending.source === 'table' ? draftState.lastSent : '';
  scheduleDraftStore();
}

function discardDraft() {
  const pending = draftState.pending;
  if (!pending) return;
  hideDraftBanner();
  draftState.pending = null;
  callDraftScript('discarded', { draft: pending.draft, source: pending.source });
}

// Call the 'Manage: Document' FileMaker script with a mode parameter
function callManageDocument(mode) {
  const scriptParam = JSON.stringify({ mode });
  if (window.FileMaker) {
    window.FileMaker.PerformScript('Manage: Document', scriptParam);
  } else {
    console.log('FileMaker not detected. Manage: Document would be called with:', scriptParam);
  }
}

// Show/hide the online-only document actions (Email PDF, Create PDF)
function setDocumentActionsOnlineState(online) {
  document.querySelectorAll('.btn-doc-online').forEach(btn => {
    btn.hidden = !online;
  });
}

// If there are unsaved changes, offer to save before running a document action
let pendingDocumentAction = null;

function withUnsavedChangesCheck(action) {
  if (isDirty) {
    pendingDocumentAction = action;
    const modal = document.getElementById('unsavedChangesModal');
    if (modal) modal.classList.add('visible');
  } else {
    action();
  }
}

// Set when the user answered "save first" - the document action then waits for
// the save to actually finish. The save is several FileMaker round trips now,
// so running the action straight after triggerSave() would close the window out
// from under a save that is still on step 1 of 4.
let runPendingActionAfterSave = false;

function runPendingDocumentAction() {
  if (!pendingDocumentAction) return;
  const action = pendingDocumentAction;
  pendingDocumentAction = null;
  action();
}

function resolvePendingDocumentAction(shouldSave) {
  const modal = document.getElementById('unsavedChangesModal');
  if (modal) modal.classList.remove('visible');

  if (shouldSave) {
    runPendingActionAfterSave = true;
    window.triggerSave();
    return;
  }

  runPendingDocumentAction();
}

// FileMaker WebViewer on iPad intercepts spacebar and arrow keys at the native
// layer before they reach web content. Using capture-phase stopPropagation
// prevents FileMaker from swallowing these keys so they work in input fields.
document.addEventListener('keydown', (e) => {
  const intercepted = [' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
  if (intercepted.includes(e.key)) {
    e.stopPropagation();
  }
}, true);

// Today's date on the device, as YYYY-MM-DD in LOCAL time.
// Never use toISOString() for this: it gives the UTC date, which is already
// tomorrow after 7 PM Eastern (8 PM during daylight saving). That made evening
// notes default to the next day and the finalize check say "Today" was tomorrow
// (tickets 128160 / 128161, 11/18/26).
function localDateString(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Initialize form
document.addEventListener('DOMContentLoaded', () => {
  console.log('EIS Session Note Form Loaded');

  // Set default date to today
  const sessionDate = document.getElementById('sessionDate');
  if (sessionDate && !sessionDate.value) {
    sessionDate.value = localDateString();
  }
  
  // Initialize signature pads
  initializeSignaturePad('eISignature', 'clearSignature');
  initializeSignaturePad('parentSignature', 'clearParentSignature');
  initializeSignaturePad('supervisorSignature', 'clearSupervisorSignature');

  // Wire up prompt sub-field combining
  setupPromptSubfields();

  // Load any saved data from FileMaker if available
  loadFormData();

  // Track unsaved changes to show/hide the floating save bar
  form.addEventListener('input', markDirty);
  form.addEventListener('change', markDirty);

  // Drafts (11/5/26) - registered after markDirty so isDirty is already set
  form.addEventListener('input', scheduleDraft);
  form.addEventListener('change', scheduleDraft);
  form.addEventListener('focusout', () => {
    if (draftState.lastSent !== draftState.lastStored) scheduleDraftStore();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushDraft();
  });
  window.addEventListener('pagehide', flushDraft);
  const draftRestoreBtn = document.getElementById('draftRestoreBtn');
  if (draftRestoreBtn) draftRestoreBtn.addEventListener('click', restoreDraft);
  const draftDiscardBtn = document.getElementById('draftDiscardBtn');
  if (draftDiscardBtn) draftDiscardBtn.addEventListener('click', discardDraft);

  // Mark dirty when drawing on signature canvases
  ['eISignature', 'parentSignature'].forEach(id => {
    const canvas = document.getElementById(id);
    if (canvas) {
      canvas.addEventListener('mousedown', markDirty);
      canvas.addEventListener('touchstart', markDirty);
    }
  });

  // Show/hide cancellation section based on session status
  const sessionStatusInput = document.getElementById('sessionStatus');
  if (sessionStatusInput) {
    sessionStatusInput.addEventListener('change', handleSessionStatusChange);
    sessionStatusInput.addEventListener('input', handleSessionStatusChange);
  }

  // Mirror the cancellation/absence description into "What we did today"
  const cancellationDescriptionInput = document.getElementById('cancellationDescription');
  if (cancellationDescriptionInput) {
    cancellationDescriptionInput.addEventListener('input', syncCancellationToWhatWeDidToday);
  }

  // Update whatWeDidToday placeholder based on session type
  const sessionTypeInput = document.getElementById('sessionType');
  if (sessionTypeInput) {
    sessionTypeInput.addEventListener('change', handleSessionTypeChange);
    sessionTypeInput.addEventListener('input', handleSessionTypeChange);
  }

  // Update whatWeDidToday placeholder based on location
  const locationInput = document.getElementById('location');
  if (locationInput) {
    locationInput.addEventListener('change', handleLocationChange);
    locationInput.addEventListener('input', handleLocationChange);
  }

  // Wire up Present widget — re-sync when any contributing field changes
  ['eIFirstName', 'eILastName', 'clientFirstName'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', syncPresentWidget);
      el.addEventListener('change', syncPresentWidget);
    }
  });
  document.querySelectorAll('input[name="childPresentStatus"]').forEach(r =>
    r.addEventListener('change', syncPresentWidget)
  );
  document.querySelectorAll('input[name="teamingPreApproved"]').forEach(r =>
    r.addEventListener('change', syncPresentWidget)
  );
  const childAbsentReasonEl = document.getElementById('childAbsentReason');
  if (childAbsentReasonEl) childAbsentReasonEl.addEventListener('input', syncPresentWidget);
  const othersPresentEl = document.getElementById('othersPresent');
  if (othersPresentEl) othersPresentEl.addEventListener('input', syncPresentWidget);

  syncPresentWidget();

  // Wire up document actions toolbar
  const closeDocBtn = document.getElementById('closeDocBtn');
  if (closeDocBtn) closeDocBtn.addEventListener('click', () => withUnsavedChangesCheck(() => callManageDocument('close')));
  const emailPdfBtn = document.getElementById('emailPdfBtn');
  if (emailPdfBtn) emailPdfBtn.addEventListener('click', () => withUnsavedChangesCheck(() => callManageDocument('saveEmail')));
  const createPdfBtn = document.getElementById('createPdfBtn');
  if (createPdfBtn) createPdfBtn.addEventListener('click', () => withUnsavedChangesCheck(() => callManageDocument('save')));
  // Caregiver signature link (tele sessions). Sending the link is the remote
  // equivalent of handing over the iPad, so it passes the same gate as the
  // caregiver pad: EI signed and everything else valid. The note is always saved
  // first so FileMaker holds awaitingSignaturesOnly = true - that flag is what
  // lets the note lock when the caregiver signs through the link.
  // The supervisor link button was removed 9/16/26; supervisors sign in the note.
  const parentLinkBtn = document.getElementById('copyParentSignatureLinkBtn');
  if (parentLinkBtn) {
    parentLinkBtn.addEventListener('click', () => {
      if (isSaveInProgress()) return;
      if (!canStartCaregiverSignature()) return;
      pendingDocumentAction = () => {
        clearValidationErrors();
        callManageDocument('copyParentSignatureLink');
        const toast = document.getElementById('copyLinkToast');
        if (toast) {
          toast.textContent = '\u{1F517} Caregiver signature link copied';
          toast.classList.add('show');
          setTimeout(() => toast.classList.remove('show'), 3000);
        }
      };
      runPendingActionAfterSave = true;
      window.triggerSave();
    });
  }

  // Supervisor signature (assigned supervisor only - see applySupervisorState)
  const supervisorSignBtn = document.getElementById('supervisorSignBtn');
  if (supervisorSignBtn) supervisorSignBtn.addEventListener('click', submitSupervisorSignature);

  // Wire up unsaved changes modal buttons
  const unsavedSaveBtn = document.getElementById('unsavedChangesSaveBtn');
  if (unsavedSaveBtn) unsavedSaveBtn.addEventListener('click', () => resolvePendingDocumentAction(true));
  const unsavedCancelBtn = document.getElementById('unsavedChangesCancelBtn');
  if (unsavedCancelBtn) unsavedCancelBtn.addEventListener('click', () => resolvePendingDocumentAction(false));

  // Wire up refresh button and its confirmation modal
  const refreshBtn = document.getElementById('refreshBtn');
  if (refreshBtn) refreshBtn.addEventListener('click', handleRefreshClick);
  const refreshConfirmSaveBtn = document.getElementById('refreshConfirmSaveBtn');
  if (refreshConfirmSaveBtn) refreshConfirmSaveBtn.addEventListener('click', () => {
    hideRefreshConfirmModal();
    window.triggerSave();
  });
  const refreshConfirmDiscardBtn = document.getElementById('refreshConfirmDiscardBtn');
  if (refreshConfirmDiscardBtn) refreshConfirmDiscardBtn.addEventListener('click', () => {
    hideRefreshConfirmModal();
    // The user threw these changes away - don't offer them back on reload
    cancelDraftTimers();
    callDraftScript('clear');
    loadFormData();
  });

  // Check & Lock - why is this note not locked, and lock it if it passes
  const lockCheckBtn = document.getElementById('lockCheckBtn');
  if (lockCheckBtn) lockCheckBtn.addEventListener('click', runLockCheck);
  const lockCheckCloseBtn = document.getElementById('lockCheckCloseBtn');
  if (lockCheckCloseBtn) lockCheckCloseBtn.addEventListener('click', hideLockCheck);
  const lockCheckLockBtn = document.getElementById('lockCheckLockBtn');
  if (lockCheckLockBtn) lockCheckLockBtn.addEventListener('click', () => {
    hideLockCheck();
    window.triggerSave();
  });

  // Revise Note - voids this Final note and opens a copy to correct
  const reviseNoteBtn = document.getElementById('reviseNoteBtn');
  if (reviseNoteBtn) reviseNoteBtn.addEventListener('click', showReviseModal);
  const reviseCancelBtn = document.getElementById('reviseCancelBtn');
  if (reviseCancelBtn) reviseCancelBtn.addEventListener('click', hideReviseModal);
  const reviseConfirmBtn = document.getElementById('reviseConfirmBtn');
  if (reviseConfirmBtn) reviseConfirmBtn.addEventListener('click', confirmRevision);

  // Online-only actions are hidden until FileMaker reports online status
  setDocumentActionsOnlineState(false);
});

// ===== SIGNATURE GATES & LOCKING (9/16/26) =====

function currentSessionStatus() {
  const el = document.getElementById('sessionStatus');
  return el ? el.value.trim() : '';
}

function scrollToValidationSummary() {
  const summary = document.getElementById('validationSummary');
  if (summary && summary.style.display !== 'none') {
    summary.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// The EI may sign once every non-signature requirement passes.
function canStartEISignature() {
  if (document.body.classList.contains('view-only')) return false;
  const ok = validateForm({ skipEISignatureCheck: true, skipParentSignatureCheck: true });
  if (!ok) {
    const eiErr = document.getElementById('eISignatureError');
    if (eiErr) eiErr.textContent = 'Complete the fields listed above before signing.';
    scrollToValidationSummary();
  }
  return ok;
}

// The caregiver may sign (or be sent the link) only on a held session, after
// the EI has signed and everything else passes.
function canStartCaregiverSignature() {
  if (document.body.classList.contains('view-only')) return false;
  const parentErr = document.getElementById('parentSignatureError');
  if (currentSessionStatus() !== 'H - Held') {
    clearValidationErrors();
    if (parentErr) parentErr.textContent = 'A caregiver signature is only needed for held sessions.';
    return false;
  }
  if (isSignatureEmpty('eISignature')) {
    validateForm({ skipParentSignatureCheck: true });
    if (parentErr) parentErr.textContent = 'The interventionist must sign before the caregiver.';
    scrollToValidationSummary();
    return false;
  }
  const ok = validateForm({ skipParentSignatureCheck: true });
  if (!ok) {
    if (parentErr) parentErr.textContent = 'Complete the fields listed above before the caregiver signs.';
    scrollToValidationSummary();
  }
  return ok;
}

// Ink shorter than this (CSS pixels of pen travel) reads as an unfinished
// signature. A full signature is usually well over 300.
const CAREGIVER_MIN_INK = 120;

// 11/10/26: asked when the caregiver's finger leaves the pad. Before this the
// note locked at once, so a finger that slid below the box mid-signature
// finalized the note with half a signature (Tiffany Gerba, 11/9/26).
function askCaregiverFinished(inkLength, resumeSigning) {
  if (isSaveInProgress() || document.body.classList.contains('view-only')) return;
  const modal = document.getElementById('caregiverDoneModal');
  if (!modal) {
    lockAfterCaregiverSignature();
    return;
  }
  // 11/17/26: a dot or tap can't be finalized at all - only Keep Signing
  const tooSmall = isSignatureTooSmall('parentSignature');
  const short = inkLength < CAREGIVER_MIN_INK;
  document.getElementById('caregiverDoneTitle').textContent = tooSmall
    ? 'The caregiver signature is too small'
    : short
      ? 'The caregiver signature looks unfinished'
      : 'Has the caregiver finished signing?';
  document.getElementById('caregiverDoneText').textContent = tooSmall
    ? 'That looks like a dot or a tap, not a signature. Tap Keep Signing and have the caregiver sign their full name.'
    : short
      ? 'Tap Keep Signing to finish it, or Finalize Note if it is complete. Finalizing saves and locks this note.'
      : 'Finalizing saves and locks this note. Tap Keep Signing to go back to the signature.';

  const keepBtn = document.getElementById('caregiverDoneKeepBtn');
  const finalizeBtn = document.getElementById('caregiverDoneFinalizeBtn');
  // style, not [hidden]: the button class sets display and would win
  finalizeBtn.style.display = tooSmall ? 'none' : '';
  // The finger that opened this is still coming up, and its click could land
  // on a button that appeared under it. Hold the buttons briefly.
  keepBtn.disabled = true;
  finalizeBtn.disabled = true;
  setTimeout(() => { keepBtn.disabled = false; finalizeBtn.disabled = false; }, 600);

  keepBtn.onclick = () => {
    modal.classList.remove('visible');
    if (resumeSigning) resumeSigning();
  };
  finalizeBtn.onclick = () => {
    modal.classList.remove('visible');
    lockAfterCaregiverSignature();
  };
  modal.classList.add('visible');
}

// The caregiver has finished signing: save and lock straight away.
function lockAfterCaregiverSignature() {
  if (isSaveInProgress() || document.body.classList.contains('view-only')) return;
  if (!validateForm()) {
    scrollToValidationSummary();
    return;
  }
  window.triggerSave();
}

// ===== CHECK & LOCK (9/17/26) =====
// One header button on an unlocked note. It runs the same validateForm() the
// Save button uses, lists anything outstanding, and offers Lock Note when the
// note passes. The lock itself is an ordinary locking save, so FileMaker's
// Seal If Complete has the final say - and if it refuses, showLockRefused()
// says why instead of the note silently staying unlocked.

function hideLockCheck() {
  const modal = document.getElementById('lockCheckModal');
  if (modal) modal.classList.remove('visible');
}

function showLockPanel(title, text, items, canLock) {
  const modal = document.getElementById('lockCheckModal');
  if (!modal) return;
  document.getElementById('lockCheckTitle').textContent = title;
  document.getElementById('lockCheckText').textContent = text;
  const list = document.getElementById('lockCheckList');
  list.innerHTML = '';
  (items || []).forEach(item => {
    const li = document.createElement('li');
    li.textContent = item;
    list.appendChild(li);
  });
  list.hidden = !items || items.length === 0;
  document.getElementById('lockCheckLockBtn').hidden = !canLock;
  modal.classList.add('visible');
}

function runLockCheck() {
  if (isSaveInProgress()) return;
  if (document.body.classList.contains('view-only')) {
    showLockPanel('This note is locked', 'Nothing more is needed.', [], false);
    return;
  }
  const ok = validateForm();
  if (ok) {
    clearValidationErrors();
    showLockPanel(
      'Ready to lock',
      'Everything required is complete. Locking saves the note and it can no longer be edited.',
      [],
      true
    );
    return;
  }
  const status = currentSessionStatus();
  const text = !status
    ? 'Choose a Session Status first - the requirements depend on it.'
    : 'This note can lock once these are done. They are also marked on the form.';
  showLockPanel('Not ready to lock', text, lastValidationErrors.slice(), false);
}

function showLockRefused(seal) {
  const reason = String(seal.reason || '');
  const missing = String(seal.missing || '').split(',').map(s => s.trim()).filter(Boolean);
  let text;
  if (reason === 'awaiting signatures') {
    text = 'The note was saved, but FileMaker did not lock it because these signatures did not reach it. Check they are still showing, then save again.';
  } else if (reason.indexOf('non-signature requirements') !== -1) {
    text = 'The note was saved, but FileMaker did not accept it as complete. Tap Check & Lock to try again.';
  } else {
    text = 'The note was saved, but FileMaker did not lock it' + (reason ? ' (' + reason + ')' : '') + '.';
  }
  showLockPanel('Saved - not locked', text, missing, false);
}

// ===== SUPERVISOR SIGNATURE =====

function isTruthy(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function applySupervisorState(data) {
  const section = document.getElementById('supervisorSection');
  if (!section) return;
  const awaiting = isTruthy(data.awaitingSupervisor);
  const signature = data.supervisorSignatureBase64 || '';
  const signed = !awaiting && !!signature;
  const isMine = !!data.currentUserId && data.currentUserId === data.supervisorUserId;

  section.hidden = !awaiting && !signed;

  const signedBox = document.getElementById('supSigSigned');
  if (signedBox) {
    signedBox.hidden = !signed;
    const img = document.getElementById('supSigImage');
    if (img && signed) img.src = signature;
    const by = document.getElementById('supSigSignedBy');
    if (by && signed) {
      const who = [data.supervisorName, data.supervisorCredentials].filter(Boolean).join(', ');
      const when = data.supervisorSignedTS ? String(data.supervisorSignedTS).split(' ')[0] : '';
      by.textContent = (who ? 'Signed by ' + who : 'Signed') + (when ? ' on ' + when : '');
    }
  }

  const waiting = document.getElementById('supSigWaiting');
  if (waiting) {
    waiting.hidden = !(awaiting && !isMine);
    waiting.textContent = 'Waiting on the supervisor signature'
      + (data.supervisorAssignedName ? ' (' + data.supervisorAssignedName + ')' : '') + '.';
  }

  const area = document.getElementById('supSigArea');
  if (area) {
    area.hidden = !(awaiting && isMine);
    const canvas = document.getElementById('supervisorSignature');
    if (canvas && !area.hidden) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (canvas._deactivate) canvas._deactivate();
      // The canvas was sized while hidden (0x0) - size it now it is visible
      if (canvas._resize) canvas._resize();
    }
    const btn = document.getElementById('supervisorSignBtn');
    if (btn) { btn.disabled = false; btn.textContent = 'Sign as Supervisor'; }
    const err = document.getElementById('supervisorSignatureError');
    if (err) err.textContent = '';
  }
}

function submitSupervisorSignature() {
  const err = document.getElementById('supervisorSignatureError');
  const signature = getSignatureAsBase64('supervisorSignature');
  if (!signature) {
    if (err) err.textContent = 'Please sign in the box first.';
    return;
  }
  if (err) err.textContent = '';
  const btn = document.getElementById('supervisorSignBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Signing...'; }
  const scriptParam = JSON.stringify({ signature });
  if (window.FileMaker) {
    window.FileMaker.PerformScript('SessionNote: Supervisor Sign', scriptParam);
  } else {
    console.log('FileMaker not detected. SessionNote: Supervisor Sign would be called with a', signature.length, 'char signature');
  }
}

// Called by SessionNote: Supervisor Sign when it could not finish.
window.supervisorSignFailed = function(message) {
  const btn = document.getElementById('supervisorSignBtn');
  if (btn) { btn.disabled = false; btn.textContent = 'Sign as Supervisor'; }
  const err = document.getElementById('supervisorSignatureError');
  if (err) err.textContent = message || 'The signature could not be saved.';
};

// ===== REVISIONS =====
// Revising is deliberately NOT online-only: interventionists revise on the iPad
// too, and MirrorSync carries both the voided original and the new copy.

function showReviseModal() {
  const reason = document.getElementById('reviseReason');
  const error = document.getElementById('reviseReasonError');
  if (reason) reason.value = '';
  if (error) error.hidden = true;
  const modal = document.getElementById('reviseNoteModal');
  if (modal) modal.classList.add('visible');
  if (reason) reason.focus();
}

function hideReviseModal() {
  const modal = document.getElementById('reviseNoteModal');
  if (modal) modal.classList.remove('visible');
}

function confirmRevision() {
  const reasonEl = document.getElementById('reviseReason');
  const reason = reasonEl ? reasonEl.value.trim() : '';
  const error = document.getElementById('reviseReasonError');
  if (!reason) {
    if (error) error.hidden = false;
    return;
  }
  hideReviseModal();
  // The script works on the note this window is showing, so no id is needed.
  // It voids the original, opens the copy and calls populateForm() with it.
  const scriptParam = JSON.stringify({ reason });
  if (window.FileMaker) {
    window.FileMaker.PerformScript('SessionNote: Create Revision', scriptParam);
  } else {
    console.log('FileMaker not detected. SessionNote: Create Revision would be called with:', scriptParam);
  }
}

// Called by the FileMaker script if the revision could not be created.
window.revisionFailed = function(message) {
  alert(message || 'The revision could not be created.');
};

function formatTimestampForBanner(value) {
  if (!value) return '';
  // FileMaker timestamps arrive as "M/D/YYYY h:mm:ss AM" - keep just the date
  return String(value).split(' ')[0];
}

// Show / hide the Revise button and the void + revision banners
function applyRevisionState(data, noteStatus) {
  const isFinal = noteStatus.toLowerCase() === 'final';
  const isVoid = noteStatus.toLowerCase() === 'void';
  const revisionNumber = Number(data.revisionNumber) || 0;

  const reviseBtn = document.getElementById('reviseNoteBtn');
  if (reviseBtn) reviseBtn.hidden = !isFinal;

  const voidBanner = document.getElementById('voidBanner');
  if (voidBanner) {
    voidBanner.hidden = !isVoid;
    if (isVoid) {
      const when = formatTimestampForBanner(data.voidedTS);
      voidBanner.textContent = 'VOID' + (when ? ' — voided ' + when : '')
        + (data.voidedBy ? ' by ' + data.voidedBy : '')
        + '. This note was replaced by a revision and is kept for the record only.';
    }
  }

  const banner = document.getElementById('revisionBanner');
  if (!banner) return;
  banner.hidden = revisionNumber === 0;
  if (revisionNumber === 0) return;

  const title = document.getElementById('revisionBannerTitle');
  if (title) {
    title.textContent = 'REVISION ' + revisionNumber
      + (isFinal ? ' — signed and final' : ' — needs all signatures before it is final');
  }
  const reason = document.getElementById('revisionBannerReason');
  if (reason) reason.textContent = data.revisionReason ? 'Reason: ' + data.revisionReason : '';

  // changeLog is rebuilt by FileMaker on every save of a revision, one change per line
  const list = document.getElementById('revisionChangesList');
  if (list) {
    const lines = String(data.changeLog || '').split(/\r\n|\r|\n/).filter(l => l.trim());
    list.innerHTML = '';
    if (lines.length === 0) {
      const li = document.createElement('li');
      li.className = 'revision-changes-empty';
      li.textContent = 'No changes saved yet.';
      list.appendChild(li);
    } else {
      lines.forEach(line => {
        const li = document.createElement('li');
        li.textContent = line;
        list.appendChild(li);
      });
    }
  }
}

// Reload the note from FileMaker, warning first if there are unsaved changes
function handleRefreshClick() {
  if (isDirty) {
    const modal = document.getElementById('refreshConfirmModal');
    if (modal) modal.classList.add('visible');
  } else {
    loadFormData();
  }
}

function hideRefreshConfirmModal() {
  const modal = document.getElementById('refreshConfirmModal');
  if (modal) modal.classList.remove('visible');
}

// Initialize Signature Pad
function initializeSignaturePad(canvasId, clearButtonId) {
  const canvas = document.getElementById(canvasId);
  const clearBtn = document.getElementById(clearButtonId);
  const overlay = document.getElementById(canvasId + 'Overlay');

  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  let isDrawing = false;
  let drewStroke = false;
  let isActive = false;
  let lastX = 0;
  let lastY = 0;

  // Set canvas size to match display size.
  // 11/9/26: setting canvas.width erases the canvas, and iPad windowed mode and
  // rotation fire resize events, so a signature could vanish. Now a resize that
  // changes nothing is ignored, a pad hidden for a moment (0 wide) is left alone,
  // and a real size change copies the ink across.
  let sized = false;
  const resizeCanvas = () => {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.floor(rect.width * dpr);
    const height = Math.floor(rect.height * dpr);

    if (sized && (!width || !height)) return;
    if (sized && width === canvas.width && height === canvas.height) return;

    let ink = null;
    if (sized && !isSignatureEmpty(canvasId)) {
      ink = document.createElement('canvas');
      ink.width = canvas.width;
      ink.height = canvas.height;
      ink.getContext('2d').drawImage(canvas, 0, 0);
    }

    canvas.width = width;
    canvas.height = height;
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    sized = true;

    if (ink) {
      // Device pixels, not the scaled drawing units. Only ever shrink to fit.
      const scale = Math.min(width / ink.width, height / ink.height, 1);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(ink, 0, 0, ink.width * scale, ink.height * scale);
      ctx.restore();
    }

    // A saved signature that arrived while this pad was hidden
    if (width && height && canvas._pendingSignature) {
      const pending = canvas._pendingSignature;
      canvas._pendingSignature = null;
      loadSignatureFromBase64(canvasId, pending);
    }
  };

  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  // Get coordinates relative to canvas
  const getCoordinates = (e) => {
    const rect = canvas.getBoundingClientRect();
    const touch = e.touches ? e.touches[0] : e;
    return {
      x: touch.clientX - rect.left,
      y: touch.clientY - rect.top
    };
  };

  // Activate the pad (called by overlay tap or when a saved signature is loaded)
  const activate = () => {
    isActive = true;
    inkLength = 0;
    canvas._active = true;
    if (overlay) overlay.style.display = 'none';
  };

  // Set once the user actually draws, so loading a saved signature never
  // triggers the caregiver auto-lock.
  let drewSinceActivate = false;
  // How far the pen has travelled since activation, in CSS pixels, so the
  // finished-signing prompt can say when a signature looks unfinished.
  let inkLength = 0;

  // 11/9/26: the overlay used to come back as an 88% cover whenever the pad
  // went inactive, so a good signature looked deleted as soon as the signer
  // touched anything else. A pad with ink now keeps a see-through overlay: the
  // signature stays visible, and the page still scrolls from on top of it.
  const showOverlay = () => {
    if (!overlay) return;
    const signed = !isSignatureEmpty(canvasId);
    overlay.classList.toggle('signature-activate-overlay--signed', signed);
    const label = overlay.querySelector('span');
    if (label) label.textContent = signed ? 'Tap Clear to start over' : 'Tap to Sign';
    overlay.style.display = '';
  };

  // Deactivate the pad (called by Clear button and by tapping outside it)
  const deactivate = (e) => {
    const wasActive = isActive;
    isActive = false;
    canvas._active = false;
    showOverlay();
    // Stores wait while a pad is open, so this is when the signature gets one
    if (wasActive && DRAFT_SIGNATURE_PADS[canvasId]) scheduleDraftStore();
    if (wasActive && drewSinceActivate && canvasId === 'parentSignature' && !isSignatureEmpty('parentSignature')) {
      drewSinceActivate = false;
      // 11/10/26: a touch outside the pad no longer locks the note by itself;
      // the signer confirms first. Tapping Save is that confirmation already.
      const tappedSave = !!(e && e.target && e.target.closest &&
        e.target.closest('button[type="submit"]'));
      if (tappedSave) {
        // Let the outside tap finish first (it is the Save button itself)
        setTimeout(lockAfterCaregiverSignature, 0);
      } else {
        const ink = inkLength;
        setTimeout(() => askCaregiverFinished(ink, () => { activate(); inkLength = ink; }), 0);
      }
    }
    drewSinceActivate = false;
    inkLength = 0;
  };

  // Expose activate/deactivate on the canvas element so loadSignatureFromBase64 can call them
  canvas._activate = activate;
  canvas._deactivate = deactivate;
  // Lets a pad that was hidden at load (0x0) size itself once it is shown,
  // without a window resize that would wipe the other pads' signatures.
  canvas._resize = resizeCanvas;

  // Overlay tap → activate so the user can sign - but only once the note is
  // ready for that signature (9/16/26: validation runs BEFORE the EI signs, and
  // the caregiver pad stays blocked until the EI has signed and it all passes).
  if (overlay) {
    overlay.addEventListener('click', () => {
      if (canvasId === 'eISignature' && !canStartEISignature()) return;
      if (canvasId === 'parentSignature' && !canStartCaregiverSignature()) return;
      activate();
    });
  }

  // Deactivate when the user interacts with anything outside this signature wrapper
  const wrapper = canvas.closest('.signature-wrapper');
  const deactivateOnOutsideInteraction = (e) => {
    if (!isActive) return;
    if (wrapper && !wrapper.contains(e.target)) {
      deactivate(e);
    }
  };
  document.addEventListener('touchstart', deactivateOnOutsideInteraction);
  document.addEventListener('mousedown', deactivateOnOutsideInteraction);

  // Start drawing
  const startDrawing = (e) => {
    // The supervisor signs a note that is already locked, so only that pad
    // ignores view-only.
    if (!isActive) return;
    if (document.body.classList.contains('view-only') && canvasId !== 'supervisorSignature') return;
    e.preventDefault();
    isDrawing = true;
    if (DRAFT_SIGNATURE_PADS[canvasId]) notePenDown();
    drewStroke = false;
    drewSinceActivate = true;
    canvas._cleared = false;
    const coords = getCoordinates(e);
    lastX = coords.x;
    lastY = coords.y;
  };

  // Draw
  const draw = (e) => {
    if (!isDrawing || !isActive) return;
    e.preventDefault();
    drewStroke = true;

    const coords = getCoordinates(e);

    inkLength += Math.hypot(coords.x - lastX, coords.y - lastY);
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(coords.x, coords.y);
    ctx.stroke();

    lastX = coords.x;
    lastY = coords.y;
  };

  // Stop drawing
  const stopDrawing = () => {
    // A tap adds no ink, and must not copy a saved signature into a draft
    if (isDrawing && DRAFT_SIGNATURE_PADS[canvasId]) notePenUp();
    if (isDrawing && drewStroke) noteSignatureDrawn(canvasId);
    isDrawing = false;
  };

  // Mouse events
  canvas.addEventListener('mousedown', startDrawing);
  canvas.addEventListener('mousemove', draw);
  canvas.addEventListener('mouseup', stopDrawing);
  canvas.addEventListener('mouseleave', stopDrawing);

  // Touch events for iPad
  canvas.addEventListener('touchstart', startDrawing);
  canvas.addEventListener('touchmove', draw);
  canvas.addEventListener('touchend', stopDrawing);
  canvas.addEventListener('touchcancel', stopDrawing);

  // Clear signature and deactivate so the user must tap again to re-sign
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // The one way a save may blank a stored signature - see saveToFileMaker
      canvas._cleared = true;
      drewSinceActivate = false;
      noteSignatureCleared(canvasId);
      deactivate();
    });
  }
}

// Calculate units from time in/out; compare against authorized duration
function calculateUnitsFromTime() {
  const startEl = document.getElementById('sessionStartTime');
  const endEl   = document.getElementById('sessionEndTime');
  const unitsEl = document.getElementById('serviceUnits');

  if (!startEl || !endEl || !unitsEl) return;
  if (!startEl.value || !endEl.value) return;

  const start = new Date(`1970-01-01T${startEl.value}`);
  const end   = new Date(`1970-01-01T${endEl.value}`);
  const diffMinutes = (end - start) / 1000 / 60;

  const timeWarning = document.getElementById('timeWarning');
  if (diffMinutes <= 0) {
    unitsEl.value = '';
    updateTotalMinutes(0);
    checkUnitsDuration('');
    if (timeWarning) timeWarning.textContent = startEl.value && endEl.value ? 'Confirm time in/out' : '';
    return;
  }
  if (timeWarning) timeWarning.textContent = '';

  // Floor to whole units — 1 unit = 15 minutes, no rounding up
  const units = Math.floor(diffMinutes / 15);

  unitsEl.value = units || '0';
  updateTotalMinutes(diffMinutes);
  checkUnitsDuration(units);
}

function updateTotalMinutes(minutes) {
  if (totalMinutes) {
    totalMinutes.value = minutes > 0 ? Math.round(minutes) : '';
  }
}

// Prompt unit justification when calculated units differ from authorized duration
function checkUnitsDuration(calculatedUnits) {
  const durationEl = document.getElementById('duration');
  const noticeEl   = document.getElementById('unitJustificationNotice');
  const justEl     = document.getElementById('unitJustification');
  if (!noticeEl) return;

  const authorizedUnits = durationEl ? parseFloat(durationEl.value) : NaN;

  if (!isNaN(authorizedUnits) && authorizedUnits > 0 && calculatedUnits !== '' && parseFloat(calculatedUnits) !== authorizedUnits) {
    const diff = (parseFloat(calculatedUnits) - authorizedUnits).toFixed(2).replace(/\.?0+$/, '');
    const sign = parseFloat(diff) > 0 ? '+' : '';
    noticeEl.textContent = `Units (${calculatedUnits}) differ from authorized duration (${authorizedUnits} units) by ${sign}${diff} — Unit Justification required.`;
    if (justEl) justEl.classList.add('field-error');
  } else {
    noticeEl.textContent = '';
    if (justEl) justEl.classList.remove('field-error');
  }
}

sessionStartTime.addEventListener('change', calculateUnitsFromTime);
sessionStartTime.addEventListener('input', calculateUnitsFromTime);
sessionEndTime.addEventListener('change', calculateUnitsFromTime);

// Flag next session date if it is in the past
function checkNextSessionDate() {
  const el      = document.getElementById('nextSessionDate');
  const warning = document.getElementById('nextSessionDateWarning');
  if (!el || !warning) return;
  if (!el.value) { warning.textContent = ''; return; }
  // Both are YYYY-MM-DD, so a string compare orders them correctly.
  if (el.value < localDateString()) {
    warning.textContent = 'This date is in the past — please verify.';
  } else {
    warning.textContent = '';
  }
}

const nextSessionDateEl = document.getElementById('nextSessionDate');
if (nextSessionDateEl) {
  nextSessionDateEl.addEventListener('change', checkNextSessionDate);
  nextSessionDateEl.addEventListener('input',  checkNextSessionDate);
}
sessionEndTime.addEventListener('input', calculateUnitsFromTime);

// Clear Unit Justification error state once the user starts typing
const unitJustificationEl = document.getElementById('unitJustification');
if (unitJustificationEl) {
  unitJustificationEl.addEventListener('input', () => {
    if (unitJustificationEl.value.trim()) {
      unitJustificationEl.classList.remove('field-error');
      const noticeEl = document.getElementById('unitJustificationNotice');
      if (noticeEl) noticeEl.textContent = '';
    }
  });
}

// Form submission handler
form.addEventListener('submit', (e) => {
  e.preventDefault();

  if (isSaveInProgress()) return;

  const isValid = validateForm();

  const formData = getFormData();

  // Flag if session date is not today
  const sessionDateEl = document.getElementById('sessionDate');
  const alertEl = document.getElementById('alert');
  if (sessionDateEl && alertEl) {
    const today = localDateString();
    if (sessionDateEl.value && sessionDateEl.value !== today) {
      const direction = sessionDateEl.value < today ? 'past' : 'future';
      alertEl.value = `Session date (${sessionDateEl.value}) is not today's date (today: ${today}) — entered as ${direction} date`;
      // Confirm before saving a past date
      if (isValid && direction === 'past' && !confirm(`Are you sure this date is correct?\n\nSession date: ${sessionDateEl.value}\nToday: ${today}`)) {
        return;
      }
    } else {
      alertEl.value = '';
    }
    formData.alert = alertEl.value;
  }

  // If all validations pass the note gets locked - but the lock is applied on
  // the LAST step of the save, not this one. Sending viewOnly with the first
  // step locked the record against the save's own remaining steps, so the
  // signatures never landed and the note could never be saved again.
  // setHeaderStatus('Final') likewise waits for FileMaker to confirm.
  saveToFileMaker(formData, isValid);
});

// Get signature canvas as base64.
//
// The pad is captured at devicePixelRatio (2x on iPad) and is mostly empty
// space, so encoding it whole produced a payload big enough to stall the save.
// One pass over the alpha channel gives us both the "is it empty" answer and
// the ink bounding box, then we re-encode just that box at 1x. Typically an
// 80-90% reduction with no visible loss - a signature is line art.
function getSignatureAsBase64(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !canvas.width || !canvas.height) return '';

  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;

  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (data[row + x * 4 + 3] !== 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  // No ink anywhere - same answer the old emptiness check gave.
  if (maxX < 0) return '';

  const dpr = window.devicePixelRatio || 1;
  const pad = Math.round(4 * dpr);
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad);
  maxY = Math.min(height - 1, maxY + pad);

  const cropW = maxX - minX + 1;
  const cropH = maxY - minY + 1;

  const out = document.createElement('canvas');
  out.width  = Math.max(1, Math.round(cropW / dpr));
  out.height = Math.max(1, Math.round(cropH / dpr));

  const octx = out.getContext('2d');
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(canvas, minX, minY, cropW, cropH, 0, 0, out.width, out.height);

  return out.toDataURL('image/png');
}

// Load signature from base64 to canvas
function loadSignatureFromBase64(canvasId, base64Data) {
  if (!base64Data) return;
  
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  // Pad hidden right now (0x0): nothing to draw on, so resizeCanvas draws it later
  if (!canvas.width || !canvas.height) {
    canvas._pendingSignature = base64Data;
    return;
  }

  const ctx = canvas.getContext('2d');
  const img = new Image();
  
  img.onload = () => {
    // Saved signatures are now cropped to the ink, so they no longer share the
    // pad's aspect ratio - stretching one to fill the pad would distort it.
    // Scale to fit and centre instead. A full-pad image from an older save has
    // the pad's own ratio, so it still lands exactly where it used to.
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.width / dpr;
    const cssH = canvas.height / dpr;

    ctx.clearRect(0, 0, cssW, cssH);

    const scale = Math.min(cssW / img.width, cssH / img.height, 1);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, (cssW - w) / 2, (cssH - h) / 2, w, h);

    // Leave the pad inactive: the see-through overlay shows the signature, and a
    // stray touch can't add to it or stop the page scrolling (11/9/26).
    if (canvas._deactivate) canvas._deactivate();
  };
  
  img.src = base64Data;
}

// Get form data as object
function getFormData() {
  const data = {};
  
  // Get all form elements
  const elements = form.elements;
  
  for (let element of elements) {
    const name = element.name;
    const id = element.id;
    
    // Skip elements without a name or id
    if (!name && !id) continue;
    
    // Use id as key for all elements to match sample-data.json structure
    const key = id || name;
    
    if (element.type === 'checkbox') {
      // Store each checkbox by its ID as a boolean value
      data[key] = element.checked;
    } else if (element.type === 'radio') {
      // Handle radio buttons - only store if checked, use the group name
      if (element.checked) {
        data[name] = element.value;
      }
    } else if (element.type === 'select-one') {
      // Handle select dropdowns
      data[key] = element.value;
    } else if (element.type === 'textarea') {
      // Handle textareas
      data[key] = element.value;
    } else if (element.type !== 'button' && element.type !== 'submit') {
      // Handle all other input types (text, number, date, time, etc.)
      data[key] = element.value;
    }
  }

  
  // Add signature data as base64
  data.eISignatureBase64 = getSignatureAsBase64('eISignature');
  data.parentSignatureBase64 = getSignatureAsBase64('parentSignature');

  // Flag teleintervention sessions as needing caregiver signature
  const locationEl = document.getElementById('location');
  data.telehealthSignatureRequired = (locationEl && locationEl.value.trim() === 'Teleintervention') ? true : false;

  // Flag child not present
  const childPresentCheck = document.querySelector('input[name="childPresentStatus"]:checked');
  data.childNotPresent = childPresentCheck ? childPresentCheck.value === 'no' : false;

  return data;
}

// Show save confirmation toast and hide the floating save bar
function showSaveConfirmation() {
  markClean();

  // Toast notification
  const toast = document.getElementById('saveToast');
  if (toast) {
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
  }
}

// Convert YYYY-MM-DD → MM/DD/YYYY for FileMaker display fields
function formatDateForDisplay(isoDate) {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate || '';
  const [y, m, d] = isoDate.split('-');
  return `${m}/${d}/${y}`;
}

// Convert HH:MM (24-hour) → h:MM AM/PM for FileMaker display fields
function formatTimeForDisplay(time24) {
  if (!time24 || !/^\d{2}:\d{2}$/.test(time24)) return time24 || '';
  const [h, m] = time24.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${m.toString().padStart(2, '0')} ${period}`;
}

// ===== SAVE =====
//
// FileMaker.PerformScript is fire-and-forget - it returns immediately and tells
// us nothing. The old code called showSaveConfirmation() on the next line, so
// the toast appeared before FileMaker had done any work, and a stall or an
// error looked exactly like a successful save.
//
// The save is now a queue of small steps. Each step is its own PerformScript
// call; the FileMaker script ends by calling window.saveProgress(), which
// advances the bar and fires the next step. Because the script *ends* between
// steps, the web viewer repaints, so the progress the user sees is real.
// Splitting the signatures out also keeps any single script parameter small.

const SAVE_TIMEOUT_MS = 20000;

const saveState = {
  active: false,
  id: null,
  queue: [],
  index: 0,
  timer: null,
  locking: false,
};

function isSaveInProgress() {
  return saveState.active;
}

function setSaveProgressUI(fraction, label, detail) {
  const overlay = document.getElementById('saveProgress');
  const fill    = document.getElementById('saveProgressFill');
  const text    = document.getElementById('saveProgressLabel');
  const step    = document.getElementById('saveProgressStep');
  if (overlay) overlay.classList.add('visible');
  if (overlay) overlay.classList.remove('error');
  if (fill) fill.style.width = Math.round(Math.max(0, Math.min(1, fraction)) * 100) + '%';
  if (text) text.textContent = label || 'Saving...';
  if (step) step.textContent = detail || '';
}

function hideSaveProgressUI() {
  const overlay = document.getElementById('saveProgress');
  if (overlay) overlay.classList.remove('visible', 'error');
}

// The Close button only appears in the failure state.
document.addEventListener('DOMContentLoaded', () => {
  const dismiss = document.getElementById('saveProgressDismiss');
  if (dismiss) dismiss.addEventListener('click', hideSaveProgressUI);
});

function failSave(message) {
  clearTimeout(saveState.timer);
  saveState.active = false;
  saveState.id = null;
  saveState.locking = false;
  document.body.classList.remove('locking');

  // Do not close or export off the back of a save that did not land.
  runPendingActionAfterSave = false;
  pendingDocumentAction = null;

  const overlay = document.getElementById('saveProgress');
  const text    = document.getElementById('saveProgressLabel');
  const step    = document.getElementById('saveProgressStep');
  if (overlay) overlay.classList.add('visible', 'error');
  if (text) text.textContent = 'Save failed';
  if (step) step.textContent = message || 'FileMaker did not respond. Your changes are still here - try saving again.';

  // The note stays dirty so the save bar remains available for a retry.
}

function armSaveWatchdog() {
  clearTimeout(saveState.timer);
  saveState.timer = setTimeout(() => {
    failSave('FileMaker stopped responding partway through the save. Nothing was lost - tap Save Session Note to try again.');
  }, SAVE_TIMEOUT_MS);
}

function sendSaveStep() {
  const stepDef = saveState.queue[saveState.index];
  if (!stepDef) return;

  const total = saveState.queue.length;
  setSaveProgressUI(
    saveState.index / total,
    stepDef.label,
    `Step ${saveState.index + 1} of ${total}`
  );

  const scriptParam = JSON.stringify(Object.assign(
    {
      mode: 'save',
      saveId: saveState.id,
      seq: saveState.index,
      total,
    },
    stepDef.payload
  ));

  armSaveWatchdog();

  if (window.FileMaker) {
    try {
      window.FileMaker.PerformScript('Manage: SessionNote', scriptParam);
    } catch (err) {
      failSave('Could not reach FileMaker: ' + (err && err.message ? err.message : err));
    }
  } else {
    // Outside FileMaker (npm start) - simulate the round trip so the progress
    // UI can be exercised in a plain browser.
    console.log('FileMaker not detected. Step would be sent:', scriptParam);
    setTimeout(() => {
      window.saveProgress(JSON.stringify({
        saveId: saveState.id, seq: saveState.index, total, ok: true,
      }));
    }, 250);
  }
}

// Called by the FileMaker script at the end of every step.
window.saveProgress = function(payload) {
  let result;
  try {
    result = typeof payload === 'string' ? JSON.parse(payload) : (payload || {});
  } catch (err) {
    result = { ok: false, message: 'Unreadable response from FileMaker.' };
  }

  // Ignore anything from a save we already gave up on or replaced.
  if (!saveState.active) return;
  if (result.saveId && result.saveId !== saveState.id) return;
  if (typeof result.seq === 'number' && result.seq !== saveState.index) return;

  if (result.ok === false) {
    failSave(result.message || ('FileMaker reported error ' + (result.error != null ? result.error : '?') + '.'));
    return;
  }

  clearTimeout(saveState.timer);
  saveState.index += 1;

  if (saveState.index >= saveState.queue.length) {
    saveState.active = false;
    saveState.id = null;
    setSaveProgressUI(1, 'Saved', '');
    setTimeout(hideSaveProgressUI, 400);

    // The note is only final if FileMaker says it locked it. Manage: SessionNote
    // returns SessionNote: Seal If Complete's result as "seal" on the last step.
    // An older script that sends no "seal" is trusted, as before.
    let lockRefused = null;
    if (saveState.locking) {
      saveState.locking = false;
      document.body.classList.remove('locking');
      const seal = result.seal && typeof result.seal === 'object' ? result.seal : null;
      const locked = !seal || isTruthy(seal.sealed) || seal.reason === 'already sealed';
      if (locked) {
        setHeaderStatus('Final');
        setViewOnlyMode(true);
        const linkBtn = document.getElementById('copyParentSignatureLinkBtn');
        if (linkBtn) linkBtn.hidden = true;
        const checkBtn = document.getElementById('lockCheckBtn');
        if (checkBtn) checkBtn.hidden = true;
      } else {
        lockRefused = seal;
      }
    }

    showSaveConfirmation();
    if (lockRefused) {
      // Saved, but not locked - say so instead of looking final
      setTimeout(() => showLockRefused(lockRefused), 450);
    }

    // The user asked to save before closing / emailing - do it now that the
    // save has actually landed, after the confirmation has had a moment.
    if (runPendingActionAfterSave) {
      runPendingActionAfterSave = false;
      setTimeout(runPendingDocumentAction, 450);
    }
    return;
  }

  // This callback is running from inside the FileMaker script's final
  // "Perform JavaScript in Web Viewer" step, so that script has not formally
  // exited yet. Yielding to the event loop first lets it finish before we ask
  // FileMaker to start the next one, and gives the progress bar a chance to
  // repaint.
  setTimeout(sendSaveStep, 0);
};

function saveToFileMaker(data, lockWhenDone) {
  if (saveState.active) return; // guard against a double tap on Save

  // A draft must not land in the middle of the save. FileMaker clears the
  // draft itself once the commit step succeeds.
  cancelDraftTimers();

  // Append human-readable formatted date/time fields for FileMaker billing
  // and next-session display calculations (e.g. billingLine, nextSessionDisplay).
  // Raw ISO values are kept intact for date/time field storage.
  data.sessionDateFormatted      = formatDateForDisplay(data.sessionDate);
  data.sessionStartTimeFormatted = formatTimeForDisplay(data.sessionStartTime);
  data.sessionEndTimeFormatted   = formatTimeForDisplay(data.sessionEndTime);
  data.nextSessionDateFormatted  = formatDateForDisplay(data.nextSessionDate);
  data.nextSessionTimeFormatted  = formatTimeForDisplay(data.nextSessionTime);

  // Signatures travel on their own steps, not inside the field payload.
  const eiSignature     = data.eISignatureBase64 || '';
  const parentSignature = data.parentSignatureBase64 || '';

  const fields = {};
  Object.keys(data).forEach(key => {
    if (key === 'eISignatureBase64' || key === 'parentSignatureBase64') return;
    fields[key] = data[key];
  });

  // The lock travels on the commit step instead, once the signatures are in.
  // When we are not locking, whatever status the form holds rides along as
  // normal.
  const finalFields = {};
  if (lockWhenDone) {
    delete fields.status;
    delete fields.viewOnly;
    finalFields.status = 'Final';
    finalFields.viewOnly = true;
  }
  saveState.locking = !!lockWhenDone;
  // Nothing may change between "this is valid, lock it" and the lock landing.
  if (lockWhenDone) document.body.classList.add('locking');

  const queue = [
    { label: 'Saving session note...', payload: { step: 'fields', data: fields } },
  ];

  // 11/9/26: a blank pad only overwrites the stored signature when the signer
  // tapped Clear. Before, every save sent both pads, so a pad that had been
  // wiped or hadn't finished drawing erased a good signature.
  const shouldSendSignature = (canvasId, value) => {
    const canvas = document.getElementById(canvasId);
    return !!value || !!(canvas && canvas._cleared);
  };
  if (shouldSendSignature('eISignature', eiSignature)) {
    queue.push({
      label: 'Saving EI signature...',
      payload: { step: 'signature', field: 'eISignatureBase64', value: eiSignature },
    });
  }
  if (shouldSendSignature('parentSignature', parentSignature)) {
    queue.push({
      label: 'Saving caregiver signature...',
      payload: { step: 'signature', field: 'parentSignatureBase64', value: parentSignature },
    });
  }
  queue.push({
    label: lockWhenDone ? 'Finalizing note...' : 'Finishing up...',
    payload: { step: 'commit', data: finalFields },
  });

  console.log('Saving to FileMaker in ' + queue.length + ' steps.',
    'fields:', Object.keys(fields).length,
    'ei sig:', eiSignature.length, 'chars,',
    'parent sig:', parentSignature.length, 'chars');

  saveState.active = true;
  saveState.id = 'sv' + Date.now();
  saveState.queue = queue;
  saveState.index = 0;

  sendSaveStep();
}

// Load data from FileMaker
// FileMaker injects window.FileMaker asynchronously and it can lag slightly
// behind DOMContentLoaded, so retry briefly before giving up.
function loadFormData(attemptsLeft = 20) {
  const scriptParam = JSON.stringify({ mode: 'load' });
  if (window.FileMaker) {
    try {
      window.FileMaker.PerformScript('Manage: SessionNote', scriptParam);
    } catch (error) {
      console.log('No existing data to load');
    }
  } else if (attemptsLeft > 0) {
    setTimeout(() => loadFormData(attemptsLeft - 1), 100);
  } else {
    console.log('FileMaker not detected. Manage: SessionNote would be called with:', scriptParam);
  }
}

// ===== PRESENT WIDGET =====
function syncPresentWidget() {
  const staffFirst = (document.getElementById('eIFirstName') || {}).value || '';
  const staffLast  = (document.getElementById('eILastName')  || {}).value || '';
  const childFirst = (document.getElementById('clientFirstName') || {}).value || '';
  const childPresentVal = (document.querySelector('input[name="childPresentStatus"]:checked') || {}).value || '';
  // Show/hide the absent reason fields
  const noWrap = document.getElementById('presentNoReasonWrap');
  if (noWrap) noWrap.style.display = childPresentVal === 'no' ? 'flex' : 'none';

  // Compose comma-separated value for the textarea
  const textarea = document.getElementById('whatWeDidTodayPresent');
  if (!textarea) return;

  const parts = [];
  // Only Held sessions auto-fill the interventionist name into Present
  const sessionStatus = (document.getElementById('sessionStatus') || {}).value || '';
  if (sessionStatus === 'H - Held') {
    const staffName = [staffFirst, staffLast].filter(Boolean).join(' ');
    if (staffName) parts.push(staffName);
  }

  if (childPresentVal === 'yes') {
    if (childFirst) parts.push(childFirst);
  } else if (childPresentVal === 'no') {
    const reason = (document.getElementById('childAbsentReason') || {}).value || '';
    parts.push(`Child absent${reason ? ': ' + reason : ''}`);
    const teaming = (document.querySelector('input[name="teamingPreApproved"]:checked') || {}).value;
    if (teaming) parts.push(`Teaming pre-approved: ${teaming === 'yes' ? 'Yes' : 'No'}`);
  }

  const others = (document.getElementById('othersPresent') || {}).value || '';
  if (others) parts.push(others);

  textarea.value = parts.join(', ');
}

// ===== PILL MULTI-SELECT FOR GOALS =====
// Builds a custom pill-based selector inside `containerId`.
// A hidden <input id=fieldId> holds the comma-joined selected values for getFormData.
function buildGoalsPillSelect(containerId, fieldId, goals, preSelected) {
  const container = document.getElementById(containerId);
  if (!container) return;

  let selected = new Set(preSelected || []);

  // Hidden input — read by getFormData like any other text input
  const hidden = document.createElement('input');
  hidden.type = 'hidden';
  hidden.id   = fieldId;
  hidden.name = fieldId;

  // Outer wrapper
  const wrapper = document.createElement('div');
  wrapper.className = 'pill-select';

  // Pill display area (acts as the trigger)
  const display = document.createElement('div');
  display.className = 'pill-select__display';
  display.setAttribute('tabindex', '0');
  display.setAttribute('role', 'combobox');
  display.setAttribute('aria-haspopup', 'listbox');
  display.setAttribute('aria-expanded', 'false');

  // Placeholder span
  const placeholder = document.createElement('span');
  placeholder.className = 'pill-select__placeholder';
  placeholder.textContent = 'Select outcome(s)/goal(s)…';
  display.appendChild(placeholder);

  // Dropdown list
  const dropdown = document.createElement('ul');
  dropdown.className = 'pill-select__dropdown';
  dropdown.setAttribute('role', 'listbox');
  dropdown.setAttribute('aria-multiselectable', 'true');

  function syncHidden() {
    hidden.value = [...selected].join(', ');
    // fire change so dirty-state tracking picks it up
    hidden.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function renderPills() {
    // Remove existing pills (keep placeholder)
    display.querySelectorAll('.pill-select__pill').forEach(p => p.remove());
    placeholder.style.display = selected.size ? 'none' : '';

    [...selected].forEach(val => {
      const pill = document.createElement('span');
      pill.className = 'pill-select__pill';
      pill.textContent = val;

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'pill-select__pill-remove';
      removeBtn.setAttribute('aria-label', `Remove ${val}`);
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        selected.delete(val);
        // uncheck in dropdown
        const cb = dropdown.querySelector(`input[value="${CSS.escape(val)}"]`);
        if (cb) cb.checked = false;
        renderPills();
        syncHidden();
      });

      pill.appendChild(removeBtn);
      display.insertBefore(pill, placeholder);
    });

    // Update checkbox states
    dropdown.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.checked = selected.has(cb.value);
    });
  }

  // Build list items
  goals.forEach(goal => {
    const li = document.createElement('li');
    li.className = 'pill-select__option';
    li.setAttribute('role', 'option');

    const cb = document.createElement('input');
    cb.type  = 'checkbox';
    cb.value = goal;
    cb.id    = `goal-cb-${goal.replace(/\s+/g, '-')}`;
    cb.checked = selected.has(goal);

    const lbl = document.createElement('label');
    lbl.htmlFor = cb.id;
    lbl.textContent = goal;

    cb.addEventListener('change', () => {
      if (cb.checked) selected.add(goal); else selected.delete(goal);
      renderPills();
      syncHidden();
    });

    li.appendChild(cb);
    li.appendChild(lbl);
    dropdown.appendChild(li);
  });

  // Toggle dropdown
  function openDropdown() {
    wrapper.classList.add('pill-select--open');
    display.setAttribute('aria-expanded', 'true');
  }
  function closeDropdown() {
    wrapper.classList.remove('pill-select--open');
    display.setAttribute('aria-expanded', 'false');
  }

  display.addEventListener('click', () => {
    wrapper.classList.contains('pill-select--open') ? closeDropdown() : openDropdown();
  });
  display.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDropdown(); }
    if (e.key === 'Escape') closeDropdown();
  });

  // Close when clicking outside
  document.addEventListener('click', (e) => {
    if (!wrapper.contains(e.target)) closeDropdown();
  });

  wrapper.appendChild(display);
  wrapper.appendChild(dropdown);
  container.innerHTML = '';
  container.appendChild(wrapper);
  container.appendChild(hidden);

  renderPills();
  syncHidden();
}

// Trigger a save from FileMaker (fires the same submit handler as the Save button)
window.triggerSave = function() {
  form.requestSubmit();
};

// Put values into the form fields by id (or radio group name). Used for the
// note FileMaker loads, and again for a restored draft (11/5/26).
function applyFieldValues(data) {
  for (let key in data) {
    const element = document.getElementById(key);
    if (element) {
      if (element.type === 'checkbox') {
        // Set checkbox state based on boolean value
        element.checked = data[key] === true || data[key] === 'true' || data[key] === 1;
      } else if (element.type === 'radio') {
        // For radio buttons, check if this element's value matches the data value
        if (element.value === data[key]) {
          element.checked = true;
        }
      } else {
        // Set value for all other input types
        element.value = data[key] || '';
      }
    } else {
      // If no element found by ID, check if it's a radio button group by name
      const radioGroup = document.querySelectorAll(`input[type="radio"][name="${key}"]`);
      if (radioGroup.length > 0) {
        radioGroup.forEach(radio => {
          if (radio.value === data[key]) {
            radio.checked = true;
          }
        });
      }
    }
  }
}

// Function to populate form from FileMaker (called by FileMaker script)
window.populateForm = function(jsonData) {
  try {
    const data = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;

    // Support legacy payloads that send only `sessionStatus` under the key `status`
    // (only applies when there is no separate sessionStatus key at all).
    if (data.sessionStatus === undefined && data.status !== undefined && data.status !== 'Final') {
      data.sessionStatus = data.status;
    }
    
    // Capture status before the loop so it cannot be affected by field population
    const noteStatus = (data.status || '').trim();

    // Clear form first
    form.reset();

    // Populate all form fields
    applyFieldValues(data);

    // Build pill multi-select for goals AFTER the loop so the loop's empty
    // ifspOutcomes value cannot overwrite the hidden input set by syncHidden().
    if (Array.isArray(data.goals) && data.goals.length > 0) {
      let preSelected = [];
      if (data.ifspOutcomes) {
        // Restore previously saved selections that are still in the goals list
        preSelected = data.ifspOutcomes.split(', ').filter(g => data.goals.includes(g));
      }
      if (preSelected.length === 0 && data.goals.length === 1) {
        // Auto-select the only available goal for new sessions
        preSelected = [data.goals[0]];
      }
      buildGoalsPillSelect('ifspOutcomesContainer', 'ifspOutcomes', data.goals, preSelected);
    }

    // A freshly loaded note starts with no pending Clear or queued signature
    ['eISignature', 'parentSignature'].forEach(id => {
      const pad = document.getElementById(id);
      if (pad) { pad._cleared = false; pad._pendingSignature = null; }
    });

    // Load signatures from base64 if present
    if (data.eISignatureBase64) {
      loadSignatureFromBase64('eISignature', data.eISignatureBase64);
    }
    if (data.parentSignatureBase64) {
      loadSignatureFromBase64('parentSignature', data.parentSignatureBase64);
    }
    
    // Recalculate units and check duration if times are populated
    calculateUnitsFromTime();
    // Show/hide conditional sub-field sections based on loaded session type and location
    handleSessionTypeChange();
    handleLocationChange();
    // Re-sync the Present widget with loaded staff/child names and saved radio state
    syncPresentWidget();
    // Distribute loaded combined values into prompt sub-fields
    distributeToSubFields('outcomeUpdates', ['outcomeUpdates_q1', 'outcomeUpdates_q2']);
    markClean();

    // Show status in header
    console.log('[populateForm] noteStatus:', noteStatus, '| data.status:', data.status);
    setHeaderStatus(noteStatus);
    applyRevisionState(data, noteStatus);
    applySupervisorState(data);
    applyEmailState(data);

    // Show Email PDF/Create PDF only when FileMaker reports an online connection
    setDocumentActionsOnlineState(data.online === true || data.online === 'true' || data.online === 1);

    // Apply view-only mode if requested
    const isLocked = data.viewOnly === true || data.viewOnly === 'true' || data.viewOnly === 1;
    setViewOnlyMode(isLocked);
    // A caregiver link for a locked note is pointless
    const linkBtn = document.getElementById('copyParentSignatureLinkBtn');
    if (linkBtn && isLocked) linkBtn.hidden = true;
    const checkBtn = document.getElementById('lockCheckBtn');
    if (checkBtn) checkBtn.hidden = isLocked;

    // Drafts last, once the form shows exactly what is saved (11/5/26)
    setupDrafts(data, isLocked);

    console.log('Form populated with data:', data);
  } catch (error) {
    console.error('Error populating form:', error);
  }
};

// ===== FAMILY EMAIL STATUS (9/23/26) =====
// SessionNote::asJSON carries emailStatus / emailSentTS / emailSentTo. The server
// sets them when it emails the sealed PDF; the Email PDF button sets them too.
// FileMaker timestamps arrive as "9/23/2026 3:14:07 PM" - show them shorter.
function formatFmTimestamp(raw) {
  const text = String(raw || '').trim();
  const m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?)?/i);
  if (!m) return text;
  const [, mo, d, y, h, mi, ap] = m;
  const date = `${Number(mo)}/${Number(d)}/${y}`;
  if (h === undefined) return date;
  let hour = Number(h);
  let suffix = ap ? ap.toUpperCase() : '';
  if (!suffix) { suffix = hour >= 12 ? 'PM' : 'AM'; hour = hour % 12 || 12; }
  return `${date} ${hour}:${mi} ${suffix}`;
}

function applyEmailState(data) {
  const banner = document.getElementById('emailStatusBanner');
  if (!banner) return;
  const status = String(data.emailStatus || '').trim();
  const when = formatFmTimestamp(data.emailSentTS);
  const to = String(data.emailSentTo || '').trim();
  let text = '';
  let variant = '';
  if (status === 'Sent') {
    text = '✉️ Emailed to family' + (to ? ' (' + to + ')' : '') + (when ? ' on ' + when : '');
    variant = 'sent';
  } else if (status === 'Sending') {
    text = '✉️ Sending to family…';
    variant = 'pending';
  } else if (status === 'Waiting for Sync') {
    // 10/23/26: sealed on the offline copy - the server emails it after the next sync.
    text = '✉️ Waiting for sync - the family email goes out after this device syncs.';
    variant = 'pending';
  } else if (status === 'Failed') {
    text = '⚠️ Email to family failed - it will retry automatically.';
    variant = 'failed';
  } else if (status === 'No Recipient') {
    text = 'Not emailed - no family member on this client is marked preferred with an email address.';
    variant = 'none';
  }
  banner.textContent = text;
  banner.className = 'email-status-banner' + (variant ? ' email-status-banner--' + variant : '');
  banner.hidden = !text;
}

// Called by Manage: Document (saveEmail) after the Email PDF button marks the note sent.
window.setEmailStatus = function(json) {
  try {
    applyEmailState(typeof json === 'string' ? JSON.parse(json) : (json || {}));
  } catch (error) {
    console.error('setEmailStatus failed:', error);
  }
};

// Update the status badge in the blue header
function setHeaderStatus(statusText) {
  const el = document.getElementById('headerStatus');
  if (el) el.textContent = statusText || '';
}

// Enable or disable view-only mode
function setViewOnlyMode(enabled) {
  if (enabled) {
    document.body.classList.add('view-only');
    form.addEventListener('submit', (e) => e.preventDefault(), true);
    // Disable every interactive control so checkboxes/radios cannot be toggled
    form.querySelectorAll('input, textarea, select, button').forEach(el => {
      el.disabled = true;
    });
  } else {
    document.body.classList.remove('view-only');
    form.querySelectorAll('input, textarea, select, button').forEach(el => {
      el.disabled = false;
    });
  }
}

// Auto-save functionality (optional)
let autoSaveTimeout;
form.addEventListener('input', () => {
  clearTimeout(autoSaveTimeout);
  autoSaveTimeout = setTimeout(() => {
    const data = getFormData();
    console.log('Auto-save triggered:', data);
    // Could implement auto-save to FileMaker here if needed
  }, 2000); // Save 2 seconds after user stops typing
});

// Format Client ID input (add dashes automatically)
const clientIdInput = document.getElementById('clientId');
if (clientIdInput) {
  clientIdInput.addEventListener('input', (e) => {
    let value = e.target.value.replace(/\D/g, ''); // Remove non-digits
    
    if (value.length > 12) {
      value = value.slice(0, 12);
    }
    
    e.target.value = value;
  });
}

// ===== CONDITIONAL VALIDATION =====

// Fields required when Session Status is "H - Held" (excludes travelMinutes, unitJustification, localId)
const HELD_REQUIRED_FIELDS = [
  { id: 'county',                    label: 'County' },
  { id: 'staffId',                   label: 'Staff ID' },
  { id: 'sessionDate',               label: 'Session Date' },
  { id: 'sessionStartTime',          label: 'Time In' },
  { id: 'sessionEndTime',            label: 'Time Out' },
  { id: 'serviceUnits',              label: 'Units' },
  { id: 'clientFirstName',           label: 'Child First Name' },
  { id: 'clientLastName',            label: 'Child Last Name' },
  { id: 'serviceCode',               label: 'Type of Service' },
  { id: 'sessionType',               label: 'Type of Session' },
  { id: 'location',                  label: 'Location of Session' },
  { id: 'ifspOutcomes',              label: 'Outcome(s)/Goal(s) from IFSP/IEP' },
  { id: 'specificTargets',           label: 'Specific Targets' },
  { id: 'outcomeUpdates',            label: 'Child and family outcome updates' },
  { id: 'whatWeDidTodayPresent',     label: 'Present' },
  { id: 'whatWeDidToday',            label: 'What we did today' },
  { id: 'whatTargets',               label: 'What? (Targets)' },
  { id: 'howActivities',             label: 'How? (Strategies)' },
  { id: 'whenWhere',                 label: 'When and Where?' },
  { id: 'who',                       label: 'Who?' },
  { id: 'successLooks',              label: 'What will success look like?' },
  { id: 'eIFirstName',               label: 'Staff First Name' },
  { id: 'eILastName',                label: 'Staff Last Name' },
  { id: 'eICredentials',             label: 'Credentials/Title' },
  { id: 'eIPhone',                   label: 'Staff Phone' },
  { id: 'parentFirstName',           label: 'Parent/Caregiver First Name' },
  { id: 'parentLastName',            label: 'Parent/Caregiver Last Name' },
  { id: 'serviceCoordinatorName',    label: 'Service Coordinator Name' },
  { id: 'serviceCoordinatorLastName',label: 'Service Coordinator Last Name' },
  // nextSessionDate / nextSessionTime are no longer required on their own -
  // see the Scheduling Notes rule in validateForm (9/16/26).
];

// ===== Prompt sub-fields — individual boxes that combine into hidden textarea =====

function autoResizeSubfield(el) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

function syncOutcomeUpdatesCombined() {
  const q1 = (document.getElementById('outcomeUpdates_q1') || {}).value || '';
  const q2 = (document.getElementById('outcomeUpdates_q2') || {}).value || '';
  const combined = [q1, q2].filter(s => s.trim()).join(' ');
  const el = document.getElementById('outcomeUpdates');
  if (el) el.value = combined;
}

function distributeToSubFields(combinedId, subIds) {
  const combinedEl = document.getElementById(combinedId);
  if (!combinedEl || !combinedEl.value) return;
  const parts = combinedEl.value.split(/\n\n+/);
  subIds.forEach((id, i) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (i < subIds.length - 1) {
      el.value = parts[i] || '';
    } else {
      // Last sub-field absorbs any overflow paragraphs
      el.value = parts.slice(i).join('\n\n') || '';
    }
    autoResizeSubfield(el);
  });
}

function setupPromptSubfields() {
  ['outcomeUpdates_q1', 'outcomeUpdates_q2'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
      autoResizeSubfield(el);
      syncOutcomeUpdatesCombined();
    });
  });
}

function handleSessionTypeChange() {
  const sessionType = (document.getElementById('sessionType') || {}).value || '';
  const isReview = sessionType.trim() === 'Review' || sessionType.trim() === 'Teaming (Pre-approved)';
  const reviewNote = document.getElementById('wwdtReviewNote');
  if (reviewNote) reviewNote.style.display = isReview ? '' : 'none';
}

function handleLocationChange() {
  // Location no longer toggles a separate telehealth sub-field — the reason
  // for a TI session is now captured directly in the combined free-text box.
}

function handleSessionStatusChange() {
  const statusEl = document.getElementById('sessionStatus');
  const status = statusEl ? statusEl.value.trim() : '';
  const cancellationSection = document.getElementById('cancellationSection');
  if (!cancellationSection) return;

  if (status && status !== 'H - Held') {
    // Any non-held, non-empty status = cancelled/absence — show description prompt
    cancellationSection.style.display = 'block';
  } else {
    cancellationSection.style.display = 'none';
  }

  // Interventionist name only auto-fills into Present for Held sessions
  syncPresentWidget();
}

function syncCancellationToWhatWeDidToday() {
  const descEl = document.getElementById('cancellationDescription');
  const wwdtEl = document.getElementById('whatWeDidToday');
  if (!descEl || !wwdtEl) return;
  wwdtEl.value = descEl.value;
}

function clearValidationErrors() {
  document.querySelectorAll('.field-error').forEach(el => el.classList.remove('field-error'));
  // Remove dynamically added error spans
  document.querySelectorAll('.error-msg-dynamic').forEach(el => el.remove());
  // Clear static error span text
  document.querySelectorAll('.error-msg').forEach(el => { el.textContent = ''; });
  // Reset signature border colors
  const eiSig = document.getElementById('eISignature');
  if (eiSig) eiSig.style.borderColor = '';
  const parentSig = document.getElementById('parentSignature');
  if (parentSig) parentSig.style.borderColor = '';
  // Hide summary
  const summary = document.getElementById('validationSummary');
  if (summary) {
    summary.style.display = 'none';
    summary.innerHTML = '';
  }
}

function setFieldError(fieldId, message) {
  const field = document.getElementById(fieldId);
  if (!field) return;
  field.classList.add('field-error');
  const errorSpan = document.createElement('span');
  errorSpan.className = 'error-msg error-msg-dynamic';
  errorSpan.textContent = message;
  field.insertAdjacentElement('afterend', errorSpan);
}

function isSignatureEmpty(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !canvas.width || !canvas.height) return true;
  const ctx = canvas.getContext('2d');
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return !imageData.data.some(channel => channel !== 0);
}

// 11/17/26: a caregiver "signature" that was a single dot (an 11x6 PNG) passed
// isSignatureEmpty and locked Mary Beiler's Myles Roberts note. A caregiver
// signature whose ink fits inside this many CSS pixels, both ways, is refused.
// Even short initials are well over this.
const MIN_SIGNATURE_SIZE = 40;

// Width and height of the ink, in CSS pixels. 0 x 0 for an empty pad.
function signatureInkSize(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !canvas.width || !canvas.height) return { width: 0, height: 0 };
  const { width, height } = canvas;
  const data = canvas.getContext('2d').getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (data[row + x * 4 + 3] !== 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { width: 0, height: 0 };
  const dpr = window.devicePixelRatio || 1;
  return { width: (maxX - minX + 1) / dpr, height: (maxY - minY + 1) / dpr };
}

// Ink is there but too small to be a signature (a dot or a tap)
function isSignatureTooSmall(canvasId) {
  const size = signatureInkSize(canvasId);
  if (!size.width && !size.height) return false;
  return Math.max(size.width, size.height) < MIN_SIGNATURE_SIZE;
}

function showValidationSummary(errors) {
  const summary = document.getElementById('validationSummary');
  if (!summary) return;
  summary.innerHTML = `<strong>Please complete the following required fields:</strong><ul>${errors.map(e => `<li>${e}</li>`).join('')}</ul>`;
  summary.style.display = 'block';
  summary.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// The last validateForm() result, for the Check & Lock panel
let lastValidationErrors = [];

function validateForm(options = {}) {
  clearValidationErrors();
  const errors = [];
  lastValidationErrors = errors;
  const signatureErrors = [];
  const awaitingSignaturesOnlyEl = document.getElementById('awaitingSignaturesOnly');
  if (awaitingSignaturesOnlyEl) awaitingSignaturesOnlyEl.value = 'false';

  const statusEl = document.getElementById('sessionStatus');
  const status = statusEl ? statusEl.value.trim() : '';

  // Session Status is always required
  if (!status) {
    setFieldError('sessionStatus', 'Session Status is required.');
    errors.push('Session Status');
    showValidationSummary(errors);
    return false;
  }

  const isHeld = status === 'H - Held';

  if (isHeld) {
    // Validate all required fields for Held sessions
    HELD_REQUIRED_FIELDS.forEach(({ id, label }) => {
      const field = document.getElementById(id);
      if (field && !field.value.trim()) {
        setFieldError(id, `${label} is required.`);
        errors.push(label);
      }
    });

    // Scheduling Notes (9/16/26): required when the next session date or time is
    // blank. "Discharge" is the usual entry for counties that require a date.
    const nextDateEl = document.getElementById('nextSessionDate');
    const nextTimeEl = document.getElementById('nextSessionTime');
    const schedulingEl = document.getElementById('schedulingNotes');
    const nextSessionMissing = !(nextDateEl && nextDateEl.value.trim()) || !(nextTimeEl && nextTimeEl.value.trim());
    if (nextSessionMissing && !(schedulingEl && schedulingEl.value.trim())) {
      setFieldError('schedulingNotes', 'Scheduling Notes are required when the next session date or time is blank (e.g. "Discharge").');
      errors.push('Scheduling Notes (no next session date/time)');
    }

    // Unit Justification required when calculated units differ from authorized duration
    const durationEl      = document.getElementById('duration');
    const unitsEl         = document.getElementById('serviceUnits');
    const justEl          = document.getElementById('unitJustification');
    const authorizedUnits = durationEl ? parseFloat(durationEl.value)           : NaN;
    const calcUnits       = unitsEl    ? parseFloat(unitsEl.value)               : NaN;
    if (!isNaN(authorizedUnits) && authorizedUnits > 0 && !isNaN(calcUnits) && calcUnits !== authorizedUnits) {
      if (!justEl || !justEl.value.trim()) {
        setFieldError('unitJustification', 'Unit Justification is required when units differ from authorized duration.');
        errors.push('Unit Justification (units differ from authorized duration)');
      }
    }

    // At least 1 coaching strategy must be checked (or Other filled)
    const coachingChecked = document.querySelectorAll('input[name="coachingStrategies"]:checked').length > 0;
    const coachingOtherEl = document.getElementById('coachingOther');
    const hasCoachingOther = coachingOtherEl && coachingOtherEl.value.trim().length > 0;
    if (!coachingChecked && !hasCoachingOther) {
      const coachingErr = document.getElementById('coachingStrategiesError');
      if (coachingErr) coachingErr.textContent = 'At least one coaching strategy is required.';
      errors.push('Coaching strategy (at least 1 required)');
    }

    // Target 1 progress must be selected
    const target1Selected = document.querySelector('input[name="target1Progress"]:checked');
    if (!target1Selected) {
      const target1Err = document.getElementById('target1ProgressError');
      if (target1Err) target1Err.textContent = 'Target 1 progress selection is required.';
      errors.push('Target 1 progress selection');
    }

    // EI Signature required (skipped when the user is actively tapping in to sign)
    if (!options.skipEISignatureCheck && isSignatureEmpty('eISignature')) {
      const eiSig = document.getElementById('eISignature');
      if (eiSig) eiSig.style.borderColor = '#dc3545';
      const eiErr = document.getElementById('eISignatureError');
      if (eiErr) eiErr.textContent = 'EI Signature is required.';
      errors.push('EI Signature');
      signatureErrors.push('EI Signature');
    }

    // Parent/Caregiver Signature required (skipped when checking whether the caregiver may sign yet)
    if (!options.skipParentSignatureCheck && isSignatureEmpty('parentSignature')) {
      const parentSig = document.getElementById('parentSignature');
      if (parentSig) parentSig.style.borderColor = '#dc3545';
      const parentErr = document.getElementById('parentSignatureError');
      if (parentErr) parentErr.textContent = 'Parent/Caregiver Signature is required.';
      errors.push('Parent/Caregiver Signature');
      signatureErrors.push('Parent/Caregiver Signature');
    } else if (!options.skipParentSignatureCheck && isSignatureTooSmall('parentSignature')) {
      const parentSig = document.getElementById('parentSignature');
      if (parentSig) parentSig.style.borderColor = '#dc3545';
      const parentErr = document.getElementById('parentSignatureError');
      if (parentErr) parentErr.textContent = 'The caregiver signature is too small. Tap Clear and have the caregiver sign again.';
      errors.push('Parent/Caregiver Signature (too small - sign again)');
      signatureErrors.push('Parent/Caregiver Signature');
    }

  } else {
    // Cancelled/absence status: require cancellation description
    const descEl = document.getElementById('cancellationDescription');
    if (!descEl || !descEl.value.trim()) {
      setFieldError('cancellationDescription', 'Please describe the reason for cancellation or absence.');
      errors.push('Description of cancellation/absence');
    }

    // 9/16/26: canceled/absent notes need the EI signature only - no caregiver
    if (!options.skipEISignatureCheck && isSignatureEmpty('eISignature')) {
      const eiSig = document.getElementById('eISignature');
      if (eiSig) eiSig.style.borderColor = '#dc3545';
      const eiErr = document.getElementById('eISignatureError');
      if (eiErr) eiErr.textContent = 'EI Signature is required.';
      errors.push('EI Signature');
      signatureErrors.push('EI Signature');
    }
  }

  if (errors.length > 0) {
    // All required fields passed except the signature(s)
    if (awaitingSignaturesOnlyEl && errors.length === signatureErrors.length) {
      awaitingSignaturesOnlyEl.value = 'true';
    }
    showValidationSummary(errors);
    return false;
  }

  return true;
}