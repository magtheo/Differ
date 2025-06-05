import * as vscode from 'vscode';
import { ChangeParser, ParsedInput, ValidationResult } from './parser/inputParser';

interface DifferState {
    parsedInput: ParsedInput | null;
    lastValidationResult: ValidationResult | null;
    previewContent: string | null;
}

export function activate(context: vscode.ExtensionContext) {
    console.log('🚀 Differ extension is now active!');
    
    // Extension state
    const state: DifferState = {
        parsedInput: null,
        lastValidationResult: null,
        previewContent: null
    };

    // Register commands
    const commands = [
        vscode.commands.registerCommand('differ.openPanel', () => openDifferPanel()),
        vscode.commands.registerCommand('differ.parseInput', () => parseUserInput(state)),
        vscode.commands.registerCommand('differ.previewChanges', () => previewChanges(state)),
        vscode.commands.registerCommand('differ.applyChanges', () => applyChanges(state)),
        vscode.commands.registerCommand('differ.clearChanges', () => clearChanges(state))
    ];

    context.subscriptions.push(...commands);
}

async function openDifferPanel() {
    vscode.window.showInformationMessage('Differ Panel - Coming Soon! Use Command Palette commands for now.');
}

async function parseUserInput(state: DifferState) {
    try {
        // Get JSON input from user
        const jsonInput = await vscode.window.showInputBox({
            prompt: 'Paste your JSON change input',
            placeHolder: '{"description": "...", "changes": [...]}',
            ignoreFocusOut: true
        });

        if (!jsonInput) {
            return;
        }

        // Parse input WITHOUT file validation
        vscode.window.showInformationMessage('Parsing input...');
        
        const parsedInput = ChangeParser.parseInput(jsonInput);
        
        // Validate structure only
        const structureValidation = ChangeParser.validateStructure(parsedInput);
        
        if (!structureValidation.isValid) {
            vscode.window.showErrorMessage(`Input validation failed: ${structureValidation.errors.join(', ')}`);
            return;
        }

        // Show warnings if any
        if (structureValidation.warnings.length > 0) {
            const warningMsg = `Warnings: ${structureValidation.warnings.join(', ')}`;
            vscode.window.showWarningMessage(warningMsg);
        }

        // Store parsed input
        state.parsedInput = parsedInput;
        state.lastValidationResult = structureValidation;

        // Show success with summary
        const summary = `Parsed successfully! ${parsedInput.changes.length} changes across ${parsedInput.metadata?.affectedFiles.length} files`;
        vscode.window.showInformationMessage(summary);

        // Generate and store preview
        state.previewContent = ChangeParser.generatePreview(parsedInput);
        
        // Show preview automatically
        await showPreview(state.previewContent);

    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        vscode.window.showErrorMessage(`Failed to parse input: ${message}`);
    }
}

async function previewChanges(state: DifferState) {
    if (!state.parsedInput) {
        vscode.window.showErrorMessage('No changes to preview. Parse input first.');
        return;
    }

    if (!state.previewContent) {
        state.previewContent = ChangeParser.generatePreview(state.parsedInput);
    }

    await showPreview(state.previewContent);
}

async function showPreview(content: string) {
    // Create and show a new untitled document with the preview
    const doc = await vscode.workspace.openTextDocument({
        content,
        language: 'markdown'
    });
    
    await vscode.window.showTextDocument(doc, {
        preview: true,
        viewColumn: vscode.ViewColumn.Beside
    });
}

async function applyChanges(state: DifferState) {
    if (!state.parsedInput) {
        vscode.window.showErrorMessage('No changes to apply. Parse input first.');
        return;
    }

    const workspace = vscode.workspace.workspaceFolders?.[0];
    if (!workspace) {
        vscode.window.showErrorMessage('No workspace folder found');
        return;
    }

    try {
        // Now validate file access when actually needed
        vscode.window.showInformationMessage('Validating file access...');
        
        const fileValidations = await Promise.all(
            state.parsedInput.metadata!.affectedFiles.map(async (file) => ({
                file,
                validation: await ChangeParser.validateFileAccess(file, workspace)
            }))
        );

        // Check for file access errors
        const fileErrors = fileValidations
            .filter(fv => !fv.validation.isValid)
            .map(fv => `${fv.file}: ${fv.validation.errors.join(', ')}`);

        if (fileErrors.length > 0) {
            vscode.window.showErrorMessage(`File access errors: ${fileErrors.join('; ')}`);
            return;
        }

        // Show file warnings
        const fileWarnings = fileValidations
            .flatMap(fv => fv.validation.warnings.map(w => `${fv.file}: ${w}`));
        
        if (fileWarnings.length > 0) {
            const proceed = await vscode.window.showWarningMessage(
                `File warnings detected. Continue anyway?`,
                { detail: fileWarnings.join('\n') },
                'Yes', 'No'
            );
            
            if (proceed !== 'Yes') {
                return;
            }
        }

        // Confirm before applying
        const confirmResult = await vscode.window.showWarningMessage(
            `Apply ${state.parsedInput.changes.length} changes to ${state.parsedInput.metadata!.affectedFiles.length} files?`,
            { modal: true },
            'Apply Changes', 'Cancel'
        );

        if (confirmResult !== 'Apply Changes') {
            return;
        }

        // Apply changes
        vscode.window.showInformationMessage('Applying changes...');
        await applyParsedChanges(state.parsedInput, workspace);
        
        vscode.window.showInformationMessage('Changes applied successfully!');
        
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        vscode.window.showErrorMessage(`Failed to apply changes: ${message}`);
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
        // Try to read existing file
        let content = '';
        try {
            const fileData = await vscode.workspace.fs.readFile(fullPath);
            content = Buffer.from(fileData).toString('utf8');
        } catch {
            // File doesn't exist - will be created
            console.log(`Creating new file: ${filePath}`);
        }

        // Apply each change to the content
        let modifiedContent = content;
        
        for (const change of changes) {
            modifiedContent = applyChange(modifiedContent, change);
        }

        // Write the modified content back
        const writeData = Buffer.from(modifiedContent, 'utf8');
        await vscode.workspace.fs.writeFile(fullPath, writeData);
        
        console.log(`Applied ${changes.length} changes to ${filePath}`);
        
    } catch (error) {
        throw new Error(`Failed to apply changes to ${filePath}: ${error}`);
    }
}

function applyChange(content: string, change: any): string {
    // This is where you'd implement the actual change application logic
    // For now, just a placeholder that shows the concept
    
    switch (change.action) {
        case 'add_import':
            return addImport(content, change.code);
        
        case 'replace_function':
            return replaceFunction(content, change.target, change.code);
            
        case 'add_function':
            return addFunction(content, change.code);
            
        // Add other action handlers...
        
        default:
            console.warn(`Unsupported action: ${change.action}`);
            return content;
    }
}

// Placeholder change application functions
function addImport(content: string, importCode: string): string {
    const lines = content.split('\n');
    const importIndex = lines.findIndex(line => line.startsWith('use ')) || 0;
    lines.splice(importIndex, 0, importCode);
    return lines.join('\n');
}

function replaceFunction(content: string, functionName: string, newCode: string): string {
    // Simple regex-based replacement - you'd want more sophisticated parsing
    const functionRegex = new RegExp(`pub fn ${functionName}\\([^}]*\\}`, 'gs');
    return content.replace(functionRegex, newCode);
}

function addFunction(content: string, functionCode: string): string {
    // Add function before the last closing brace
    const lastBraceIndex = content.lastIndexOf('}');
    if (lastBraceIndex === -1) {
        return content + '\n\n' + functionCode;
    }
    
    return content.slice(0, lastBraceIndex) + '\n\n' + functionCode + '\n' + content.slice(lastBraceIndex);
}

function clearChanges(state: DifferState) {
    state.parsedInput = null;
    state.lastValidationResult = null;
    state.previewContent = null;
    vscode.window.showInformationMessage('Changes cleared');
}

export function deactivate() {
    console.log('👋 Differ extension deactivated');
}