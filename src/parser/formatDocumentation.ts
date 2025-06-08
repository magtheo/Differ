/**
 * Documentation and examples for the comment-based change format
 */
export class FormatDocumentation {
    
    /**
     * Generate a comprehensive example showing the comment-based format
     */
    public static generateExample(): string {
        return `Add user authentication system

CHANGE: Create User interface
FILE: src/types/user.ts
ACTION: create_file
---
export interface User {
  id: string;
  email: string;
  passwordHash: string;
  isActive: boolean;
}

export interface AuthResult {
  success: boolean;
  user?: User;
  error?: string;
}
---

CHANGE: Add authentication service
FILE: src/services/auth.ts
ACTION: create_file
---
import { User, AuthResult } from '../types/user';

export class AuthService {
  async authenticateUser(email: string, password: string): Promise<AuthResult> {
    const hashedPassword = await this.hashPassword(password);
    // Implementation here
    return { success: true };
  }

  private async hashPassword(password: string): Promise<string> {
    // Hash implementation
    return password; // placeholder
  }
}
---

CHANGE: Add auth import to main app
FILE: src/app.ts
ACTION: add_import
---
import { AuthService } from './services/auth';
---

CHANGE: Replace existing login function
FILE: src/controllers/auth.ts
ACTION: replace_function
TARGET: loginUser
---
export async function loginUser(email: string, password: string): Promise<AuthResult> {
  const authService = new AuthService();
  return await authService.authenticateUser(email, password);
}
---

CHANGE: Add new method to UserService
FILE: src/services/user.ts
ACTION: add_method
CLASS: UserService
TARGET: validateUserCredentials
---
async validateUserCredentials(email: string, password: string): Promise<boolean> {
  const user = await this.findUserByEmail(email);
  if (!user) return false;
  
  return await this.verifyPassword(password, user.passwordHash);
}
---

CHANGE: Update configuration file
FILE: config/auth.json
ACTION: create_file
---
{
  "tokenExpiration": "24h",
  "passwordMinLength": 8,
  "requireEmailVerification": true,
  "maxLoginAttempts": 5
}
---`;
    }

    /**
     * Get comprehensive format documentation
     */
    public static getFormatDocumentation(): string {
        return `# Differ - Comment-Based Change Format Documentation

## Overview

The comment-based format makes it easy for both humans and AI to specify code changes without worrying about JSON syntax errors. Each change is clearly structured with readable field names and explicit code boundaries.

## Basic Structure

Each change follows this pattern:

\`\`\`
CHANGE: Description of what this change does
FILE: path/to/target/file.ext
ACTION: action_type
TARGET: function_or_method_name (when needed)
CLASS: ClassName (for method operations only)
---
code content goes here
---
\`\`\`

## Required Fields

Every change must have:
- **CHANGE**: A clear description of what this change accomplishes
- **FILE**: Relative path to the target file from workspace root
- **ACTION**: The type of operation to perform
- **Code block**: Wrapped in \`---\` markers (except for \`delete_function\`)

## Available Actions

### File Operations
| Action | Description | Requires TARGET | Requires CLASS | Code Block |
|--------|-------------|----------------|----------------|------------|
| \`create_file\` | Creates a new file | No | No | Yes |
| \`add_import\` | Adds import statement | No | No | Yes |

### Function Operations
| Action | Description | Requires TARGET | Requires CLASS | Code Block |
|--------|-------------|----------------|----------------|------------|
| \`add_function\` | Adds new function | No | No | Yes |
| \`replace_function\` | Replaces existing function | Yes | No | Yes |
| \`delete_function\` | Removes a function | Yes | No | No |

### Method Operations (Class-based)
| Action | Description | Requires TARGET | Requires CLASS | Code Block |
|--------|-------------|----------------|----------------|------------|
| \`add_method\` | Adds method to class | Yes | Yes | Yes |
| \`replace_method\` | Replaces existing method | Yes | Yes | Yes |

### General Code Operations
| Action | Description | Requires TARGET | Requires CLASS | Code Block |
|--------|-------------|----------------|----------------|------------|
| \`replace_block\` | Replaces code block | Yes | No | Yes |
| \`insert_after\` | Inserts after target | Yes | No | Yes |
| \`insert_before\` | Inserts before target | Yes | No | Yes |
| \`modify_line\` | Modifies specific line | Yes/LINE | No | Yes |

### Structural Operations
| Action | Description | Requires TARGET | Requires CLASS | Code Block |
|--------|-------------|----------------|----------------|------------|
| \`add_struct\` | Adds struct/interface | No | No | Yes |
| \`add_enum\` | Adds enum/enumeration | No | No | Yes |

## Optional Fields

- **TARGET**: Function name, method name, or code snippet to find
- **CLASS**: Class name (required for method operations)
- **LINE**: Line number for line-based operations

## Field Descriptions

### CHANGE
Brief, descriptive explanation of what this change accomplishes. This helps with:
- Code review and understanding
- Change history tracking
- Debugging when things go wrong

### FILE
Relative path to the target file from the workspace root:
- Use forward slashes (\`/\`) for all platforms
- Start from workspace root (no leading \`./\`)
- Examples: \`src/auth/auth.ts\`, \`config/database.json\`

### ACTION
The type of operation to perform. Choose the most specific action:
- \`create_file\` for completely new files
- \`add_function\` for new functions in existing files
- \`replace_function\` when updating existing functions
- \`add_method\` for new methods in existing classes

### TARGET
Specifies what to find/modify in the file:
- **Function names**: Exact function name (e.g., \`getUserById\`)
- **Method names**: Exact method name (e.g., \`authenticate\`)
- **Code blocks**: Unique code snippet to find and replace
- **Line references**: Use \`LINE: 42\` for line-based operations

### CLASS
Required for method operations (\`add_method\`, \`replace_method\`):
- Use exact class name as it appears in the file
- Case-sensitive
- Examples: \`UserService\`, \`AuthController\`

## Code Blocks

Code must be wrapped in triple-dash markers:

\`\`\`
---
your code here
---
\`\`\`

**Important:**
- The \`---\` must be on separate lines
- No spaces or other characters on the \`---\` lines
- Code can span multiple lines
- Preserve original indentation

## Common Patterns & Examples

### 1. Creating a New Feature Module

\`\`\`
CHANGE: Create user authentication types
FILE: src/types/auth.ts
ACTION: create_file
---
export interface User {
  id: string;
  email: string;
  isActive: boolean;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthToken {
  token: string;
  expiresAt: Date;
}
---
\`\`\`

### 2. Adding to Existing Files

\`\`\`
CHANGE: Add password validation utility
FILE: src/utils/validation.ts
ACTION: add_function
---
export function validatePassword(password: string): boolean {
  return password.length >= 8 && 
         /[A-Z]/.test(password) && 
         /[0-9]/.test(password);
}
---
\`\`\`

### 3. Updating Existing Code

\`\`\`
CHANGE: Improve user validation with better error handling
FILE: src/services/user.ts
ACTION: replace_function
TARGET: validateUser
---
export function validateUser(user: User): ValidationResult {
  const errors: string[] = [];
  
  if (!user.email?.includes('@')) {
    errors.push('Invalid email format');
  }
  
  if (!user.password || user.password.length < 8) {
    errors.push('Password must be at least 8 characters');
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}
---
\`\`\`

### 4. Working with Classes

\`\`\`
CHANGE: Add caching method to UserService
FILE: src/services/user.ts
ACTION: add_method
CLASS: UserService
TARGET: getCachedUser
---
private getCachedUser(id: string): User | null {
  const cached = this.cache.get(\`user_\${id}\`);
  if (cached && cached.expiresAt > new Date()) {
    return cached.user;
  }
  return null;
}
---
\`\`\`

### 5. Configuration and Data Files

\`\`\`
CHANGE: Create database configuration
FILE: config/database.json
ACTION: create_file
---
{
  "development": {
    "host": "localhost",
    "port": 5432,
    "database": "myapp_dev",
    "ssl": false
  },
  "production": {
    "host": "prod-db.example.com",
    "port": 5432,
    "database": "myapp_prod",
    "ssl": true
  }
}
---
\`\`\`

## Error Prevention Tips

### 1. File Paths
- ✅ \`src/auth/auth.ts\`
- ❌ \`./src/auth/auth.ts\`
- ❌ \`src\\auth\\auth.ts\`

### 2. Action Names
- ✅ \`create_file\`
- ❌ \`createFile\`
- ❌ \`new_file\`

### 3. Code Blocks
- ✅ Code wrapped in \`---\` on separate lines
- ❌ \`--- code ---\` on same line
- ❌ Missing closing \`---\`

### 4. Targets
- ✅ Exact function/method names
- ✅ Unique code snippets
- ❌ Partial or ambiguous names

## Validation & Error Handling

The system validates:
- **Structure**: All required fields present
- **Actions**: Valid action names with suggestions for typos
- **Files**: File existence and accessibility
- **Targets**: Function/method existence (optional)
- **Syntax**: Proper code block formatting

Common error messages and solutions:
- "Missing FILE: line" → Add \`FILE: path/to/file.ext\`
- "Invalid action 'add_func'" → Use \`add_function\`
- "Missing code block" → Wrap code in \`---\` markers
- "Target not found" → Check function/method name spelling

## Best Practices

1. **Be Descriptive**: Use clear, specific change descriptions
2. **One Responsibility**: Each change should do one thing well
3. **Logical Order**: Arrange changes in dependency order
4. **Exact Names**: Use precise function/method/class names
5. **Test Incrementally**: Apply smaller change sets first

## Getting Help

- **Show Example**: Click the example button for a working sample
- **Preview Changes**: Use preview to see exactly what will change
- **Validate First**: Check for errors before applying
- **Start Small**: Begin with simple changes to learn the format

For more complex scenarios or questions, refer to the extension documentation or community resources.`;
    }

    /**
     * Get a quick reference card
     */
    public static getQuickReference(): string {
        return `# Quick Reference - Comment-Based Format

## Basic Template
\`\`\`
CHANGE: What this change does
FILE: path/to/file.ext
ACTION: action_type
TARGET: function_name (if needed)
CLASS: ClassName (if needed)
---
code goes here
---
\`\`\`

## Most Common Actions
- \`create_file\` - Create new file
- \`add_function\` - Add new function
- \`replace_function\` - Update existing function
- \`add_import\` - Add import statement
- \`add_method\` - Add method to class
- \`replace_method\` - Update existing method

## Required Fields
- ✅ CHANGE (always)
- ✅ FILE (always)  
- ✅ ACTION (always)
- ✅ Code block in \`---\` (except delete_function)
- ⚠️ TARGET (for replace/delete operations)
- ⚠️ CLASS (for method operations)

## Tips
- Use exact function/method names
- File paths from workspace root
- No quotes needed around values
- Preview before applying`;
    }

    /**
     * Get format validation tips
     */
    public static getValidationTips(): string[] {
        return [
            "Each change must start with 'CHANGE: description'",
            "Use 'FILE: path/to/file.ext' for the target file",
            "Choose a valid ACTION from the available list",
            "Wrap code in --- markers on separate lines",
            "Use exact function names for TARGET field",
            "Specify CLASS name for method operations",
            "File paths should be relative to workspace root",
            "Use forward slashes (/) in file paths",
            "Preview changes before applying them"
        ];
    }

    /**
     * Get troubleshooting guide
     */
    public static getTroubleshootingGuide(): string {
        return `# Troubleshooting Common Issues

## Parse Errors

**"Missing CHANGE line"**
- Add \`CHANGE: description\` at the start of each change block

**"Missing FILE line"**  
- Add \`FILE: path/to/file.ext\` after the CHANGE line

**"Invalid action"**
- Check spelling of ACTION field
- Use underscores (e.g., \`add_function\` not \`addFunction\`)

**"Missing code block"**
- Wrap code in \`---\` markers on separate lines
- Make sure closing \`---\` is present

## Validation Errors

**"File not found"**
- Check file path spelling and capitalization
- Use relative path from workspace root
- Use forward slashes (/) not backslashes (\\)

**"Target not found"**
- Verify function/method name is spelled correctly
- Check that the target actually exists in the file
- Use exact name as it appears in code

**"Class required"**
- Add \`CLASS: ClassName\` for method operations
- Use exact class name as it appears in file

## Application Errors

**"Changes not applied"**
- Check file permissions
- Ensure workspace folder is open
- Verify no syntax errors in generated code

**"Preview not working"**
- File may not exist (use create_file action)
- Check file permissions
- Verify workspace folder is accessible`;
    }
}