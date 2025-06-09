import * as vscode from 'vscode';
import * as path from 'path'; // Ensure path is imported
import { UIStateManager, PendingChange } from './stateManager'; // Assuming PendingChange is still used
import { ChangeParser, ParsedInput, ParsedChange, ValidationError, ValidationWarning } from '../parser/inputParser';
// ValidationEngine, ErrorReporter might be used internally or by ChangeParser, ensure imports are correct
// import { ValidationEngine, ValidationSummary } from '../validation/validationEngine';
// import { ErrorReporter } from '../validation/errorReporter';
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
                vscode.Uri.joinPath(this._extensionUri, 'out') // For 'out/webview/main.js' etc.
            ]
        };
        
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        
        webviewView.webview.onDidReceiveMessage(
            message => this._handleMessage(message),
            undefined,
            this._context.subscriptions
        );
        
        this._logger.info('Webview HTML set. Sending initial state to webview.', { 
            initialStateIsLoading: this._stateManager.getState().isLoading 
        });
        this._updateWebview(); // Send initial state
        
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
        this._logger.info('Clearing pending changes via public method (WebViewProvider).');
        this._stateManager.clearPendingChanges();
        // The state change will trigger _updateWebview
    }

    // NEW public method to be called from extension.ts command
    public requestToggleQuickStart() {
        this._logger.info('Request received to toggle Quick Start section.');
        if (this._view) {
            this._view.webview.postMessage({ type: 'toggleQuickStart' });
        } else {
            this._logger.warn('Cannot toggle Quick Start: Webview is not available.');
            vscode.window.showInformationMessage('Differ panel must be open to toggle Quick Start guide.');
        }
    }
    
    private async _handleMessage(message: any) {
        this._logger.info('Received message from webview', { type: message.type, data: message.data });
        
        switch (message.type) {
            case 'parseInput':
                await this._handleParseInput(message.data);
                break;
            
            // REMOVED 'showExample' and 'showHelp' cases as they are now handled by commands in extension.ts
            // case 'showExample':
            //     await this._handleShowExample(); // This logic is now in extension.ts
            //     break;
            // case 'showHelp':
            //     await this._handleShowHelp(); // This logic is now in extension.ts
            //     break;
                
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
                this._logger.info('Handling clearInput message from webview.');
                this._stateManager.clearInput();
                break;
                
            case 'clearChanges':
                this._logger.info('Handling clearChanges message from webview.');
                this._stateManager.clearPendingChanges(); // This will trigger UI update
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
    
    private async _handleParseInput(inputData: { input: string }) {
        this._logger.info('Starting to parse comment-based input from webview', { inputLength: inputData.input?.length });
        
        this._stateManager.setJsonInput(inputData.input); // Store raw input

        this._stateManager.setLoading(true);
        this._stateManager.clearGlobalValidationErrors();
        this._stateManager.clearAllValidationErrors(); // Clears per-change errors too
        this._stateManager.clearPendingChanges(); // Clears list of changes
        
        try {
            if (!inputData.input || inputData.input.trim() === '') {
                this._stateManager.setGlobalValidationErrors([{
                    type: 'parse_error', // Using one of your defined ValidationErrorTypes
                    message: 'Input cannot be empty',
                    suggestion: 'Please provide changes in the comment-based format.'
                }]);
                return; // Exits after setting error
            }
            
            this._logger.info('Phase 1: Validating comment-based structure');
            const structureValidation = ChangeParser.validateStructure(inputData.input.trim());
            
            if (!structureValidation.isValid) {
                this._logger.warn('Comment-based structure validation failed', { 
                    errorCount: structureValidation.errors.length,
                    warningCount: structureValidation.warnings.length 
                });
                this._stateManager.setGlobalValidationErrors(
                    structureValidation.errors, 
                    structureValidation.warnings
                );
                return; // Exits after setting error
            }
            
            this._logger.info('Phase 2: Parsing validated comment-based input');
            let parsedData: ParsedInput;
            try {
                parsedData = ChangeParser.parseInput(inputData.input.trim());
            } catch (parseError) {
                const errorMessage = parseError instanceof Error ? parseError.message : String(parseError);
                this._stateManager.setGlobalValidationErrors([{
                    type: 'parse_error',
                    message: `Unexpected parsing error: ${errorMessage}`,
                    suggestion: 'Please check your input format.'
                }]);
                return; // Exits after setting error
            }
            
            this._logger.info('Phase 3: Semantic validation');
            const semanticValidation = ChangeParser.validateSemanticConsistency(parsedData);
            
            if (!semanticValidation.isValid) {
                this._logger.warn('Semantic validation failed', { 
                    errorCount: semanticValidation.errors.length 
                });
                this._stateManager.setGlobalValidationErrors(
                    [...(this._stateManager.getState().globalValidationErrors || []), ...semanticValidation.errors], // Append to any existing structural errors
                    [...(this._stateManager.getState().globalValidationWarnings || []), ...semanticValidation.warnings]
                );
                return; // Exits after setting error
            }
            
            this._logger.info('Phase 4: Creating pending changes');
            const pendingChanges: PendingChange[] = parsedData.changes.map((change: ParsedChange, index: number) => 
                this._stateManager.createPendingChangeFromParsed(change, index)
            );
            
            this._stateManager.setParsedInput(parsedData);
            this._stateManager.setPendingChanges(pendingChanges);
            
            // Add any warnings from successful parsing stages
             const allWarnings = [
                ...(structureValidation.warnings || []),
                ...(semanticValidation.warnings || [])
            ];
            if (allWarnings.length > 0) {
                 this._stateManager.setGlobalValidationErrors(
                    this._stateManager.getState().globalValidationErrors, // Keep existing errors if any
                    allWarnings
                );
            }
            
            this._logger.info('Phase 5: Starting target existence validation (async)');
            this._performTargetValidation(parsedData); // Runs in background
            
            this._logger.info('Successfully parsed comment-based input.', { 
                changeCount: pendingChanges.length,
                description: parsedData.description,
                warningCount: allWarnings.length
            });
            
        } catch (error) { // Catch any unexpected errors during the process
            const errorMessage = error instanceof Error ? error.message : `Unknown error: ${String(error)}`;
            this._logger.error('Failed to parse comment-based input', { error: errorMessage, originalError: error });
            this._stateManager.setGlobalValidationErrors([{
                type: 'parse_error',
                message: `Parsing failed: ${errorMessage}`,
                suggestion: 'Check input format and logs.'
            }]);
        } finally {
            this._stateManager.setLoading(false); // Ensure loading is set to false
        }
    }
        
    private async _handleApplyChanges(data: { selectedChanges: string[] }) {
        this._logger.info('Handling applyChanges message from webview', { selectedChangeIds: data.selectedChanges });
        this._stateManager.setLoading(true);
        
        const changesToApply = this._stateManager.getSelectedChanges().filter(c => data.selectedChanges.includes(c.id));
        const originalParsedInput = this._stateManager.getState().parsedInput;

        try {
            if (changesToApply.length === 0) {
                this._logger.warn("Apply changes requested, but no changes were actually selected or found in state.");
                // Optionally inform webview:
                // this._stateManager.setError("No changes selected to apply."); 
                return;
            }
            
            if (!originalParsedInput) {
                this._logger.error("Cannot apply changes, parsedInput is missing from state.");
                this._stateManager.setGlobalValidationErrors([{
                    type: 'parse_error',
                    message: `Internal error: Parsed input is missing. Please parse again.`,
                }]);
                return;
            }

            const invalidChanges = changesToApply.filter(change => !change.isValid);
            if (invalidChanges.length > 0) {
                this._logger.warn('Attempted to apply invalid changes', { 
                    invalidCount: invalidChanges.length,
                    totalCount: changesToApply.length 
                });
                this._stateManager.setGlobalValidationErrors([{
                    type: 'invalid_format', // Or a more specific type
                    message: `Cannot apply ${invalidChanges.length} invalid changes. Fix validation errors first.`,
                    suggestion: 'Deselect invalid changes or use "Select Only Valid".'
                }]);
                return;
            }

            // Construct a ParsedInput object containing only the selected and valid changes for application
            const inputForApplication: ParsedInput = {
                description: originalParsedInput.description, // Keep original overall description
                changes: changesToApply.map(pc => ({ // Convert PendingChange back to ParsedChange
                    file: pc.file,
                    action: pc.action,
                    target: pc.target,
                    code: pc.code,
                    class: pc.class,
                    description: pc.description, // Ensure this field exists on ParsedChange if needed
                })),
                metadata: { // Recompute metadata for the subset
                    totalChanges: changesToApply.length,
                    affectedFiles: [...new Set(changesToApply.map(c => c.file))],
                    hasNewFiles: changesToApply.some(c => c.action === 'create_file')
                }
            };
            
            this._logger.info(`Executing 'differ.applyChanges' command with ${inputForApplication.changes.length} changes.`);
            // The command now receives the filtered ParsedInput
            await vscode.commands.executeCommand('differ.applyChanges', inputForApplication); 
            
            changesToApply.forEach(change => {
                this._stateManager.updatePendingChangeStatus(change.id, 'applied');
            });
            this._logger.info(`Successfully applied ${changesToApply.length} changes.`);

        } catch (error) { // This catch is for errors from vscode.commands.executeCommand
            const errorMessage = error instanceof Error ? error.message : String(error);
            this._logger.error('Failed to apply changes via command', { error: errorMessage, originalError: error });
            this._stateManager.setGlobalValidationErrors([{
                type: 'parse_error', // Consider a more specific 'apply_failed' type
                message: `Apply failed: ${errorMessage}`,
                suggestion: 'Check the VS Code Output panel (Differ channel) for more details.'
            }]);
            changesToApply.forEach(change => {
                this._stateManager.updatePendingChangeStatus(change.id, 'failed', errorMessage);
            });
        } finally {
            this._stateManager.setLoading(false);
        }
    }
    
    // _handlePreviewChange, _previewFileModification, _previewNewFile remain the same
    private async _handlePreviewChange(data: { changeId: string }) {
        this._logger.info('Handling previewChange message', { changeId: data.changeId });
        const change = this._stateManager.getState().pendingChanges.find(c => c.id === data.changeId);

        if (!change) {
            this._logger.warn('Preview requested for non-existent change ID', { changeId: data.changeId });
            this._stateManager.setGlobalValidationErrors([{
                type: 'parse_error',
                message: `Cannot preview change: ID ${data.changeId} not found`,
                suggestion: 'Try refreshing the changes list'
            }]);
            return;
        }

        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                this._stateManager.setGlobalValidationErrors([{
                    type: 'parse_error',
                    message: 'No workspace folder open to preview changes',
                    suggestion: 'Open a workspace folder first'
                }]);
                return;
            }
            
            const workspaceRoot = workspaceFolders[0].uri;
            const targetFileUri = vscode.Uri.joinPath(workspaceRoot, change.file);

            if (change.action === 'create_file') {
                await this._previewNewFile(change, targetFileUri);
                return;
            }

            let originalDocument: vscode.TextDocument;
            try {
                originalDocument = await vscode.workspace.openTextDocument(targetFileUri);
            } catch (e: any) {
                this._logger.error(`Failed to open original file for preview: ${targetFileUri.fsPath}`, e);
                this._stateManager.setChangeValidationErrors(change.id, [{
                    type: 'parse_error',
                    message: `File not found: ${change.file}`,
                    suggestion: 'Use "create_file" action to create new files, or check that the file path is correct',
                    details: e.message
                }]);
                return;
            }
            await this._previewFileModification(change, originalDocument);
        } catch (error: any) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this._logger.error('Failed to generate preview', { error: errorMessage, originalError: error, changeId: data.changeId });
            this._stateManager.setChangeValidationErrors(data.changeId, [{
                type: 'parse_error',
                message: `Preview failed: ${errorMessage}`,
                suggestion: 'Check the file path and try again'
            }]);
        }
    }

    private async _previewFileModification(change: PendingChange, originalDocument: vscode.TextDocument) {
        const originalContent = originalDocument.getText();
        let modifiedContent = originalContent;
        let unableToPreviewReason: string | null = null;
        const EOL = originalDocument.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';

        // Simplified preview logic based on action (more robust parsing needed for accuracy)
        if (change.action.toLowerCase().includes('replace')) {
            if (change.target && change.target.length > 0) {
                const targetIndex = originalContent.indexOf(change.target);
                if (targetIndex !== -1) {
                    modifiedContent = originalContent.substring(0, targetIndex) +
                                      change.code +
                                      originalContent.substring(targetIndex + change.target.length);
                } else {
                    unableToPreviewReason = `Target text for replacement ("${change.target.substring(0, 50)}...") not found.`;
                    modifiedContent = `// PREVIEW NOTE: ${unableToPreviewReason}${EOL}// Proposed code change below:${EOL}${change.code}${EOL}// --- Original File Content ---${EOL}${originalContent}`;
                }
            } else {
                unableToPreviewReason = `'target' for replacement is empty. Cannot determine what to replace.`;
                 modifiedContent = `// PREVIEW NOTE: ${unableToPreviewReason}${EOL}// Proposed code change below:${EOL}${change.code}${EOL}// --- Original File Content ---${EOL}${originalContent}`;
            }
        } else if (change.action.toLowerCase().includes('add') || change.action.toLowerCase().includes('insert')) {
            // Basic append for add/insert. For line-specific, more logic needed.
            modifiedContent = originalContent + EOL + change.code;
        } else {
            unableToPreviewReason = `Action '${change.action}' diff preview is approximate.`;
            modifiedContent = originalContent + EOL + `// --- Proposed code for action '${change.action}' (Target: ${change.target}) --- ${EOL}` + change.code;
        }

        if (unableToPreviewReason) {
            this._logger.warn(`Preview limitation for change ${change.id}: ${unableToPreviewReason}`);
            this._stateManager.setChangeValidationErrors(change.id, [], [{
                type: 'missing_description', // Or a more fitting warning type
                message: `Preview limitation: ${unableToPreviewReason}`,
                suggestion: 'Diff view shows approximated changes.'
            }]);
        }

        const diffTitle = `Preview: ${path.basename(change.file)} (${change.action})`;
        const modifiedDoc = await vscode.workspace.openTextDocument({
            content: modifiedContent,
            language: originalDocument.languageId
        });
        await vscode.commands.executeCommand('vscode.diff', originalDocument.uri, modifiedDoc.uri, diffTitle);
    }

    private async _previewNewFile(change: PendingChange, targetFileUri: vscode.Uri) {
        this._logger.info(`Previewing new file creation: ${targetFileUri.fsPath}`);
        let fileExists = false;
        try {
            await vscode.workspace.fs.stat(targetFileUri); // Check if target file already exists
            fileExists = true;
        } catch { 
            // File doesn't exist, which is expected for 'create_file' typically
        }

        const newFileContent = change.code;
        const fileExtension = path.extname(change.file).substring(1).toLowerCase() || 'txt';
        
        // Manual mapping from file extension to VS Code language ID
        const languageMap: { [key: string]: string } = {
            'ts': 'typescript', 'js': 'javascript', 'tsx': 'typescriptreact', 
            'jsx': 'javascriptreact', 'py': 'python', 'java': 'java', 
            'cpp': 'cpp', 'c': 'c', 'cs': 'csharp', 'rs': 'rust', 'go': 'go',
            'json': 'json', 'xml': 'xml', 'html': 'html', 'css': 'css', 
            'scss': 'scss', 'less': 'less', 'md': 'markdown', 'yaml': 'yaml', 
            'yml': 'yaml', 'sh': 'shellscript', 'bat': 'bat', 'ps1': 'powershell',
            'txt': 'plaintext',
            // Add more common extensions as needed
        };
        
        const languageId = languageMap[fileExtension] || 'plaintext'; // Fallback
        
        this._logger.debug(`Determined languageId: '${languageId}' for extension '${fileExtension}'`);

        const newDocument = await vscode.workspace.openTextDocument({ content: newFileContent, language: languageId });

        if (fileExists) {
            // If the file exists, diff the current file with the proposed new content
            const originalDocument = await vscode.workspace.openTextDocument(targetFileUri);
            await vscode.commands.executeCommand('vscode.diff', originalDocument.uri, newDocument.uri, `Create (Overwrite): ${path.basename(change.file)}`);
        } else {
            // If the file does not exist, diff an empty document with the proposed new content
            // To do this, we create a temporary untitled document with empty content but the correct language ID
            const tempEmptyDoc = await vscode.workspace.openTextDocument({content: '', language: languageId});
            await vscode.commands.executeCommand('vscode.diff', tempEmptyDoc.uri, newDocument.uri, `Create New File: ${path.basename(change.file)}`);
            
            // Note: After the diff is closed, tempEmptyDoc might linger as an untitled file.
            // A more robust solution for diffing against "nothing" might involve more complex URI schemes
            // or simply showing the newDocument directly if a true "empty" left side for diff isn't crucial.
            // For now, this approach gives a visual diff.
            // Alternative: Just show the new document if preferred for a completely new file
            // await vscode.window.showTextDocument(newDocument, { preview: true, viewColumn: vscode.ViewColumn.Beside });
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
        this._logger.info('Handling retryValidation message from webview.');
        const currentInput = this._stateManager.getState().jsonInput; // Get input from state
        
        if (!currentInput) {
            this._stateManager.setGlobalValidationErrors([{
                type: 'parse_error',
                message: 'No input to validate',
                suggestion: 'Enter input first.'
            }]);
            return;
        }
        await this._handleParseInput({ input: currentInput }); // Re-parse with the stored input
    }

    private async _performTargetValidation(parsedInput: ParsedInput) {
        const workspace = vscode.workspace.workspaceFolders?.[0];
        if (!workspace) {
            this._logger.warn('No workspace folder available for target validation.');
            // Potentially update UI to reflect this state for all changes
            parsedInput.changes.forEach((_, index) => {
                const changeId = this._stateManager.getState().pendingChanges[index]?.id;
                if (changeId) {
                    this._stateManager.setChangeValidationErrors(changeId, [], [{
                        type: 'missing_target', // Example warning type
                        message: 'Workspace not found, cannot validate file targets.',
                    }]);
                }
            });
            return;
        }

        try {
            this._stateManager.setValidationInProgress(true);
            this._logger.info('Starting target existence validation in background.');

            const fileValidations = await Promise.all(
                parsedInput.changes.map(async (change, index) => ({
                    changeIndex: index,
                    validation: await ChangeParser.validateFileAccess(change.file, workspace, change.action)
                }))
            );

            this._logger.info('Target validation completed.', {
                totalChanges: fileValidations.length,
                invalidChanges: fileValidations.filter(fv => !fv.validation.isValid).length
            });

            for (const fileValidation of fileValidations) {
                const changeId = this._stateManager.getState().pendingChanges[fileValidation.changeIndex]?.id;
                if (changeId) {
                    this._stateManager.setChangeValidationErrors(
                        changeId, 
                        fileValidation.validation.errors, 
                        fileValidation.validation.warnings
                    );
                }
            }
            // No need to update global errors/warnings here unless there's a pattern
            // Individual change errors/warnings are more useful.

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this._logger.error('Target validation process failed', { error: errorMessage });
            // This is a global failure of the validation process, not specific file issues
            // We might add a global error to the UI state.
            // For now, individual errors would have been set if any.
        } finally {
            this._stateManager.setValidationInProgress(false);
        }
    }

    private async _handleValidateTargets() {
        this._logger.info('Handling manual target validation request from webview.');
        const parsedInput = this._stateManager.getState().parsedInput;
        if (!parsedInput) {
            this._stateManager.setGlobalValidationErrors([{
                type: 'parse_error',
                message: 'No parsed input available for target validation.',
                suggestion: 'Parse input first.'
            }]);
            return;
        }
        await this._performTargetValidation(parsedInput);
    }
    
    private _updateWebview() {
        if (this._view && this._view.visible) { // Check if webview is visible
            const state = this._stateManager.getState();
            this._logger.info('Posting stateUpdate to webview.', { 
                isLoading: state.isLoading,
                validationInProgress: state.validationInProgress,
                globalErrorCount: state.globalValidationErrors.length,
                pendingChangeCount: state.pendingChanges.length 
            });
            this._view.webview.postMessage({ type: 'stateUpdate', state: state });
        } else {
            this._logger.info('Webview not visible or not available, skipping state update.');
        }
    }
    
    private _getHtmlForWebview(webview: vscode.Webview): string {
        this._logger.debug('Generating HTML for webview (title bar actions version).');
        
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'main.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'main.css'));
        const nonce = this._getNonce();
        
        this._logger.debug('Webview URIs', { scriptUri: scriptUri.toString(), styleUri: styleUri.toString() });

        // HTML is now simplified, removing the custom toolbar and its dropdown.
        // The Quick Start section is still present but will be toggled by messages.
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
            <title>Differ - Code Patcher</title>
        </head>
        <body>
            <div id="app">
                <!-- Toolbar and its dropdown are REMOVED from HTML here -->

                <!-- Input Section -->
                <div class="section">
                    <h3>📝 Input Changes</h3>
                    <div class="input-container">
                        <div class="format-info">
                             <p>Use the comment-based format. Each change starts with <code>CHANGE:</code>. Use the menu icon (⋮) in the view title bar for help and examples.</p>
                        </div>
                        <textarea 
                            id="inputTextarea" 
                            placeholder="CHANGE: Add user authentication...\nFILE: src/auth/auth.ts\nACTION: create_file\n---\nexport function authenticate(...) { ... }\n---"
                            rows="12"
                            aria-label="Change input in comment format"
                        ></textarea>
                        <div class="input-buttons">
                            <button id="parseBtn" class="primary" disabled>🚀 Parse Changes</button>
                            <button id="clearInputBtn" class="secondary">🗑️ Clear Input</button>
                        </div>
                    </div>
                </div>
                
                <!-- Status Section (remains the same) -->
                <div id="statusSection" class="section hidden">
                    <div id="loadingIndicator" class="hidden">
                        <div class="spinner" role="status" aria-label="Loading"></div>
                        <span>Processing changes...</span>
                    </div>
                    <div id="globalErrors" class="validation-errors hidden">
                        <h4>❌ Input Errors</h4>
                        <div id="globalErrorsList" class="error-list"></div>
                        <div class="error-actions">
                            <button id="retryValidationBtn" class="secondary">🔄 Retry Validation</button>
                        </div>
                    </div>
                    <div id="globalWarnings" class="validation-warnings hidden">
                        <h4>⚠️ Input Warnings</h4>
                        <div id="globalWarningsList" class="warning-list"></div>
                    </div>
                    <div id="errorMessage" class="error hidden" role="alert"></div>
                    <div id="successMessage" class="success hidden" role="status"></div>
                </div>
                
                <!-- Pending Changes Section (remains the same) -->
                <div id="changesSection" class="section hidden">
                    <h3>🔧 Pending Changes</h3>
                    <div class="changes-header">
                        <div class="changes-info">
                            <span id="changesCount">0 changes</span>
                            <span id="selectedCount">0 selected</span>
                            <span id="validationSummary" class="validation-summary"></span>
                        </div>
                        <div class="changes-buttons">
                            <button id="applySelectedBtn" class="primary" disabled>✅ Apply Selected</button>
                            <button id="selectOnlyValidBtn" class="secondary" disabled>✨ Select Only Valid</button>
                            <button id="validateTargetsBtn" class="secondary" disabled>🔍 Validate Targets</button>
                            <button id="clearChangesBtn" class="secondary">🗑️ Clear All Changes</button>
                        </div>
                    </div>
                    <div id="changesList" class="changes-list" aria-live="polite"></div>
                </div>
                
                <!-- Quick Start Section - Initially hidden, toggled by command -->
                <div class="section hidden" id="quickStartSection">
                    <h3>🚀 Quick Start</h3>
                    <div class="quick-start-content">
                        <div class="quick-start-item">
                            <h4>1. Format Your Changes</h4>
                            <p>Use the comment-based format. Each change starts with <code>CHANGE:</code> followed by <code>FILE:</code>, <code>ACTION:</code>, and code between <code>---</code> markers. Access "Show Example" or "Format Help" from the (⋮) menu in the title bar.</p>
                        </div>
                        <div class="quick-start-item">
                            <h4>2. Available Actions</h4>
                            <div class="action-grid">
                                <span class="action-tag">create_file</span> <span class="action-tag">add_function</span>
                                <span class="action-tag">replace_function</span> <span class="action-tag">add_import</span>
                                <span class="action-tag">add_method</span> <span class="action-tag">replace_method</span> 
                                <!-- Add more as needed -->
                            </div>
                        </div>
                         <div class="quick-start-item">
                            <h4>3. View Title Bar Menu (⋮)</h4>
                            <p>Use the menu icon (⋮) in this panel's title bar for quick access to "Show Example", "Format Help", and to toggle this Quick Start guide.</p>
                        </div>
                    </div>
                </div>
                
                <!-- History Section (remains the same) -->
                <div class="section">
                    <h3>📋 Change History</h3>
                    <div class="history-buttons">
                        <button id="showHistoryBtn" class="secondary" disabled>📜 Show History (Soon)</button>
                        <button id="undoLastBtn" class="secondary" disabled>↶ Undo Last (Soon)</button>
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