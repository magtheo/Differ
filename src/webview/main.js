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
    changeHistory: []
};

// DOM elements
let elements = {};

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM Content Loaded. Initializing...');
    initializeElements();
    attachEventListeners();
    updateUI(); // This will use the initial currentState.isLoading = false
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
        errorMessage: document.getElementById('errorMessage'),
        successMessage: document.getElementById('successMessage'),
        
        changesSection: document.getElementById('changesSection'),
        changesCount: document.getElementById('changesCount'),
        selectedCount: document.getElementById('selectedCount'),
        applySelectedBtn: document.getElementById('applySelectedBtn'),
        clearChangesBtn: document.getElementById('clearChangesBtn'),
        changesList: document.getElementById('changesList'),
        
        showHistoryBtn: document.getElementById('showHistoryBtn'),
        undoLastBtn: document.getElementById('undoLastBtn'),
        historyList: document.getElementById('historyList')
    };
    console.log('DOM elements initialized:', elements);
}

function attachEventListeners() {
    console.log('Attaching event listeners.');
    // Input section
    if (elements.jsonInput) elements.jsonInput.addEventListener('input', handleJsonInputChange);
    if (elements.parseBtn) elements.parseBtn.addEventListener('click', handleParseInput);
    if (elements.clearInputBtn) elements.clearInputBtn.addEventListener('click', handleClearInput);
    
    // Changes section
    if (elements.applySelectedBtn) elements.applySelectedBtn.addEventListener('click', handleApplySelected);
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
    if (elements.parseBtn) {
        elements.parseBtn.disabled = !hasContent || currentState.isLoading;
    }
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
    
    if (!jsonInput || currentState.isLoading) {
        console.warn('ParseInput handler: No input or currently loading. Aborting.');
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
    if (elements.parseBtn) {
        elements.parseBtn.disabled = true; // Always disable if input is cleared
    }
    sendMessage('clearInput');
    // Manually trigger a UI update for the input field and parse button state
    updateUI();
}

function handleApplySelected() {
    const selectedChanges = currentState.selectedChanges;
    console.log('Apply selected button clicked. Selected changes count:', selectedChanges.length, 'isLoading:', currentState.isLoading);
    
    if (selectedChanges.length === 0 || currentState.isLoading) {
        console.warn('ApplySelected handler: No changes selected or currently loading. Aborting.');
        return;
    }
    
    sendMessage('applyChanges', { selectedChanges });
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
    console.log('Received message from extension <- Type:', message.type, 'Full Message:', message);
    
    switch (message.type) {
        case 'stateUpdate':
            console.log('State update received. Old state:', JSON.parse(JSON.stringify(currentState)));
            currentState = { ...currentState, ...message.state };
            console.log('New state after update:', JSON.parse(JSON.stringify(currentState)));
            updateUI();
            break;
            
        default:
            console.warn('Unknown message type received from extension:', message.type);
    }
}

// UI updates
function updateUI() {
    console.log('Updating UI. Current state:', JSON.parse(JSON.stringify(currentState)));
    updateStatusSection();
    updateChangesSection();
    updateHistorySection();
    
    // Update input field and parse button state explicitly
    if (elements.jsonInput && elements.jsonInput.value !== currentState.jsonInput) {
        elements.jsonInput.value = currentState.jsonInput;
    }
    
    if (elements.parseBtn) {
        const hasContent = currentState.jsonInput.trim().length > 0;
        elements.parseBtn.disabled = !hasContent || currentState.isLoading;
        console.log(
            'updateUI: Parse button state. HasContent:', hasContent, 
            'isLoading:', currentState.isLoading, 
            'Disabled:', elements.parseBtn.disabled
        );
    }
    console.log('UI update complete.');
}

function updateStatusSection() {
    console.log('Updating status section. isLoading:', currentState.isLoading, 'Error:', currentState.error);
    
    if (!elements.statusSection || !elements.loadingIndicator || !elements.errorMessage || !elements.successMessage) {
        console.warn('Status section elements not found during updateStatusSection.');
        return;
    }

    // Always manage visibility of the whole section first
    elements.statusSection.classList.add('hidden');

    if (currentState.isLoading) {
        elements.statusSection.classList.remove('hidden');
        elements.loadingIndicator.classList.remove('hidden');
        elements.errorMessage.classList.add('hidden');
        elements.successMessage.classList.add('hidden');
        console.log('Status: Loading indicator visible.');
    } else {
        elements.loadingIndicator.classList.add('hidden');
        
        if (currentState.error) {
            elements.statusSection.classList.remove('hidden');
            elements.errorMessage.classList.remove('hidden');
            elements.errorMessage.textContent = currentState.error;
            elements.successMessage.classList.add('hidden');
            console.log('Status: Error message visible:', currentState.error);
        } else if (currentState.parsedInput && currentState.pendingChanges.length > 0 && !currentState.error) {
            // Show success message only if parsing was successful and there are changes
            elements.statusSection.classList.remove('hidden');
            elements.successMessage.classList.remove('hidden');
            elements.successMessage.textContent = `Successfully parsed ${currentState.pendingChanges.length} changes. Description: ${currentState.parsedInput.description || '(no description)'}`;
            elements.errorMessage.classList.add('hidden');
            console.log('Status: Success message visible.');
        } else {
            // If not loading, no error, and no parsed changes to report success on, hide the section
            elements.statusSection.classList.add('hidden');
            console.log('Status: Section hidden (no loading, error, or success to show).');
        }
    }
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
        
        elements.changesCount.textContent = `${currentState.pendingChanges.length} changes`;
        elements.selectedCount.textContent = `${currentState.selectedChanges.length} selected`;
        
        elements.applySelectedBtn.disabled = currentState.selectedChanges.length === 0 || currentState.isLoading;
        
        renderChangesList();
        console.log('Changes section: Visible. Apply button disabled:', elements.applySelectedBtn.disabled);
    } else {
        elements.changesSection.classList.add('hidden');
        elements.changesList.innerHTML = ''; // Clear list if no changes
        console.log('Changes section: Hidden.');
    }
}

function updateHistorySection() {
    if (!elements.undoLastBtn || !elements.historyList) {
        console.warn('History section elements not found during updateHistorySection.');
        return;
    }
    // TODO: Update history display when history functionality is implemented
    elements.undoLastBtn.disabled = currentState.changeHistory.length === 0 || currentState.isLoading;
    console.log('Updating history section. Undo button disabled:', elements.undoLastBtn.disabled);
}

function renderChangesList() {
    if (!elements.changesList) {
        console.warn('Changes list element not found during renderChangesList.');
        return;
    }
    elements.changesList.innerHTML = ''; // Clear previous items
    console.log('Rendering changes list. Count:', currentState.pendingChanges.length);
    
    currentState.pendingChanges.forEach(change => {
        const changeElement = createChangeElement(change);
        elements.changesList.appendChild(changeElement);
    });
}

function createChangeElement(change) {
    const div = document.createElement('div');
    div.className = 'change-item';

    const isSelected = currentState.selectedChanges.includes(change.id);
    const codeText = change.code || '';

    div.innerHTML = `
        <input
            type="checkbox"
            class="change-checkbox"
            data-change-id="${change.id}"
            ${isSelected ? 'checked' : ''}
            ${currentState.isLoading ? 'disabled' : ''}
        >
        <div class="change-content">
            <div class="change-header">
                <div class="change-title">${escapeHtml(getChangeTitle(change))}</div>
                <span class="change-status ${escapeHtml(change.status)}">${escapeHtml(change.status)}</span>
            </div>
            <div class="change-details">
                <span class="change-detail">📄 ${escapeHtml(change.file)}</span>
                <span class="change-detail">🔧 ${escapeHtml(change.action)}</span>
                <span class="change-detail">🎯 ${escapeHtml(change.target)}</span>
                ${change.class ? `<span class="change-detail">📦 ${escapeHtml(change.class)}</span>` : ''}
            </div>
            ${change.error ? `<div class="error">${escapeHtml(change.error)}</div>` : ''}
            <!-- <div class="code-preview">
                <div class="code-preview-header">Code Snippet</div>
                <pre class="code-preview-content">${escapeHtml(codeText.substring(0, 200) + (codeText.length > 200 ? '...' : ''))}</pre>
            </div> -->
            <div class="change-actions">
                <button class="secondary preview-btn" data-change-id="${change.id}" ${currentState.isLoading ? 'disabled' : ''}>Preview</button>
            </div>
        </div>
    `;

    const checkbox = div.querySelector('.change-checkbox');
    if (checkbox) {
        checkbox.addEventListener('change', handleChangeCheckboxChange);
    }

    // Add event listener for the preview button
    const previewButton = div.querySelector('.preview-btn');
    if (previewButton) {
        previewButton.addEventListener('click', (event) => {
            const changeId = event.currentTarget.dataset.changeId;
            if (changeId && !currentState.isLoading) {
                handlePreviewChange(changeId);
            }
        });
    }
    return div;
}

function getChangeTitle(change) {
    const actionMap = {
        'replace_function': '🔄 Replace Function',
        'replace_method': '🔄 Replace Method',
        'add_function': '➕ Add Function',
        'add_method': '➕ Add Method',
        'add_import': '📥 Add Import',
        'replace_variable': '🔄 Replace Variable'
        // Add more user-friendly titles for other actions as needed
    };
    return actionMap[change.action] || change.action; // Fallback to raw action if not mapped
}

function escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') {
        return '';
    }
    return unsafe
         .replace(/&/g, "&")
         .replace(/</g, "<")
         .replace(/>/g, ">")
         .replace(/"/g, '"')
         .replace(/'/g, "'");
}

// This line was from your original code. It's generally handled by updateUI now,
// but leaving it commented out for reference. It might have been intended
// to ensure the parse button is disabled before any state is received.
// elements.parseBtn && (elements.parseBtn.disabled = true);
console.log('main.js script fully parsed.');