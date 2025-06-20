// src/parser/inputParser.ts
import * as vscode from 'vscode';
import { FormatDocumentation } from './formatDocumentation';

// --- NEW/UPDATED INTERFACES (from Revised Plan v2) ---

/**
 * Represents a detailed error with user-friendly and technical information.
 */
export interface DetailedError {
    message: string;        // High-level user-friendly error description
    details: string;        // Full technical details (stack trace, file context, specific Tree-sitter node info, etc.)
    code: string;           // Hierarchical error category code (e.g., FILE_ERROR.NOT_FOUND)
    suggestions: string[];  // Actionable suggestions for fixing the error
    context?: any;          // Additional debugging context (relevant code snippets, operation attempted, file path, target name)
}

/**
 * Tracks the outcome of applying a single change.
 */
export interface ChangeApplicationResult {
    changeId: string;           // Unique identifier of the change (persists from PendingChange.id)
    success: boolean;           // True if change was applied successfully
    error?: DetailedError;      // Present if the change failed
    changeIndex: number;        // Original 0-based index of the change within the input batch
    originalChange: ParsedChange; // A copy of the ParsedChange object
    appliedAt?: number;         // Timestamp (e.g., Date.now()) of successful application
    durationMs?: number;        // Time taken to apply this change
}

/**
 * Tracks the overall outcome of a batch application attempt.
 */
export interface BatchApplicationResult {
    batchId: string;                // Unique identifier for this specific batch application attempt
    overallSuccess: boolean;        // True if *all* changes in the batch processed successfully in this attempt
    processedChangeCountInThisAttempt: number; // Number of changes attempted *in this specific run*
    successfullyAppliedCountInThisAttempt: number; // Number of changes successfully applied *in this specific run*
    failedChangeResult?: ChangeApplicationResult; // The result for the first change that failed in this attempt, if any
    resultsInThisAttempt: ChangeApplicationResult[]; // Individual outcomes for changes processed *in this attempt*
    batchError?: DetailedError;     // Overall batch-level error if the entire process failed catastrophically
}

/**
 * Payload for generating an LLM prompt for a failed change.
 */
export interface FailedChangeExportPayload {
    originalChangeBlock: string; // The full original comment-based block of the failed change
    error: DetailedError;        // The detailed error for this specific failed change
    contextDescription: string;  // Brief description of the overall goal (from ParsedInput.description)
    language?: string;           // Detected language of the file, if known
}

// --- ERROR CATEGORIZATION CONSTANTS (Examples) ---
export const ErrorCategories = {
    // Top-level
    FILE_ERROR: 'FILE_ERROR',
    TARGET_ERROR: 'TARGET_ERROR',
    SYNTAX_ERROR: 'SYNTAX_ERROR', // Error in the input format itself, or in the provided code
    PERMISSION_ERROR: 'PERMISSION_ERROR',
    APPLICATION_LOGIC_ERROR: 'APPLICATION_LOGIC_ERROR', // Errors in the extension's change application logic
    ANALYSIS_ERROR: 'ANALYSIS_ERROR', // Errors from CodeAnalyzer/TreeSitterService
    GENERAL_ERROR: 'GENERAL_ERROR', // Fallback

    // Sub-categories (Examples)
    FILE_ERROR_NOT_FOUND: 'FILE_ERROR.NOT_FOUND',
    FILE_ERROR_READ_FAILED: 'FILE_ERROR.READ_FAILED',
    FILE_ERROR_WRITE_FAILED: 'FILE_ERROR.WRITE_FAILED',

    TARGET_ERROR_NOT_FOUND: 'TARGET_ERROR.NOT_FOUND', // Generic target not found
    TARGET_ERROR_FUNCTION_NOT_FOUND: 'TARGET_ERROR.FUNCTION_NOT_FOUND',
    TARGET_ERROR_METHOD_NOT_FOUND: 'TARGET_ERROR.METHOD_NOT_FOUND',
    TARGET_ERROR_CLASS_NOT_FOUND: 'TARGET_ERROR.CLASS_NOT_FOUND',
    TARGET_ERROR_BLOCK_NOT_FOUND: 'TARGET_ERROR.BLOCK_NOT_FOUND',
    TARGET_ERROR_BLOCK_MISMATCH: 'TARGET_ERROR.BLOCK_MISMATCH', // Found block but content differs from target

    SYNTAX_ERROR_INPUT_FORMAT: 'SYNTAX_ERROR.INPUT_FORMAT', // Error in the Differ comment format
    SYNTAX_ERROR_CODE_BLOCK: 'SYNTAX_ERROR.CODE_BLOCK',   // Syntax error in the user-provided code

    APPLICATION_LOGIC_ERROR_OFFSET_OUT_OF_BOUNDS: 'APPLICATION_LOGIC_ERROR.OFFSET_OUT_OF_BOUNDS',

    ANALYSIS_ERROR_TS_PARSE_FAILED: 'ANALYSIS_ERROR.TS_PARSE_FAILED',
    ANALYSIS_ERROR_TS_QUERY_FAILED: 'ANALYSIS_ERROR.TS_QUERY_FAILED',
} as const;

// --- EXISTING INTERFACES (Mostly unchanged, but reviewed for consistency) ---

export interface ParsedChange {
    file: string;
    action: ChangeAction;
    target: string;
    code: string;
    class?: string;
    description?: string;
    // originalBlockIndex?: number; 
    // rawChangeBlock?: string; 
}

export interface ParsedInput {
    description: string; 
    changes: ParsedChange[];
    metadata?: {
        totalChanges: number;
        affectedFiles: string[];
        hasNewFiles: boolean;
        rawInput?: string; // Store the original full input string
    };
}

export type ChangeAction =
    | 'add_import'
    | 'replace_function'
    | 'add_function'
    | 'replace_method'
    | 'add_method'
    | 'add_struct'
    | 'add_enum'
    | 'replace_block'
    | 'insert_after'
    | 'insert_before'
    | 'delete_function'
    | 'modify_line' 
    | 'create_file';

export interface InputFormatValidationError {
    type: 'parse_error' | 'missing_field' | 'invalid_action' | 'invalid_format' | 'duplicate_change_definition';
    changeBlockIndex?: number;
    field?: string;
    message: string;
    details?: string;
    suggestion?: string;
}

export interface InputFormatValidationWarning {
    type: 'missing_change_description' | 'large_change_block_count' | 'duplicate_target_definition' | 'long_code_block_in_input' | 'missing_target_in_input';
    changeBlockIndex?: number;
    field?: string;
    message: string;
    suggestion?: string;
}

export interface InputFormatValidationResult {
    isValid: boolean;
    errors: InputFormatValidationError[];
    warnings: InputFormatValidationWarning[];
}

export interface FileAccessValidationResult {
    isValid: boolean;
    errors: InputFormatValidationError[]; 
    warnings: InputFormatValidationWarning[];
}


export class ChangeParser {

    private static readonly VALID_ACTIONS: ChangeAction[] = [
        'add_import', 'replace_function', 'add_function', 'replace_method', 'add_method',
        'add_struct', 'add_enum', 'replace_block', 'insert_after', 'insert_before',
        'delete_function', 'modify_line', 'create_file'
    ];

    private static readonly MAX_REASONABLE_CHANGES = 100;
    private static readonly MAX_CODE_LENGTH = 20000;

    private static readonly CHANGE_PATTERN = /^CHANGE:\s*(.+)$/m;
    private static readonly FILE_PATTERN = /^FILE:\s*(.+)$/m;
    private static readonly ACTION_PATTERN = /^ACTION:\s*(.+)$/m;
    private static readonly TARGET_PATTERN = /^TARGET:\s*(.+)$/m;
    private static readonly CLASS_PATTERN = /^CLASS:\s*(.+)$/m;
    private static readonly CODE_DELIMITER = /^---\s*$/m;

    public static parseInput(inputContent: string): ParsedInput {
        const structureValidation = this.validateInputStructure(inputContent);

        if (!structureValidation.isValid) {
            const errorSummary = structureValidation.errors.map(e => `Block ${e.changeBlockIndex !== undefined ? e.changeBlockIndex + 1 : 'N/A'}${e.field ? ` (Field: ${e.field})` : ''}: ${e.message}${e.suggestion ? ` Suggestion: ${e.suggestion}` : ''}`).join('; ');
            const err = new Error(`Input format validation failed: ${errorSummary}`);
            (err as any).validationErrors = structureValidation.errors;
            throw err;
        }

        const globalDescription = this.extractGlobalDescription(inputContent) || 'Code modifications';
        const changeBlocks = this.splitIntoChangeBlocks(inputContent);
        const parsedChanges: ParsedChange[] = [];
        const affectedFiles = new Set<string>();

        for (let i = 0; i < changeBlocks.length; i++) {
            const change = this.parseChangeBlock(changeBlocks[i], i); // Removed originalFullInput argument as it's not used here
            parsedChanges.push(change);
            affectedFiles.add(change.file);
        }

        return {
            description: globalDescription,
            changes: parsedChanges,
            metadata: {
                totalChanges: parsedChanges.length,
                affectedFiles: Array.from(affectedFiles),
                hasNewFiles: parsedChanges.some(c => c.action === 'create_file'),
                rawInput: inputContent // Storing raw input
            }
        };
    }

    public static validateInputStructure(inputContent: string): InputFormatValidationResult {
        const errors: InputFormatValidationError[] = [];
        const warnings: InputFormatValidationWarning[] = [];

        if (!inputContent || inputContent.trim() === '') {
            errors.push({
                type: 'invalid_format',
                message: 'Input cannot be empty.',
                suggestion: 'Provide changes using the comment-based format.'
            });
            return { isValid: false, errors, warnings };
        }

        const changeBlockMarkers = inputContent.match(/^CHANGE:/gm);
        if (!changeBlockMarkers || changeBlockMarkers.length === 0) {
            errors.push({
                type: 'invalid_format',
                message: 'No change blocks found. Each change must start with "CHANGE:".',
                suggestion: 'Ensure each modification is defined in a separate CHANGE block.'
            });
        } else if (changeBlockMarkers.length > this.MAX_REASONABLE_CHANGES) {
            warnings.push({
                type: 'large_change_block_count',
                message: `Large number of change blocks (${changeBlockMarkers.length}). Consider splitting into smaller batches for clarity and performance.`,
                suggestion: 'Break down extensive modifications into smaller, logical sets.'
            });
        }

        const blocks = this.splitIntoChangeBlocks(inputContent);
        const uniqueChangeKeys = new Set<string>();

        blocks.forEach((block, index) => {
            const blockValidation = this.validateSingleChangeBlockStructure(block, index);
            errors.push(...blockValidation.errors);
            warnings.push(...blockValidation.warnings);

            const fileMatch = block.match(this.FILE_PATTERN);
            const actionMatch = block.match(this.ACTION_PATTERN);
            const targetMatch = block.match(this.TARGET_PATTERN);
            if (fileMatch && actionMatch) {
                const key = `${fileMatch[1].trim()}|${actionMatch[1].trim()}|${targetMatch ? targetMatch[1].trim() : ''}`;
                if (uniqueChangeKeys.has(key) && actionMatch[1].trim() !== 'add_import') { 
                    errors.push({
                        type: 'duplicate_change_definition',
                        changeBlockIndex: index,
                        message: `Duplicate change definition found for action '${actionMatch[1].trim()}' on target '${targetMatch ? targetMatch[1].trim() : 'N/A'}' in file '${fileMatch[1].trim()}'.`,
                        suggestion: 'Ensure each change operation is unique or combine them if appropriate.'
                    });
                }
                uniqueChangeKeys.add(key);
            }
        });

        return {
            isValid: errors.length === 0,
            errors,
            warnings
        };
    }

    private static validateSingleChangeBlockStructure(block: string, blockIndex: number): InputFormatValidationResult {
        const errors: InputFormatValidationError[] = [];
        const warnings: InputFormatValidationWarning[] = [];

        if (!this.CHANGE_PATTERN.test(block)) {
            errors.push({ type: 'missing_field', changeBlockIndex: blockIndex, field: 'CHANGE', message: 'Missing CHANGE line.', suggestion: 'Start with "CHANGE: description".' });
        } else {
            const changeDesc = block.match(this.CHANGE_PATTERN)?.[1]?.trim();
            if (!changeDesc) {
                 warnings.push({ type: 'missing_change_description', changeBlockIndex: blockIndex, field: 'CHANGE', message: 'CHANGE description is empty.', suggestion: 'Provide a meaningful description.' });
            }
        }
        if (!this.FILE_PATTERN.test(block)) {
            errors.push({ type: 'missing_field', changeBlockIndex: blockIndex, field: 'FILE', message: 'Missing FILE line.', suggestion: 'Add "FILE: path/to/file.ext".' });
        }
        if (!this.ACTION_PATTERN.test(block)) {
            errors.push({ type: 'missing_field', changeBlockIndex: blockIndex, field: 'ACTION', message: 'Missing ACTION line.', suggestion: 'Add "ACTION: action_type".' });
        } else {
            const action = block.match(this.ACTION_PATTERN)![1].trim();
            if (!this.VALID_ACTIONS.includes(action as ChangeAction)) {
                const suggestion = this.suggestSimilarAction(action);
                errors.push({
                    type: 'invalid_action',
                    changeBlockIndex: blockIndex,
                    field: 'ACTION',
                    message: `Invalid action "${action}".`,
                    suggestion: suggestion ? `Did you mean "${suggestion}"? Valid actions are: ${this.VALID_ACTIONS.join(', ')}` : `Valid actions are: ${this.VALID_ACTIONS.join(', ')}`
                });
            } else {
                if (this.actionRequiresTarget(action as ChangeAction) && !this.TARGET_PATTERN.test(block)) {
                    errors.push({ type: 'missing_field', changeBlockIndex: blockIndex, field: 'TARGET', message: `Action "${action}" requires a TARGET line.`, suggestion: 'Add "TARGET: name_or_code_snippet".' });
                }
                if (this.actionRequiresClass(action as ChangeAction) && !this.CLASS_PATTERN.test(block)) {
                     errors.push({ type: 'missing_field', changeBlockIndex: blockIndex, field: 'CLASS', message: `Action "${action}" requires a CLASS line.`, suggestion: 'Add "CLASS: ClassName".' });
                }
            }
        }

        const codeDelimiters = block.match(/^---\s*$/gm);
        const actionForCodeCheck = block.match(this.ACTION_PATTERN)?.[1]?.trim();
        if (actionForCodeCheck && this.actionRequiresCodeBlock(actionForCodeCheck as ChangeAction)) {
            if (!codeDelimiters || codeDelimiters.length < 2) {
                errors.push({ type: 'missing_field', changeBlockIndex: blockIndex, field: 'code', message: 'Missing code block or incorrect "---" delimiters.', suggestion: 'Wrap code in "---" markers on separate lines.' });
            }
        }
        else if (actionForCodeCheck && !this.actionRequiresCodeBlock(actionForCodeCheck as ChangeAction) && codeDelimiters && codeDelimiters.length >=2) {
            const codeContent = this.extractCodeBlock(block);
            if(codeContent.trim() !== "") { // Only warn if there's actual content
                 warnings.push({type: 'long_code_block_in_input', changeBlockIndex: blockIndex, field: 'code', message: `Action "${actionForCodeCheck}" does not use a code block, but one was provided.`, suggestion: 'Remove the code block for this action.'});
            }
        }

        return { isValid: errors.length === 0, errors, warnings };
    }

    private static extractGlobalDescription(inputContent: string): string | undefined {
        const lines = inputContent.split('\n');
        const descriptionLines: string[] = [];
        for (const line of lines) {
            if (this.CHANGE_PATTERN.test(line)) break; 
            const trimmedLine = line.trim();
            if (trimmedLine && !trimmedLine.startsWith('//') && !trimmedLine.startsWith('#') && !this.FILE_PATTERN.test(line) && !this.ACTION_PATTERN.test(line)) {
                descriptionLines.push(trimmedLine);
            }
        }
        return descriptionLines.join(' ').trim() || undefined;
    }

    private static splitIntoChangeBlocks(inputContent: string): string[] {
        const blocks = inputContent.split(/\n(?=CHANGE:)/g).map(s => s.trim());
        return blocks.filter(block => block.startsWith("CHANGE:") && block.trim() !== 'CHANGE:');
    }

    private static parseChangeBlock(block: string, _blockIndex: number): ParsedChange { // blockIndex not directly used now
        const descriptionMatch = block.match(this.CHANGE_PATTERN);
        const fileMatch = block.match(this.FILE_PATTERN);
        const actionMatch = block.match(this.ACTION_PATTERN);

        if (!descriptionMatch || !fileMatch || !actionMatch) {
            throw new Error(`Internal Parsing Error: Block is malformed despite pre-validation.`);
        }

        const description = descriptionMatch[1].trim();
        const file = fileMatch[1].trim();
        const action = actionMatch[1].trim() as ChangeAction;

        const targetMatch = block.match(this.TARGET_PATTERN);
        const target = targetMatch ? targetMatch[1].trim() : ''; 

        const classMatch = block.match(this.CLASS_PATTERN);
        const classValue = classMatch ? classMatch[1].trim() : undefined;

        const code = this.actionRequiresCodeBlock(action) ? this.extractCodeBlock(block) : "";

        return {
            description,
            file,
            action,
            target: target || description, 
            class: classValue,
            code,
        };
    }

    private static extractCodeBlock(block: string): string {
        const lines = block.split('\n');
        let inCodeBlock = false;
        const codeLines: string[] = [];
        let delimiterCount = 0;

        for (const line of lines) {
            if (this.CODE_DELIMITER.test(line)) {
                delimiterCount++;
                if (delimiterCount === 1) {
                    inCodeBlock = true;
                    continue;
                }
                if (delimiterCount === 2) {
                    inCodeBlock = false;
                    break; 
                }
            }
            if (inCodeBlock) {
                codeLines.push(line);
            }
        }
        return codeLines.join('\n');
    }

    private static actionRequiresTarget(action: ChangeAction): boolean {
        const needsTargetActions: ChangeAction[] = [
            'replace_function', 'delete_function',
            'replace_method', 
            'add_method',     
            'replace_block', 'insert_after', 'insert_before',
            'modify_line'
        ];
        return needsTargetActions.includes(action);
    }

    private static actionRequiresClass(action: ChangeAction): boolean {
        const needsClassActions: ChangeAction[] = ['replace_method', 'add_method'];
        return needsClassActions.includes(action);
    }

    private static actionRequiresCodeBlock(action: ChangeAction): boolean {
        const noCodeActions: ChangeAction[] = ['delete_function'];
        return !noCodeActions.includes(action);
    }

    private static suggestSimilarAction(invalidAction: string): string | null {
        let bestMatch: string | null = null;
        let minDistance = Infinity;

        for (const validAction of this.VALID_ACTIONS) {
            const distance = this.levenshteinDistance(invalidAction.toLowerCase(), validAction.toLowerCase());
            if (distance < minDistance) {
                minDistance = distance;
                bestMatch = validAction;
            }
        }
        if (bestMatch && (minDistance <= 3 || minDistance < invalidAction.length / 2)) {
            return bestMatch;
        }
        return null;
    }

    private static levenshteinDistance(a: string, b: string): number {
        const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));
        for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
        for (let j = 0; j <= b.length; j++) matrix[j][0] = j;
        for (let j = 1; j <= b.length; j++) {
            for (let i = 1; i <= a.length; i++) {
                const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
                matrix[j][i] = Math.min(matrix[j][i - 1] + 1, matrix[j - 1][i] + 1, matrix[j - 1][i - 1] + indicator);
            }
        }
        return matrix[b.length][a.length];
    }

    public static async validateFileAccess(filePath: string, workspace: vscode.WorkspaceFolder, action: ChangeAction): Promise<FileAccessValidationResult> {
        const errors: InputFormatValidationError[] = [];
        const warnings: InputFormatValidationWarning[] = [];

        try {
            const fullPath = vscode.Uri.joinPath(workspace.uri, filePath);
            let fileExists = false;
            try {
                await vscode.workspace.fs.stat(fullPath);
                fileExists = true;
            } catch (statError) {
                if (action !== 'create_file') {
                    errors.push({
                        type: 'parse_error', 
                        message: `Target file does not exist: ${filePath}.`,
                        suggestion: `Verify the path or use 'create_file' action if it's a new file.`
                    });
                } else {
                     warnings.push({ type: 'missing_change_description', message: `File "${filePath}" will be created.`, suggestion: 'Ensure path is correct.'});
                }
            }

            if (fileExists && action === 'create_file') {
                warnings.push({
                    type: 'missing_change_description', 
                    message: `File "${filePath}" already exists and will be overwritten by 'create_file' action.`,
                    suggestion: `Consider 'replace_block' or other modification actions if overwrite is not intended.`
                });
            }

        } catch (error: any) {
            errors.push({
                type: 'parse_error',
                message: `Error accessing file path "${filePath}": ${error.message || error}`,
                suggestion: 'Check workspace permissions and file path validity.'
            });
        }

        return { isValid: errors.length === 0, errors, warnings };
    }

    public static groupChangesByFile(input: ParsedInput): Map<string, ParsedChange[]> {
        const grouped = new Map<string, ParsedChange[]>();
        for (const change of input.changes) {
            const fileChanges = grouped.get(change.file) || [];
            fileChanges.push(change);
            grouped.set(change.file, fileChanges);
        }
        return grouped;
    }

    public static generateBasicPreviewSummary(input: ParsedInput): string {
        let preview = `## Change Operation Summary: ${input.description}\n\n`;
        if (input.metadata) {
            preview += `*   **Total Changes**: ${input.metadata.totalChanges}\n`;
            preview += `*   **Affected Files**: ${input.metadata.affectedFiles.length}\n`;
            if (input.metadata.hasNewFiles) {
                preview += `*   **New Files to be Created**: Yes\n`;
            }
        }
        preview += `\n**Breakdown by File:**\n`;
        const grouped = this.groupChangesByFile(input);
        for (const [file, changes] of grouped) {
            preview += `### File: \`${file}\`\n`;
            changes.forEach(change => {
                preview += `*   **Action**: \`${change.action}\`\n`;
                if (change.target && change.target !== change.description) { 
                    preview += `    *   **Target**: ${change.target.substring(0,100)}${change.target.length > 100 ? '...' : ''}\n`;
                }
                if (change.class) {
                     preview += `    *   **Class**: ${change.class}\n`;
                }
                preview += `    *   **Description**: ${change.description}\n`;
            });
            preview += `\n`;
        }
        return preview;
    }

    public static generateExample(): string { return FormatDocumentation.generateExample(); }
    public static getFormatDocumentation(): string { return FormatDocumentation.getFormatDocumentation(); }
    public static getQuickReference(): string { return FormatDocumentation.getQuickReference(); }
    public static getValidationTips(): string[] { return FormatDocumentation.getValidationTips(); }
    public static getTroubleshootingGuide(): string { return FormatDocumentation.getTroubleshootingGuide(); }
}

/**
 * @deprecated Use ChangeParser.parseInput directly.
 */
export function parseChangeInput(inputContent: string): ParsedInput {
    return ChangeParser.parseInput(inputContent);
}