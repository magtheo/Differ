import * as vscode from 'vscode';

export interface PendingChange {
    id: string;
    file: string;
    action: string;
    target: string;
    code: string;
    class?: string;
    selected: boolean;
    status: 'pending' | 'applied' | 'failed' | 'error';
    error?: string;
}

export interface ParsedInput {
    description: string;
    changes: any[];
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
    error: string | null;
    
    // History state (placeholder for now)
    changeHistory: any[];
}

export class UIStateManager {
    private _state: UIState = {
        jsonInput: '',
        parsedInput: null,
        pendingChanges: [],
        selectedChanges: [],
        isLoading: false, // Initialize as false, not true
        error: null,
        changeHistory: []
    };
    
    private _onStateChangeEmitter = new vscode.EventEmitter<UIState>();
    public readonly onStateChange = this._onStateChangeEmitter.event;
    
    constructor() {
        // Initialize state - make sure loading is false initially
        this._state.isLoading = false;
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
        this._updateState({ jsonInput: input });
    }
    
    public setParsedInput(parsed: ParsedInput | null) {
        this._updateState({ parsedInput: parsed });
    }
    
    public clearInput() {
        this._updateState({ 
            jsonInput: '',
            parsedInput: null,
            error: null
        });
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
    
    // UI state management
    public setLoading(loading: boolean) {
        this._updateState({ isLoading: loading });
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
               this._state.pendingChanges.some(change => change.status === 'error' || change.status === 'failed');
    }
    
    public getErrorChanges(): PendingChange[] {
        return this._state.pendingChanges.filter(change => 
            change.status === 'error' || change.status === 'failed'
        );
    }
}