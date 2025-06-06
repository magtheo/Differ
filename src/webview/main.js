console.log('=== WEBVIEW MAIN.JS STARTING ===');
console.log('Document ready state:', document.readyState);
console.log('VS Code API available:', typeof acquireVsCodeApi);

// Get VS Code API
const vscode = acquireVsCodeApi();

// State management
let currentState = {
    jsonInput: '',
    parsedInput: null,
    pendingChanges: [],
    selectedChanges: [],
    isLoading: false,
    error: null,
    validationInProgress: false,
    globalValidationErrors: [],
    globalValidationWarnings: [],
    changeHistory: []
};

// DOM elements
let elements = {};

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM Content Loaded. Initializing...');
    initializeElements();
    attachEventListeners();
    updateUI();
    console.log('Initialization complete. Waiting for messages or user interaction.');
});

function initializeElements() {
    console.log('Initializing DOM elements.');
    elements = {
        jsonInput: document.getElementById('jsonInput'),
        parseBtn: document.getElementById('parseBtn'),
        clearInputBtn: document.getElementById('clearInputBtn'),
        
        statusSection: document.getElementById('statusSection'),
        loadingIndicator: document.getElementById('loadingIndicator'),
        
        // Global validation elements
        globalErrors: document.getElementById('globalErrors'),
        globalErrorsList: document.getElementById('globalErrorsList'),
        globalWarnings: document.getElementById('globalWarnings'),
        globalWarningsList: document.getElementById('globalWarningsList'),
        retryValidationBtn: document.getElementById('retryValidationBtn'),
        
        // Legacy elements
        errorMessage: document.getElementById('errorMessage'),
        successMessage: document.getElementById('successMessage'),
        
        changesSection: document.getElementById('changesSection'),
        changesCount: document.getElementById('changesCount'),
        selectedCount: document.getElementById('selectedCount'),
        validationSummary: document.getElementById('validationSummary'),
        applySelectedBtn: document.getElementById('applySelectedBtn'),
        selectOnlyValidBtn: document.getElementById('selectOnlyValidBtn'),
        validateTargetsBtn: document.getElementById('validateTargetsBtn'),
        clearChangesBtn: document.getElementById('clearChangesBtn'),
        changesList: document.getElementById('changesList'),
        
        showHistoryBtn: document.getElementById('showHistoryBtn'),
        undoLastBtn: document.getElementById('undoLastBtn'),
        historyList: document.getElementById('historyList')
    };
    console.log('DOM elements initialized:', Object.keys(elements));
}

function attachEventListeners() {
    console.log('Attaching event listeners.');
    
    // Input section
    if (elements.jsonInput) elements.jsonInput.addEventListener('input', handleJsonInputChange);
    if (elements.parseBtn) elements.parseBtn.addEventListener('click', handleParseInput);
    if (elements.clearInputBtn) elements.clearInputBtn.addEventListener('click', handleClearInput);
    
    // Validation section
    if (elements.retryValidationBtn) elements.retryValidationBtn.addEventListener('click', handleRetryValidation);
    
    // Changes section
    if (elements.applySelectedBtn) elements.applySelectedBtn.addEventListener('click', handleApplySelected);
    if (elements.selectOnlyValidBtn) elements.selectOnlyValidBtn.addEventListener('click', handleSelectOnlyValid);
    if (elements.clearChangesBtn) elements.clearChangesBtn.addEventListener('click', handleClearChanges);
    
    // History section
    if (elements.showHistoryBtn) elements.showHistoryBtn.addEventListener('click', handleShowHistory);
    if (elements.undoLastBtn) elements.undoLastBtn.addEventListener('click', handleUndoLast);
    
    // Listen for messages from extension
    window.addEventListener('message', handleExtensionMessage);
    console.log('Event listeners attached.');
}

// Event handlers
function handleJsonInputChange(event) {
    currentState.jsonInput = event.target.value;
    const hasContent = currentState.jsonInput.trim().length > 0;
    
    // Clear validation errors when input changes
    currentState.globalValidationErrors = [];
    currentState.globalValidationWarnings = [];
    currentState.error = null;
    
    if (elements.parseBtn) {
        elements.parseBtn.disabled = !hasContent || currentState.isLoading || currentState.validationInProgress;
    }
    
    // Update UI to reflect cleared validation state
    updateStatusSection();
    
    console.log(
        'Input changed. Length:', currentState.jsonInput.length,
        'HasContent:', hasContent,
        'isLoading:', currentState.isLoading,
        'Parse button disabled:', elements.parseBtn ? elements.parseBtn.disabled : 'N/A'
    );
}

function handleParseInput() {
    const jsonInput = elements.jsonInput ? elements.jsonInput.value.trim() : '';
    console.log('Parse button clicked. Input length:', jsonInput.length, 'isLoading:', currentState.isLoading);
    
    if (!jsonInput || currentState.isLoading || currentState.validationInProgress) {
        console.warn('ParseInput handler: No input or currently processing. Aborting.');
        return;
    }
    
    console.log('Sending parseInput message with data:', jsonInput.substring(0, 100) + '...');
    sendMessage('parseInput', { jsonInput });
}

function handleClearInput() {
    console.log('Clear input button clicked.');
    if (elements.jsonInput) {
        elements.jsonInput.value = '';
    }
    currentState.jsonInput = '';
    currentState.globalValidationErrors = [];
    currentState.globalValidationWarnings = [];
    currentState.error = null;
    
    if (elements.parseBtn) {
        elements.parseBtn.disabled = true;
    }
    
    sendMessage('clearInput');
    updateUI();
}

function handleRetryValidation() {
    console.log('Retry validation button clicked.');
    if (!currentState.jsonInput.trim()) {
        console.warn('No input to retry validation with.');
        return;
    }
    sendMessage('retryValidation');
}

function handleApplySelected() {
    const selectedChanges = currentState.selectedChanges;
    console.log('Apply selected button clicked. Selected changes count:', selectedChanges.length, 'isLoading:', currentState.isLoading);
    
    if (selectedChanges.length === 0 || currentState.isLoading || currentState.validationInProgress) {
        console.warn('ApplySelected handler: No changes selected or currently processing. Aborting.');
        return;
    }
    
    sendMessage('applyChanges', { selectedChanges });
}

function handleSelectOnlyValid() {
    console.log('Select only valid button clicked.');
    sendMessage('selectOnlyValid');
}

function handleValidateTargets() {
    console.log('Validate targets button clicked.');
    if (currentState.isLoading || currentState.validationInProgress) {
        console.warn('Validation already in progress, ignoring request.');
        return;
    }
    sendMessage('validateTargets');
}

function handleClearChanges() {
    console.log('Clear changes button clicked.');
    sendMessage('clearChanges');
}

function handleShowHistory() {
    console.log('Show history button clicked.');
    alert('History feature not yet implemented');
}

function handleUndoLast() {
    console.log('Undo last button clicked.');
    alert('Undo feature not yet implemented');
}

function handleChangeCheckboxChange(event) {
    const changeId = event.target.dataset.changeId;
    const selected = event.target.checked;
    console.log('Checkbox change for ID:', changeId, 'Selected:', selected);
    sendMessage('toggleChangeSelection', { changeId, selected });
}

function handlePreviewChange(changeId) {
    console.log('Preview button clicked for change ID:', changeId);
    sendMessage('previewChange', { changeId });
}

// Message handling
function sendMessage(type, data = {}) {
    console.log('Sending message to extension -> Type:', type, 'Data:', data);
    vscode.postMessage({ type, data });
}

function handleExtensionMessage(event) {
    const message = event.data;
    console.log('Received message from extension <- Type:', message.type, 'Message keys:', Object.keys(message));
    
    switch (message.type) {
        case 'stateUpdate':
            console.log('State update received. Old state validation errors:', currentState.globalValidationErrors.length);
            currentState = { ...currentState, ...message.state };
            console.log('New state after update. Validation errors:', currentState.globalValidationErrors.length, 'Pending changes:', currentState.pendingChanges.length);
            updateUI();
            break;
            
        default:
            console.warn('Unknown message type received from extension:', message.type);
    }
}

// UI updates
function updateUI() {
    console.log('Updating UI. Current state overview:', {
        isLoading: currentState.isLoading,
        validationInProgress: currentState.validationInProgress,
        globalErrors: currentState.globalValidationErrors.length,
        globalWarnings: currentState.globalValidationWarnings.length,
        pendingChanges: currentState.pendingChanges.length,
        inputLength: currentState.jsonInput.length
    });
    
    updateStatusSection();
    updateChangesSection();
    updateHistorySection();
    updateInputSection();
    
    console.log('UI update complete.');
}

function updateInputSection() {
    // Update input field
    if (elements.jsonInput && elements.jsonInput.value !== currentState.jsonInput) {
        elements.jsonInput.value = currentState.jsonInput;
    }
    
    // Update parse button state
    if (elements.parseBtn) {
        const hasContent = currentState.jsonInput.trim().length > 0;
        const isProcessing = currentState.isLoading || currentState.validationInProgress;
        elements.parseBtn.disabled = !hasContent || isProcessing;
        
        // Update button text based on state
        if (currentState.validationInProgress) {
            elements.parseBtn.textContent = 'Validating...';
        } else if (currentState.isLoading) {
            elements.parseBtn.textContent = 'Processing...';
        } else {
            elements.parseBtn.textContent = 'Parse Changes';
        }
        
        console.log(
            'updateInputSection: Parse button state. HasContent:', hasContent, 
            'isProcessing:', isProcessing,
            'Disabled:', elements.parseBtn.disabled
        );
    }
}

function updateStatusSection() {
    console.log('Updating status section. State:', {
        isLoading: currentState.isLoading,
        validationInProgress: currentState.validationInProgress,
        globalErrors: currentState.globalValidationErrors.length,
        globalWarnings: currentState.globalValidationWarnings.length,
        legacyError: !!currentState.error
    });
    
    if (!elements.statusSection) {
        console.warn('Status section elements not found during updateStatusSection.');
        return;
    }

    // Always start with section hidden
    elements.statusSection.classList.add('hidden');

    // Handle loading state
    if (currentState.isLoading || currentState.validationInProgress) {
        elements.statusSection.classList.remove('hidden');
        elements.loadingIndicator.classList.remove('hidden');
        hideAllValidationElements();
        console.log('Status: Loading/validation indicator visible.');
        return;
    }
    
    // Hide loading indicator when not loading
    elements.loadingIndicator.classList.add('hidden');
    
    // Handle global validation errors
    if (currentState.globalValidationErrors.length > 0) {
        elements.statusSection.classList.remove('hidden');
        showGlobalErrors();
        console.log('Status: Global validation errors visible.');
    } else {
        hideGlobalErrors();
    }
    
    // Handle global validation warnings
    if (currentState.globalValidationWarnings.length > 0) {
        elements.statusSection.classList.remove('hidden');
        showGlobalWarnings();
        console.log('Status: Global validation warnings visible.');
    } else {
        hideGlobalWarnings();
    }
    
    // Handle legacy error (fallback)
    if (currentState.error && currentState.globalValidationErrors.length === 0) {
        elements.statusSection.classList.remove('hidden');
        elements.errorMessage.classList.remove('hidden');
        elements.errorMessage.textContent = currentState.error;
        elements.successMessage.classList.add('hidden');
        console.log('Status: Legacy error message visible:', currentState.error);
    } else {
        elements.errorMessage.classList.add('hidden');
    }
    
    // Handle success message
    if (!currentState.isLoading && 
        !currentState.validationInProgress &&
        currentState.globalValidationErrors.length === 0 && 
        !currentState.error &&
        currentState.parsedInput && 
        currentState.pendingChanges.length > 0) {
        
        elements.statusSection.classList.remove('hidden');
        elements.successMessage.classList.remove('hidden');
        elements.successMessage.textContent = `Successfully parsed ${currentState.pendingChanges.length} changes. Description: ${currentState.parsedInput.description || '(no description)'}`;
        console.log('Status: Success message visible.');
    } else {
        elements.successMessage.classList.add('hidden');
    }
    
    // Hide section if nothing to show
    if (!hasAnyStatusContent()) {
        elements.statusSection.classList.add('hidden');
        console.log('Status: Section hidden (nothing to show).');
    }
}

function showGlobalErrors() {
    if (!elements.globalErrors || !elements.globalErrorsList) return;
    
    elements.globalErrors.classList.remove('hidden');
    elements.globalErrorsList.innerHTML = '';
    
    currentState.globalValidationErrors.forEach((error, index) => {
        const errorDiv = createValidationErrorElement(error, index, 'error');
        elements.globalErrorsList.appendChild(errorDiv);
    });
}

function hideGlobalErrors() {
    if (elements.globalErrors) {
        elements.globalErrors.classList.add('hidden');
    }
}

function showGlobalWarnings() {
    if (!elements.globalWarnings || !elements.globalWarningsList) return;
    
    elements.globalWarnings.classList.remove('hidden');
    elements.globalWarningsList.innerHTML = '';
    
    currentState.globalValidationWarnings.forEach((warning, index) => {
        const warningDiv = createValidationErrorElement(warning, index, 'warning');
        elements.globalWarningsList.appendChild(warningDiv);
    });
}

function hideGlobalWarnings() {
    if (elements.globalWarnings) {
        elements.globalWarnings.classList.add('hidden');
    }
}

function hideAllValidationElements() {
    hideGlobalErrors();
    hideGlobalWarnings();
    if (elements.errorMessage) elements.errorMessage.classList.add('hidden');
    if (elements.successMessage) elements.successMessage.classList.add('hidden');
}

function hasAnyStatusContent() {
    return currentState.isLoading ||
           currentState.validationInProgress ||
           currentState.globalValidationErrors.length > 0 ||
           currentState.globalValidationWarnings.length > 0 ||
           !!currentState.error ||
           (currentState.parsedInput && currentState.pendingChanges.length > 0);
}

function createValidationErrorElement(validationItem, index, type) {
    const div = document.createElement('div');
    div.className = `validation-item ${type}`;
    
    const typeLabel = type === 'error' ? '❌' : '⚠️';
    const changeInfo = validationItem.changeIndex !== undefined ? 
        ` (Change ${validationItem.changeIndex + 1})` : '';
    const fieldInfo = validationItem.field ? ` - Field: ${validationItem.field}` : '';
    
    div.innerHTML = `
        <div class="validation-item-header">
            <span class="validation-icon">${typeLabel}</span>
            <span class="validation-message">${escapeHtml(validationItem.message)}</span>
        </div>
        ${validationItem.suggestion ? `<div class="validation-suggestion">💡 ${escapeHtml(validationItem.suggestion)}</div>` : ''}
        ${changeInfo || fieldInfo ? `<div class="validation-context">${escapeHtml(changeInfo + fieldInfo)}</div>` : ''}
    `;
    
    return div;
}

function updateChangesSection() {
    if (!elements.changesSection || !elements.changesCount || !elements.selectedCount || !elements.applySelectedBtn || !elements.changesList) {
        console.warn('Changes section elements not found during updateChangesSection.');
        return;
    }

    const hasChanges = currentState.pendingChanges.length > 0;
    console.log('Updating changes section. Has changes:', hasChanges, 'Pending changes count:', currentState.pendingChanges.length);
    
    if (hasChanges) {
        elements.changesSection.classList.remove('hidden');
        
        // Update counts and summary
        elements.changesCount.textContent = `${currentState.pendingChanges.length} changes`;
        elements.selectedCount.textContent = `${currentState.selectedChanges.length} selected`;
        
        // Update validation summary
        if (elements.validationSummary) {
            const validCount = currentState.pendingChanges.filter(c => c.isValid).length;
            const invalidCount = currentState.pendingChanges.length - validCount;
            
            if (invalidCount > 0) {
                elements.validationSummary.textContent = `(${validCount} valid, ${invalidCount} invalid)`;
                elements.validationSummary.className = 'validation-summary has-errors';
            } else if (validCount > 0) {
                elements.validationSummary.textContent = '(all valid)';
                elements.validationSummary.className = 'validation-summary all-valid';
            } else {
                elements.validationSummary.textContent = '';
                elements.validationSummary.className = 'validation-summary';
            }
        }
        
        // Update button states
        const isProcessing = currentState.isLoading || currentState.validationInProgress;
        const hasValidSelection = currentState.selectedChanges.length > 0 && 
                                 currentState.pendingChanges
                                     .filter(c => currentState.selectedChanges.includes(c.id))
                                     .every(c => c.isValid);
        
        elements.applySelectedBtn.disabled = !hasValidSelection || isProcessing;
        
        if (elements.selectOnlyValidBtn) {
            const hasValidChanges = currentState.pendingChanges.some(c => c.isValid);
            elements.selectOnlyValidBtn.disabled = !hasValidChanges || isProcessing;
        }
        
        if (elements.validateTargetsBtn) {
            const hasPendingChanges = currentState.pendingChanges.length > 0;
            elements.validateTargetsBtn.disabled = !hasPendingChanges || isProcessing;
            
            // Update button text based on validation state
            if (currentState.validationInProgress) {
                elements.validateTargetsBtn.textContent = 'Validating...';
            } else {
                elements.validateTargetsBtn.textContent = 'Validate Targets';
            }
        }
        
        renderChangesList();
        console.log('Changes section: Visible. Apply button disabled:', elements.applySelectedBtn.disabled);
    } else {
        elements.changesSection.classList.add('hidden');
        elements.changesList.innerHTML = '';
        console.log('Changes section: Hidden.');
    }
}

function updateHistorySection() {
    if (!elements.undoLastBtn) {
        console.warn('History section elements not found during updateHistorySection.');
        return;
    }
    
    const isProcessing = currentState.isLoading || currentState.validationInProgress;
    elements.undoLastBtn.disabled = currentState.changeHistory.length === 0 || isProcessing;
    console.log('Updating history section. Undo button disabled:', elements.undoLastBtn.disabled);
}

function renderChangesList() {
    if (!elements.changesList) {
        console.warn('Changes list element not found during renderChangesList.');
        return;
    }
    elements.changesList.innerHTML = '';
    console.log('Rendering changes list. Count:', currentState.pendingChanges.length);
    
    currentState.pendingChanges.forEach(change => {
        const changeElement = createChangeElement(change);
        elements.changesList.appendChild(changeElement);
    });
}

function createChangeElement(change) {
    const div = document.createElement('div');
    div.className = `change-item ${change.isValid ? 'valid' : 'invalid'}`;

    const isSelected = currentState.selectedChanges.includes(change.id);
    const isProcessing = currentState.isLoading || currentState.validationInProgress;
    
    // Special styling for create_file actions
    if (change.action === 'create_file') {
        div.classList.add('create-file-change');
    }
    
    // Determine status display
    const statusIcon = getStatusIcon(change);
    const statusClass = getStatusClass(change);
    
    // Special warning for create_file on existing files
    const hasOverwriteWarning = change.action === 'create_file' && 
        change.validationWarnings && 
        change.validationWarnings.some(w => w.message.includes('will be overwritten'));
    
    div.innerHTML = `
        <input
            type="checkbox"
            class="change-checkbox"
            data-change-id="${change.id}"
            ${isSelected ? 'checked' : ''}
            ${isProcessing ? 'disabled' : ''}
        >
        <div class="change-content">
            <div class="change-header">
                <div class="change-title">${escapeHtml(getChangeTitle(change))}</div>
                <span class="change-status ${statusClass}">${statusIcon} ${escapeHtml(change.status)}</span>
            </div>
            <div class="change-details">
                <span class="change-detail">📄 ${escapeHtml(change.file)}</span>
                <span class="change-detail">🔧 ${escapeHtml(change.action)}</span>
                ${change.action === 'create_file' ? 
                    `<span class="change-detail">📝 New File</span>` : 
                    `<span class="change-detail">🎯 ${escapeHtml(change.target)}</span>`
                }
                ${change.class ? `<span class="change-detail">📦 ${escapeHtml(change.class)}</span>` : ''}
                ${hasOverwriteWarning ? `<span class="change-detail warning">⚠️ Will Overwrite</span>` : ''}
            </div>
            ${renderChangeValidationErrors(change)}
            ${change.error ? `<div class="legacy-error error">${escapeHtml(change.error)}</div>` : ''}
            <div class="change-actions">
                <button class="secondary preview-btn" data-change-id="${change.id}" ${isProcessing ? 'disabled' : ''}>
                    ${change.action === 'create_file' ? 'Preview New File' : 'Preview'}
                </button>
            </div>
        </div>
    `;

    // Attach event listeners
    const checkbox = div.querySelector('.change-checkbox');
    if (checkbox) {
        checkbox.addEventListener('change', handleChangeCheckboxChange);
    }

    const previewButton = div.querySelector('.preview-btn');
    if (previewButton) {
        previewButton.addEventListener('click', (event) => {
            const changeId = event.currentTarget.dataset.changeId;
            if (changeId && !isProcessing) {
                handlePreviewChange(changeId);
            }
        });
    }
    
    return div;
}

function renderChangeValidationErrors(change) {
    let html = '';
    
    // Render validation errors
    if (change.validationErrors && change.validationErrors.length > 0) {
        html += '<div class="change-validation-errors">';
        change.validationErrors.forEach((error, index) => {
            html += `
                <div class="validation-error">
                    <span class="validation-icon">❌</span>
                    <span class="validation-message">${escapeHtml(error.message)}</span>
                    ${error.suggestion ? `<div class="validation-suggestion">💡 ${escapeHtml(error.suggestion)}</div>` : ''}
                </div>
            `;
        });
        html += '</div>';
    }
    
    // Render validation warnings
    if (change.validationWarnings && change.validationWarnings.length > 0) {
        html += '<div class="change-validation-warnings">';
        change.validationWarnings.forEach((warning, index) => {
            html += `
                <div class="validation-warning">
                    <span class="validation-icon">⚠️</span>
                    <span class="validation-message">${escapeHtml(warning.message)}</span>
                    ${warning.suggestion ? `<div class="validation-suggestion">💡 ${escapeHtml(warning.suggestion)}</div>` : ''}
                </div>
            `;
        });
        html += '</div>';
    }
    
    return html;
}

function getStatusIcon(change) {
    if (!change.isValid) return '❌';
    
    switch (change.status) {
        case 'pending': return '⏳';
        case 'applied': return '✅';
        case 'failed': return '❌';
        case 'error': return '💥';
        case 'validation_error': return '🚫';
        default: return '❓';
    }
}

function getStatusClass(change) {
    if (!change.isValid) return 'invalid';
    return change.status;
}

function getChangeTitle(change) {
    const actionMap = {
        'replace_function': '🔄 Replace Function',
        'replace_method': '🔄 Replace Method',
        'add_function': '➕ Add Function',
        'add_method': '➕ Add Method',
        'add_import': '📥 Add Import',
        'replace_variable': '🔄 Replace Variable',
        'create_file': '📝 Create File'  // NEW
    };
    return actionMap[change.action] || `🔧 ${change.action}`;
}

function escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') {
        return '';
    }
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

console.log('main.js script fully parsed.');