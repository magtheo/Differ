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
    initializeElements();
    attachEventListeners();
    updateUI();
});

function initializeElements() {
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
}

function attachEventListeners() {
    // Input section
    elements.jsonInput.addEventListener('input', handleJsonInputChange);
    elements.parseBtn.addEventListener('click', handleParseInput);
    elements.clearInputBtn.addEventListener('click', handleClearInput);
    
    // Changes section
    elements.applySelectedBtn.addEventListener('click', handleApplySelected);
    elements.clearChangesBtn.addEventListener('click', handleClearChanges);
    
    // History section
    elements.showHistoryBtn.addEventListener('click', handleShowHistory);
    elements.undoLastBtn.addEventListener('click', handleUndoLast);
    
    // Listen for messages from extension
    window.addEventListener('message', handleExtensionMessage);
}

// Event handlers
function handleJsonInputChange(event) {
    currentState.jsonInput = event.target.value;
    elements.parseBtn.disabled = !event.target.value.trim();
}

function handleParseInput() {
    const jsonInput = elements.jsonInput.value.trim();
    if (!jsonInput) return;
    
    sendMessage('parseInput', { jsonInput });
}

function handleClearInput() {
    elements.jsonInput.value = '';
    currentState.jsonInput = '';
    elements.parseBtn.disabled = true;
    sendMessage('clearInput');
}

function handleApplySelected() {
    const selectedChanges = currentState.selectedChanges;
    if (selectedChanges.length === 0) return;
    
    sendMessage('applyChanges', { selectedChanges });
}

function handleClearChanges() {
    sendMessage('clearChanges');
}

function handleShowHistory() {
    sendMessage('showHistory');
}

function handleUndoLast() {
    sendMessage('undoLast');
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
    vscode.postMessage({ type, data });
}

function handleExtensionMessage(event) {
    const message = event.data;
    
    switch (message.type) {
        case 'stateUpdate':
            currentState = { ...currentState, ...message.state };
            updateUI();
            break;
            
        default:
            console.warn('Unknown message type:', message.type);
    }
}

// UI updates
function updateUI() {
    updateStatusSection();
    updateChangesSection();
    updateHistorySection();
}

function updateStatusSection() {
    // Show/hide loading
    if (currentState.isLoading) {
        elements.statusSection.classList.remove('hidden');
        elements.loadingIndicator.classList.remove('hidden');
        elements.errorMessage.classList.add('hidden');
        elements.successMessage.classList.add('hidden');
    } else {
        elements.loadingIndicator.classList.add('hidden');
        
        if (currentState.error) {
            elements.statusSection.classList.remove('hidden');
            elements.errorMessage.classList.remove('hidden');
            elements.errorMessage.textContent = currentState.error;
            elements.successMessage.classList.add('hidden');
        } else if (currentState.pendingChanges.length > 0) {
            elements.statusSection.classList.remove('hidden');
            elements.successMessage.classList.remove('hidden');
            elements.successMessage.textContent = `Successfully parsed ${currentState.pendingChanges.length} changes`;
            elements.errorMessage.classList.add('hidden');
        } else {
            elements.statusSection.classList.add('hidden');
        }
    }
}

function updateChangesSection() {
    const hasChanges = currentState.pendingChanges.length > 0;
    
    if (hasChanges) {
        elements.changesSection.classList.remove('hidden');
        
        // Update counts
        elements.changesCount.textContent = `${currentState.pendingChanges.length} changes`;
        elements.selectedCount.textContent = `${currentState.selectedChanges.length} selected`;
        
        // Update apply button
        elements.applySelectedBtn.disabled = currentState.selectedChanges.length === 0 || currentState.isLoading;
        
        // Update changes list
        renderChangesList();
    } else {
        elements.changesSection.classList.add('hidden');
    }
}

function updateHistorySection() {
    // TODO: Update history display when history functionality is implemented
    elements.undoLastBtn.disabled = currentState.changeHistory.length === 0;
}

function renderChangesList() {
    elements.changesList.innerHTML = '';
    
    currentState.pendingChanges.forEach(change => {
        const changeElement = createChangeElement(change);
        elements.changesList.appendChild(changeElement);
    });
}

function createChangeElement(change) {
    const div = document.createElement('div');
    div.className = 'change-item';
    
    const isSelected = currentState.selectedChanges.includes(change.id);
    
    div.innerHTML = `
        <input 
            type="checkbox" 
            class="change-checkbox" 
            data-change-id="${change.id}"
            ${isSelected ? 'checked' : ''}
        >
        <div class="change-content">
            <div class="change-header">
                <div class="change-title">${getChangeTitle(change)}</div>
                <div class="change-status ${change.status}">${change.status}</div>
            </div>
            <div class="change-details">
                <span class="change-detail">📄 ${change.file}</span>
                <span class="change-detail">🔧 ${change.action}</span>
                <span class="change-detail">🎯 ${change.target}</span>
                ${change.class ? `<span class="change-detail">📦 ${change.class}</span>` : ''}
            </div>
            ${change.error ? `<div class="error">${change.error}</div>` : ''}
            <div class="change-actions">
                <button onclick="handlePreviewChange('${change.id}')" class="secondary">Preview</button>
            </div>
        </div>
    `;
    
    // Attach checkbox event listener
    const checkbox = div.querySelector('.change-checkbox');
    checkbox.addEventListener('change', handleChangeCheckboxChange);
    
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
    };
    
    return actionMap[change.action] || change.action;
}

// Initialize parse button state
elements.parseBtn && (elements.parseBtn.disabled = true);