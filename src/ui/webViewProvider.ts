import * as vscode from 'vscode';
import * as path from 'path';
import { UIStateManager, PendingChange, ParsedInput } from './stateManager';
import { ChangeParser, ValidationError, ValidationWarning } from '../parser/inputParser';
import { ValidationEngine, ValidationSummary } from '../validation/validationEngine';
import { ErrorReporter } from '../validation/errorReporter';
import { Logger } from '../utils/logger';

export class DifferProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'differ-panel';
    
    private _view?: vscode.WebviewView;
    private _stateManager: UIStateManager;
    private _logger: Logger;
    
    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _context: vscode.ExtensionContext
    ) {
        this._logger = new Logger('WebViewProvider');
        this._stateManager = new UIStateManager();
        
        // Listen to state changes and update webview
        this._stateManager.onStateChange((newState) => {
            this._logger.info('State changed, preparing to update webview.', { 
                stateIsLoading: newState.isLoading, 
                validationInProgress: newState.validationInProgress,
                globalErrors: newState.globalValidationErrors.length,
                pendingChangesCount: newState.pendingChanges.length 
            });
            this._updateWebview();
        });
        
        this._logger.info('DifferProvider constructed. Initial state:', this._stateManager.getStateSnapshot());
    }
    
    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._logger.info('Resolving webview view.');
        this._view = webviewView;
        
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this._extensionUri,
                vscode.Uri.joinPath(this._extensionUri, 'out')
            ]
        };
        
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        
        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(
            message => this._handleMessage(message),
            undefined,
            this._context.subscriptions
        );
        
        // Initialize with current state
        this._logger.info('Webview HTML set. Sending initial state to webview.', { 
            initialStateIsLoading: this._stateManager.getState().isLoading 
        });
        this._updateWebview();
        
        this._logger.info('WebView resolved and initialized');
    }
    
    public show() {
        if (this._view) {
            this._logger.info('Showing webview panel.');
            this._view.show(true);
        } else {
            this._logger.warn('Attempted to show webview, but it is not available.');
        }
    }
    
    public dispose() {
        this._logger.info('Disposing DifferProvider.');
        this._stateManager.dispose();
    }
    
    public clearChanges() {
        this._logger.info('Clearing pending changes via public method.');
        this._stateManager.clearPendingChanges();
    }
    
    private async _handleMessage(message: any) {
        this._logger.info('Received message from webview', { type: message.type, data: message.data });
        
        switch (message.type) {
            case 'parseInput':
                await this._handleParseInput(message.data);
                break;
                
            case 'applyChanges':
                await this._handleApplyChanges(message.data);
                break;
                
            case 'previewChange':
                await this._handlePreviewChange(message.data);
                break;
                
            case 'toggleChangeSelection':
                this._handleToggleChangeSelection(message.data);
                break;
                
            case 'selectOnlyValid':
                this._handleSelectOnlyValid();
                break;
                
            case 'clearInput':
                this._logger.info('Handling clearInput message.');
                this._stateManager.clearInput();
                break;
                
            case 'clearChanges':
                this._logger.info('Handling clearChanges message.');
                this._stateManager.clearPendingChanges();
                break;
                
            case 'retryValidation':
                await this._handleRetryValidation();
                break;
                
            case 'validateTargets':
                await this._handleValidateTargets();
                break;
                
            default:
                this._logger.warn('Unknown message type received from webview', { type: message.type });
        }
    }
    
    private async _handleParseInput(inputData: { jsonInput: string }) {
        this._logger.info('Starting to parse input', { inputLength: inputData.jsonInput?.length });
        
        // Clear previous state and start loading
        this._stateManager.setLoading(true);
        this._stateManager.clearGlobalValidationErrors();
        this._stateManager.clearAllValidationErrors();
        this._stateManager.clearPendingChanges();
        
        try {
            // Validate input is not empty
            if (!inputData.jsonInput || inputData.jsonInput.trim() === '') {
                this._stateManager.setGlobalValidationErrors([{
                    type: 'json_parse',
                    message: 'Input cannot be empty',
                    suggestion: 'Please paste valid JSON containing a "changes" array'
                }]);
                return;
            }
            
            // Phase 1: JSON Structure Validation
            this._logger.info('Phase 1: Validating JSON structure');
            const structureValidation = ChangeParser.validateJsonStructure(inputData.jsonInput.trim());
            
            if (!structureValidation.isValid) {
                this._logger.warn('JSON structure validation failed', { 
                    errorCount: structureValidation.errors.length,
                    warningCount: structureValidation.warnings.length 
                });
                
                // Show structure validation errors in the UI
                this._stateManager.setGlobalValidationErrors(
                    structureValidation.errors, 
                    structureValidation.warnings
                );
                return;
            }
            
            // Phase 2: Parse the validated JSON
            this._logger.info('Phase 2: Parsing validated JSON');
            let parsedData: any;
            try {
                parsedData = ChangeParser.parseInput(inputData.jsonInput.trim());
            } catch (parseError) {
                // This shouldn't happen if validation passed, but just in case
                const errorMessage = parseError instanceof Error ? parseError.message : String(parseError);
                this._stateManager.setGlobalValidationErrors([{
                    type: 'json_parse',
                    message: `Unexpected parsing error: ${errorMessage}`,
                    suggestion: 'Please check your JSON format'
                }]);
                return;
            }
            
            // Phase 3: Semantic Validation
            this._logger.info('Phase 3: Semantic validation');
            const semanticValidation = ChangeParser.validateSemanticConsistency(parsedData);
            
            if (!semanticValidation.isValid) {
                this._logger.warn('Semantic validation failed', { 
                    errorCount: semanticValidation.errors.length 
                });
                
                this._stateManager.setGlobalValidationErrors(
                    [...structureValidation.errors, ...semanticValidation.errors],
                    [...structureValidation.warnings, ...semanticValidation.warnings]
                );
                return;
            }
            
            // Phase 4: Create pending changes
            this._logger.info('Phase 4: Creating pending changes');
            const pendingChanges: PendingChange[] = parsedData.changes.map((change: any, index: number) => 
                this._stateManager.createPendingChangeFromParsed(change, index)
            );
            
            // Store results
            this._stateManager.setParsedInput(parsedData);
            this._stateManager.setPendingChanges(pendingChanges);
            
            // Store any warnings from validation
            if (structureValidation.warnings.length > 0 || semanticValidation.warnings.length > 0) {
                this._stateManager.setGlobalValidationErrors(
                    [], // No errors if we got this far
                    [...structureValidation.warnings, ...semanticValidation.warnings]
                );
            }
            
            // Phase 5: Target Existence Validation (automatic)
            this._logger.info('Phase 5: Starting target existence validation');
            // Don't await this - let it run in background and update UI when complete
            this._performTargetValidation(parsedData);
            
            this._logger.info('Successfully parsed input.', { 
                changeCount: pendingChanges.length,
                description: parsedData.description,
                warningCount: structureValidation.warnings.length + semanticValidation.warnings.length
            });
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : `Unknown error: ${String(error)}`;
            this._logger.error('Failed to parse input', { error: errorMessage, originalError: error });
            
            this._stateManager.setGlobalValidationErrors([{
                type: 'json_parse',
                message: `Parsing failed: ${errorMessage}`,
                suggestion: 'Check your JSON format and try again'
            }]);
            
        } finally {
            this._stateManager.setLoading(false);
        }
    }
    
    private async _handleApplyChanges(data: { selectedChanges: string[] }) {
        this._logger.info('Handling applyChanges message', { selectedChangeIds: data.selectedChanges });
        this._stateManager.setLoading(true);
        
        const changesToApply = this._stateManager.getSelectedChanges().filter(c => data.selectedChanges.includes(c.id));
        
        try {
            if (changesToApply.length === 0) {
                this._logger.warn("Apply changes requested, but no changes were actually selected or found in state.");
                return;
            }
            
            // Check if any selected changes have validation errors
            const invalidChanges = changesToApply.filter(change => !change.isValid);
            if (invalidChanges.length > 0) {
                this._logger.warn('Attempted to apply invalid changes', { 
                    invalidCount: invalidChanges.length,
                    totalCount: changesToApply.length 
                });
                
                this._stateManager.setGlobalValidationErrors([{
                    type: 'invalid_type',
                    message: `Cannot apply ${invalidChanges.length} invalid changes. Fix validation errors first.`,
                    suggestion: 'Use "Select Only Valid" to select only changes without errors'
                }]);
                return;
            }
            
            this._logger.info(`Executing 'differ.applyChanges' command with ${changesToApply.length} changes.`);
            await vscode.commands.executeCommand('differ.applyChanges', changesToApply);
            
            // Mark applied changes as successful
            changesToApply.forEach(change => {
                this._stateManager.updatePendingChangeStatus(change.id, 'applied');
            });
            
            this._logger.info(`Successfully applied ${changesToApply.length} changes.`);

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this._logger.error('Failed to apply changes via command', { error: errorMessage, originalError: error });
            
            this._stateManager.setGlobalValidationErrors([{
                type: 'json_parse', // Using existing type
                message: `Apply failed: ${errorMessage}`,
                suggestion: 'Check the VS Code output panel for more details'
            }]);
            
            // Mark selected changes as failed
            changesToApply.forEach(change => {
                this._stateManager.updatePendingChangeStatus(change.id, 'failed', errorMessage);
            });
            
        } finally {
            this._stateManager.setLoading(false);
        }
    }
    
    private async _handlePreviewChange(data: { changeId: string }) {
        this._logger.info('Handling previewChange message', { changeId: data.changeId });
        const change = this._stateManager.getState().pendingChanges.find(c => c.id === data.changeId);

        if (!change) {
            this._logger.warn('Preview requested for non-existent change ID', { changeId: data.changeId });
            this._stateManager.setGlobalValidationErrors([{
                type: 'json_parse',
                message: `Cannot preview change: ID ${data.changeId} not found`,
                suggestion: 'Try refreshing the changes list'
            }]);
            return;
        }

        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                this._stateManager.setGlobalValidationErrors([{
                    type: 'json_parse',
                    message: 'No workspace folder open to preview changes',
                    suggestion: 'Open a workspace folder first'
                }]);
                return;
            }
            
            const workspaceRoot = workspaceFolders[0].uri;
            const originalFileUri = vscode.Uri.joinPath(workspaceRoot, change.file);

            this._logger.info(`Constructed originalFileUri for preview: ${originalFileUri.fsPath}`, {
                workspaceRoot: workspaceRoot.fsPath,
                changeFile: change.file
            });

            let originalDocument: vscode.TextDocument;
            try {
                originalDocument = await vscode.workspace.openTextDocument(originalFileUri);
            } catch (e: any) {
                this._logger.error(`Failed to open original file for preview: ${originalFileUri.fsPath}`, e);
                
                this._stateManager.setChangeValidationErrors(change.id, [{
                    type: 'json_parse',
                    message: `File not found: ${change.file}`,
                    suggestion: 'Check that the file path is correct',
                    details: e.message
                }]);
                return;
            }
            
            const originalContent = originalDocument.getText();
            let modifiedContent = originalContent;
            let unableToPreviewReason: string | null = null;
            const EOL = originalDocument.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';

            // Apply transformations to generate modifiedContent based on change.action
            if (change.action.toLowerCase().includes('replace')) {
                if (change.target && change.target.length > 0) {
                    const targetIndex = originalContent.indexOf(change.target);
                    if (targetIndex !== -1) {
                        modifiedContent = originalContent.substring(0, targetIndex) +
                                          change.code +
                                          originalContent.substring(targetIndex + change.target.length);
                    } else {
                        unableToPreviewReason = `Target text to replace was not found in ${change.file}.\nTarget (first 100 chars): "${change.target.substring(0, 100)}..."`;
                        modifiedContent = `// PREVIEW NOTE: ${unableToPreviewReason}${EOL}// Proposed code change below:${EOL}${change.code}${EOL}// --- Original File Content ---${EOL}${originalContent}`;
                    }
                } else {
                    unableToPreviewReason = `'target' for replacement is empty or missing. Cannot determine what to replace.`;
                    modifiedContent = `// PREVIEW NOTE: ${unableToPreviewReason}${EOL}// Proposed code change below:${EOL}${change.code}${EOL}// --- Original File Content ---${EOL}${originalContent}`;
                }
            } else if (change.action.toLowerCase().includes('add') || change.action.toLowerCase().includes('insert')) {
                if (change.target && change.target.toLowerCase().startsWith('line:')) {
                    const lineNumberStr = change.target.substring('line:'.length);
                    const lineNumber = parseInt(lineNumberStr, 10);

                    if (!isNaN(lineNumber) && lineNumber >= 1) {
                        const lines = originalContent.split(EOL);
                        const spliceIndex = Math.max(0, Math.min(lineNumber - 1, lines.length));
                        lines.splice(spliceIndex, 0, change.code);
                        modifiedContent = lines.join(EOL);
                    } else {
                        unableToPreviewReason = `Invalid line number in target: '${change.target}'. Appending proposed code instead.`;
                        modifiedContent = originalContent + (originalContent.length > 0 ? EOL : '') + `// --- Proposed Code (appended due to invalid line target for '${change.action}') ---${EOL}${change.code}`;
                    }
                } else {
                    modifiedContent = originalContent + (originalContent.length > 0 ? EOL : '') + change.code;
                }
            } else {
                unableToPreviewReason = `Action '${change.action}' is not fully supported for precise diff preview. Showing proposed code appended.`;
                modifiedContent = originalContent + (originalContent.length > 0 ? EOL : '') +
                                  `// --- Proposed Code for action '${change.action}' (appended due to limited preview support) ---${EOL}` +
                                  `// Target: ${change.target}${EOL}` +
                                  `${change.code}`;
            }

            if (unableToPreviewReason) {
                this._logger.warn(`Preview limitation for change ${change.id}: ${unableToPreviewReason}`, { change });
                
                this._stateManager.setChangeValidationErrors(change.id, [], [{
                    type: 'missing_description',
                    message: `Preview limitation: ${unableToPreviewReason}`,
                    suggestion: 'The diff view shows approximated changes'
                }]);
            }

            const diffTitle = `Preview: ${path.basename(change.file)} (${change.action})`;
            const modifiedDoc = await vscode.workspace.openTextDocument({
                content: modifiedContent,
                language: originalDocument.languageId
            });

            await vscode.commands.executeCommand('vscode.diff', originalDocument.uri, modifiedDoc.uri, diffTitle);
            this._logger.info(`Showing diff for ${change.id}: ${originalDocument.uri.fsPath} vs. untitled (preview)`);

        } catch (error: any) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this._logger.error('Failed to generate preview', { error: errorMessage, originalError: error, changeId: data.changeId });
            
            this._stateManager.setChangeValidationErrors(data.changeId, [{
                type: 'json_parse',
                message: `Preview failed: ${errorMessage}`,
                suggestion: 'Check the file path and try again'
            }]);
        }
    }
    
    private _handleToggleChangeSelection(data: { changeId: string, selected: boolean }) {
        this._logger.info('Handling toggleChangeSelection message', data);
        this._stateManager.toggleChangeSelection(data.changeId, data.selected);
    }
    
    private _handleSelectOnlyValid() {
        this._logger.info('Handling selectOnlyValid message');
        this._stateManager.selectOnlyValidChanges();
    }
    
    private async _handleRetryValidation() {
        this._logger.info('Handling retryValidation message');
        const currentInput = this._stateManager.getState().jsonInput;
        
        if (!currentInput) {
            this._stateManager.setGlobalValidationErrors([{
                type: 'json_parse',
                message: 'No input to validate',
                suggestion: 'Enter JSON input first'
            }]);
            return;
        }
        
        // Re-run the parsing with current input
        await this._handleParseInput({ jsonInput: currentInput });
    }

    /**
     * Perform target existence validation in background
     */
    private async _performTargetValidation(parsedInput: ParsedInput) {
        const workspace = vscode.workspace.workspaceFolders?.[0];
        if (!workspace) {
            this._logger.warn('No workspace folder available for target validation');
            return;
        }

        try {
            this._stateManager.setValidationInProgress(true);
            this._logger.info('Starting target existence validation');

            // Run full validation with target existence checking
            const validationSummary = await ValidationEngine.validateChanges(parsedInput, workspace, {
                validateTargetExistence: true,
                parallelValidation: true,
                timeoutMs: 30000
            });

            this._logger.info('Target validation completed', {
                overallValid: validationSummary.overallValid,
                invalidChanges: validationSummary.summary.invalidChanges,
                processingTime: validationSummary.summary.processingTimeMs
            });

            // Update each change with its validation results
            for (const changeValidation of validationSummary.changeValidations) {
                const changeId = this._stateManager.getState().pendingChanges[changeValidation.changeIndex]?.id;
                if (changeId) {
                    this._stateManager.setChangeValidationErrors(
                        changeId, 
                        changeValidation.errors, 
                        changeValidation.warnings
                    );
                }
            }

            // Update global validation state with any new global errors
            if (validationSummary.suggestions.length > 0) {
                const currentState = this._stateManager.getState();
                const newWarnings: ValidationWarning[] = validationSummary.suggestions.map((suggestion: string) => ({
                    type: 'missing_description',
                    message: suggestion,
                    suggestion: 'Review and address this issue'
                }));
                
                this._stateManager.setGlobalValidationErrors(
                    currentState.globalValidationErrors,
                    [...currentState.globalValidationWarnings, ...newWarnings]
                );
            }

        } catch (error) {
            this._logger.error('Target validation failed', { error });
            this._stateManager.setGlobalValidationErrors([{
                type: 'json_parse',
                message: `Target validation failed: ${error}`,
                suggestion: 'Try validating individual changes or check workspace configuration'
            }]);
        } finally {
            this._stateManager.setValidationInProgress(false);
        }
    }

    /**
     * Handle manual target validation trigger
     */
    private async _handleValidateTargets() {
        this._logger.info('Handling manual target validation request');
        
        const parsedInput = this._stateManager.getState().parsedInput;
        if (!parsedInput) {
            this._stateManager.setGlobalValidationErrors([{
                type: 'json_parse',
                message: 'No parsed input available for target validation',
                suggestion: 'Parse JSON input first'
            }]);
            return;
        }

        await this._performTargetValidation(parsedInput);
    }
    
    private _updateWebview() {
        if (this._view && this._view.visible) {
            const state = this._stateManager.getState();
            this._logger.info('Posting stateUpdate to webview.', { 
                stateIsLoading: state.isLoading,
                validationInProgress: state.validationInProgress,
                globalErrors: state.globalValidationErrors.length,
                pendingChangesCount: state.pendingChanges.length 
            });
            
            this._view.webview.postMessage({
                type: 'stateUpdate',
                state: state
            });
        } else {
            this._logger.info('Webview not visible or available, skipping state update.', { 
                viewExists: !!this._view, 
                viewVisible: this._view?.visible 
            });
        }
    }
    
    private _getHtmlForWebview(webview: vscode.Webview): string {
        this._logger.debug('Generating HTML for webview.');
        
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'main.js')
        );
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'main.css')
        );
        
        const nonce = this._getNonce();
        
        this._logger.debug('Webview URIs', { 
            scriptUri: scriptUri.toString(), 
            styleUri: styleUri.toString() 
        });

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta http-equiv="Content-Security-Policy" content="
                default-src 'none';
                style-src ${webview.cspSource} 'unsafe-inline'; 
                script-src 'nonce-${nonce}' 'unsafe-eval';
                font-src ${webview.cspSource};
                img-src ${webview.cspSource} data: https:; 
            ">
            <link href="${styleUri}" rel="stylesheet">
            <title>LLM Code Patcher</title>
        </head>
        <body>
            <div id="app">
                <!-- Input Section -->
                <div class="section">
                    <h3>Input JSON Changes</h3>
                    <div class="input-container">
                        <textarea 
                            id="jsonInput" 
                            placeholder="Paste LLM-generated JSON changes here..."
                            rows="8"
                            aria-label="JSON input for code changes"
                        ></textarea>
                        <div class="input-buttons">
                            <button id="parseBtn" class="primary" disabled>Parse Changes</button>
                            <button id="clearInputBtn" class="secondary">Clear Input</button>
                        </div>
                    </div>
                </div>
                
                <!-- Status Section -->
                <div id="statusSection" class="section hidden">
                    <div id="loadingIndicator" class="hidden">
                        <div class="spinner" role="status" aria-label="Loading"></div>
                        <span>Processing...</span>
                    </div>
                    
                    <!-- Global Validation Errors -->
                    <div id="globalErrors" class="validation-errors hidden">
                        <h4>Validation Errors</h4>
                        <div id="globalErrorsList" class="error-list"></div>
                        <div class="error-actions">
                            <button id="retryValidationBtn" class="secondary">Retry Validation</button>
                        </div>
                    </div>
                    
                    <!-- Global Validation Warnings -->
                    <div id="globalWarnings" class="validation-warnings hidden">
                        <h4>Validation Warnings</h4>
                        <div id="globalWarningsList" class="warning-list"></div>
                    </div>
                    
                    <div id="errorMessage" class="error hidden" role="alert"></div>
                    <div id="successMessage" class="success hidden" role="status"></div>
                </div>
                
                <!-- Pending Changes Section -->
                <div id="changesSection" class="section hidden">
                    <h3>Pending Changes</h3>
                    <div class="changes-header">
                        <div class="changes-info">
                            <span id="changesCount">0 changes</span>
                            <span id="selectedCount">0 selected</span>
                            <span id="validationSummary" class="validation-summary"></span>
                        </div>
                        <div class="changes-buttons">
                            <button id="applySelectedBtn" class="primary" disabled>Apply Selected</button>
                            <button id="selectOnlyValidBtn" class="secondary" disabled>Select Only Valid</button>
                            <button id="validateTargetsBtn" class="secondary" disabled>Validate Targets</button>
                            <button id="clearChangesBtn" class="secondary">Clear All Changes</button>
                        </div>
                    </div>
                    <div id="changesList" class="changes-list" aria-live="polite"></div>
                </div>
                
                <!-- History Section (Placeholder) -->
                <div class="section">
                    <h3>Change History</h3>
                    <div class="history-buttons">
                        <button id="showHistoryBtn" class="secondary" disabled>Show History (WIP)</button>
                        <button id="undoLastBtn" class="secondary" disabled>Undo Last (WIP)</button>
                    </div>
                    <div id="historyList" class="history-list">
                        <p class="placeholder">Change history is not yet available.</p>
                    </div>
                </div>
            </div>
            
            <script nonce="${nonce}" src="${scriptUri}"></script>
        </body>
        </html>`;
    }
    
    private _getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
}