import * as vscode from 'vscode';

export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3
}

export class Logger {
    private _outputChannel: vscode.OutputChannel;
    private _logLevel: LogLevel = LogLevel.INFO;
    
    constructor(private _name: string) {
        this._outputChannel = vscode.window.createOutputChannel(`Differ - ${_name}`);
        
        // Get log level from configuration
        const config = vscode.workspace.getConfiguration('differ');
        const configLogLevel = config.get<string>('logLevel', 'info');
        this._logLevel = this._parseLogLevel(configLogLevel);
    }
    
    private _parseLogLevel(level: string): LogLevel {
        switch (level.toLowerCase()) {
            case 'debug': return LogLevel.DEBUG;
            case 'info': return LogLevel.INFO;
            case 'warn': return LogLevel.WARN;
            case 'error': return LogLevel.ERROR;
            default: return LogLevel.INFO;
        }
    }
    
    private _shouldLog(level: LogLevel): boolean {
        return level >= this._logLevel;
    }
    
    private _formatMessage(level: string, message: string, data?: any): string {
        const timestamp = new Date().toISOString();
        const dataString = data ? ` | Data: ${JSON.stringify(data, null, 2)}` : '';
        return `[${timestamp}] [${level}] [${this._name}] ${message}${dataString}`;
    }
    
    private _log(level: LogLevel, levelName: string, message: string, data?: any) {
        if (!this._shouldLog(level)) {
            return;
        }
        
        const formattedMessage = this._formatMessage(levelName, message, data);
        this._outputChannel.appendLine(formattedMessage);
        
        // Also log to console in development
        if (process.env.NODE_ENV === 'development') {
            console.log(formattedMessage);
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
        
        // Show warning in VS Code if it's a significant issue
        if (this._logLevel <= LogLevel.WARN) {
            const displayMessage = data ? `${message}: ${JSON.stringify(data)}` : message;
            vscode.window.showWarningMessage(`Differ: ${displayMessage}`);
        }
    }
    
    public error(message: string, error?: any) {
        const errorData = error instanceof Error ? {
            name: error.name,
            message: error.message,
            stack: error.stack
        } : error;
        
        this._log(LogLevel.ERROR, 'ERROR', message, errorData);
        
        // Always show errors in VS Code
        const displayMessage = error ? `${message}: ${error.message || error}` : message;
        vscode.window.showErrorMessage(`Differ: ${displayMessage}`);
    }
    
    public show() {
        this._outputChannel.show();
    }
    
    public dispose() {
        this._outputChannel.dispose();
    }
    
    // Utility methods for structured logging
    public logMethodEntry(methodName: string, args?: any) {
        this.debug(`Entering ${methodName}`, args);
    }
    
    public logMethodExit(methodName: string, result?: any) {
        this.debug(`Exiting ${methodName}`, result);
    }
    
    public logMethodError(methodName: string, error: any) {
        this.error(`Error in ${methodName}`, error);
    }
    
    public logPerformance(operation: string, duration: number) {
        this.info(`Performance: ${operation} took ${duration}ms`);
    }
    
    public logUserAction(action: string, details?: any) {
        this.info(`User action: ${action}`, details);
    }
    
    public logSystemEvent(event: string, details?: any) {
        this.info(`System event: ${event}`, details);
    }
}