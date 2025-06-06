import * as vscode from 'vscode';
import { ValidationError, ValidationWarning, ChangeAction, ParsedInput, ParsedChange } from '../parser/inputParser';

export interface PendingChange {
    id: string;
    file: string;
    action: ChangeAction;
    target: string;
    code: string;
    class?: string;
    description?: string; // Add this line
    selected: boolean;
    status: 'pending' | 'applied' | 'failed' | 'error' | 'validation_error';
    error?: string; // Legacy error field for backwards compatibility
    validationErrors: ValidationError[];  // NEW: Per-change validation errors
    validationWarnings: ValidationWarning[]; // NEW: Per-change validation warnings
    isValid: boolean;  // NEW: Quick validation check
}

export interface UIState {
    // Input state
    jsonInput: string;
    parsedInput: ParsedInput | null;
    
    // Changes state
    pendingChanges: PendingChange[];
    selectedChanges: string[];
    
    // UI state
    isLoading: boolean;
    error: string | null; // Legacy global error
    
    // NEW: Enhanced validation state
    validationInProgress: boolean;  // Track validation state separately from loading
    globalValidationErrors: ValidationError[];  // JSON-level validation errors
    globalValidationWarnings: ValidationWarning[]; // JSON-level validation warnings
    
    // History state (placeholder for now)
    changeHistory: any[];
}

export class UIStateManager {
    private _state: UIState = {
        jsonInput: '',
        parsedInput: null,
        pendingChanges: [],
        selectedChanges: [],
        isLoading: false,
        error: null,
        validationInProgress: false,
        globalValidationErrors: [],
        globalValidationWarnings: [],
        changeHistory: []
    };
    
    private _onStateChangeEmitter = new vscode.EventEmitter<UIState>();
    public readonly onStateChange = this._onStateChangeEmitter.event;
    
    constructor() {
        // Initialize state
        this._state.isLoading = false;
        this._state.validationInProgress = false;
    }
    
    public dispose() {
        this._onStateChangeEmitter.dispose();
    }
    
    public getState(): UIState {
        return { ...this._state };
    }
    
    private _updateState(updates: Partial<UIState>) {
        this._state = { ...this._state, ...updates };
        this._onStateChangeEmitter.fire(this.getState());
    }
    
    // Input management
    public setJsonInput(input: string) {
        this._updateState({ 
            jsonInput: input,
            // Clear previous validation errors when input changes
            globalValidationErrors: [],
            globalValidationWarnings: [],
            error: null
        });
    }
    
    public setParsedInput(parsed: ParsedInput | null) {
        this._updateState({ parsedInput: parsed });
    }
    
    public clearInput() {
        this._updateState({ 
            jsonInput: '',
            parsedInput: null,
            error: null,
            globalValidationErrors: [],
            globalValidationWarnings: []
        });
    }
    
    // NEW: Global validation error management
    public setGlobalValidationErrors(errors: ValidationError[], warnings: ValidationWarning[] = []) {
        this._updateState({ 
            globalValidationErrors: errors,
            globalValidationWarnings: warnings,
            // Clear legacy error when setting validation errors
            error: null
        });
    }
    
    public clearGlobalValidationErrors() {
        this._updateState({ 
            globalValidationErrors: [],
            globalValidationWarnings: []
        });
    }
    
    public hasGlobalValidationErrors(): boolean {
        return this._state.globalValidationErrors.length > 0;
    }
    
    public getGlobalValidationSummary(): string {
        const errorCount = this._state.globalValidationErrors.length;
        const warningCount = this._state.globalValidationWarnings.length;
        
        if (errorCount === 0 && warningCount === 0) {
            return '';
        }
        
        let summary = '';
        if (errorCount > 0) {
            summary += `${errorCount} error${errorCount > 1 ? 's' : ''}`;
        }
        if (warningCount > 0) {
            if (summary) summary += ', ';
            summary += `${warningCount} warning${warningCount > 1 ? 's' : ''}`;
        }
        
        return summary;
    }
    
    // Changes management
    public setPendingChanges(changes: PendingChange[]) {
        const selectedChanges = changes
            .filter(change => change.selected)
            .map(change => change.id);
            
        this._updateState({ 
            pendingChanges: changes,
            selectedChanges
        });
    }
    
    public addPendingChange(change: PendingChange) {
        const newChanges = [...this._state.pendingChanges, change];
        const selectedChanges = change.selected 
            ? [...this._state.selectedChanges, change.id]
            : this._state.selectedChanges;
            
        this._updateState({ 
            pendingChanges: newChanges,
            selectedChanges
        });
    }
    
    public removePendingChange(changeId: string) {
        const newChanges = this._state.pendingChanges.filter(c => c.id !== changeId);
        const selectedChanges = this._state.selectedChanges.filter(id => id !== changeId);
        
        this._updateState({ 
            pendingChanges: newChanges,
            selectedChanges
        });
    }
    
    public updatePendingChangeStatus(changeId: string, status: PendingChange['status'], error?: string) {
        const newChanges = this._state.pendingChanges.map(change => 
            change.id === changeId 
                ? { ...change, status, error }
                : change
        );
        
        this._updateState({ pendingChanges: newChanges });
    }
    
    // NEW: Validation-specific change updates
    public setChangeValidationErrors(changeId: string, errors: ValidationError[], warnings: ValidationWarning[] = []) {
        const newChanges = this._state.pendingChanges.map(change => 
            change.id === changeId 
                ? { 
                    ...change, 
                    validationErrors: errors,
                    validationWarnings: warnings,
                    isValid: errors.length === 0,
                    status: errors.length > 0 ? 'validation_error' as const : 'pending' as const
                }
                : change
        );
        
        this._updateState({ pendingChanges: newChanges });
    }
    
    public clearChangeValidationErrors(changeId: string) {
        this.setChangeValidationErrors(changeId, [], []);
    }
    
    public clearAllValidationErrors() {
        const newChanges = this._state.pendingChanges.map(change => ({
            ...change,
            validationErrors: [],
            validationWarnings: [],
            isValid: true,
            status: change.status === 'validation_error' ? 'pending' as const : change.status
        }));
        
        this._updateState({ 
            pendingChanges: newChanges,
            globalValidationErrors: [],
            globalValidationWarnings: []
        });
    }
    
    public clearPendingChanges() {
        this._updateState({ 
            pendingChanges: [],
            selectedChanges: [],
            parsedInput: null
        });
    }
    
    public toggleChangeSelection(changeId: string, selected: boolean) {
        // Update the change itself
        const newChanges = this._state.pendingChanges.map(change => 
            change.id === changeId 
                ? { ...change, selected }
                : change
        );
        
        // Update selected changes list
        let selectedChanges: string[];
        if (selected) {
            selectedChanges = [...this._state.selectedChanges, changeId];
        } else {
            selectedChanges = this._state.selectedChanges.filter(id => id !== changeId);
        }
        
        this._updateState({ 
            pendingChanges: newChanges,
            selectedChanges
        });
    }
    
    public selectAllChanges() {
        const newChanges = this._state.pendingChanges.map(change => ({
            ...change,
            selected: true
        }));
        
        const selectedChanges = newChanges.map(change => change.id);
        
        this._updateState({ 
            pendingChanges: newChanges,
            selectedChanges
        });
    }
    
    public deselectAllChanges() {
        const newChanges = this._state.pendingChanges.map(change => ({
            ...change,
            selected: false
        }));
        
        this._updateState({ 
            pendingChanges: newChanges,
            selectedChanges: []
        });
    }
    
    // NEW: Select only valid changes
    public selectOnlyValidChanges() {
        const newChanges = this._state.pendingChanges.map(change => ({
            ...change,
            selected: change.isValid
        }));
        
        const selectedChanges = newChanges
            .filter(change => change.selected)
            .map(change => change.id);
        
        this._updateState({ 
            pendingChanges: newChanges,
            selectedChanges
        });
    }
    
    // UI state management
    public setLoading(loading: boolean) {
        this._updateState({ isLoading: loading });
    }
    
    // NEW: Validation progress tracking
    public setValidationInProgress(inProgress: boolean) {
        this._updateState({ validationInProgress: inProgress });
    }
    
    public setError(error: string | null) {
        this._updateState({ error });
    }
    
    // History management (placeholder for now)
    public addToHistory(historyEntry: any) {
        const newHistory = [...this._state.changeHistory, historyEntry];
        this._updateState({ changeHistory: newHistory });
    }
    
    public clearHistory() {
        this._updateState({ changeHistory: [] });
    }
    
    // Computed properties
    public getSelectedChanges(): PendingChange[] {
        return this._state.pendingChanges.filter(change => 
            this._state.selectedChanges.includes(change.id)
        );
    }
    
    public hasSelectedChanges(): boolean {
        return this._state.selectedChanges.length > 0;
    }
    
    public hasPendingChanges(): boolean {
        return this._state.pendingChanges.length > 0;
    }
    
    public getPendingChangesCount(): number {
        return this._state.pendingChanges.length;
    }
    
    public getSelectedChangesCount(): number {
        return this._state.selectedChanges.length;
    }
    
    public hasErrors(): boolean {
        return this._state.error !== null || 
               this._state.globalValidationErrors.length > 0 ||
               this._state.pendingChanges.some(change => 
                   change.status === 'error' || 
                   change.status === 'failed' || 
                   change.status === 'validation_error'
               );
    }
    
    public getErrorChanges(): PendingChange[] {
        return this._state.pendingChanges.filter(change => 
            change.status === 'error' || 
            change.status === 'failed' || 
            change.status === 'validation_error'
        );
    }
    
    // NEW: Validation-specific computed properties
    public hasValidationErrors(): boolean {
        return this._state.globalValidationErrors.length > 0 ||
               this._state.pendingChanges.some(change => change.validationErrors.length > 0);
    }
    
    public getValidChanges(): PendingChange[] {
        return this._state.pendingChanges.filter(change => change.isValid);
    }
    
    public getInvalidChanges(): PendingChange[] {
        return this._state.pendingChanges.filter(change => !change.isValid);
    }
    
    public getValidChangesCount(): number {
        return this.getValidChanges().length;
    }
    
    public getInvalidChangesCount(): number {
        return this.getInvalidChanges().length;
    }
    
    public hasOnlyValidChangesSelected(): boolean {
        const selectedChanges = this.getSelectedChanges();
        return selectedChanges.length > 0 && selectedChanges.every(change => change.isValid);
    }
    
    public hasAnyInvalidChangesSelected(): boolean {
        const selectedChanges = this.getSelectedChanges();
        return selectedChanges.some(change => !change.isValid);
    }
    
    public getValidationSummary(): string {
        const totalChanges = this._state.pendingChanges.length;
        const validChanges = this.getValidChangesCount();
        const invalidChanges = this.getInvalidChangesCount();
        const globalErrors = this._state.globalValidationErrors.length;
        const globalWarnings = this._state.globalValidationWarnings.length;
        
        if (totalChanges === 0) {
            return 'No changes to validate';
        }
        
        let summary = `${validChanges}/${totalChanges} changes valid`;
        
        if (invalidChanges > 0) {
            summary += `, ${invalidChanges} invalid`;
        }
        
        if (globalErrors > 0 || globalWarnings > 0) {
            summary += ` (${globalErrors} global errors, ${globalWarnings} warnings)`;
        }
        
        return summary;
    }
    
    // NEW: Bulk operations for validation
    public markAllChangesAsValid() {
        const newChanges = this._state.pendingChanges.map(change => ({
            ...change,
            validationErrors: [],
            validationWarnings: [],
            isValid: true,
            status: change.status === 'validation_error' ? 'pending' as const : change.status
        }));
        
        this._updateState({ pendingChanges: newChanges });
    }
    
    public createPendingChangeFromParsed(parsedChange: ParsedChange, index: number): PendingChange {
        return {
            id: `change-${Date.now()}-${index}-${Math.random().toString(36).substring(2, 7)}`,
            file: parsedChange.file,
            action: parsedChange.action,
            target: parsedChange.target,
            code: parsedChange.code,
            class: parsedChange.class,
            description: parsedChange.description,
            selected: true, // Default to selected
            status: 'pending',
            validationErrors: [],
            validationWarnings: [],
            isValid: true // Assume valid until validation runs
        };
    }
    
    // Debug helpers
    public getStateSnapshot(): string {
        return JSON.stringify({
            inputLength: this._state.jsonInput.length,
            hasParsedInput: !!this._state.parsedInput,
            pendingChangesCount: this._state.pendingChanges.length,
            selectedChangesCount: this._state.selectedChanges.length,
            isLoading: this._state.isLoading,
            validationInProgress: this._state.validationInProgress,
            globalErrorsCount: this._state.globalValidationErrors.length,
            globalWarningsCount: this._state.globalValidationWarnings.length,
            validChangesCount: this.getValidChangesCount(),
            invalidChangesCount: this.getInvalidChangesCount()
        }, null, 2);
    }
}