import { ValidationError, ValidationWarning, ParsedChange } from '../parser/inputParser';
import { ValidationSummary, ChangeValidationResult } from './validationEngine';
import { TargetValidationResult } from '../analysis/codeAnalyzer';

export interface ErrorReport {
    severity: 'error' | 'warning' | 'info';
    title: string;
    message: string;
    suggestion?: string;
    code?: string;
    actionable: boolean;
    category: 'json' | 'file' | 'target' | 'syntax' | 'logic' | 'performance';
}

export interface ValidationReport {
    summary: string;
    overallStatus: 'valid' | 'invalid' | 'warnings';
    reports: ErrorReport[];
    quickFixes: string[];
    nextSteps: string[];
}

export class ErrorReporter {
    
    /**
     * Create comprehensive validation report
     */
    public static createValidationReport(validationSummary: ValidationSummary): ValidationReport {
        const reports: ErrorReport[] = [];
        
        // Add JSON-level errors and warnings
        reports.push(...this.formatJsonErrors(validationSummary.jsonErrors));
        reports.push(...this.formatJsonWarnings(validationSummary.jsonWarnings));
        
        // Add change-level errors and warnings
        for (const changeValidation of validationSummary.changeValidations) {
            reports.push(...this.formatChangeErrors(changeValidation));
            reports.push(...this.formatChangeWarnings(changeValidation));
        }
        
        // Generate summary
        const summary = this.generateSummaryMessage(validationSummary);
        const overallStatus = this.determineOverallStatus(validationSummary);
        
        // Generate actionable next steps
        const quickFixes = this.generateQuickFixes(validationSummary);
        const nextSteps = this.generateNextSteps(validationSummary);
        
        return {
            summary,
            overallStatus,
            reports,
            quickFixes,
            nextSteps
        };
    }

    /**
     * Format JSON parsing errors
     */
    public static formatJsonErrors(errors: ValidationError[]): ErrorReport[] {
        return errors.map(error => {
            const baseReport: ErrorReport = {
                severity: 'error',
                title: this.getErrorTitle(error),
                message: error.message,
                suggestion: error.suggestion,
                actionable: true,
                category: 'json'
            };

            switch (error.type) {
                case 'json_parse':
                    return {
                        ...baseReport,
                        title: '🚫 JSON Parsing Error',
                        code: 'JSON_PARSE_ERROR'
                    };
                    
                case 'missing_field':
                    return {
                        ...baseReport,
                        title: `📝 Missing Required Field: ${error.field}`,
                        code: 'MISSING_FIELD'
                    };
                    
                case 'invalid_type':
                    return {
                        ...baseReport,
                        title: `🔧 Invalid Field Type: ${error.field}`,
                        code: 'INVALID_TYPE'
                    };
                    
                case 'invalid_action':
                    return {
                        ...baseReport,
                        title: '⚡ Invalid Action Type',
                        code: 'INVALID_ACTION'
                    };
                    
                case 'empty_array':
                    return {
                        ...baseReport,
                        title: '📋 Empty Changes Array',
                        code: 'EMPTY_CHANGES'
                    };
                    
                case 'duplicate_change':
                    return {
                        ...baseReport,
                        title: '🔄 Duplicate Change Detected',
                        code: 'DUPLICATE_CHANGE',
                        category: 'logic'
                    };
                    
                default:
                    return baseReport;
            }
        });
    }

    /**
     * Format JSON parsing warnings
     */
    public static formatJsonWarnings(warnings: ValidationWarning[]): ErrorReport[] {
        return warnings.map(warning => {
            const baseReport: ErrorReport = {
                severity: 'warning',
                title: this.getWarningTitle(warning),
                message: warning.message,
                suggestion: warning.suggestion,
                actionable: false,
                category: 'json'
            };

            switch (warning.type) {
                case 'missing_description':
                    return {
                        ...baseReport,
                        title: '💬 Missing Description',
                        code: 'MISSING_DESCRIPTION',
                        actionable: true
                    };
                    
                case 'large_change_count':
                    return {
                        ...baseReport,
                        title: '📊 Large Change Set',
                        code: 'LARGE_CHANGE_SET',
                        category: 'performance'
                    };
                    
                case 'duplicate_target':
                    return {
                        ...baseReport,
                        title: '🎯 Duplicate Target',
                        code: 'DUPLICATE_TARGET',
                        category: 'logic'
                    };
                    
                case 'long_code_block':
                    return {
                        ...baseReport,
                        title: '📝 Long Code Block',
                        code: 'LONG_CODE_BLOCK',
                        category: 'performance'
                    };
                    
                default:
                    return baseReport;
            }
        });
    }

    /**
     * Format change-level errors
     */
    public static formatChangeErrors(changeValidation: ChangeValidationResult): ErrorReport[] {
        return changeValidation.errors.map(error => {
            const changeInfo = `Change ${changeValidation.changeIndex + 1} (${changeValidation.change.action} in ${changeValidation.change.file})`;
            
            const baseReport: ErrorReport = {
                severity: 'error',
                title: `❌ ${changeInfo}`,
                message: error.message,
                suggestion: error.suggestion,
                actionable: true,
                category: this.categorizeError(error, changeValidation)
            };

            // Add specific formatting based on error context
            if (error.field === 'file') {
                return {
                    ...baseReport,
                    title: `📁 File Not Found: ${changeValidation.change.file}`,
                    category: 'file'
                };
            }
            
            if (error.field === 'target') {
                return {
                    ...baseReport,
                    title: `🎯 Target Not Found: ${changeValidation.change.target}`,
                    category: 'target'
                };
            }
            
            return baseReport;
        });
    }

    /**
     * Format change-level warnings
     */
    public static formatChangeWarnings(changeValidation: ChangeValidationResult): ErrorReport[] {
        const reports: ErrorReport[] = [];
        
        // Regular warnings
        reports.push(...changeValidation.warnings.map(warning => {
            const changeInfo = `Change ${changeValidation.changeIndex + 1}`;
            
            return {
                severity: 'warning' as const,
                title: `⚠️ ${changeInfo}: ${this.getWarningTitle(warning)}`,
                message: warning.message,
                suggestion: warning.suggestion,
                actionable: false,
                category: this.categorizeWarning(warning, changeValidation)
            };
        }));
        
        // Target validation warnings
        if (changeValidation.targetValidation?.suggestions && changeValidation.targetValidation.suggestions.length > 0) {
            reports.push({
                severity: 'info' as const,
                title: `💡 Change ${changeValidation.changeIndex + 1}: Target Suggestions`,
                message: `Found similar targets: ${changeValidation.targetValidation.suggestions.join(', ')}`,
                suggestion: 'Consider using one of these similar targets if the current target is incorrect',
                actionable: true,
                category: 'target'
            });
        }
        
        return reports;
    }

    /**
     * Generate summary message
     */
    private static generateSummaryMessage(validationSummary: ValidationSummary): string {
        const { summary } = validationSummary;
        
        if (summary.invalidChanges === 0 && summary.warningChanges === 0) {
            return `✅ All ${summary.totalChanges} changes are valid and ready to apply.`;
        }
        
        if (summary.invalidChanges === 0) {
            return `✅ All ${summary.totalChanges} changes are valid. ${summary.warningChanges} warning${summary.warningChanges !== 1 ? 's' : ''} to review.`;
        }
        
        if (summary.validChanges === 0) {
            return `❌ All ${summary.totalChanges} changes have errors that must be fixed before applying.`;
        }
        
        return `⚠️ ${summary.validChanges} of ${summary.totalChanges} changes are valid. ${summary.invalidChanges} error${summary.invalidChanges !== 1 ? 's' : ''} must be fixed.`;
    }

    /**
     * Determine overall validation status
     */
    private static determineOverallStatus(validationSummary: ValidationSummary): 'valid' | 'invalid' | 'warnings' {
        if (validationSummary.summary.invalidChanges > 0) {
            return 'invalid';
        }
        
        if (validationSummary.summary.warningChanges > 0) {
            return 'warnings';
        }
        
        return 'valid';
    }

    /**
     * Generate quick fix suggestions
     */
    private static generateQuickFixes(validationSummary: ValidationSummary): string[] {
        const fixes: string[] = [];
        const errors = validationSummary.changeValidations.flatMap(cv => cv.errors);
        const warnings = validationSummary.changeValidations.flatMap(cv => cv.warnings);
        
        // Missing file fixes
        const missingFiles = errors.filter(e => e.message.includes('does not exist')).length;
        if (missingFiles > 0) {
            fixes.push(`Create ${missingFiles} missing file${missingFiles !== 1 ? 's' : ''}`);
        }
        
        // Missing target fixes
        const missingTargets = errors.filter(e => e.message.includes('not found')).length;
        if (missingTargets > 0) {
            fixes.push(`Verify ${missingTargets} target name${missingTargets !== 1 ? 's' : ''}`);
        }
        
        // Missing class fixes
        const missingClasses = errors.filter(e => e.field === 'class').length;
        if (missingClasses > 0) {
            fixes.push(`Add missing class field${missingClasses !== 1 ? 's' : ''} for method operations`);
        }
        
        // Description fixes
        const missingDescriptions = warnings.filter(w => w.type === 'missing_description').length;
        if (missingDescriptions > 0) {
            fixes.push('Add descriptive text to explain the changes');
        }
        
        return fixes;
    }

    /**
     * Generate next steps recommendations
     */
    private static generateNextSteps(validationSummary: ValidationSummary): string[] {
        const steps: string[] = [];
        const { summary } = validationSummary;
        
        if (summary.invalidChanges > 0) {
            steps.push('1. Fix all validation errors before applying changes');
            steps.push('2. Use "Select Only Valid" to apply valid changes first');
            steps.push('3. Fix remaining issues and retry validation');
        } else if (summary.warningChanges > 0) {
            steps.push('1. Review warnings and make improvements if needed');
            steps.push('2. Apply changes (warnings don\'t block application)');
        } else {
            steps.push('1. Apply all changes');
            steps.push('2. Test the modified code');
            steps.push('3. Commit changes to version control');
        }
        
        // Performance suggestions
        if (summary.processingTimeMs > 10000) {
            steps.push('• Consider breaking large change sets into smaller batches for better performance');
        }
        
        // Global suggestions
        if (validationSummary.suggestions.length > 0) {
            steps.push('• ' + validationSummary.suggestions.join('\n• '));
        }
        
        return steps;
    }

    /**
     * Categorize error for better organization
     */
    private static categorizeError(error: ValidationError, _changeValidation: ChangeValidationResult): ErrorReport['category'] {
        if (error.field === 'file') return 'file';
        if (error.field === 'target') return 'target';
        if (error.type === 'json_parse') return 'json';
        if (error.type === 'invalid_action') return 'syntax';
        if (error.type === 'duplicate_change') return 'logic';
        return 'json';
    }

    /**
     * Categorize warning for better organization
     */
    private static categorizeWarning(warning: ValidationWarning, _changeValidation: ChangeValidationResult): ErrorReport['category'] {
        if (warning.type === 'long_code_block') return 'performance';
        if (warning.type === 'large_change_count') return 'performance';
        if (warning.type === 'duplicate_target') return 'logic';
        return 'json';
    }

    /**
     * Get user-friendly error title
     */
    private static getErrorTitle(error: ValidationError): string {
        const titles: { [key: string]: string } = {
            'json_parse': 'JSON Parsing Error',
            'missing_field': 'Missing Required Field',
            'invalid_type': 'Invalid Field Type',
            'invalid_action': 'Invalid Action Type',
            'empty_array': 'Empty Changes Array',
            'duplicate_change': 'Duplicate Change'
        };
        
        return titles[error.type] || 'Validation Error';
    }

    /**
     * Get user-friendly warning title
     */
    private static getWarningTitle(warning: ValidationWarning): string {
        const titles: { [key: string]: string } = {
            'missing_description': 'Missing Description',
            'large_change_count': 'Large Change Set',
            'duplicate_target': 'Duplicate Target',
            'long_code_block': 'Long Code Block'
        };
        
        return titles[warning.type] || 'Validation Warning';
    }

    /**
     * Format target validation result for display
     */
    public static formatTargetValidation(result: TargetValidationResult, change: ParsedChange): string {
        if (result.exists) {
            let message = `✅ Target "${change.target}" found`;
            if (result.location) {
                message += ` at line ${result.location.line}`;
            }
            if (result.confidence !== 'high') {
                message += ` (${result.confidence} confidence)`;
            }
            return message;
        } else {
            let message = `❌ Target "${change.target}" not found`;
            if (result.reason) {
                message += `: ${result.reason}`;
            }
            if (result.suggestions && result.suggestions.length > 0) {
                message += `\nSuggestions: ${result.suggestions.join(', ')}`;
            }
            return message;
        }
    }

    /**
     * Create user-friendly error message for specific scenarios
     */
    public static createContextualError(
        type: 'file_not_found' | 'target_not_found' | 'class_not_found' | 'permission_denied',
        context: {
            file?: string;
            target?: string;
            class?: string;
            action?: string;
            suggestions?: string[];
        }
    ): ErrorReport {
        switch (type) {
            case 'file_not_found':
                return {
                    severity: 'error',
                    title: `📁 File Not Found: ${context.file}`,
                    message: `The target file "${context.file}" does not exist in the workspace.`,
                    suggestion: context.suggestions?.[0] || 'Check the file path or create the file first',
                    actionable: true,
                    category: 'file',
                    code: 'FILE_NOT_FOUND'
                };

            case 'target_not_found':
                return {
                    severity: 'error',
                    title: `🎯 Target Not Found: ${context.target}`,
                    message: `Cannot find "${context.target}" in ${context.file}`,
                    suggestion: context.suggestions?.length ? 
                        `Similar targets found: ${context.suggestions.join(', ')}` : 
                        'Check the target name and spelling',
                    actionable: true,
                    category: 'target',
                    code: 'TARGET_NOT_FOUND'
                };

            case 'class_not_found':
                return {
                    severity: 'error',
                    title: `🏗️ Class Not Found: ${context.class}`,
                    message: `Cannot find class "${context.class}" in ${context.file}`,
                    suggestion: context.suggestions?.length ? 
                        `Similar classes found: ${context.suggestions.join(', ')}` : 
                        'Check the class name and spelling',
                    actionable: true,
                    category: 'target',
                    code: 'CLASS_NOT_FOUND'
                };

            case 'permission_denied':
                return {
                    severity: 'error',
                    title: `🔒 Permission Denied: ${context.file}`,
                    message: `Cannot read or write to "${context.file}" due to permission restrictions.`,
                    suggestion: 'Check file permissions or try running VS Code with elevated privileges',
                    actionable: true,
                    category: 'file',
                    code: 'PERMISSION_DENIED'
                };

            default:
                return {
                    severity: 'error',
                    title: '❌ Validation Error',
                    message: 'An unknown validation error occurred',
                    actionable: false,
                    category: 'json'
                };
        }
    }

    /**
     * Generate performance report
     */
    public static generatePerformanceReport(validationSummary: ValidationSummary): string {
        const { summary } = validationSummary;
        const avgTimePerChange = summary.processingTimeMs / summary.totalChanges;
        
        let report = `🚀 Performance Report:\n`;
        report += `• Total validation time: ${summary.processingTimeMs}ms\n`;
        report += `• Average per change: ${avgTimePerChange.toFixed(1)}ms\n`;
        report += `• Files analyzed: ${summary.filesAnalyzed}\n`;
        
        if (summary.processingTimeMs > 10000) {
            report += `⚠️ Validation took longer than expected. Consider:\n`;
            report += `• Breaking changes into smaller batches\n`;
            report += `• Excluding large files from validation\n`;
            report += `• Using quick validation mode for initial checks\n`;
        }
        
        return report;
    }

    /**
     * Create detailed validation summary for logging
     */
    public static createDetailedSummary(validationSummary: ValidationSummary): string {
        const { summary, changeValidations } = validationSummary;
        
        let details = `Validation Summary:\n`;
        details += `==================\n`;
        details += `Total Changes: ${summary.totalChanges}\n`;
        details += `Valid: ${summary.validChanges}\n`;
        details += `Invalid: ${summary.invalidChanges}\n`;
        details += `With Warnings: ${summary.warningChanges}\n`;
        details += `Files Analyzed: ${summary.filesAnalyzed}\n`;
        details += `Processing Time: ${summary.processingTimeMs}ms\n\n`;
        
        if (summary.invalidChanges > 0) {
            details += `Invalid Changes:\n`;
            details += `================\n`;
            changeValidations
                .filter(cv => !cv.isValid)
                .forEach((cv, index) => {
                    details += `${index + 1}. Change ${cv.changeIndex + 1}: ${cv.change.action} in ${cv.change.file}\n`;
                    cv.errors.forEach(error => {
                        details += `   Error: ${error.message}\n`;
                    });
                    details += `\n`;
                });
        }
        
        if (summary.warningChanges > 0) {
            details += `Warnings:\n`;
            details += `=========\n`;
            changeValidations
                .filter(cv => cv.warnings.length > 0)
                .forEach((cv, index) => {
                    details += `${index + 1}. Change ${cv.changeIndex + 1}: ${cv.change.action} in ${cv.change.file}\n`;
                    cv.warnings.forEach(warning => {
                        details += `   Warning: ${warning.message}\n`;
                    });
                    details += `\n`;
                });
        }
        
        return details;
    }

    /**
     * Export validation report as JSON for external tools
     */
    public static exportAsJson(validationSummary: ValidationSummary): string {
        const exportData = {
            timestamp: new Date().toISOString(),
            summary: validationSummary.summary,
            overallValid: validationSummary.overallValid,
            changes: validationSummary.changeValidations.map(cv => ({
                index: cv.changeIndex,
                file: cv.change.file,
                action: cv.change.action,
                target: cv.change.target,
                isValid: cv.isValid,
                errors: cv.errors,
                warnings: cv.warnings,
                processingTime: cv.processingTime
            })),
            suggestions: validationSummary.suggestions
        };
        
        return JSON.stringify(exportData, null, 2);
    }
}