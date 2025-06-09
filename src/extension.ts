import * as vscode from 'vscode';
import { ChangeParser, ParsedInput, ValidationResult } from './parser/inputParser'; // Make sure ParsedInput is exported if needed by applyChanges
import { DifferProvider } from './ui/webViewProvider';

// Store the provider instance to be accessible by command handlers
let differProviderInstance: DifferProvider | undefined;

interface DifferState { // This state is for the legacy command palette flow, less relevant for webview-centric actions
    parsedInput: ParsedInput | null;
    lastValidationResult: ValidationResult | null;
    previewContent: string | null;
}

export function activate(context: vscode.ExtensionContext) {
    console.log('🚀 Differ extension is now active!');
    
    // Extension state (for legacy command palette flow)
    const state: DifferState = {
        parsedInput: null,
        lastValidationResult: null,
        previewContent: null
    };

    // Create and register the webview provider
    const provider = new DifferProvider(context.extensionUri, context);
    differProviderInstance = provider; // Store the instance

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(DifferProvider.viewType, provider)
    );

    // Register existing commands
    const existingCommands = [
        vscode.commands.registerCommand('differ.openPanel', () => provider.show()),
        // The command now handles input from the webview or from the legacy state
        vscode.commands.registerCommand('differ.applyChanges', (inputFromWebview?: ParsedInput) => {
            // If inputFromWebview is undefined, it means the command was likely called
            // from the command palette or a keybinding without specific input,
            // so we might fall back to the legacy `state.parsedInput`.
            // However, the primary flow for applyChanges should originate from the webview
            // which *should* provide the relevant `ParsedInput`.
            const effectiveInput = inputFromWebview || state.parsedInput;
            if (!effectiveInput && !inputFromWebview) {
                 // If triggered from outside the webview flow and state.parsedInput is also null
                console.warn('applyChanges called without effective input. Webview should provide it.');
                vscode.window.showWarningMessage('No changes to apply. Please parse input in the Differ panel.');
                return;
            }
            applyChanges(effectiveInput);
        }),
        vscode.commands.registerCommand('differ.clearChanges', () => {
            clearChanges(state); // Clears legacy state
            provider.clearChanges(); // Also clear the webview state via its public method
        })
        // Note: differ.parseInput and differ.previewChanges might be less relevant if all parsing
        // and previewing is initiated from the webview. If they are still meant to be
        // command-palette accessible, they can remain. Otherwise, they could be removed
        // if their functionality is fully encompassed by webview interactions.
        // For now, I'll keep them as they might relate to 'state'.
        ,
        vscode.commands.registerCommand('differ.parseInput', () => parseUserInput(state)),
        vscode.commands.registerCommand('differ.previewChanges', () => previewChanges(state))
    ];

    context.subscriptions.push(...existingCommands);

    // Register NEW commands for the view title bar
    const viewTitleCommands = [
        vscode.commands.registerCommand('differ.view.showExample', async () => {
            const example = ChangeParser.generateExample();
            const doc = await vscode.workspace.openTextDocument({ content: example, language: 'plaintext' });
            await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
        }),
        vscode.commands.registerCommand('differ.view.showHelp', async () => {
            const documentation = ChangeParser.getFormatDocumentation();
            const doc = await vscode.workspace.openTextDocument({ content: documentation, language: 'markdown' });
            await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
        }),
        vscode.commands.registerCommand('differ.view.toggleQuickStart', () => {
            if (differProviderInstance) {
                differProviderInstance.requestToggleQuickStart();
            } else {
                vscode.window.showErrorMessage('Differ panel is not available to toggle Quick Start.');
            }
        })
    ];
    context.subscriptions.push(...viewTitleCommands);

    // Legacy commands (Show History, Undo) - these are placeholders as per your package.json
    context.subscriptions.push(
        vscode.commands.registerCommand('differ.showHistory', () => {
            vscode.window.showInformationMessage('Differ: Show Change History - Not yet implemented.');
        }),
        vscode.commands.registerCommand('differ.undoLastChanges', () => {
            vscode.window.showInformationMessage('Differ: Undo Last Changes - Not yet implemented.');
        })
    );
}

// Legacy function, might be refactored or removed if webview handles all parsing initiation
async function parseUserInput(state: DifferState) {
    try {
        const jsonInput = await vscode.window.showInputBox({
            prompt: 'Paste your LLM-generated change input (comment format)',
            placeHolder: 'CHANGE: ...\nFILE: ...\nACTION: ...\n---\ncode\n---',
            ignoreFocusOut: true
        });

        if (!jsonInput) {
            return;
        }

        vscode.window.showInformationMessage('Parsing input...');
        
        // Use the same ChangeParser
        const structureValidation = ChangeParser.validateStructure(jsonInput);
        if (!structureValidation.isValid) {
            vscode.window.showErrorMessage(`Input validation failed: ${structureValidation.errors.map(e => e.message).join(', ')}`);
            return;
        }
        
        const parsedInput = ChangeParser.parseInput(jsonInput);

        if (structureValidation.warnings.length > 0) {
            const warningMsg = `Warnings: ${structureValidation.warnings.join(', ')}`;
            vscode.window.showWarningMessage(warningMsg);
        }

        state.parsedInput = parsedInput;
        // state.lastValidationResult = structureValidation; // structureValidation may not be the complete validation

        const summary = `Parsed successfully! ${parsedInput.changes.length} changes across ${parsedInput.metadata?.affectedFiles.length || 0} files (from command palette).`;
        vscode.window.showInformationMessage(summary);

        state.previewContent = ChangeParser.generatePreview(parsedInput);
        await showPreview(state.previewContent);

    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        vscode.window.showErrorMessage(`Failed to parse input (from command palette): ${message}`);
    }
}

// Legacy function
async function previewChanges(state: DifferState) {
    if (!state.parsedInput) {
        vscode.window.showErrorMessage('No changes to preview. Parse input first (from command palette).');
        return;
    }

    if (!state.previewContent) {
        state.previewContent = ChangeParser.generatePreview(state.parsedInput);
    }
    await showPreview(state.previewContent);
}

async function showPreview(content: string) {
    const doc = await vscode.workspace.openTextDocument({
        content,
        language: 'markdown'
    });
    await vscode.window.showTextDocument(doc, {
        preview: true,
        viewColumn: vscode.ViewColumn.Beside
    });
}

// applyChanges can now be called with ParsedInput directly from the webview flow
// or potentially from legacy state if 'differ.applyChanges' is triggered elsewhere.
async function applyChanges(input: ParsedInput | null) {
    if (!input) {
        vscode.window.showErrorMessage('No changes to apply. Parse input first.');
        return;
    }

    const workspace = vscode.workspace.workspaceFolders?.[0];
    if (!workspace) {
        vscode.window.showErrorMessage('No workspace folder found');
        return;
    }

    try {
        vscode.window.showInformationMessage('Validating file access for applying changes...');
        
        const fileValidations = await Promise.all(
            input.changes.map(async (change) => ({
                change,
                validation: await ChangeParser.validateFileAccess(change.file, workspace, change.action)
            }))
        );

        const fileErrors = fileValidations
            .filter(fv => !fv.validation.isValid)
            .map(fv => `${fv.change.file} (${fv.change.action}): ${fv.validation.errors.map(e=>e.message).join(', ')}`);

        if (fileErrors.length > 0) {
            vscode.window.showErrorMessage(`File access errors prevented applying changes: ${fileErrors.join('; ')}`);
            return;
        }

        const fileWarnings = fileValidations
            .flatMap(fv => fv.validation.warnings.map(w => `${fv.change.file} (${fv.change.action}): ${w.message}`));
        
        if (fileWarnings.length > 0) {
            const proceed = await vscode.window.showWarningMessage(
                `File warnings detected. Continue applying changes anyway?`,
                { 
                    detail: fileWarnings.join('\n'),
                    modal: true 
                },
                'Yes', 'No'
            );
            if (proceed !== 'Yes') return;
        }

        const createFileChanges = input.changes.filter(c => c.action === 'create_file');
        const modifyFileChanges = input.changes.filter(c => c.action !== 'create_file');
        let confirmMessage = `Apply ${input.changes.length} changes?`;
        let detailMessage = '';
        if (createFileChanges.length > 0) detailMessage += `• ${createFileChanges.length} new files will be created\n`;
        if (modifyFileChanges.length > 0) detailMessage += `• ${modifyFileChanges.length} existing files will be modified\n`;
        const affectedFiles = [...new Set(input.changes.map(c => c.file))];
        detailMessage += `• ${affectedFiles.length} total files affected`;

        const confirmResult = await vscode.window.showWarningMessage(
            confirmMessage,
            { modal: true, detail: detailMessage },
            'Apply Changes', 'Cancel'
        );
        if (confirmResult !== 'Apply Changes') return;

        vscode.window.showInformationMessage('Applying changes...');
        await applyParsedChanges(input, workspace);
        
        let successMessage = 'Changes applied successfully!';
        if (createFileChanges.length > 0) successMessage += ` Created ${createFileChanges.length} new files.`;
        if (modifyFileChanges.length > 0) successMessage += ` Modified ${modifyFileChanges.length} existing files.`;
        vscode.window.showInformationMessage(successMessage);
        
        // Optionally, inform the webview that changes were applied so it can update its state
        if (differProviderInstance) {
            // This assumes you might want to send the applied changes back or just a success signal
            // For now, let's just log it. The webview already marks them as 'applied' based on its own flow.
            // differProviderInstance.notifyChangesApplied(input); 
        }

    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        vscode.window.showErrorMessage(`Failed to apply changes: ${message}`);
        // Rethrow or handle so the webview can also show an error
        throw error;
    }
}

async function applyParsedChanges(input: ParsedInput, workspace: vscode.WorkspaceFolder) {
    const groupedChanges = ChangeParser.groupChangesByFile(input);
    for (const [filePath, changes] of groupedChanges) {
        await applyChangesToFile(filePath, changes, workspace);
    }
}

async function applyChangesToFile(filePath: string, changes: any[], workspace: vscode.WorkspaceFolder) {
    const fullPath = vscode.Uri.joinPath(workspace.uri, filePath);
    try {
        const createFileChanges = changes.filter(c => c.action === 'create_file');
        const otherChanges = changes.filter(c => c.action !== 'create_file');
        if (createFileChanges.length > 1) {
            throw new Error(`Multiple create_file actions for ${filePath} - only one is allowed per file`);
        }
        
        let content = '';
        let fileExists = false;
        try {
            const fileData = await vscode.workspace.fs.readFile(fullPath);
            content = Buffer.from(fileData).toString('utf8');
            fileExists = true;
        } catch {
            fileExists = false;
        }
        
        if (createFileChanges.length === 1) {
            const createChange = createFileChanges[0];
            console.log(fileExists ? `Overwriting existing file: ${filePath}` : `Creating new file: ${filePath}`);
            content = createChange.code; // Use provided code as complete file content
        } else if (!fileExists && otherChanges.length > 0) {
            throw new Error(`File ${filePath} does not exist. Use "create_file" action to create new files.`);
        }

        let modifiedContent = content;
        for (const change of otherChanges) {
            modifiedContent = applySingleChangeToContent(modifiedContent, change); // Renamed internal function
        }

        const writeData = Buffer.from(modifiedContent, 'utf8');
        await vscode.workspace.fs.writeFile(fullPath, writeData);
        
        const actionSummary = [];
        if (createFileChanges.length > 0) actionSummary.push(fileExists ? 'overwritten' : 'created');
        if (otherChanges.length > 0) actionSummary.push(`${otherChanges.length} modifications applied`);
        console.log(`File ${filePath}: ${actionSummary.join(', ')}`);
        
    } catch (error) {
        const e = error instanceof Error ? error : new Error(String(error));
        throw new Error(`Failed to apply changes to ${filePath}: ${e.message}`);
    }
}

// Renamed from applyChange to avoid conflict with the top-level applyChanges
function applySingleChangeToContent(content: string, change: any): string {
    switch (change.action) {
        case 'create_file':
             // Should be handled by applyChangesToFile primarily
            console.warn(`create_file action being processed by applySingleChangeToContent for ${change.file}. This is usually handled earlier.`);
            return change.code;
        case 'add_import':
            return addImport(content, change.code);
        case 'replace_function':
            return replaceFunction(content, change.target, change.code);
        case 'add_function':
            return addFunction(content, change.code);
        default:
            console.warn(`Unsupported action in applySingleChangeToContent: ${change.action}`);
            return content;
    }
}

// Placeholder change application functions (implementation specific to your needs)
function addImport(content: string, importCode: string): string {
    // A more robust implementation would parse AST or use language-specific logic
    const lines = content.split('\n');
    let lastImportIndex = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim().startsWith('import') || lines[i].trim().startsWith('use')) { // Common import keywords
            lastImportIndex = i;
        } else if (lines[i].trim() !== '' && lastImportIndex !== -1) {
            // Found a non-empty line after imports, break
            break;
        }
    }
    lines.splice(lastImportIndex + 1, 0, importCode);
    return lines.join('\n');
}

function replaceFunction(content: string, functionName: string, newCode: string): string {
    // WARNING: This is a very basic regex and likely to fail on complex cases or overloads.
    // Consider using a proper parser for the target language.
    const functionRegex = new RegExp(`(async\\s+)?function\\s+${functionName}\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\}`, 'g');
    if (!functionRegex.test(content)) {
        // Try Rust style
        const rustFuncRegex = new RegExp(`(pub\\s+)?(async\\s+)?fn\\s+${functionName}\\s*\\([^)]*\\)\\s*(->\\s*[^\\{]+)?\\s*\\{[\\s\\S]*?\\}`, 'g');
        if (rustFuncRegex.test(content)) {
            return content.replace(rustFuncRegex, newCode);
        }
        console.warn(`Function "${functionName}" not found for replacement.`);
        return content; // Or throw error
    }
    return content.replace(functionRegex, newCode);
}

function addFunction(content: string, functionCode: string): string {
    // Appends to the end of the file, or before the last closing brace if found.
    const lastBraceIndex = content.lastIndexOf('}');
    if (lastBraceIndex !== -1 && lastBraceIndex === content.length -1) { // If '}' is the very last char
        return content.slice(0, lastBraceIndex) + '\n' + functionCode + '\n}';
    }
    return content + '\n\n' + functionCode;
}

function clearChanges(state: DifferState) { // This function primarily clears the legacy command-palette state
    state.parsedInput = null;
    state.lastValidationResult = null;
    state.previewContent = null;
    // The webview state is cleared by provider.clearChanges() called by the command handler
    vscode.window.showInformationMessage('Legacy state cleared.');
}

export function deactivate() {
    console.log('👋 Differ extension deactivated');
    differProviderInstance = undefined; // Clean up
}