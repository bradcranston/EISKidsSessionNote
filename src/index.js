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
  const bar = document.getElementById('floatingSaveBar');
  if (bar) bar.classList.remove('visible');
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

// Initialize form
document.addEventListener('DOMContentLoaded', () => {
  console.log('EIS Session Note Form Loaded');
  
  // Set default date to today
  const sessionDate = document.getElementById('sessionDate');
  if (sessionDate && !sessionDate.value) {
    sessionDate.value = new Date().toISOString().split('T')[0];
  }
  
  // Initialize signature pads
  initializeSignaturePad('eISignature', 'clearSignature');
  initializeSignaturePad('parentSignature', 'clearParentSignature');

  // Wire up prompt sub-field combining
  setupPromptSubfields();

  // Load any saved data from FileMaker if available
  loadFormData();

  // Track unsaved changes to show/hide the floating save bar
  form.addEventListener('input', markDirty);
  form.addEventListener('change', markDirty);

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
});

// Initialize Signature Pad
function initializeSignaturePad(canvasId, clearButtonId) {
  const canvas = document.getElementById(canvasId);
  const clearBtn = document.getElementById(clearButtonId);
  
  if (!canvas) return;
  
  const ctx = canvas.getContext('2d');
  let isDrawing = false;
  let lastX = 0;
  let lastY = 0;
  
  // Set canvas size to match display size
  const resizeCanvas = () => {
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
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
  
  // Start drawing
  const startDrawing = (e) => {
    e.preventDefault();
    isDrawing = true;
    const coords = getCoordinates(e);
    lastX = coords.x;
    lastY = coords.y;
  };
  
  // Draw
  const draw = (e) => {
    if (!isDrawing) return;
    e.preventDefault();
    
    const coords = getCoordinates(e);
    
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(coords.x, coords.y);
    ctx.stroke();
    
    lastX = coords.x;
    lastY = coords.y;
  };
  
  // Stop drawing
  const stopDrawing = () => {
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
  
  // Clear signature
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
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
  const today    = new Date(new Date().toISOString().split('T')[0]);
  const selected = new Date(el.value);
  if (selected < today) {
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

  const isValid = validateForm();

  const formData = getFormData();

  // Flag if session date is not today
  const sessionDateEl = document.getElementById('sessionDate');
  const alertEl = document.getElementById('alert');
  if (sessionDateEl && alertEl) {
    const today = new Date().toISOString().split('T')[0];
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

  // If all validations pass, mark the note as complete and lock it
  if (isValid) {
    formData.status = 'Final';
    formData.viewOnly = true;
    setHeaderStatus('Final');
  }

  // Always send data to FileMaker
  saveToFileMaker(formData);
});

// Get signature canvas as base64
function getSignatureAsBase64(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return '';
  
  // Check if canvas is empty
  const ctx = canvas.getContext('2d');
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const hasContent = imageData.data.some(channel => channel !== 0);
  
  if (!hasContent) return '';
  
  // Return base64 encoded PNG
  return canvas.toDataURL('image/png');
}

// Load signature from base64 to canvas
function loadSignatureFromBase64(canvasId, base64Data) {
  if (!base64Data) return;
  
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  
  const ctx = canvas.getContext('2d');
  const img = new Image();
  
  img.onload = () => {
    // Clear canvas first
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Draw image to canvas
    ctx.drawImage(img, 0, 0, canvas.width / window.devicePixelRatio, canvas.height / window.devicePixelRatio);
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

// Save data to FileMaker
function saveToFileMaker(data) {
  console.log('Saving to FileMaker:', data);
  
      data.mode = 'save'; // Add mode to indicate saving action

  // Create FileMaker script parameter
  const scriptParam = JSON.stringify(data);

  // Call FileMaker script
  if (window.FileMaker) {
    window.FileMaker.PerformScript('Manage: SessionNote', scriptParam);
    showSaveConfirmation();
  } else {
    // For testing outside of FileMaker
    console.log('FileMaker not detected. Data would be saved:', scriptParam);
    showSaveConfirmation();
  }
}

// Load data from FileMaker
function loadFormData() {
  // Check if FileMaker has provided initial data
  if (window.FileMaker) {
    try {
      // Request data from FileMaker
      window.FileMaker.PerformScript('GetSessionNoteData', '');
    } catch (error) {
      console.log('No existing data to load');
    }
  }
}

// ===== PRESENT WIDGET =====
function syncPresentWidget() {
  const staffFirst = (document.getElementById('eIFirstName') || {}).value || '';
  const staffLast  = (document.getElementById('eILastName')  || {}).value || '';
  // Show/hide the absent reason fields
  const noWrap = document.getElementById('presentNoReasonWrap');
  if (noWrap) noWrap.style.display = childPresentVal === 'no' ? 'flex' : 'none';

  // Compose comma-separated value for the textarea
  const textarea = document.getElementById('whatWeDidTodayPresent');
  if (!textarea) return;

  const parts = [];
  const staffName = [staffFirst, staffLast].filter(Boolean).join(' ');
  if (staffName) parts.push(staffName);

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
    
    // Handle goals array — auto-fill single goal or build pill multi-select
    if (Array.isArray(data.goals) && data.goals.length > 0) {
      buildGoalsPillSelect('ifspOutcomesContainer', 'ifspOutcomes', data.goals,
        data.goals.length === 1 ? [data.goals[0]] : []);
    }

    // Populate all form fields
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
    distributeToSubFields('whatWeDidToday', ['whatWeDidToday_q1', 'whatWeDidToday_q2', 'whatWeDidToday_q3', 'whatWeDidToday_q4']);
    markClean();

    // Show status in header
    console.log('[populateForm] noteStatus:', noteStatus, '| data.status:', data.status);
    setHeaderStatus(noteStatus);

    // Apply view-only mode if requested
    if (data.viewOnly === true || data.viewOnly === 'true' || data.viewOnly === 1) {
      setViewOnlyMode(true);
    } else {
      setViewOnlyMode(false);
    }

    console.log('Form populated with data:', data);
  } catch (error) {
    console.error('Error populating form:', error);
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
  { id: 'nextSessionDate',           label: 'Date of Next Session' },
  { id: 'nextSessionTime',           label: 'Time of Next Session' },
];

// ===== Prompt sub-fields — individual boxes that combine into hidden textarea =====

function autoResizeSubfield(el) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

function syncOutcomeUpdatesCombined() {
  const q1 = (document.getElementById('outcomeUpdates_q1') || {}).value || '';
  const q2 = (document.getElementById('outcomeUpdates_q2') || {}).value || '';
  const combined = [q1, q2].filter(s => s.trim()).join('\n\n');
  const el = document.getElementById('outcomeUpdates');
  if (el) el.value = combined;
}

function syncWhatWeDidTodayCombined() {
  const q1 = (document.getElementById('whatWeDidToday_q1') || {}).value || '';
  const q2 = (document.getElementById('whatWeDidToday_q2') || {}).value || '';
  const q3 = (document.getElementById('whatWeDidToday_q3') || {}).value || '';
  const q4 = (document.getElementById('whatWeDidToday_q4') || {}).value || '';
  const parts = [q1, q2, q3, q4].filter(s => s.trim());
  const el = document.getElementById('whatWeDidToday');
  if (el) el.value = parts.join('\n\n');
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
  ['whatWeDidToday_q1', 'whatWeDidToday_q2', 'whatWeDidToday_q3', 'whatWeDidToday_q4'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
      autoResizeSubfield(el);
      syncWhatWeDidTodayCombined();
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
  const location = (document.getElementById('location') || {}).value || '';
  const isTelehealth = location.trim() === 'Teleintervention';
  const telehealthPrompt = document.getElementById('wwdtTelehealthPrompt');
  if (telehealthPrompt) telehealthPrompt.style.display = isTelehealth ? '' : 'none';
  syncWhatWeDidTodayCombined();
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
  if (!canvas) return true;
  const ctx = canvas.getContext('2d');
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return !imageData.data.some(channel => channel !== 0);
}

function showValidationSummary(errors) {
  const summary = document.getElementById('validationSummary');
  if (!summary) return;
  summary.innerHTML = `<strong>Please complete the following required fields:</strong><ul>${errors.map(e => `<li>${e}</li>`).join('')}</ul>`;
  summary.style.display = 'block';
  summary.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function validateForm() {
  clearValidationErrors();
  const errors = [];

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

    // EI Signature required
    if (isSignatureEmpty('eISignature')) {
      const eiSig = document.getElementById('eISignature');
      if (eiSig) eiSig.style.borderColor = '#dc3545';
      const eiErr = document.getElementById('eISignatureError');
      if (eiErr) eiErr.textContent = 'EI Signature is required.';
      errors.push('EI Signature');
    }

    // Parent/Caregiver Signature required
    if (isSignatureEmpty('parentSignature')) {
      const parentSig = document.getElementById('parentSignature');
      if (parentSig) parentSig.style.borderColor = '#dc3545';
      const parentErr = document.getElementById('parentSignatureError');
      if (parentErr) parentErr.textContent = 'Parent/Caregiver Signature is required.';
      errors.push('Parent/Caregiver Signature');
    }

  } else {
    // Cancelled/absence status: require cancellation description
    const descEl = document.getElementById('cancellationDescription');
    if (!descEl || !descEl.value.trim()) {
      setFieldError('cancellationDescription', 'Please describe the reason for cancellation or absence.');
      errors.push('Description of cancellation/absence');
    }
  }

  if (errors.length > 0) {
    showValidationSummary(errors);
    return false;
  }

  return true;
}