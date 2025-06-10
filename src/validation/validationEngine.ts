import * as vscode from 'vscode';
import { CodeAnalyzer, TargetValidationResult } from '../analysis/codeAnalyzer';
import { ParsedInput, ParsedChange, ValidationError, ValidationWarning, ChangeAction } from '../parser/inputParser';

export interface ChangeValidationResult {
    changeIndex: number;
    change: ParsedChange;
    isValid: boolean;
    errors: ValidationError[];
    warnings: ValidationWarning[];
    targetValidation?: TargetValidationResult;
    processingTime?: number;
}

export interface ValidationSummary {
    overallValid: boolean;
    jsonErrors: ValidationError[];
    jsonWarnings: ValidationWarning[];
    changeValidations: ChangeValidationResult[];
    summary: {
        totalChanges: number;
        validChanges: number;
        invalidChanges: number;
        warningChanges: number;
        filesAnalyzed: number;
        processingTimeMs: number;
    };
    suggestions: string[];
}

export interface ValidationOptions {
    validateTargetExistence: boolean;
    skipLargeFiles: boolean;
    maxFileSize: number;
    timeoutMs: number;
    parallelValidation: boolean;
}

export class ValidationEngine {
    private static readonly DEFAULT_OPTIONS: ValidationOptions = {
        validateTargetExistence: true,
        skipLargeFiles: true,
        maxFileSize: 5 * 1024 * 1024, // 5MB
        timeoutMs: 30000, // 30 seconds
        parallelValidation: true
    };

    /**
     * Comprehensive validation of all changes in parsed input
     */
    public static async validateChanges(
        parsedInput: ParsedInput, 
        workspace: vscode.WorkspaceFolder,
        options: Partial<ValidationOptions> = {}
    ): Promise<ValidationSummary> {
        const startTime = Date.now();
        const opts = { ...this.DEFAULT_OPTIONS, ...options };
        
        const changeValidations: ChangeValidationResult[] = [];
        const filesAnalyzed = new Set<string>();
        const globalSuggestions: string[] = [];

        try {
            // Validate changes in parallel or sequentially based on options
            if (opts.parallelValidation && parsedInput.changes.length <= 20) {
                // Parallel validation for smaller change sets
                const validationPromises = parsedInput.changes.map(async (change, index) => {
                    try {
                        const result = await Promise.race([
                            this.validateSingleChange(change, index, workspace, opts),
                            this.createTimeoutPromise(opts.timeoutMs, change, index)
                        ]);
                        filesAnalyzed.add(change.file);
                        return result;
                    } catch (error) {
                        return this.createErrorResult(change, index, `Validation timeout or error: ${error}`);
                    }
                });

                changeValidations.push(...await Promise.all(validationPromises));
            } else {
                // Sequential validation for larger change sets or when parallel is disabled
                for (let index = 0; index < parsedInput.changes.length; index++) {
                    const change = parsedInput.changes[index];
                    try {
                        const result = await this.validateSingleChange(change, index, workspace, opts);
                        changeValidations.push(result);
                        filesAnalyzed.add(change.file);
                    } catch (error) {
                        const errorResult = this.createErrorResult(change, index, `Validation error: ${error}`);
                        changeValidations.push(errorResult);
                    }
                }
            }

            // Generate global suggestions
            globalSuggestions.push(...this.generateGlobalSuggestions(changeValidations));

            // Calculate summary
            const summary = this.calculateSummary(changeValidations, filesAnalyzed.size, Date.now() - startTime);

            return {
                overallValid: summary.invalidChanges === 0,
                jsonErrors: [], // Structure errors handled in Phase 1
                jsonWarnings: [], // Structure warnings handled in Phase 1
                changeValidations,
                summary,
                suggestions: globalSuggestions
            };

        } catch (error) {
            // Handle catastrophic validation failure
            return {
                overallValid: false,
                jsonErrors: [{
                    type: 'parse_error',
                    message: `Validation engine failed: ${error}`,
                    suggestion: 'Try validating changes one at a time'
                }],
                jsonWarnings: [],
                changeValidations: [],
                summary: {
                    totalChanges: parsedInput.changes.length,
                    validChanges: 0,
                    invalidChanges: parsedInput.changes.length,
                    warningChanges: 0,
                    filesAnalyzed: 0,
                    processingTimeMs: Date.now() - startTime
                },
                suggestions: ['Validation engine encountered an error. Try again or reduce the number of changes.']
            };
        }
    }

    /**
     * Validate a single change
     */
    public static async validateSingleChange(
        change: ParsedChange, 
        index: number, 
        workspace: vscode.WorkspaceFolder,
        options: ValidationOptions
    ): Promise<ChangeValidationResult> {
        const startTime = Date.now();
        const errors: ValidationError[] = [];
        const warnings: ValidationWarning[] = [];

        try {
            // Basic file existence check
            const fileUri = vscode.Uri.joinPath(workspace.uri, change.file);
            let fileExists = false;
            
            try {
                await vscode.workspace.fs.stat(fileUri);
                fileExists = true;
            } catch {
                // File doesn't exist - this might be intentional for new files
                if (this.isNewFileAction(change.action)) {
                    warnings.push({
                        type: 'missing_description',
                        changeIndex: index,
                        message: `Target file does not exist: ${change.file} (will be created)`,
                        suggestion: 'Ensure the directory structure exists'
                    });
                } else {
                    errors.push({
                        type: 'parse_error',
                        changeIndex: index,
                        field: 'file',
                        message: `Target file does not exist: ${change.file}`,
                        suggestion: 'Check the file path or use an action that creates new files'
                    });
                }
            }

            let targetValidation: TargetValidationResult | undefined;

            // Target existence validation (only if file exists and option is enabled)
            if (options.validateTargetExistence && fileExists) {
                targetValidation = await this.validateTarget(change, workspace);
                
                if (!targetValidation.exists) {
                    errors.push({
                        type: 'parse_error',
                        changeIndex: index,
                        field: 'target',
                        message: targetValidation.reason || `Target "${change.target}" not found`,
                        suggestion: targetValidation.suggestions?.join(', ') || 'Check the target name and spelling'
                    });
                }

                // Add confidence-based warnings
                if (targetValidation.exists && targetValidation.confidence === 'low') {
                    warnings.push({
                        type: 'missing_description',
                        changeIndex: index,
                        message: `Low confidence in target detection for "${change.target}"`,
                        suggestion: 'Verify the target exists and is spelled correctly'
                    });
                }
            }

            // Action-specific validation
            const actionValidation = this.validateActionSpecificRequirements(change, index);
            errors.push(...actionValidation.errors);
            warnings.push(...actionValidation.warnings);

            return {
                changeIndex: index,
                change,
                isValid: errors.length === 0,
                errors,
                warnings,
                targetValidation,
                processingTime: Date.now() - startTime
            };

        } catch (error) {
            return this.createErrorResult(change, index, `Validation failed: ${error}`, Date.now() - startTime);
        }
    }

    /**
     * Validate target existence based on action type
     */
    private static async validateTarget(change: ParsedChange, workspace: vscode.WorkspaceFolder): Promise<TargetValidationResult> {
        switch (change.action) {
            case 'replace_function':
            case 'delete_function':
                return await CodeAnalyzer.validateFunction(change.file, change.target, workspace);
                
            case 'replace_method':
                if (!change.class) {
                    return {
                        exists: false,
                        reason: 'Class name required for method operations',
                        confidence: 'high',
                        suggestions: []
                    };
                }
                return await CodeAnalyzer.validateMethod(change.file, change.class, change.target, workspace);
                
            case 'add_method':
                if (!change.class) {
                    return {
                        exists: false,
                        reason: 'Class name required for method operations',
                        confidence: 'high',
                        suggestions: []
                    };
                }
                // For add_method, we validate that the class exists, not the method
                const classValidation = await CodeAnalyzer.validateClass(change.file, change.class, workspace);
                if (!classValidation.exists) {
                    return {
                        exists: false,
                        reason: `Target class "${change.class}" not found`,
                        confidence: classValidation.confidence,
                        suggestions: classValidation.suggestions
                    };
                }
                // Check if method already exists (warning, not error)
                const methodValidation = await CodeAnalyzer.validateMethod(change.file, change.class, change.target, workspace);
                return {
                    exists: true, // Class exists, which is what we need
                    confidence: 'high',
                    suggestions: methodValidation.exists ? [`Method "${change.target}" already exists in class "${change.class}"`] : []
                };
                
            case 'add_import':
                // For imports, we check if it already exists (warning, not error)
                const importValidation = await CodeAnalyzer.validateImport(change.file, change.target, workspace);
                return {
                    exists: true, // Always allow adding imports
                    confidence: 'medium',
                    suggestions: importValidation.exists ? [`Import "${change.target}" already exists`] : []
                };
                
            case 'add_function':
            case 'add_struct':
            case 'add_enum':
                // For add operations, we check if the target already exists (warning, not error)
                const existingValidation = await CodeAnalyzer.validateFunction(change.file, change.target, workspace);
                return {
                    exists: true, // Always allow adding new items
                    confidence: 'medium',
                    suggestions: existingValidation.exists ? [`${change.action.split('_')[1]} "${change.target}" already exists`] : []
                };
                
            case 'replace_block':
            case 'insert_after':
            case 'insert_before':
                return await CodeAnalyzer.validateBlock(change.file, change.target, workspace);
            
            case 'modify_line':
                 // This action has specific logic not covered by standard target validation
                return { exists: true, confidence: 'low', reason: "modify_line validation not yet implemented." };
                
            default:
                return {
                    exists: true, // Unknown actions pass by default
                    confidence: 'low',
                    suggestions: [`Unknown action type: ${change.action}`]
                };
        }
    }

    /**
     * Validate action-specific requirements
     */
    private static validateActionSpecificRequirements(change: ParsedChange, index: number): { errors: ValidationError[], warnings: ValidationWarning[] } {
        const errors: ValidationError[] = [];
        const warnings: ValidationWarning[] = [];

        // Method operations require class
        if ((change.action === 'replace_method' || change.action === 'add_method') && !change.class) {
            errors.push({
                type: 'missing_field',
                changeIndex: index,
                field: 'class',
                message: `Action "${change.action}" requires a "class" field`,
                suggestion: 'Specify which class the method belongs to'
            });
        }

        // Check for potentially destructive operations
        if (change.action === 'delete_function') {
            warnings.push({
                type: 'missing_description',
                changeIndex: index,
                message: 'Deleting functions is a destructive operation',
                suggestion: 'Ensure you have a backup and this deletion is intentional'
            });
        }

        // Check code quality
        if (change.code) {
            // Very basic syntax checks
            if (change.code.includes('console.log') && !change.description?.toLowerCase().includes('debug')) {
                warnings.push({
                    type: 'missing_description',
                    changeIndex: index,
                    message: 'Code contains console.log statement',
                    suggestion: 'Consider removing debug statements before production'
                });
            }

            if (change.code.length > 1000) {
                warnings.push({
                    type: 'long_code_block',
                    changeIndex: index,
                    field: 'code',
                    message: 'Very large code block',
                    suggestion: 'Consider breaking large changes into smaller pieces'
                });
            }
        }

        return { errors, warnings };
    }

    /**
     * Check if action creates new files
     */
    private static isNewFileAction(action: ChangeAction): boolean {
        return ['add_function', 'add_method', 'add_struct', 'add_enum', 'add_import', 'create_file'].includes(action);
    }

    /**
     * Create timeout promise for validation
     */
    private static createTimeoutPromise(timeoutMs: number, _change: ParsedChange, _index: number): Promise<ChangeValidationResult> {
        return new Promise((_, reject) => {
            setTimeout(() => {
                reject(new Error(`Validation timeout after ${timeoutMs}ms`));
            }, timeoutMs);
        });
    }

    /**
     * Create error result for failed validation
     */
    private static createErrorResult(change: ParsedChange, index: number, errorMessage: string, processingTime?: number): ChangeValidationResult {
        return {
            changeIndex: index,
            change,
            isValid: false,
            errors: [{
                type: 'parse_error',
                changeIndex: index,
                message: errorMessage,
                suggestion: 'Check the change configuration and try again'
            }],
            warnings: [],
            processingTime
        };
    }

    /**
     * Generate global suggestions based on validation results
     */
    private static generateGlobalSuggestions(changeValidations: ChangeValidationResult[]): string[] {
        const suggestions: string[] = [];
        
        const invalidChanges = changeValidations.filter(cv => !cv.isValid);
        const missingFiles = invalidChanges.filter(cv => 
            cv.errors.some(e => e.message.includes('does not exist'))
        );
        const missingTargets = invalidChanges.filter(cv => 
            cv.errors.some(e => e.message.includes('not found'))
        );
        
        if (missingFiles.length > 0) {
            suggestions.push(`${missingFiles.length} changes target non-existent files. Create the files first or check file paths.`);
        }
        
        if (missingTargets.length > 0) {
            suggestions.push(`${missingTargets.length} changes target non-existent functions/methods. Check the target names and spelling.`);
        }
        
        const slowValidations = changeValidations.filter(cv => cv.processingTime && cv.processingTime > 5000);
        if (slowValidations.length > 0) {
            suggestions.push('Some validations took a long time. Consider breaking large files into smaller pieces.');
        }
        
        return suggestions;
    }

    /**
     * Calculate validation summary
     */
    private static calculateSummary(
        changeValidations: ChangeValidationResult[], 
        filesAnalyzed: number, 
        processingTimeMs: number
    ) {
        const totalChanges = changeValidations.length;
        const validChanges = changeValidations.filter(cv => cv.isValid).length;
        const invalidChanges = totalChanges - validChanges;
        const warningChanges = changeValidations.filter(cv => cv.warnings.length > 0).length;
        
        return {
            totalChanges,
            validChanges,
            invalidChanges,
            warningChanges,
            filesAnalyzed,
            processingTimeMs
        };
    }

    /**
     * Retry validation for a specific change
     */
    public static async retryValidation(
        change: ParsedChange, 
        index: number, 
        workspace: vscode.WorkspaceFolder,
        options: Partial<ValidationOptions> = {}
    ): Promise<ChangeValidationResult> {
        const opts = { ...this.DEFAULT_OPTIONS, ...options };
        return await this.validateSingleChange(change, index, workspace, opts);
    }

    /**
     * Quick validation check (minimal validation for performance)
     */
    public static async quickValidate(
        parsedInput: ParsedInput, 
        workspace: vscode.WorkspaceFolder
    ): Promise<{ valid: boolean, errorCount: number, warningCount: number }> {
        const options: ValidationOptions = {
            validateTargetExistence: false, // Skip expensive target validation
            skipLargeFiles: true,
            maxFileSize: 1024 * 1024, // 1MB limit for quick validation
            timeoutMs: 5000, // 5 second timeout
            parallelValidation: true
        };
        
        const summary = await this.validateChanges(parsedInput, workspace, options);
        
        return {
            valid: summary.overallValid,
            errorCount: summary.summary.invalidChanges,
            warningCount: summary.summary.warningChanges
        };
    }
}