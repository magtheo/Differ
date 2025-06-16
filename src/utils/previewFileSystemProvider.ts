// Create a new file: src/previewFileSystemProvider.ts

import * as vscode from 'vscode';

export class PreviewFileSystemProvider implements vscode.FileSystemProvider {
    private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    private _bufferedEvents: vscode.FileChangeEvent[] = [];
    private _fireSoonHandle?: NodeJS.Timeout;
    private _previewFiles = new Map<string, Uint8Array>();

    readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._emitter.event;

    watch(uri: vscode.Uri, options: { recursive: boolean; excludes: string[]; }): vscode.Disposable {
        // Since we're only dealing with preview files, we don't need to watch anything
        return new vscode.Disposable(() => {});
    }

    stat(uri: vscode.Uri): vscode.FileStat | Thenable<vscode.FileStat> {
        console.log('📊 PREVIEW FS: stat called for:', uri.toString());
        
        if (this._previewFiles.has(uri.toString())) {
            const content = this._previewFiles.get(uri.toString())!;
            return {
                type: vscode.FileType.File,
                ctime: Date.now(),
                mtime: Date.now(),
                size: content.byteLength
            };
        }
        
        throw vscode.FileSystemError.FileNotFound(uri);
    }

    readDirectory(uri: vscode.Uri): [string, vscode.FileType][] | Thenable<[string, vscode.FileType][]> {
        throw vscode.FileSystemError.FileNotFound(uri);
    }

    createDirectory(uri: vscode.Uri): void | Thenable<void> {
        throw vscode.FileSystemError.NoPermissions('Preview file system is read-only');
    }

    readFile(uri: vscode.Uri): Uint8Array | Thenable<Uint8Array> {
        console.log('📖 PREVIEW FS: readFile called for:', uri.toString());
        
        const content = this._previewFiles.get(uri.toString());
        if (content) {
            console.log('📖 PREVIEW FS: Found content, length:', content.byteLength);
            return content;
        }
        
        console.log('📖 PREVIEW FS: File not found');
        throw vscode.FileSystemError.FileNotFound(uri);
    }

    writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean; overwrite: boolean; }): void | Thenable<void> {
        console.log('📝 PREVIEW FS: writeFile called for:', uri.toString());
        console.log('📝 PREVIEW FS: Content length:', content.byteLength);
        
        const exists = this._previewFiles.has(uri.toString());
        this._previewFiles.set(uri.toString(), content);
        
        // Fire change event
        this._fireSoon({
            type: exists ? vscode.FileChangeType.Changed : vscode.FileChangeType.Created,
            uri
        });
        
        console.log('📝 PREVIEW FS: File written successfully');
    }

    delete(uri: vscode.Uri, options: { recursive: boolean; }): void | Thenable<void> {
        const exists = this._previewFiles.delete(uri.toString());
        if (!exists) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        
        this._fireSoon({ type: vscode.FileChangeType.Deleted, uri });
    }

    rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean; }): void | Thenable<void> {
        const content = this._previewFiles.get(oldUri.toString());
        if (!content) {
            throw vscode.FileSystemError.FileNotFound(oldUri);
        }
        
        const exists = this._previewFiles.has(newUri.toString());
        if (exists && !options.overwrite) {
            throw vscode.FileSystemError.FileExists(newUri);
        }
        
        this._previewFiles.set(newUri.toString(), content);
        this._previewFiles.delete(oldUri.toString());
        
        this._fireSoon(
            { type: vscode.FileChangeType.Deleted, uri: oldUri },
            { type: exists ? vscode.FileChangeType.Changed : vscode.FileChangeType.Created, uri: newUri }
        );
    }

    // Helper method to clear all preview files (useful for cleanup)
    clearPreviewFiles(): void {
        console.log('🧹 PREVIEW FS: Clearing all preview files');
        this._previewFiles.clear();
    }

    // Helper method to get all preview file URIs
    getPreviewFiles(): string[] {
        return Array.from(this._previewFiles.keys());
    }

    private _fireSoon(...events: vscode.FileChangeEvent[]): void {
        this._bufferedEvents.push(...events);

        if (this._fireSoonHandle) {
            clearTimeout(this._fireSoonHandle);
        }

        this._fireSoonHandle = setTimeout(() => {
            this._emitter.fire(this._bufferedEvents);
            this._bufferedEvents.length = 0;
        }, 5);
    }
}

// Singleton instance
let _previewFileSystemProvider: PreviewFileSystemProvider | undefined;

export function getPreviewFileSystemProvider(): PreviewFileSystemProvider {
    if (!_previewFileSystemProvider) {
        _previewFileSystemProvider = new PreviewFileSystemProvider();
    }
    return _previewFileSystemProvider;
}