export interface PermissionRequest {
  permissions: string[];
  reason?: string;
  settingsLocalJson?: Record<string, unknown>;
}

export interface PermissionMergeResult {
  settings: Record<string, unknown>;
  added: string[];
  allowList: string[];
}

const PERMISSION_RESULT_VALUES = new Set(["PERMISSION_REQUEST", "permission_request"]);

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

export class PermissionRequestParser {
  parse(rawOutput?: string): PermissionRequest | null {
    if (!rawOutput) return null;

    const trimmedOutput = rawOutput.trim();
    if (!trimmedOutput) return null;

    const fencedMatch = trimmedOutput.match(/```(?:json|jsonc)?\s*\n([\s\S]*?)\n?```/i);
    if (fencedMatch) {
      const result = this.tryParseJSON(fencedMatch[1].trim());
      if (result) return result;
    }

    const directResult = this.tryParseJSON(trimmedOutput);
    if (directResult) return directResult;

    const extractedJSON = this.extractJSONFromText(trimmedOutput);
    if (extractedJSON) {
      const result = this.tryParseJSON(extractedJSON);
      if (result) return result;
    }

    return null;
  }

  private tryParseJSON(text: string): PermissionRequest | null {
    try {
      const parsed = JSON.parse(text);
      if (!isRecord(parsed)) {
        return null;
      }

      const resultField = parsed.result ?? parsed.type;
      if (typeof resultField !== "string" || !PERMISSION_RESULT_VALUES.has(resultField)) {
        return null;
      }

      const permissions = this.extractPermissions(parsed);
      if (!permissions.length) {
        return null;
      }

      const reason = typeof parsed.reason === "string" ? parsed.reason : undefined;
      const settingsLocalJson = this.extractSettingsLocalJson(parsed);

      return {
        permissions,
        reason,
        settingsLocalJson,
      };
    } catch {
      return null;
    }
  }

  private extractPermissions(parsed: Record<string, unknown>): string[] {
    const candidateFields = [
      parsed.permissions_to_add,
      parsed.missing_permissions,
      parsed.permissions,
    ];

    for (const field of candidateFields) {
      if (!Array.isArray(field)) {
        continue;
      }

      const permissions = field
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean);

      if (permissions.length > 0) {
        return permissions;
      }
    }

    return [];
  }

  private extractSettingsLocalJson(parsed: Record<string, unknown>): Record<string, unknown> | undefined {
    const direct = parsed.settings_local_json;
    if (isRecord(direct)) {
      return direct;
    }

    const alt = parsed.settingsLocalJson;
    if (isRecord(alt)) {
      return alt;
    }

    return undefined;
  }

  private extractJSONFromText(text: string): string | null {
    const firstBrace = text.indexOf("{");
    if (firstBrace === -1) return null;

    let braceCount = 0;
    let inString = false;
    let escapeNext = false;

    for (let i = firstBrace; i < text.length; i++) {
      const char = text[i];

      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (char === "\\") {
        escapeNext = true;
        continue;
      }

      if (char === "\"") {
        inString = !inString;
        continue;
      }

      if (inString) continue;

      if (char === "{") {
        braceCount++;
      } else if (char === "}") {
        braceCount--;
        if (braceCount === 0) {
          return text.substring(firstBrace, i + 1);
        }
      }
    }

    return null;
  }
}

const normalizeAllowList = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
};

export const mergePermissionAllows = (
  settings: Record<string, unknown>,
  permissionsToAdd: string[],
): PermissionMergeResult => {
  const permissions = settings.permissions;
  const permissionsObject = isRecord(permissions) ? { ...permissions } : {};

  const currentAllow = normalizeAllowList(permissionsObject.allow);
  const allowSet = new Set(currentAllow);
  const added: string[] = [];

  for (const permission of permissionsToAdd) {
    const trimmed = permission.trim();
    if (!trimmed || allowSet.has(trimmed)) {
      continue;
    }
    allowSet.add(trimmed);
    currentAllow.push(trimmed);
    added.push(trimmed);
  }

  permissionsObject.allow = currentAllow;

  return {
    settings: {
      ...settings,
      permissions: permissionsObject,
    },
    added,
    allowList: currentAllow,
  };
};
