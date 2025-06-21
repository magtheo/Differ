// src/extension.ts
import * as vscode from 'vscode';
import {
    ChangeParser,
    ParsedInput,
    ParsedChange,
    DetailedError,
    ChangeApplicationResult,
    BatchApplicationResult,
    ErrorCategories
} from './parser/inputParser';
import { DifferProvider } from './ui/webViewProvider';
import { CodeAnalyzer, Position, SymbolInfo, offsetToPosition } from './analysis/codeAnalyzer';
import { Logger } from './utils/logger';
import { getPreviewFileSystemProvider } from './utils/previewFileSystemProvider';

// --- Globals ---
let differProviderInstance: DifferProvider | undefined;
const logger = new Logger('Extension');
const history: any[] = []; // Simple in-memory history for now

/**
 * Represents a change that has been resolved to a specific start and end position in a file.
 */
interface PositionalChange extends ParsedChange {
    start: Position;
    end: Position;
}

// --- Activation / Deactivation ---

export async function activate(context: vscode.ExtensionContext) {
    logger.info('🚀 Differ extension is now active!');

    try {
        logger.info('🔄 Initializing CodeAnalyzer...');
        await CodeAnalyzer.initialize(context);
        logger.info('✅ CodeAnalyzer initialized successfully');
    } catch (error: any) {
        logger.error('❌ Failed to initialize CodeAnalyzer:', error);
        vscode.window.showWarningMessage('Differ: Code analysis features may not work properly. Check logs.');
    }

    // Register preview file system provider
    try {
        const previewProvider = getPreviewFileSystemProvider();
        context.subscriptions.push(
            vscode.workspace.registerFileSystemProvider('differ-preview', previewProvider, {
                isCaseSensitive: true,
                isReadonly: false
            })
        );
        logger.info('✅ Preview file system provider registered');
    } catch (error: any) {
        logger.error('❌ Failed to register preview file system provider:', error);
    }

    const provider = new DifferProvider(context.extensionUri, context);
    differProviderInstance = provider;

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(DifferProvider.viewType, provider)
    );

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('differ.openPanel', () => provider.show()),
        
        // Updated applyChanges command - now expects ParsedInput instead of individual changes
        vscode.commands.registerCommand('differ.applyChanges', async (
            parsedInput: ParsedInput
        ): Promise<BatchApplicationResult> => {
            const batchId = generateBatchId();
            logger.logBatchStart(batchId, parsedInput.changes.length, parsedInput.description);
            
            const workspace = vscode.workspace.workspaceFolders?.[0];
            if (!workspace) {
                const error = createDetailedError(
                    ErrorCategories.GENERAL_ERROR,
                    'No workspace folder found.',
                    'Cannot apply changes without an active workspace.',
                    ['Open a folder or workspace.']
                );
                logger.error('ApplyChanges failed: No workspace folder.', error);
                const batchResult: BatchApplicationResult = {
                    batchId,
                    overallSuccess: false,
                    processedChangeCountInThisAttempt: 0,
                    successfullyAppliedCountInThisAttempt: 0,
                    resultsInThisAttempt: [],
                    batchError: error,
                };
                return batchResult;
            }
            
            return _processBatch(batchId, parsedInput.changes, workspace);
        }),
        
        // New command for applying a fixed change and resuming the batch
        vscode.commands.registerCommand('differ.applyFixedChangeAndResume', async (
            batchId: string,
            fixedChange: ParsedChange,
            remainingChangesInBatch: ParsedChange[]
        ): Promise<BatchApplicationResult> => {
            logger.info(`Resuming batch ${batchId} starting with fixed change: ${fixedChange.description}`, { 
                remainingCount: remainingChangesInBatch.length 
            });

            const workspace = vscode.workspace.workspaceFolders?.[0];
            if (!workspace) {
                const error = createDetailedError(
                    ErrorCategories.GENERAL_ERROR,
                    'No workspace folder found.',
                    'Cannot resume batch without an active workspace.',
                    ['Open a folder or workspace.']
                );
                return {
                    batchId,
                    overallSuccess: false,
                    processedChangeCountInThisAttempt: 0,
                    successfullyAppliedCountInThisAttempt: 0,
                    resultsInThisAttempt: [],
                    batchError: error,
                };
            }

            const changesForThisRun = [fixedChange, ...remainingChangesInBatch];
            return _processBatch(batchId, changesForThisRun, workspace, true);
        }),

        vscode.commands.registerCommand('differ.clearChanges', () => {
            if (differProviderInstance) {
                differProviderInstance.clearChanges();
            }
        }),

        vscode.commands.registerCommand('differ.showHistory', () => {
            // TODO: Implement history display
            vscode.window.showInformationMessage('History feature coming soon!');
        }),

        vscode.commands.registerCommand('differ.undoLastChanges', () => {
            // TODO: Implement undo functionality
            vscode.window.showInformationMessage('Undo feature coming soon!');
        })
    );

    // Register view title bar commands
    const viewTitleCommands = [
        vscode.commands.registerCommand('differ.view.showExample', async () => {
            const example = ChangeParser.generateExample();
            const doc = await vscode.workspace.openTextDocument({ 
                content: example, 
                language: 'plaintext' 
            });
            await vscode.window.showTextDocument(doc, { 
                preview: true, 
                viewColumn: vscode.ViewColumn.Beside 
            });
        }),
        
        vscode.commands.registerCommand('differ.view.showHelp', async () => {
            const documentation = ChangeParser.getFormatDocumentation();
            const doc = await vscode.workspace.openTextDocument({ 
                content: documentation, 
                language: 'markdown' 
            });
            await vscode.window.showTextDocument(doc, { 
                preview: true, 
                viewColumn: vscode.ViewColumn.Beside 
            });
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
}

export function deactivate() {
    logger.info('👋 Differ extension deactivated');
    differProviderInstance = undefined;
}

// --- Core Batch Processing Logic (Phase 2 Implementation) ---

/**
 * Processes a batch of changes sequentially, implementing fail-fast logic.
 * Returns a BatchApplicationResult.
 */
async function _processBatch(
    batchId: string,
    changesToProcess: ParsedChange[],
    workspace: vscode.WorkspaceFolder,
    isResume: boolean = false
): Promise<BatchApplicationResult> {
    logger.info(`_processBatch invoked for batch ${batchId}. Changes: ${changesToProcess.length}. IsResume: ${isResume}`);

    const resultsInThisAttempt: ChangeApplicationResult[] = [];
    let successfullyAppliedCountInThisAttempt = 0;
    let processedChangeCountInThisAttempt = 0;
    
    // Store original "before" snapshots for files modified in this run
    const fileSnapshotsBeforeThisRun = new Map<string, string>();

    for (let i = 0; i < changesToProcess.length; i++) {
        const parsedChange = changesToProcess[i];
        const changeIndexInOriginalBatch = i; // For now, using index in current array
        const effectiveChangeId = `change-${batchId}-${i}-${parsedChange.action}`;

        logger.logChangeProcessingStart(batchId, effectiveChangeId, changeIndexInOriginalBatch, parsedChange.action, parsedChange.file);
        processedChangeCountInThisAttempt++;

        let beforeSnapshot: string | undefined = fileSnapshotsBeforeThisRun.get(parsedChange.file);

        // Get "before" snapshot for non-create actions
        if (parsedChange.action !== 'create_file' && beforeSnapshot === undefined) {
            try {
                const fullPath = vscode.Uri.joinPath(workspace.uri, parsedChange.file);
                const fileData = await vscode.workspace.fs.readFile(fullPath);
                beforeSnapshot = Buffer.from(fileData).toString('utf8');
                fileSnapshotsBeforeThisRun.set(parsedChange.file, beforeSnapshot);
                logger.logFileSnapshot('before', effectiveChangeId, parsedChange.file, beforeSnapshot);
            } catch (e: any) {
                logger.error(`Failed to read file for 'before' snapshot: ${parsedChange.file}`, e);
                const error = createDetailedError(
                    ErrorCategories.FILE_ERROR_READ_FAILED,
                    `Failed to read file: ${parsedChange.file}`,
                    e.message || String(e),
                    ['Check file existence and permissions.'],
                    { filePath: parsedChange.file }
                );
                const failedResult: ChangeApplicationResult = {
                    changeId: effectiveChangeId,
                    success: false,
                    error: error,
                    changeIndex: changeIndexInOriginalBatch,
                    originalChange: parsedChange,
                };
                resultsInThisAttempt.push(failedResult);
                
                return {
                    batchId,
                    overallSuccess: false,
                    processedChangeCountInThisAttempt,
                    successfullyAppliedCountInThisAttempt,
                    failedChangeResult: failedResult,
                    resultsInThisAttempt,
                };
            }
        } else if (parsedChange.action === 'create_file') {
            beforeSnapshot = "";
        }

        const singleChangeResult = await _applySingleChange(
            parsedChange,
            changeIndexInOriginalBatch,
            effectiveChangeId,
            workspace,
            beforeSnapshot
        );

        resultsInThisAttempt.push(singleChangeResult);
        logger.logChangeProcessingResult(batchId, effectiveChangeId, singleChangeResult);

        if (singleChangeResult.success) {
            successfullyAppliedCountInThisAttempt++;
            
            // Get "after" snapshot
            let afterContent = "";
            if (parsedChange.action === 'create_file') {
                afterContent = parsedChange.code;
            } else {
                try {
                    const fullPath = vscode.Uri.joinPath(workspace.uri, parsedChange.file);
                    const fileData = await vscode.workspace.fs.readFile(fullPath);
                    afterContent = Buffer.from(fileData).toString('utf8');
                } catch (e: any) {
                    logger.warn(`Could not read file for 'after' snapshot: ${parsedChange.file}`, e);
                }
            }
            
            logger.logFileSnapshot('after-success', effectiveChangeId, parsedChange.file, afterContent);
            createHistoryEntry(batchId, singleChangeResult, beforeSnapshot || "", afterContent);
        } else {
            // Failure: stop processing this batch attempt
            logger.error(`Batch ${batchId} failed at change ${effectiveChangeId}. Stopping processing.`);
            if (beforeSnapshot !== undefined) {
                logger.logFileSnapshot('after-fail-attempt', effectiveChangeId, parsedChange.file, beforeSnapshot);
            }
            
            return {
                batchId,
                overallSuccess: false,
                processedChangeCountInThisAttempt,
                successfullyAppliedCountInThisAttempt,
                failedChangeResult: singleChangeResult,
                resultsInThisAttempt,
            };
        }
    }

    // If loop completes, all changes in this run were successful
    return {
        batchId,
        overallSuccess: true,
        processedChangeCountInThisAttempt,
        successfullyAppliedCountInThisAttempt,
        resultsInThisAttempt,
    };
}

/**
 * Applies a single parsed change to the workspace.
 * Returns a ChangeApplicationResult.
 */
async function _applySingleChange(
    change: ParsedChange,
    originalBatchIndex: number,
    effectiveChangeId: string,
    workspace: vscode.WorkspaceFolder,
    currentContentForFile?: string
): Promise<ChangeApplicationResult> {
    const startTime = Date.now();
    
    try {
        // Handle create_file action
        if (change.action === 'create_file') {
            const fullPath = vscode.Uri.joinPath(workspace.uri, change.file);
            
            try {
                // Ensure directory exists
                const dirPath = vscode.Uri.joinPath(fullPath, '..');
                await vscode.workspace.fs.createDirectory(dirPath);
            } catch (e: any) {
                if (!(e instanceof vscode.FileSystemError && e.code === 'FileExists')) {
                    throw e;
                }
            }
            
            const writeData = Buffer.from(change.code, 'utf8');
            await vscode.workspace.fs.writeFile(fullPath, writeData);
            logger.info(`File created: ${change.file}`);
            
            return {
                changeId: effectiveChangeId,
                success: true,
                changeIndex: originalBatchIndex,
                originalChange: change,
                durationMs: Date.now() - startTime,
                appliedAt: Date.now()
            };
        }

        // All other modification actions
        const fullPath = vscode.Uri.joinPath(workspace.uri, change.file);
        let fileContent = currentContentForFile;

        if (fileContent === undefined) {
            throw new Error(`Internal error: file content not available for modification: ${change.file}`);
        }

        // Resolve target to PositionalChange using CodeAnalyzer
        const positionalChanges: PositionalChange[] = [];
        let symbolInfo: SymbolInfo | undefined;
        let changeToApply = { ...change };

        switch (changeToApply.action) {
            case 'replace_function':
            case 'delete_function': {
                const result = await CodeAnalyzer.validateFunction(change.file, change.target, workspace);
                if (result.exists && result.symbolInfo) {
                    symbolInfo = result.symbolInfo;
                } else {
                    throw result.error || createDetailedError(
                        ErrorCategories.TARGET_ERROR_FUNCTION_NOT_FOUND,
                        `Function "${change.target}" not found.`,
                        'Function validation failed',
                        ['Check function name spelling and case.'],
                        { file: change.file, target: change.target }
                    );
                }
                if (changeToApply.action === 'delete_function') {
                    changeToApply.code = "";
                }
                break;
            }

            case 'replace_method': {
                if (!change.class) {
                    throw createDetailedError(
                        ErrorCategories.SYNTAX_ERROR_INPUT_FORMAT,
                        `Action 'replace_method' requires a CLASS.`,
                        `Missing CLASS field for target '${change.target}'.`,
                        ['Add CLASS: ClassName.']
                    );
                }
                const result = await CodeAnalyzer.validateMethod(change.file, change.class, change.target, workspace);
                if (result.exists && result.symbolInfo) {
                    symbolInfo = result.symbolInfo;
                } else {
                    throw result.error || createDetailedError(
                        ErrorCategories.TARGET_ERROR_METHOD_NOT_FOUND,
                        `Method "${change.target}" in class "${change.class}" not found.`,
                        'Method validation failed',
                        ['Check method name spelling and case.'],
                        { file: change.file, class: change.class, target: change.target }
                    );
                }
                break;
            }

            case 'add_method': {
                if (!change.class) {
                    throw createDetailedError(
                        ErrorCategories.SYNTAX_ERROR_INPUT_FORMAT,
                        `Action 'add_method' requires a CLASS.`,
                        `Missing CLASS field for target '${change.target}'.`,
                        ['Add CLASS: ClassName.']
                    );
                }
                const classResult = await CodeAnalyzer.validateClass(change.file, change.class, workspace);
                if (!classResult.exists || !classResult.symbolInfo?.end) {
                    throw classResult.error || createDetailedError(
                        ErrorCategories.TARGET_ERROR_CLASS_NOT_FOUND,
                        `Class "${change.class}" not found.`,
                        'Class validation failed',
                        ['Check class name spelling and case.'],
                        { file: change.file, class: change.class }
                    );
                }

                // Find insertion point before closing brace
                const insertionOffset = classResult.symbolInfo.end.offset - 1;
                const { line, column, offset } = offsetToPosition(fileContent, insertionOffset);

                // Determine indentation from the line containing the closing brace
                const lines = fileContent.split('\n');
                const insertionLine = line - 1; // Convert to 0-based
                const classClosingLine = lines[insertionLine] || '';
                const indentMatch = classClosingLine.match(/^(\s*)/);
                const baseIndent = indentMatch ? indentMatch[1] : '';
                const methodIndent = baseIndent + '    '; // Add one level of indentation

                // Format the new method with proper indentation
                const indentedCode = changeToApply.code
                    .split('\n')
                    .map((line, index) => {
                        if (index === 0 || line.trim() === '') return line;
                        return methodIndent + line;
                    })
                    .join('\n');

                changeToApply.code = `\n${methodIndent}${indentedCode}\n`;
                symbolInfo = { 
                    name: change.target, 
                    start: { line, column, offset }, 
                    end: { line, column, offset } 
                };
                break;
            }

            case 'add_function': {
                const analysis = await CodeAnalyzer.analyzeFile(change.file, workspace);
                if (!analysis.isReadable || !analysis.tree) {
                    throw createDetailedError(
                        ErrorCategories.ANALYSIS_ERROR_TS_PARSE_FAILED,
                        "Could not analyze file for function addition.",
                        analysis.parseErrors?.join('; ') || "File analysis failed",
                        ['Check file syntax and permissions.']
                    );
                }

                // Insert at end of file
                let insertionOffset = fileContent.length;
                const rootNode = analysis.tree.rootNode;
                
                if (rootNode && rootNode.namedChildren.length > 0) {
                    const lastChild = rootNode.namedChildren[rootNode.namedChildren.length - 1];
                    insertionOffset = lastChild.endIndex;
                }

                const pos = offsetToPosition(fileContent, insertionOffset);
                changeToApply.code = `\n\n${changeToApply.code}\n`;
                symbolInfo = { 
                    name: change.target, 
                    start: pos, 
                    end: pos 
                };
                break;
            }

            case 'add_import': {
                const analysis = await CodeAnalyzer.analyzeFile(change.file, workspace);
                if (!analysis.isReadable) {
                    throw createDetailedError(
                        ErrorCategories.ANALYSIS_ERROR_TS_PARSE_FAILED,
                        "Could not analyze file for import addition.",
                        analysis.parseErrors?.join('; ') || "File analysis failed",
                        ['Check file syntax and permissions.']
                    );
                }

                let insertionOffset = 0;
                if (analysis.imports.length > 0) {
                    const lastImportSymbol = analysis.imports[analysis.imports.length - 1];
                    insertionOffset = lastImportSymbol.end.offset;
                }

                const pos = offsetToPosition(fileContent, insertionOffset);
                changeToApply.code = insertionOffset === 0 
                    ? `${changeToApply.code}\n` 
                    : `\n${changeToApply.code}`;
                    
                symbolInfo = { 
                    name: change.target, 
                    start: pos, 
                    end: pos 
                };
                break;
            }

            case 'replace_block': {
                const result = await CodeAnalyzer.validateBlock(change.file, change.target, workspace);
                if (result.exists && result.symbolInfo) {
                    symbolInfo = result.symbolInfo;
                } else {
                    throw result.error || createDetailedError(
                        ErrorCategories.TARGET_ERROR_BLOCK_NOT_FOUND,
                        `Code block starting with "${change.target.substring(0, 30)}..." not found.`,
                        'Block validation failed',
                        ['Ensure the target is an exact copy from the file.'],
                        { file: change.file, target: change.target }
                    );
                }
                break;
            }

            case 'insert_after':
            case 'insert_before': {
                const result = await CodeAnalyzer.validateBlock(change.file, change.target, workspace);
                if (result.exists && result.symbolInfo) {
                    // For insert_after, use end position; for insert_before, use start position
                    const insertPoint = changeToApply.action === 'insert_after' 
                        ? result.symbolInfo.end 
                        : result.symbolInfo.start;
                    
                    symbolInfo = { 
                        name: change.target, 
                        start: insertPoint, 
                        end: insertPoint 
                    };
                    
                    // Add newlines for proper formatting
                    changeToApply.code = changeToApply.action === 'insert_after'
                        ? `\n${changeToApply.code}`
                        : `${changeToApply.code}\n`;
                } else {
                    throw result.error || createDetailedError(
                        ErrorCategories.TARGET_ERROR_BLOCK_NOT_FOUND,
                        `Target for ${change.action} not found.`,
                        'Target validation failed',
                        ['Check target spelling and ensure it exists in the file.'],
                        { file: change.file, target: change.target, action: change.action }
                    );
                }
                break;
            }

            case 'add_struct':
            case 'add_enum': {
                const analysis = await CodeAnalyzer.analyzeFile(change.file, workspace);
                if (!analysis.isReadable || !analysis.tree) {
                    throw createDetailedError(
                        ErrorCategories.ANALYSIS_ERROR_TS_PARSE_FAILED,
                        `Could not analyze file for ${change.action}.`,
                        analysis.parseErrors?.join('; ') || "File analysis failed",
                        ['Check file syntax and permissions.']
                    );
                }

                // Insert at end of file
                let insertionOffset = fileContent.length;
                const rootNode = analysis.tree.rootNode;
                
                if (rootNode && rootNode.namedChildren.length > 0) {
                    const lastChild = rootNode.namedChildren[rootNode.namedChildren.length - 1];
                    insertionOffset = lastChild.endIndex;
                }

                const pos = offsetToPosition(fileContent, insertionOffset);
                changeToApply.code = `\n\n${changeToApply.code}\n`;
                symbolInfo = { 
                    name: change.target, 
                    start: pos, 
                    end: pos 
                };
                break;
            }

            case 'modify_line': {
                // For modify_line, target should be line number or line content
                const targetLineNumber = parseInt(change.target);
                if (!isNaN(targetLineNumber)) {
                    const lines = fileContent.split('\n');
                    if (targetLineNumber < 1 || targetLineNumber > lines.length) {
                        throw createDetailedError(
                            ErrorCategories.TARGET_ERROR_NOT_FOUND,
                            `Line number ${targetLineNumber} is out of range.`,
                            `File has ${lines.length} lines.`,
                            ['Check the line number.'],
                            { file: change.file, lineNumber: targetLineNumber, totalLines: lines.length }
                        );
                    }

                    // Calculate position for the entire line
                    let lineStartOffset = 0;
                    for (let i = 0; i < targetLineNumber - 1; i++) {
                        lineStartOffset += lines[i].length + 1; // +1 for newline
                    }
                    const lineEndOffset = lineStartOffset + lines[targetLineNumber - 1].length;
                    
                    const startPos = offsetToPosition(fileContent, lineStartOffset);
                    const endPos = offsetToPosition(fileContent, lineEndOffset);
                    
                    symbolInfo = { 
                        name: `line ${targetLineNumber}`, 
                        start: startPos, 
                        end: endPos 
                    };
                } else {
                    // Target is line content to find and replace
                    const result = await CodeAnalyzer.validateBlock(change.file, change.target, workspace);
                    if (result.exists && result.symbolInfo) {
                        symbolInfo = result.symbolInfo;
                    } else {
                        throw result.error || createDetailedError(
                            ErrorCategories.TARGET_ERROR_NOT_FOUND,
                            `Target line content not found: "${change.target}"`,
                            'Line content validation failed',
                            ['Check the target line content.'],
                            { file: change.file, target: change.target }
                        );
                    }
                }
                break;
            }

            default:
                throw createDetailedError(
                    ErrorCategories.APPLICATION_LOGIC_ERROR,
                    `Unsupported action type: ${change.action}`,
                    `The action '${change.action}' cannot be processed.`,
                    ['Use a supported action type.']
                );
        }

        if (symbolInfo) {
            positionalChanges.push({ ...changeToApply, start: symbolInfo.start, end: symbolInfo.end });
        } else {
            throw createDetailedError(
                ErrorCategories.TARGET_ERROR_NOT_FOUND,
                `Could not find target or determine insertion point for action '${change.action}'.`,
                `Target: '${change.target || change.description}' in file ${change.file}.`,
                ['Verify target and file.']
            );
        }

        // Sort positional changes by offset (highest first for proper application)
        positionalChanges.sort((a, b) => b.start.offset - a.start.offset);

        let modifiedContent = fileContent;
        for (const posChange of positionalChanges) {
            const applyResult = _applySinglePositionalChangeToContent(modifiedContent, posChange);
            if (!applyResult.success) {
                throw applyResult.error;
            }
            modifiedContent = applyResult.newContent;
        }

        const writeData = Buffer.from(modifiedContent, 'utf8');
        await vscode.workspace.fs.writeFile(fullPath, writeData);
        logger.info(`Applied modification to ${change.file} for action ${change.action}`);

        return {
            changeId: effectiveChangeId,
            success: true,
            changeIndex: originalBatchIndex,
            originalChange: change,
            durationMs: Date.now() - startTime,
            appliedAt: Date.now()
        };

    } catch (error: any) {
        logger.error(`Failed to apply single change ${effectiveChangeId} (${change.action} on ${change.file}):`, error);
        
        const detailedError = (error.code && error.message && error.details)
            ? error as DetailedError
            : createDetailedError(
                error.code || ErrorCategories.APPLICATION_LOGIC_ERROR,
                `Failed to apply change: ${change.action} on ${change.file}`,
                error.message || String(error),
                error.suggestions || ['Review error details and change configuration.'],
                { stack: error.stack, change: change }
            );
            
        return {
            changeId: effectiveChangeId,
            success: false,
            error: detailedError,
            changeIndex: originalBatchIndex,
            originalChange: change,
            durationMs: Date.now() - startTime
        };
    }
}

/**
 * Pure function to apply a single positional change to a string content.
 * Returns new content or error if offsets are invalid.
 */
function _applySinglePositionalChangeToContent(
    content: string,
    change: PositionalChange
): { newContent: string; success: boolean; error?: DetailedError } {
    logger.debug(`Applying positional change: ${change.action}, target: ${change.target.substring(0, 30)}`, {
        start: change.start.offset,
        end: change.end.offset,
        codeLen: change.code.length
    });
    
    if (change.start.offset < 0 || change.end.offset > content.length || change.start.offset > change.end.offset) {
        return {
            success: false,
            newContent: content,
            error: createDetailedError(
                ErrorCategories.APPLICATION_LOGIC_ERROR_OFFSET_OUT_OF_BOUNDS,
                'Invalid change offsets.',
                `Start: ${change.start.offset}, End: ${change.end.offset}, Content Length: ${content.length}.`,
                ['Verify target identification logic.'],
                { change }
            )
        };
    }

    const before = content.slice(0, change.start.offset);
    const after = content.slice(change.end.offset);
    
    return {
        success: true,
        newContent: before + change.code + after
    };
}

// --- History Management ---

function createHistoryEntry(
    batchId: string,
    appliedChangeResult: ChangeApplicationResult,
    beforeSnapshot: string,
    afterSnapshot: string
) {
    const historyEntry = {
        id: `history-${Date.now()}-${Math.random().toString(16).substring(2, 8)}`,
        timestamp: Date.now(),
        batchId,
        changeId: appliedChangeResult.changeId,
        originalChange: appliedChangeResult.originalChange,
        beforeSnapshotLength: beforeSnapshot.length,
        afterSnapshotLength: afterSnapshot.length,
        // Future: store actual diffs or rollback instructions
        appliedAt: appliedChangeResult.appliedAt,
        durationMs: appliedChangeResult.durationMs
    };
    
    history.push(historyEntry);
    logger.info(`History entry created for change ${appliedChangeResult.changeId} in batch ${batchId}. Total history: ${history.length}`);
}

// --- Utility Functions ---

/**
 * Generate a unique batch ID
 */
function generateBatchId(): string {
    return `batch-${Date.now()}-${Math.random().toString(16).substring(2, 8)}`;
}

/**
 * Helper to create DetailedError objects
 */
function createDetailedError(
    code: string,
    message: string,
    details: string,
    suggestions: string[] = [],
    context?: any
): DetailedError {
    return { 
        code, 
        message, 
        details, 
        suggestions, 
        context 
    };
}