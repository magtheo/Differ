// src/ui/stateManager.ts
import * as vscode from 'vscode';
import {
    ParsedInput,
    ParsedChange,
    ChangeAction,
    DetailedError,
    ChangeApplicationResult,
    FailedChangeExportPayload, // Added import
    // InputFormatValidationError, // These are specific to ChangeParser's structural validation
    // InputFormatValidationWarning
} from '../parser/inputParser';

export type PendingChangeStatus =
    | 'pending'
    | 'validation_error'
    | 'queued'
    | 'applying'
    | 'applied'
    | 'failed'
    | 'awaiting_fix';

export interface PendingChange {
    id: string;
    file: string;
    action: ChangeAction;
    target: string;
    code: string;
    class?: string;
    description?: string;
    selected: boolean;

    status: PendingChangeStatus;
    validationErrors: DetailedError[];
    validationWarnings: DetailedError[];
    applicationError?: DetailedError;

    isValid: boolean;
    originalInputBlockIndex?: number;
}

export interface FailedChangeToFixInfo {
    changeId: string;
    error: DetailedError;
    originalChange: ParsedChange;
}

export interface UIState {
    rawInput: string;
    parsedInput: ParsedInput | null;
    pendingChanges: PendingChange[];
    currentBatchId?: string;
    batchProcessingStatus: 'idle' | 'parsing' | 'validating' | 'processing' | 'awaiting_fix' | 'partially_completed' | 'completed';
    totalChangesInBatch?: number;
    processedInCurrentBatchAttempt?: number;
    succeededInCurrentBatchAttempt?: number;
    failedChangeToFix?: FailedChangeToFixInfo;
    isLoading: boolean;
    inputFormatValidationErrors: DetailedError[];
    inputFormatValidationWarnings: DetailedError[];
    changeHistory: any[];
}

export class UIStateManager {
    private _state: UIState;
    private _onStateChangeEmitter = new vscode.EventEmitter<UIState>();
    public readonly onStateChange = this._onStateChangeEmitter.event;

    constructor() {
        this._state = {
            rawInput: '',
            parsedInput: null,
            pendingChanges: [],
            currentBatchId: undefined,
            batchProcessingStatus: 'idle',
            totalChangesInBatch: undefined,
            processedInCurrentBatchAttempt: undefined,
            succeededInCurrentBatchAttempt: undefined,
            failedChangeToFix: undefined,
            isLoading: false,
            inputFormatValidationErrors: [],
            inputFormatValidationWarnings: [],
            changeHistory: []
        };
        this._logger('Initialized with default state.');
    }

    private _logger(message: string, data?: any) {
        // Simple console logger for state manager actions
        // console.log(`[UIStateManager] ${message}`, data === undefined ? '' : data);
    }

    public dispose() {
        this._onStateChangeEmitter.dispose();
    }

    public getState(): UIState {
        return JSON.parse(JSON.stringify(this._state));
    }

    private _updateState(updates: Partial<UIState>) {
        this._state = { ...this._state, ...updates };
        this._onStateChangeEmitter.fire(this.getState());
    }

    public setRawInput(input: string) {
        this._logger('Setting raw input.');
        this._updateState({
            rawInput: input,
            parsedInput: null,
            pendingChanges: [],
            inputFormatValidationErrors: [],
            inputFormatValidationWarnings: [],
            batchProcessingStatus: 'idle',
            failedChangeToFix: undefined,
        });
    }

    public setParsedInput(parsed: ParsedInput | null, formatErrors: DetailedError[] = [], formatWarnings: DetailedError[] = []) {
        this._logger('Setting parsed input and pending changes.');
        if (parsed) {
            const pendingChanges = parsed.changes.map((pc, index) =>
                // Pass the rawInput from the state, not from parsed.metadata
                this.createPendingChangeFromParsed(pc, index, this._state.rawInput)
            );
            this._updateState({
                parsedInput: parsed,
                pendingChanges: pendingChanges,
                inputFormatValidationErrors: formatErrors,
                inputFormatValidationWarnings: formatWarnings,
                isLoading: false,
                batchProcessingStatus: formatErrors.length > 0 ? 'idle' : 'validating',
            });
        } else {
            this._updateState({
                parsedInput: null,
                pendingChanges: [],
                inputFormatValidationErrors: formatErrors,
                inputFormatValidationWarnings: formatWarnings,
                isLoading: false,
            });
        }
    }

    public clearAllInputAndState() {
        this._logger('Clearing all input and state.');
        this._updateState({
            rawInput: '',
            parsedInput: null,
            pendingChanges: [],
            currentBatchId: undefined,
            batchProcessingStatus: 'idle',
            totalChangesInBatch: undefined,
            processedInCurrentBatchAttempt: undefined,
            succeededInCurrentBatchAttempt: undefined,
            failedChangeToFix: undefined,
            isLoading: false,
            inputFormatValidationErrors: [],
            inputFormatValidationWarnings: [],
        });
    }

    public startBatchProcessing(batchId: string, changesToProcess: PendingChange[]) {
        this._logger(`Starting batch processing: ${batchId}`, { count: changesToProcess.length });
        const updatedPendingChanges = this._state.pendingChanges.map(pc => {
            if (changesToProcess.find(ctp => ctp.id === pc.id)) {
                return { ...pc, status: 'queued' as PendingChangeStatus, applicationError: undefined };
            }
            return pc;
        });

        this._updateState({
            currentBatchId: batchId,
            batchProcessingStatus: 'processing',
            totalChangesInBatch: changesToProcess.length,
            processedInCurrentBatchAttempt: 0,
            succeededInCurrentBatchAttempt: 0,
            failedChangeToFix: undefined,
            pendingChanges: updatedPendingChanges,
            isLoading: false,
        });
    }

    public markChangeAsApplying(changeId: string) {
        this._logger(`Marking change as applying: ${changeId}`);
        const newChanges = this._state.pendingChanges.map(pc =>
            pc.id === changeId ? { ...pc, status: 'applying' as PendingChangeStatus } : pc
        );
        this._updateState({
            pendingChanges: newChanges,
            processedInCurrentBatchAttempt: (this._state.processedInCurrentBatchAttempt || 0) + 1,
        });
    }

    public recordChangeApplicationResult(result: ChangeApplicationResult) {
        this._logger(`Recording change application result for: ${result.changeId}`, { success: result.success });
        const newChanges = this._state.pendingChanges.map(pc => {
            if (pc.id === result.changeId) {
                return {
                    ...pc,
                    status: result.success ? 'applied' as PendingChangeStatus : 'failed' as PendingChangeStatus,
                    applicationError: result.error,
                    isValid: result.success,
                };
            }
            return pc;
        });

        let updates: Partial<UIState> = { pendingChanges: newChanges };
        if (result.success) {
            updates.succeededInCurrentBatchAttempt = (this._state.succeededInCurrentBatchAttempt || 0) + 1;
        }
        this._updateState(updates);
    }

    public handleBatchFailure(batchId: string, failedChangeResult: ChangeApplicationResult) {
        this._logger(`Handling batch failure for batch: ${batchId}, failed change: ${failedChangeResult.changeId}`);
        this._updateState({
            batchProcessingStatus: 'awaiting_fix',
            failedChangeToFix: {
                changeId: failedChangeResult.changeId,
                error: failedChangeResult.error!,
                originalChange: failedChangeResult.originalChange,
            },
        });
    }

    public completeBatchSuccessfully(batchId: string) {
        this._logger(`Batch completed successfully: ${batchId}`);
        this._updateState({
            batchProcessingStatus: 'completed',
            currentBatchId: undefined,
            failedChangeToFix: undefined,
        });
    }

    public prepareForFix(changeId: string) {
        this._logger(`Preparing for user fix for change: ${changeId}`);
        const changeToFix = this._state.pendingChanges.find(pc => pc.id === changeId && pc.status === 'failed');
        if (changeToFix && changeToFix.applicationError) {
            const originalChangeIndex = this.getOriginalChangeIndex(changeToFix);
            const parsedChange = (originalChangeIndex !== undefined && this._state.parsedInput) ?
                                 this._state.parsedInput.changes[originalChangeIndex] :
                                 undefined; // Fallback if original index isn't available

            if (parsedChange) { // Or if !parsedChange, reconstruct from PendingChange if needed
                 this._updateState({
                    batchProcessingStatus: 'awaiting_fix',
                    failedChangeToFix: {
                        changeId: changeToFix.id,
                        error: changeToFix.applicationError,
                        originalChange: parsedChange, // Use reconstructed if necessary
                    },
                });
            } else {
                 this._logger(`Could not find original ParsedChange for failed PendingChange: ${changeId}. Using data from PendingChange itself for context.`);
                 // Fallback: use data from PendingChange to populate originalChange if ParsedChange is elusive
                 const fallbackOriginalChange: ParsedChange = {
                    file: changeToFix.file,
                    action: changeToFix.action,
                    target: changeToFix.target,
                    code: changeToFix.code, // This is the *failed* code, which is what user needs to see
                    class: changeToFix.class,
                    description: changeToFix.description,
                 };
                 this._updateState({
                    batchProcessingStatus: 'awaiting_fix',
                    failedChangeToFix: {
                        changeId: changeToFix.id,
                        error: changeToFix.applicationError,
                        originalChange: fallbackOriginalChange,
                    },
                });
            }
        } else {
            this._logger(`Cannot prepare fix: Change ${changeId} not found or has no application error.`);
        }
    }

    private getOriginalChangeIndex(pendingChange: PendingChange): number | undefined {
        return pendingChange.originalInputBlockIndex;
    }

    public applyUserFix(changeId: string, newCodeBlock: string) {
        this._logger(`Applying user fix for change: ${changeId}`);
        let found = false;
        const updatedPendingChanges = this._state.pendingChanges.map(pc => {
            if (pc.id === changeId && (pc.status === 'failed' || pc.status === 'awaiting_fix')) {
                found = true;
                return {
                    ...pc,
                    code: newCodeBlock,
                    status: 'queued' as PendingChangeStatus,
                    applicationError: undefined,
                    isValid: true,
                };
            }
            return pc;
        });

        if (found) {
            this._updateState({
                pendingChanges: updatedPendingChanges,
                batchProcessingStatus: 'processing',
                failedChangeToFix: undefined,
                processedInCurrentBatchAttempt: 0,
                succeededInCurrentBatchAttempt: 0,
            });
        } else {
            this._logger(`Could not apply fix: Change ${changeId} not in a fixable state.`);
        }
    }

    public cancelBatchApplication(reason: string) {
        this._logger(`Batch application cancelled: ${reason}`);
        const revertedChanges = this._state.pendingChanges.map(pc => {
            if (pc.status === 'queued' || pc.status === 'applying') {
                // Revert to 'pending' if it was valid before, or 'validation_error' if it had pre-existing validation issues
                return { ...pc, status: pc.isValid && pc.validationErrors.length === 0 ? 'pending' as PendingChangeStatus : 'validation_error' as PendingChangeStatus };
            }
            return pc;
        });
        this._updateState({
            batchProcessingStatus: 'idle',
            currentBatchId: undefined,
            failedChangeToFix: undefined,
            pendingChanges: revertedChanges,
            isLoading: false,
        });
    }

    public getChangeErrorForLLMPayload(changeId: string): FailedChangeExportPayload | null {
        this._logger(`Getting error for LLM payload for change: ${changeId}`);
        const failedChangeFromState = this._state.failedChangeToFix;

        if (failedChangeFromState && failedChangeFromState.changeId === changeId) {
            const originalBlock = this.reconstructChangeBlock(failedChangeFromState.originalChange);
            return {
                originalChangeBlock: originalBlock,
                error: failedChangeFromState.error,
                contextDescription: this._state.parsedInput?.description || "General code modification",
                language: undefined, // TODO: Determine language
            };
        } else {
            // Fallback if not in 'awaiting_fix' mode but error exists on a PendingChange
            const pendingChangeWithError = this._state.pendingChanges.find(pc => pc.id === changeId && pc.applicationError);
            if(pendingChangeWithError && pendingChangeWithError.applicationError) {
                const originalChangeIndex = this.getOriginalChangeIndex(pendingChangeWithError);
                 const originalParsedChange = (originalChangeIndex !== undefined && this._state.parsedInput) ?
                                 this._state.parsedInput.changes[originalChangeIndex] :
                                 undefined;
                if(originalParsedChange) {
                    const originalBlock = this.reconstructChangeBlock(originalParsedChange);
                     return {
                        originalChangeBlock: originalBlock,
                        error: pendingChangeWithError.applicationError,
                        contextDescription: this._state.parsedInput?.description || "General code modification",
                        language: undefined,
                    };
                }
            }
        }
        this._logger(`No suitable error found for LLM payload for change: ${changeId}`);
        return null;
    }

    private reconstructChangeBlock(pc: ParsedChange): string {
        let block = `CHANGE: ${pc.description || ''}\n`; // Ensure description is not undefined
        block += `FILE: ${pc.file}\n`;
        block += `ACTION: ${pc.action}\n`;
        // Only add TARGET if it's meaningful and different from description, or if action requires it
        if (pc.target && (pc.target !== pc.description || ChangeParser.actionRequiresTarget(pc.action))) {
            block += `TARGET: ${pc.target}\n`;
        }
        if (pc.class) {
            block += `CLASS: ${pc.class}\n`;
        }
        if (ChangeParser.actionRequiresCodeBlock(pc.action)) {
            block += `---\n`;
            block += `${pc.code || ''}\n`; // Ensure code is not undefined
            block += `---`;
        }
        return block;
    }

    public updatePendingChangeValidationStatus(changeId: string, isValid: boolean, validationErrors: DetailedError[], validationWarnings: DetailedError[]) {
        this._logger(`Updating validation status for change: ${changeId}`, { isValid });
        const newChanges = this._state.pendingChanges.map(pc =>
            pc.id === changeId ? {
                ...pc,
                isValid,
                validationErrors,
                validationWarnings,
                status: isValid ? ('pending' as PendingChangeStatus) : ('validation_error' as PendingChangeStatus)
            } : pc
        );
        this._updateState({ pendingChanges: newChanges });
    }

    public toggleChangeSelection(changeId: string, selected: boolean) {
        this._logger(`Toggling selection for change: ${changeId} to ${selected}`);
        const newChanges = this._state.pendingChanges.map(pc =>
            pc.id === changeId ? { ...pc, selected } : pc
        );
        this._updateState({ pendingChanges: newChanges });
    }

    public createPendingChangeFromParsed(parsedChange: ParsedChange, index: number, _rawFullInput?: string): PendingChange {
        return {
            id: `pc-${Date.now()}-${index}-${Math.random().toString(16).substring(2, 8)}`,
            file: parsedChange.file,
            action: parsedChange.action,
            target: parsedChange.target,
            code: parsedChange.code,
            class: parsedChange.class,
            description: parsedChange.description,
            selected: true,
            status: 'pending' as PendingChangeStatus,
            validationErrors: [],
            validationWarnings: [],
            applicationError: undefined,
            isValid: true,
            originalInputBlockIndex: index,
        };
    }

    public setLoading(loading: boolean, operation?: 'parsing' | 'validating') {
        this._logger(`Setting loading: ${loading}` + (operation ? ` for ${operation}` : ''));
        let batchStatusUpdate: Partial<UIState> = {};
        if (loading) {
            if (operation === 'parsing') {
                batchStatusUpdate.batchProcessingStatus = 'parsing';
            } else if (operation === 'validating') {
                batchStatusUpdate.batchProcessingStatus = 'validating';
            }
        } else {
            if ((this._state.batchProcessingStatus === 'parsing' || this._state.batchProcessingStatus === 'validating')) {
                 if (this._state.inputFormatValidationErrors.length === 0 && this._state.pendingChanges.every(pc => pc.isValid && pc.validationErrors.length === 0) ) {
                    batchStatusUpdate.batchProcessingStatus = 'idle';
                 }
                 // If there are inputFormatValidationErrors, batchProcessingStatus will be set by setParsedInput
                 // If there are individual validationErrors, it might stay 'validating' or move to 'idle' if user needs to fix them.
                 // This logic might need refinement based on exact flow after validation completes.
            }
        }
        this._updateState({ isLoading: loading, ...batchStatusUpdate });
    }

    public addToHistory(historyEntry: any) {
        this._logger('Adding to history (placeholder).');
        const newHistory = [...this._state.changeHistory, historyEntry];
        this._updateState({ changeHistory: newHistory });
    }
}