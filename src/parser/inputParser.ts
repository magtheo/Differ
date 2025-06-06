import * as vscode from 'vscode';

export interface ParsedChange {
    file: string;           // Target file path (may not exist yet)
    action: ChangeAction;
    target: string;         // Function name, import name, etc.
    code: string;           // New code to apply
    class?: string;         // For method operations
    description?: string;
}

export interface ParsedInput {
    description: string;
    changes: ParsedChange[];
    metadata?: {
        totalChanges: number;
        affectedFiles: string[];
        hasNewFiles: boolean;
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
    | 'modify_line';

export interface ValidationError {
    type: 'json_parse' | 'missing_field' | 'invalid_type' | 'invalid_action' | 'empty_array' | 'duplicate_change';
    changeIndex?: number;  // Which change has the error (0-based)
    field?: string;        // Which field is problematic
    message: string;       // Human-readable error
    details?: any;         // Additional context
    suggestion?: string;   // Suggested fix
}

export interface ValidationWarning {
    type: 'missing_description' | 'large_change_count' | 'duplicate_target' | 'long_code_block';
    changeIndex?: number;
    field?: string;
    message: string;
    suggestion?: string;
}

export interface ValidationResult {
    isValid: boolean;
    errors: ValidationError[];
    warnings: ValidationWarning[];
}

export interface FileValidationResult {
    isValid: boolean;
    errors: ValidationError[];
    warnings: ValidationWarning[];
}

export class ChangeParser {
    
    private static readonly VALID_ACTIONS: ChangeAction[] = [
        'add_import', 'replace_function', 'add_function', 'replace_method', 'add_method',
        'add_struct', 'add_enum', 'replace_block', 'insert_after', 'insert_before',
        'delete_function', 'modify_line'
    ];

    private static readonly MAX_REASONABLE_CHANGES = 50;
    private static readonly MAX_CODE_LENGTH = 10000;

    /**
     * Parse JSON input with comprehensive validation
     */
    public static parseInput(jsonContent: string): ParsedInput {
        // First, validate and parse the JSON structure
        const structureValidation = this.validateJsonStructure(jsonContent);
        
        if (!structureValidation.isValid) {
            const errorMessages = structureValidation.errors.map(e => e.message).join('; ');
            throw new Error(`JSON validation failed: ${errorMessages}`);
        }

        // If we get here, we know the JSON is structurally valid
        const rawInput = JSON.parse(jsonContent);
        
        // Parse changes with detailed validation
        const changes: ParsedChange[] = [];
        const affectedFiles = new Set<string>();

        for (let i = 0; i < rawInput.changes.length; i++) {
            const change = this.parseChange(rawInput.changes[i], i);
            changes.push(change);
            affectedFiles.add(change.file);
        }

        // Calculate metadata
        const metadata = {
            totalChanges: changes.length,
            affectedFiles: Array.from(affectedFiles),
            hasNewFiles: false // We'll determine this during file validation
        };

        return {
            description: rawInput.description || 'Code changes',
            changes,
            metadata
        };
    }

    /**
     * Validate JSON structure before parsing
     */
    public static validateJsonStructure(jsonContent: string): ValidationResult {
        const errors: ValidationError[] = [];
        const warnings: ValidationWarning[] = [];

        // Check if input is empty or whitespace
        if (!jsonContent || jsonContent.trim() === '') {
            errors.push({
                type: 'json_parse',
                message: 'Input cannot be empty',
                suggestion: 'Please paste valid JSON containing a "changes" array'
            });
            return { isValid: false, errors, warnings };
        }

        // Try to parse JSON
        let rawInput: any;
        try {
            rawInput = JSON.parse(jsonContent.trim());
        } catch (parseError) {
            const errorMessage = parseError instanceof Error ? parseError.message : 'Unknown JSON parsing error';
            errors.push({
                type: 'json_parse',
                message: `Invalid JSON format: ${errorMessage}`,
                details: parseError,
                suggestion: 'Check for missing quotes, commas, or brackets in your JSON'
            });
            return { isValid: false, errors, warnings };
        }

        // Validate root object structure
        if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
            errors.push({
                type: 'invalid_type',
                message: 'Root element must be a JSON object, not an array or primitive value',
                suggestion: 'Wrap your data in curly braces: { "description": "...", "changes": [...] }'
            });
            return { isValid: false, errors, warnings };
        }

        // Check for required "changes" field
        if (!rawInput.hasOwnProperty('changes')) {
            errors.push({
                type: 'missing_field',
                field: 'changes',
                message: 'Missing required "changes" field',
                suggestion: 'Add a "changes" array to your JSON: { "changes": [...] }'
            });
            return { isValid: false, errors, warnings };
        }

        // Validate changes is an array
        if (!Array.isArray(rawInput.changes)) {
            errors.push({
                type: 'invalid_type',
                field: 'changes',
                message: '"changes" must be an array',
                suggestion: 'Use square brackets for the changes field: "changes": [...]'
            });
            return { isValid: false, errors, warnings };
        }

        // Check for empty changes array
        if (rawInput.changes.length === 0) {
            errors.push({
                type: 'empty_array',
                field: 'changes',
                message: 'Changes array cannot be empty',
                suggestion: 'Add at least one change object to the array'
            });
            return { isValid: false, errors, warnings };
        }

        // Warn about missing description
        if (!rawInput.description || rawInput.description.trim() === '') {
            warnings.push({
                type: 'missing_description',
                field: 'description',
                message: 'No description provided for this change set',
                suggestion: 'Add a "description" field to explain what these changes do'
            });
        }

        // Warn about large number of changes
        if (rawInput.changes.length > this.MAX_REASONABLE_CHANGES) {
            warnings.push({
                type: 'large_change_count',
                message: `Large number of changes (${rawInput.changes.length}). Consider splitting into smaller batches`,
                suggestion: 'Break large change sets into multiple smaller operations for easier review'
            });
        }

        // Validate individual change objects structure
        for (let i = 0; i < rawInput.changes.length; i++) {
            const changeErrors = this.validateChangeStructure(rawInput.changes[i], i);
            errors.push(...changeErrors.errors);
            warnings.push(...changeErrors.warnings);
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings
        };
    }

    /**
     * Validate individual change object structure
     */
    private static validateChangeStructure(change: any, index: number): ValidationResult {
        const errors: ValidationError[] = [];
        const warnings: ValidationWarning[] = [];

        if (!change || typeof change !== 'object' || Array.isArray(change)) {
            errors.push({
                type: 'invalid_type',
                changeIndex: index,
                message: `Change ${index + 1} must be an object`,
                suggestion: 'Use curly braces for change objects: {"file": "...", "action": "...", ...}'
            });
            return { isValid: false, errors, warnings };
        }

        // Required fields validation
        const requiredFields = ['file', 'action', 'target', 'code'];
        for (const field of requiredFields) {
            if (!change.hasOwnProperty(field)) {
                errors.push({
                    type: 'missing_field',
                    changeIndex: index,
                    field: field,
                    message: `Change ${index + 1}: Missing required field "${field}"`,
                    suggestion: `Add the "${field}" field to change ${index + 1}`
                });
                continue;
            }

            if (change[field] === null || change[field] === undefined) {
                errors.push({
                    type: 'missing_field',
                    changeIndex: index,
                    field: field,
                    message: `Change ${index + 1}: Field "${field}" cannot be null or undefined`,
                    suggestion: `Provide a valid value for "${field}" in change ${index + 1}`
                });
                continue;
            }

            if (typeof change[field] !== 'string') {
                errors.push({
                    type: 'invalid_type',
                    changeIndex: index,
                    field: field,
                    message: `Change ${index + 1}: Field "${field}" must be a string`,
                    suggestion: `Wrap the ${field} value in quotes`
                });
                continue;
            }

            // Check for empty strings in critical fields
            if (change[field].trim() === '' && field !== 'code') {
                errors.push({
                    type: 'missing_field',
                    changeIndex: index,
                    field: field,
                    message: `Change ${index + 1}: Field "${field}" cannot be empty`,
                    suggestion: `Provide a meaningful value for "${field}"`
                });
            }
        }

        // Validate action type
        if (change.action && !this.VALID_ACTIONS.includes(change.action)) {
            const suggestion = this.suggestSimilarAction(change.action);
            errors.push({
                type: 'invalid_action',
                changeIndex: index,
                field: 'action',
                message: `Change ${index + 1}: Invalid action "${change.action}"`,
                details: { validActions: this.VALID_ACTIONS },
                suggestion: suggestion ? `Did you mean "${suggestion}"?` : `Valid actions: ${this.VALID_ACTIONS.join(', ')}`
            });
        }

        // Validate optional fields
        if (change.class !== undefined && typeof change.class !== 'string') {
            errors.push({
                type: 'invalid_type',
                changeIndex: index,
                field: 'class',
                message: `Change ${index + 1}: Field "class" must be a string if provided`,
                suggestion: 'Remove the class field or provide a valid string value'
            });
        }

        // Method-specific validation
        if (change.action === 'replace_method' || change.action === 'add_method') {
            if (!change.class || change.class.trim() === '') {
                errors.push({
                    type: 'missing_field',
                    changeIndex: index,
                    field: 'class',
                    message: `Change ${index + 1}: "${change.action}" requires a "class" field`,
                    suggestion: 'Specify which class the method belongs to'
                });
            }
        }

        // Warnings
        if (change.code && change.code.length > this.MAX_CODE_LENGTH) {
            warnings.push({
                type: 'long_code_block',
                changeIndex: index,
                field: 'code',
                message: `Change ${index + 1}: Very long code block (${change.code.length} characters)`,
                suggestion: 'Consider breaking large code changes into smaller pieces'
            });
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings
        };
    }

    /**
     * Suggest similar action if user made a typo
     */
    private static suggestSimilarAction(invalidAction: string): string | null {
        const similarities: { [key: string]: string } = {
            'replace_func': 'replace_function',
            'add_func': 'add_function',
            'replace_fn': 'replace_function',
            'add_fn': 'add_function',
            'add_import_statement': 'add_import',
            'import': 'add_import',
            'delete_func': 'delete_function',
            'remove_function': 'delete_function',
            'modify': 'modify_line',
            'change_line': 'modify_line',
            'insert': 'insert_after'
        };

        const lowerInvalid = invalidAction.toLowerCase();
        
        // Direct match
        if (similarities[lowerInvalid]) {
            return similarities[lowerInvalid];
        }

        // Fuzzy match - find closest valid action
        let bestMatch: string | null = null;
        let bestScore = 0;

        for (const validAction of this.VALID_ACTIONS) {
            const score = this.calculateSimilarity(lowerInvalid, validAction);
            if (score > bestScore && score > 0.6) { // At least 60% similarity
                bestScore = score;
                bestMatch = validAction;
            }
        }

        return bestMatch;
    }

    /**
     * Simple string similarity calculation
     */
    private static calculateSimilarity(a: string, b: string): number {
        const longer = a.length > b.length ? a : b;
        const shorter = a.length > b.length ? b : a;
        
        if (longer.length === 0) return 1.0;
        
        const editDistance = this.levenshteinDistance(longer, shorter);
        return (longer.length - editDistance) / longer.length;
    }

    /**
     * Calculate Levenshtein distance between two strings
     */
    private static levenshteinDistance(a: string, b: string): number {
        const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));

        for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
        for (let j = 0; j <= b.length; j++) matrix[j][0] = j;

        for (let j = 1; j <= b.length; j++) {
            for (let i = 1; i <= a.length; i++) {
                const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
                matrix[j][i] = Math.min(
                    matrix[j][i - 1] + 1,     // deletion
                    matrix[j - 1][i] + 1,     // insertion
                    matrix[j - 1][i - 1] + indicator // substitution
                );
            }
        }

        return matrix[b.length][a.length];
    }

    /**
     * Parse individual change object (assumes structure is already validated)
     */
    private static parseChange(change: any, _index: number): ParsedChange {
        return {
            file: change.file.trim(),
            action: change.action as ChangeAction,
            target: change.target.trim(),
            code: change.code,
            class: change.class?.trim(),
            description: change.description?.trim()
        };
    }

    /**
     * Validate semantic relationships between changes
     */
    public static validateSemanticConsistency(input: ParsedInput): ValidationResult {
        const errors: ValidationError[] = [];
        const warnings: ValidationWarning[] = [];

        // Check for duplicate changes on same target
        const changeMap = new Map<string, Set<string>>();
        for (let i = 0; i < input.changes.length; i++) {
            const change = input.changes[i];
            const fileTargets = changeMap.get(change.file) || new Set();
            const changeKey = `${change.action}:${change.target}`;
            
            if (fileTargets.has(changeKey)) {
                errors.push({
                    type: 'duplicate_change',
                    changeIndex: i,
                    message: `Duplicate change detected: ${changeKey} in ${change.file}`,
                    suggestion: 'Remove duplicate changes or combine them into a single operation'
                });
            }
            
            fileTargets.add(changeKey);
            changeMap.set(change.file, fileTargets);
        }

        // Check for potentially conflicting actions
        for (const [file, targets] of changeMap) {
            if (targets.size > 20) {
                warnings.push({
                    type: 'large_change_count',
                    message: `Large number of changes (${targets.size}) in ${file}`,
                    suggestion: 'Consider splitting into multiple operations for easier review'
                });
            }
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings
        };
    }

    /**
     * Validate file accessibility (moved from old implementation)
     */
    public static async validateFileAccess(filePath: string, workspace: vscode.WorkspaceFolder): Promise<FileValidationResult> {
        const errors: ValidationError[] = [];
        const warnings: ValidationWarning[] = [];

        try {
            const fullPath = vscode.Uri.joinPath(workspace.uri, filePath);
            
            try {
                await vscode.workspace.fs.stat(fullPath);
                
                try {
                    await vscode.workspace.fs.readFile(fullPath);
                } catch (readError) {
                    errors.push({
                        type: 'json_parse', // Reusing type, could add new file-specific types
                        message: `File exists but cannot be read: ${filePath}`,
                        suggestion: 'Check file permissions'
                    });
                }
                
            } catch (statError) {
                warnings.push({
                    type: 'missing_description', // Reusing type
                    message: `Target file does not exist: ${filePath} (will be created if needed)`,
                    suggestion: 'Verify the file path is correct'
                });
            }

        } catch (error) {
            errors.push({
                type: 'json_parse',
                message: `Cannot access file path: ${filePath}`,
                suggestion: 'Check that the file path is valid for this workspace'
            });
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings
        };
    }

    /**
     * Group changes by file for easier processing
     */
    public static groupChangesByFile(input: ParsedInput): Map<string, ParsedChange[]> {
        const grouped = new Map<string, ParsedChange[]>();
        
        for (const change of input.changes) {
            const existing = grouped.get(change.file) || [];
            existing.push(change);
            grouped.set(change.file, existing);
        }
        
        return grouped;
    }

    /**
     * Generate preview without applying changes
     */
    public static generatePreview(input: ParsedInput): string {
        let preview = `## ${input.description}\n\n`;
        
        if (input.metadata) {
            preview += `**Summary:**\n`;
            preview += `- ${input.metadata.totalChanges} total changes\n`;
            preview += `- ${input.metadata.affectedFiles.length} files affected\n`;
            if (input.metadata.hasNewFiles) {
                preview += `- Some files may be created\n`;
            }
            preview += `\n`;
        }

        const groupedChanges = this.groupChangesByFile(input);
        
        for (const [file, changes] of groupedChanges) {
            preview += `### ${file}\n`;
            
            for (const change of changes) {
                preview += `- **${change.action}**: ${change.target}\n`;
                if (change.description) {
                    preview += `  ${change.description}\n`;
                }
            }
            preview += `\n`;
        }

        return preview;
    }
}

/**
 * Helper function for backwards compatibility
 */
export function parseChangeInput(jsonContent: string): ParsedInput {
    return ChangeParser.parseInput(jsonContent);
}