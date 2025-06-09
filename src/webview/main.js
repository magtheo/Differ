// src/webview/main.js
console.log('=== WEBVIEW MAIN.JS STARTING (View Title Bar Actions Version) ===');
console.log('Document ready state:', document.readyState);
console.log('VS Code API available:', typeof acquireVsCodeApi);

// Get VS Code API
const vscode = acquireVsCodeApi();

// State management
let currentState = {
    jsonInput: '', // Contains comment format input
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
    console.log('DOM Content Loaded. Initializing UI for view title bar actions...');
    initializeElements();
    attachEventListeners();
    updateUI(); // This will ensure Quick Start respects its 'hidden' class
    console.log('Initialization complete. Ready for view title bar actions.');
});

function initializeElements() {
    console.log('Initializing DOM elements for view title bar actions.');
    elements = {
        // Toolbar and Dropdown elements are REMOVED from here

        // Input Section
        inputTextarea: document.getElementById('inputTextarea'),
        parseBtn: document.getElementById('parseBtn'),
        clearInputBtn: document.getElementById('clearInputBtn'),
        
        // Status Section
        statusSection: document.getElementById('statusSection'),
        loadingIndicator: document.getElementById('loadingIndicator'),
        globalErrors: document.getElementById('globalErrors'),
        globalErrorsList: document.getElementById('globalErrorsList'),
        globalWarnings: document.getElementById('globalWarnings'),
        globalWarningsList: document.getElementById('globalWarningsList'),
        retryValidationBtn: document.getElementById('retryValidationBtn'),
        errorMessage: document.getElementById('errorMessage'),
        successMessage: document.getElementById('successMessage'),
        
        // Changes Section
        changesSection: document.getElementById('changesSection'),
        changesCount: document.getElementById('changesCount'),
        selectedCount: document.getElementById('selectedCount'),
        validationSummary: document.getElementById('validationSummary'),
        applySelectedBtn: document.getElementById('applySelectedBtn'),
        selectOnlyValidBtn: document.getElementById('selectOnlyValidBtn'),
        validateTargetsBtn: document.getElementById('validateTargetsBtn'),
        clearChangesBtn: document.getElementById('clearChangesBtn'),
        changesList: document.getElementById('changesList'),

        // Quick Start Section
        quickStartSection: document.getElementById('quickStartSection'),
        
        // History Section
        showHistoryBtn: document.getElementById('showHistoryBtn'),
        undoLastBtn: document.getElementById('undoLastBtn'),
        historyList: document.getElementById('historyList')
    };
    console.log('DOM elements initialized:', Object.keys(elements).filter(key => elements[key]).join(', '));
}

function attachEventListeners() {
    console.log('Attaching event listeners for view title bar actions.');
    
    // Event listeners for HTML dropdown are REMOVED

    // Input section
    if (elements.inputTextarea) elements.inputTextarea.addEventListener('input', handleInputChange);
    if (elements.parseBtn) elements.parseBtn.addEventListener('click', handleParseInput);
    if (elements.clearInputBtn) elements.clearInputBtn.addEventListener('click', handleClearInput);
    
    // Validation section
    if (elements.retryValidationBtn) elements.retryValidationBtn.addEventListener('click', handleRetryValidation);
    
    // Changes section
    if (elements.applySelectedBtn) elements.applySelectedBtn.addEventListener('click', handleApplySelected);
    if (elements.selectOnlyValidBtn) elements.selectOnlyValidBtn.addEventListener('click', handleSelectOnlyValid);
    if (elements.validateTargetsBtn) elements.validateTargetsBtn.addEventListener('click', handleValidateTargets);
    if (elements.clearChangesBtn) elements.clearChangesBtn.addEventListener('click', handleClearChanges);
    
    // History section
    if (elements.showHistoryBtn) elements.showHistoryBtn.addEventListener('click', handleShowHistory);
    if (elements.undoLastBtn) elements.undoLastBtn.addEventListener('click', handleUndoLast);
    
    // Listen for messages from extension
    window.addEventListener('message', handleExtensionMessage);
    
    // Global click listener for closing HTML dropdown is REMOVED
    console.log('Event listeners attached.');
}

// Event Handlers for Dropdown are REMOVED
// handleToggleHelpDropdown, handleShowExample (webview version), handleShowHelp (webview version) are removed.
// handleToggleQuickstart (webview version) is also removed; its logic is now in the message handler.


// Input and Action Handlers (mostly unchanged, but no longer responsible for dropdown interactions)
function handleInputChange(event) {
    currentState.jsonInput = event.target.value;
    const hasContent = currentState.jsonInput.trim().length > 0;
    
    currentState.globalValidationErrors = [];
    currentState.globalValidationWarnings = [];
    currentState.error = null;
    
    if (elements.parseBtn) {
        elements.parseBtn.disabled = !hasContent || currentState.isLoading || currentState.validationInProgress;
    }
    updateStatusSection();
}

function handleParseInput() {
    const input = elements.inputTextarea ? elements.inputTextarea.value.trim() : '';
    if (!input || currentState.isLoading || currentState.validationInProgress) {
        console.warn('ParseInput handler: No input or currently processing. Aborting.');
        return;
    }
    sendMessage('parseInput', { input });
}

function handleClearInput() {
    if (elements.inputTextarea) {
        elements.inputTextarea.value = '';
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
    if (!currentState.jsonInput.trim()) {
        console.warn('No input to retry validation with.');
        return;
    }
    // The extension side will use the existing currentState.jsonInput for retrying
    sendMessage('retryValidation');
}

function handleApplySelected() {
    const selectedChanges = currentState.selectedChanges;
    if (selectedChanges.length === 0 || currentState.isLoading || currentState.validationInProgress) {
        console.warn('ApplySelected handler: No changes selected or currently processing. Aborting.');
        return;
    }
    sendMessage('applyChanges', { selectedChanges });
}

function handleSelectOnlyValid() {
    sendMessage('selectOnlyValid');
}

function handleValidateTargets() {
    if (currentState.isLoading || currentState.validationInProgress) {
        console.warn('Validation already in progress, ignoring request.');
        return;
    }
    sendMessage('validateTargets');
}

function handleClearChanges() {
    sendMessage('clearChanges');
}

function handleShowHistory() {
    alert('History feature coming soon!');
}

function handleUndoLast() {
    alert('Undo feature coming soon!');
}

function handleChangeCheckboxChange(event) {
    const changeId = event.target.dataset.changeId;
    const selected = event.target.checked;
    sendMessage('toggleChangeSelection', { changeId, selected });
}

function handlePreviewChange(changeId) {
    sendMessage('previewChange', { changeId });
}

// Message handling
function sendMessage(type, data = {}) {
    console.log(`Sending message to extension -> Type: ${type}`, data);
    vscode.postMessage({ type, data });
}

function handleExtensionMessage(event) {
    const message = event.data;
    console.log(`Received message from extension <- Type: ${message.type}`);
    
    switch (message.type) {
        case 'stateUpdate':
            currentState = { ...currentState, ...message.state };
            updateUI();
            break;
        case 'toggleQuickStart': // NEW message handler
            if (elements.quickStartSection) {
                elements.quickStartSection.classList.toggle('hidden');
                console.log('Quick Start section visibility toggled by extension message.');
            }
            break;
        default:
            console.warn('Unknown message type received from extension:', message.type);
    }
}

// UI updates
function updateUI() {
    console.log('Updating UI. State overview:', {
        isLoading: currentState.isLoading,
        validationInProgress: currentState.validationInProgress,
        globalErrors: currentState.globalValidationErrors.length,
        pendingChanges: currentState.pendingChanges.length,
    });
    
    updateInputSection();
    updateStatusSection();
    updateChangesSection();
    updateHistorySection();
    // No specific update needed for quickStartSection here, its class is managed by the message handler.
    
    console.log('UI update complete.');
}

function updateInputSection() {
    if (elements.inputTextarea && elements.inputTextarea.value !== currentState.jsonInput) {
        elements.inputTextarea.value = currentState.jsonInput;
    }
    
    if (elements.parseBtn) {
        const hasContent = currentState.jsonInput.trim().length > 0;
        const isProcessing = currentState.isLoading || currentState.validationInProgress;
        elements.parseBtn.disabled = !hasContent || isProcessing;
        elements.parseBtn.innerHTML = isProcessing 
            ? (currentState.validationInProgress ? '🔄 Validating...' : '⏳ Processing...') 
            : '🚀 Parse Changes';
    }
}

// updateStatusSection, showGlobalErrors, hideGlobalErrors, showGlobalWarnings, hideGlobalWarnings,
// hideAllValidationElements, hasAnyStatusContent, createValidationErrorElement,
// updateChangesSection, updateHistorySection, renderChangesList, createChangeElement,
// renderChangeValidationErrors, getStatusIcon, getStatusClass, getChangeTitle, escapeHtml
// remain the SAME as in the previous complete main.js file you have.
// I will include them here for completeness.

function updateStatusSection() {
    if (!elements.statusSection) return;

    elements.statusSection.classList.add('hidden');
    elements.loadingIndicator.classList.add('hidden');
    hideAllValidationElements();

    if (currentState.isLoading || currentState.validationInProgress) {
        elements.statusSection.classList.remove('hidden');
        elements.loadingIndicator.classList.remove('hidden');
        return;
    }
    
    if (currentState.globalValidationErrors.length > 0) {
        elements.statusSection.classList.remove('hidden');
        showGlobalErrors();
    }
    
    if (currentState.globalValidationWarnings.length > 0) {
        elements.statusSection.classList.remove('hidden');
        showGlobalWarnings();
    }
    
    if (currentState.error && currentState.globalValidationErrors.length === 0) {
        elements.statusSection.classList.remove('hidden');
        elements.errorMessage.classList.remove('hidden');
        elements.errorMessage.textContent = currentState.error;
        elements.successMessage.classList.add('hidden');
    } else {
        elements.errorMessage.classList.add('hidden');
    }
    
    if (!currentState.isLoading && !currentState.validationInProgress &&
        currentState.globalValidationErrors.length === 0 && !currentState.error &&
        currentState.parsedInput && currentState.pendingChanges.length > 0) {
        elements.statusSection.classList.remove('hidden');
        elements.successMessage.classList.remove('hidden');
        elements.successMessage.textContent = `✅ Successfully parsed ${currentState.pendingChanges.length} changes. ${currentState.parsedInput.description || '(no description)'}`;
    } else {
        elements.successMessage.classList.add('hidden');
    }
    
    if (!hasAnyStatusContent()) {
        elements.statusSection.classList.add('hidden');
    }
}

function showGlobalErrors() {
    if (!elements.globalErrors || !elements.globalErrorsList) return;
    elements.globalErrors.classList.remove('hidden');
    elements.globalErrorsList.innerHTML = '';
    currentState.globalValidationErrors.forEach((error, index) => {
        elements.globalErrorsList.appendChild(createValidationErrorElement(error, index, 'error'));
    });
}

function hideGlobalErrors() {
    if (elements.globalErrors) elements.globalErrors.classList.add('hidden');
}

function showGlobalWarnings() {
    if (!elements.globalWarnings || !elements.globalWarningsList) return;
    elements.globalWarnings.classList.remove('hidden');
    elements.globalWarningsList.innerHTML = '';
    currentState.globalValidationWarnings.forEach((warning, index) => {
        elements.globalWarningsList.appendChild(createValidationErrorElement(warning, index, 'warning'));
    });
}

function hideGlobalWarnings() {
    if (elements.globalWarnings) elements.globalWarnings.classList.add('hidden');
}

function hideAllValidationElements() {
    hideGlobalErrors();
    hideGlobalWarnings();
    if (elements.errorMessage) elements.errorMessage.classList.add('hidden');
    if (elements.successMessage) elements.successMessage.classList.add('hidden');
}

function hasAnyStatusContent() {
    return currentState.isLoading || currentState.validationInProgress ||
           currentState.globalValidationErrors.length > 0 ||
           currentState.globalValidationWarnings.length > 0 ||
           !!currentState.error ||
           (currentState.parsedInput && currentState.pendingChanges.length > 0);
}

function createValidationErrorElement(validationItem, index, type) {
    const div = document.createElement('div');
    div.className = `validation-item ${type}`;
    const typeLabel = type === 'error' ? '❌' : '⚠️';
    // Adjusted to refer to 'blockIndex' if your ValidationError interface uses that, or 'changeIndex'
    const itemContextInfo = validationItem.changeIndex !== undefined ? ` (Block ${validationItem.changeIndex + 1})` : 
                           (validationItem.blockIndex !== undefined ? ` (Block ${validationItem.blockIndex + 1})` : '');
    const fieldInfo = validationItem.field ? ` - Field: ${validationItem.field}` : '';
    
    div.innerHTML = `
        <div class="validation-item-header">
            <span class="validation-icon">${typeLabel}</span>
            <span class="validation-message">${escapeHtml(validationItem.message)}</span>
        </div>
        ${validationItem.suggestion ? `<div class="validation-suggestion">💡 ${escapeHtml(validationItem.suggestion)}</div>` : ''}
        ${itemContextInfo || fieldInfo ? `<div class="validation-context">${escapeHtml(itemContextInfo + fieldInfo)}</div>` : ''}
    `;
    return div;
}


function updateChangesSection() {
    if (!elements.changesSection || !elements.changesCount || !elements.selectedCount || !elements.applySelectedBtn || !elements.changesList) return;

    const hasChanges = currentState.pendingChanges.length > 0;
    elements.changesSection.classList.toggle('hidden', !hasChanges);

    if (hasChanges) {
        elements.changesCount.textContent = `${currentState.pendingChanges.length} changes`;
        elements.selectedCount.textContent = `${currentState.selectedChanges.length} selected`;
        
        if (elements.validationSummary) {
            const validCount = currentState.pendingChanges.filter(c => c.isValid).length;
            const invalidCount = currentState.pendingChanges.length - validCount;
            if (invalidCount > 0) {
                elements.validationSummary.textContent = `(${validCount} valid, ${invalidCount} invalid)`;
                elements.validationSummary.className = 'validation-summary has-errors';
            } else if (validCount > 0) {
                elements.validationSummary.textContent = '(all valid ✅)';
                elements.validationSummary.className = 'validation-summary all-valid';
            } else {
                elements.validationSummary.textContent = '';
                elements.validationSummary.className = 'validation-summary';
            }
        }
        
        const isProcessing = currentState.isLoading || currentState.validationInProgress;
        const hasValidSelection = currentState.selectedChanges.length > 0 && 
                                 currentState.pendingChanges
                                     .filter(c => currentState.selectedChanges.includes(c.id))
                                     .every(c => c.isValid);
        
        if(elements.applySelectedBtn) elements.applySelectedBtn.disabled = !hasValidSelection || isProcessing;
        if(elements.selectOnlyValidBtn) elements.selectOnlyValidBtn.disabled = !currentState.pendingChanges.some(c => c.isValid) || isProcessing;
        if(elements.validateTargetsBtn) {
            elements.validateTargetsBtn.disabled = !currentState.pendingChanges.length > 0 || isProcessing;
            elements.validateTargetsBtn.innerHTML = isProcessing && currentState.validationInProgress ? '🔄 Validating...' : '🔍 Validate Targets';
        }
        
        renderChangesList();
    } else {
        elements.changesList.innerHTML = '';
    }
}

function updateHistorySection() {
    if (!elements.undoLastBtn || !elements.showHistoryBtn) return;
    const isProcessing = currentState.isLoading || currentState.validationInProgress;
    elements.undoLastBtn.disabled = currentState.changeHistory.length === 0 || isProcessing;
    elements.showHistoryBtn.disabled = isProcessing; 
}

function renderChangesList() {
    if (!elements.changesList) return;
    elements.changesList.innerHTML = '';
    currentState.pendingChanges.forEach(change => {
        elements.changesList.appendChild(createChangeElement(change));
    });
}

function createChangeElement(change) {
    const div = document.createElement('div');
    div.className = `change-item ${change.isValid ? 'valid' : 'invalid'}`;
    if (change.action === 'create_file') div.classList.add('create-file-change');

    const isSelected = currentState.selectedChanges.includes(change.id);
    const isProcessing = currentState.isLoading || currentState.validationInProgress;
    const statusIcon = getStatusIcon(change);
    const statusClass = getStatusClass(change);
    const hasOverwriteWarning = change.action === 'create_file' && 
        change.validationWarnings && 
        change.validationWarnings.some(w => w.message.includes('will be overwritten'));
    
    div.innerHTML = `
        <input type="checkbox" class="change-checkbox" data-change-id="${change.id}" ${isSelected ? 'checked' : ''} ${isProcessing ? 'disabled' : ''}>
        <div class="change-content">
            <div class="change-header">
                <div class="change-title">${escapeHtml(getChangeTitle(change))}</div>
                <span class="change-status ${statusClass}">${statusIcon} ${escapeHtml(change.status)}</span>
            </div>
            <div class="change-details">
                <span class="change-detail">📄 ${escapeHtml(change.file)}</span>
                <span class="change-detail">🔧 ${escapeHtml(change.action)}</span>
                ${change.action === 'create_file' ? `<span class="change-detail">📝 New File</span>` : `<span class="change-detail">🎯 ${escapeHtml(change.target)}</span>`}
                ${change.class ? `<span class="change-detail">📦 ${escapeHtml(change.class)}</span>` : ''}
                ${hasOverwriteWarning ? `<span class="change-detail warning">⚠️ Will Overwrite</span>` : ''}
            </div>
            ${change.description ? `<div class="change-description">${escapeHtml(change.description)}</div>` : ''}
            ${renderChangeValidationErrors(change)}
            ${change.error ? `<div class="legacy-error error">${escapeHtml(change.error)}</div>` : ''}
            <div class="change-actions">
                <button class="secondary preview-btn" data-change-id="${change.id}" ${isProcessing ? 'disabled' : ''}>
                    ${change.action === 'create_file' ? '👁️ Preview New File' : '👁️ Preview Changes'}
                </button>
            </div>
        </div>
    `;

    const checkbox = div.querySelector('.change-checkbox');
    if (checkbox) checkbox.addEventListener('change', handleChangeCheckboxChange);
    const previewButton = div.querySelector('.preview-btn');
    if (previewButton) previewButton.addEventListener('click', (event) => {
        if (!isProcessing) handlePreviewChange(event.currentTarget.dataset.changeId);
    });
    return div;
}

function renderChangeValidationErrors(change) {
    let html = '';
    if (change.validationErrors && change.validationErrors.length > 0) {
        html += '<div class="change-validation-errors">';
        change.validationErrors.forEach(error => {
            html += `<div class="validation-error"><span class="validation-icon">❌</span><span class="validation-message">${escapeHtml(error.message)}</span>${error.suggestion ? `<div class="validation-suggestion">💡 ${escapeHtml(error.suggestion)}</div>` : ''}</div>`;
        });
        html += '</div>';
    }
    if (change.validationWarnings && change.validationWarnings.length > 0) {
        html += '<div class="change-validation-warnings">';
        change.validationWarnings.forEach(warning => {
            html += `<div class="validation-warning"><span class="validation-icon">⚠️</span><span class="validation-message">${escapeHtml(warning.message)}</span>${warning.suggestion ? `<div class="validation-suggestion">💡 ${escapeHtml(warning.suggestion)}</div>` : ''}</div>`;
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
        case 'failed': return '💥';
        case 'error': return '🚫';
        case 'validation_error': return '⚠️';
        default: return '❓';
    }
}

function getStatusClass(change) {
    return change.isValid ? change.status : 'invalid';
}

function getChangeTitle(change) {
    const actionMap = {
        'create_file': '📝 Create File', 'add_function': '➕ Add Function', 'replace_function': '🔄 Replace Function',
        'add_method': '➕ Add Method', 'replace_method': '🔄 Replace Method', 'add_import': '📥 Add Import',
        'add_struct': '🏗️ Add Struct', 'add_enum': '📋 Add Enum', 'replace_block': '🔄 Replace Block',
        'insert_after': '⬇️ Insert After', 'insert_before': '⬆️ Insert Before', 'delete_function': '🗑️ Delete Function',
        'modify_line': '✏️ Modify Line'
    };
    const actionTitle = actionMap[change.action] || `🔧 ${change.action}`;
    if (change.description && change.description.trim() && change.description !== change.target) {
        return `${actionTitle}: ${change.description}`;
    } else if (change.target && change.target.trim()) {
        return `${actionTitle}: ${change.target}`;
    }
    return actionTitle;
}

function escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') return '';
    return unsafe.replace(/&/g, "&").replace(/</g, "<").replace(/>/g, ">").replace(/"/g, '"').replace(/'/g, "'");
}

console.log('View title bar actions main.js script fully parsed.');