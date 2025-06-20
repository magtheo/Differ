// src/utils/logger.ts
import * as vscode from 'vscode';
import { DetailedError, BatchApplicationResult, ChangeApplicationResult } from '../parser/inputParser'; // Adjust path as necessary

export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
    NONE = 4 // To disable logging completely
}

export class Logger {
    private _outputChannel: vscode.OutputChannel;
    private _logLevel: LogLevel = LogLevel.INFO;
    private _name: string;

    constructor(name: string, instanceName?: string) {
        this._name = instanceName ? `${name} (${instanceName})` : name;
        this._outputChannel = vscode.window.createOutputChannel(`Differ - ${this._name}`);

        this.updateLogLevelFromConfig();
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('differ.logLevel')) {
                this.updateLogLevelFromConfig();
            }
        });
    }

    private updateLogLevelFromConfig(): void {
        const config = vscode.workspace.getConfiguration('differ');
        const configLogLevel = config.get<string>('logLevel', 'info');
        const newLogLevel = this._parseLogLevel(configLogLevel);
        if (this._logLevel !== newLogLevel) {
            this._logLevel = newLogLevel;
            this.info(`Log level set to ${LogLevel[this._logLevel]}`);
        }
    }

    private _parseLogLevel(level: string): LogLevel {
        switch (level.toLowerCase()) {
            case 'debug': return LogLevel.DEBUG;
            case 'info': return LogLevel.INFO;
            case 'warn': return LogLevel.WARN;
            case 'error': return LogLevel.ERROR;
            case 'none': return LogLevel.NONE;
            default: return LogLevel.INFO;
        }
    }

    private _shouldLog(level: LogLevel): boolean {
        return level >= this._logLevel && this._logLevel !== LogLevel.NONE;
    }

    private _formatMessage(level: string, message: string, data?: any): string {
        const timestamp = new Date().toISOString();
        let dataString = '';
        if (data !== undefined) {
            try {
                // Handle complex objects, errors, etc.
                if (data instanceof Error) {
                    dataString = ` | Error: ${data.name} - ${data.message}${data.stack ? `\nStack: ${data.stack}` : ''}`;
                } else if (typeof data === 'object' && data !== null) {
                    // For DetailedError, let's make it more readable
                    if ('code' in data && 'message' in data && 'details' in data) {
                         const de = data as DetailedError;
                         dataString = ` | DetailedError: [Code: ${de.code}] ${de.message}\n   Details: ${de.details}\n   Suggestions: ${de.suggestions.join(', ')}${de.context ? `\n   Context: ${JSON.stringify(de.context, null, 2)}` : ''}`;
                    } else {
                        dataString = ` | Data: ${JSON.stringify(data, null, 2)}`;
                    }
                } else {
                     dataString = ` | Data: ${String(data)}`;
                }
            } catch (e) {
                dataString = ' | Data: (Error serializing data for logging)';
            }
        }
        return `[${timestamp}] [${level.padEnd(5)}] [${this._name}] ${message}${dataString}`;
    }

    private _log(level: LogLevel, levelName: string, message: string, data?: any) {
        if (!this._shouldLog(level)) {
            return;
        }

        const formattedMessage = this._formatMessage(levelName, message, data);
        this._outputChannel.appendLine(formattedMessage);

        // Also log to console in development (check for common dev environment variable)
        if (process.env.VSCODE_DEV || process.env.NODE_ENV === 'development') {
            switch(level) {
                case LogLevel.DEBUG: console.debug(formattedMessage); break;
                case LogLevel.INFO: console.info(formattedMessage); break;
                case LogLevel.WARN: console.warn(formattedMessage); break;
                case LogLevel.ERROR: console.error(formattedMessage); break;
            }
        }
    }

    public debug(message: string, data?: any) {
        this._log(LogLevel.DEBUG, 'DEBUG', message, data);
    }

    public info(message: string, data?: any) {
        this._log(LogLevel.INFO, 'INFO', message, data);
    }

    public warn(message: string, data?: any) {
        this._log(LogLevel.WARN, 'WARN', message, data);
        // Optionally show warning in VS Code if it's significant and log level allows
        // if (this._logLevel <= LogLevel.WARN) {
        //     const displayMessage = data ? `${message}: ${JSON.stringify(data)}` : message;
        //     vscode.window.showWarningMessage(`Differ (${this._name}): ${displayMessage}`);
        // }
    }

    public error(message: string, error?: any) { // error can be Error object or any data
        this._log(LogLevel.ERROR, 'ERROR', message, error);
        // Optionally always show errors in VS Code
        // const displayMessage = error instanceof Error ? `${message}: ${error.message}` : (error ? `${message}: ${JSON.stringify(error)}` : message);
        // vscode.window.showErrorMessage(`Differ (${this._name}): ${displayMessage}`);
    }

    public show() {
        this._outputChannel.show();
    }

    public dispose() {
        this._outputChannel.dispose();
    }

    // --- Batch Operation Logging Methods (NEW from Plan v2) ---

    public logBatchStart(batchId: string, changeCount: number, description?: string) {
        this.info(`Batch processing START. ID: ${batchId}, Changes: ${changeCount}, Description: "${description || 'N/A'}"`);
    }

    public logChangeProcessingStart(batchId: string, changeId: string, changeIndex: number, action: string, file: string) {
        this.debug(`Batch [${batchId}] - Change [${changeId} | #${changeIndex}] PROCESSING START. Action: ${action}, File: ${file}`);
    }

    public logChangeProcessingResult(batchId: string, changeId: string, result: ChangeApplicationResult) {
        const outcome = result.success ? 'SUCCESS' : 'FAILURE';
        const durationInfo = result.durationMs !== undefined ? ` (${result.durationMs}ms)` : '';
        if (result.success) {
            this.info(`Batch [${batchId}] - Change [${changeId}] PROCESSING ${outcome}${durationInfo}.`);
        } else {
            this.error(`Batch [${batchId}] - Change [${changeId}] PROCESSING ${outcome}${durationInfo}.`, result.error);
        }
    }

    public logBatchAttemptSummary(batchId: string, result: BatchApplicationResult) {
        const overallOutcome = result.failedChangeResult ? 'PARTIAL_FAILURE' : (result.batchError ? 'CATASTROPHIC_FAILURE' : 'FULL_SUCCESS');
        this.info(
            `Batch processing ATTEMPT SUMMARY. ID: ${batchId}, Outcome: ${overallOutcome}, Processed: ${result.processedChangeCountInThisAttempt}, Succeeded: ${result.successfullyAppliedCountInThisAttempt}.`,
            {
                firstFailureId: result.failedChangeResult?.changeId,
                batchLevelError: result.batchError
            }
        );
    }

    // --- Error Context Logging (NEW from Plan v2) ---

    public logDetailedErrorContext(contextIdentifier: string, error: DetailedError) {
        this.error(`Detailed error for [${contextIdentifier}]`, error);
    }

    public logFileSnapshot(type: 'before' | 'after-success' | 'after-fail-attempt', contextIdentifier: string, filePath: string, contentOrDiff: string) {
        const maxContentLength = 500; // Log only a snippet for large files
        const contentSnippet = contentOrDiff.length > maxContentLength
            ? `${contentOrDiff.substring(0, maxContentLength)}... (truncated)`
            : contentOrDiff;
        this.debug(`File snapshot [${type}] for [${contextIdentifier}] on "${filePath}"`, `\n--- Content/Diff Start ---\n${contentSnippet}\n--- Content/Diff End ---`);
        // For very large files, consider only logging a hash or if diff, only the diff stats.
        // This is a placeholder for more sophisticated snapshot logging.
    }

    public logUserFixAttempt(changeId: string, oldCodeSnippet: string, newCodeSnippet: string) {
        this.info(`User attempting to FIX change [${changeId}].`, {
            oldCodePreview: oldCodeSnippet.substring(0, 100) + (oldCodeSnippet.length > 100 ? "..." : ""),
            newCodePreview: newCodeSnippet.substring(0, 100) + (newCodeSnippet.length > 100 ? "..." : ""),
        });
    }

    // --- Performance and Debugging Logging (NEW from Plan v2, some are refinements) ---
    // logChangeApplicationTiming is covered by logChangeProcessingResult's durationMs

    public logStateTransition(contextIdentifier: string, oldStatus: string, newStatus: string, reason?: string) {
        this.debug(`State transition for [${contextIdentifier}]: ${oldStatus} -> ${newStatus}`, reason ? { reason } : undefined);
    }

    // --- Existing Utility Methods (can be kept or adapted) ---
    public logMethodEntry(methodName: string, args?: any) {
        this.debug(`ENTERING -> ${methodName}`, args);
    }

    public logMethodExit(methodName: string, result?: any) {
        // For results that are too large, summarize or skip logging them at debug level
        const maxResultLogLength = 1000;
        let resultData = result;
        if (typeof result === 'string' && result.length > maxResultLogLength) {
            resultData = `(String result, length: ${result.length}, starts with: "${result.substring(0,50)}...")`;
        } else if (typeof result === 'object' && result !== null) {
            // Potentially summarize large objects
        }
        this.debug(`EXITING <- ${methodName}`, resultData);
    }
}

// Singleton logger instance or factory for convenience (optional)
// Example:
// export const extensionLogger = new Logger('ExtensionCore');
// export const webviewLogger = new Logger('WebViewProvider');
// Or a factory:
// const loggers = new Map<string, Logger>();
// export function getLogger(name: string, instanceName?: string): Logger {
//     const key = instanceName ? `${name}:${instanceName}` : name;
//     if (!loggers.has(key)) {
//         loggers.set(key, new Logger(name, instanceName));
//     }
//     return loggers.get(key)!;
// }