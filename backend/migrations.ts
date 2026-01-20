import type BetterSqlite3 from 'better-sqlite3';

export interface Migration {
  id: number;
  name: string;
  up: (db: BetterSqlite3.Database) => void;
}

export const migrations: Migration[] = [
  {
    id: 1,
    name: 'initial_schema',
    up: (db) => {
      db.exec(`
        BEGIN;

        CREATE TABLE IF NOT EXISTS plans (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          planFilePath TEXT NOT NULL,
          workDir TEXT NOT NULL,
          owner TEXT NOT NULL,
          repo TEXT NOT NULL,
          createdAt TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS steps (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          planId INTEGER NOT NULL,
          stepNumber INTEGER NOT NULL,
          title TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('pending', 'in_progress', 'completed', 'failed')),
          createdAt TEXT NOT NULL,
          updatedAt TEXT NOT NULL,
          FOREIGN KEY (planId) REFERENCES plans(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS iterations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          stepId INTEGER NOT NULL,
          iterationNumber INTEGER NOT NULL,
          type TEXT NOT NULL CHECK(type IN ('implementation', 'build_fix', 'review_fix')),
          commitSha TEXT,
          claudeLog TEXT,
          codexLog TEXT,
          buildStatus TEXT CHECK(buildStatus IN ('pending', 'in_progress', 'passed', 'failed')),
          reviewStatus TEXT CHECK(reviewStatus IN ('pending', 'in_progress', 'passed', 'failed')),
          status TEXT NOT NULL CHECK(status IN ('in_progress', 'completed', 'failed')),
          implementationAgent TEXT NOT NULL CHECK(implementationAgent IN ('claude', 'codex')),
          reviewAgent TEXT CHECK(reviewAgent IN ('claude', 'codex')),
          createdAt TEXT NOT NULL,
          updatedAt TEXT NOT NULL,
          FOREIGN KEY (stepId) REFERENCES steps(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS issues (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          iterationId INTEGER NOT NULL,
          type TEXT NOT NULL CHECK(type IN ('ci_failure', 'codex_review', 'permission_request')),
          description TEXT NOT NULL,
          filePath TEXT,
          lineNumber INTEGER,
          severity TEXT CHECK(severity IN ('error', 'warning')),
          status TEXT NOT NULL CHECK(status IN ('open', 'fixed')),
          createdAt TEXT NOT NULL,
          resolvedAt TEXT,
          FOREIGN KEY (iterationId) REFERENCES iterations(id) ON DELETE CASCADE
        );

        COMMIT;
      `);
    },
  },
  {
    id: 2,
    name: 'add_aborted_iteration_status',
    up: (db) => {
      const pragmaOptions = { simple: true } as const;
      const foreignKeysEnabled = db.pragma('foreign_keys', pragmaOptions) === 1;

      db.pragma('foreign_keys = OFF');

      try {
        db.exec(`
          BEGIN;

          CREATE TABLE iterations_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            stepId INTEGER NOT NULL,
            iterationNumber INTEGER NOT NULL,
            type TEXT NOT NULL CHECK(type IN ('implementation', 'build_fix', 'review_fix')),
            commitSha TEXT,
            claudeLog TEXT,
            codexLog TEXT,
            buildStatus TEXT CHECK(buildStatus IN ('pending', 'in_progress', 'passed', 'failed')),
            reviewStatus TEXT CHECK(reviewStatus IN ('pending', 'in_progress', 'passed', 'failed')),
            status TEXT NOT NULL CHECK(status IN ('in_progress', 'completed', 'failed', 'aborted')),
            implementationAgent TEXT NOT NULL CHECK(implementationAgent IN ('claude', 'codex')),
            reviewAgent TEXT CHECK(reviewAgent IN ('claude', 'codex')),
            createdAt TEXT NOT NULL,
            updatedAt TEXT NOT NULL,
            FOREIGN KEY (stepId) REFERENCES steps(id) ON DELETE CASCADE
          );

          INSERT INTO iterations_new (
            id,
            stepId,
            iterationNumber,
            type,
            commitSha,
            claudeLog,
            codexLog,
            buildStatus,
            reviewStatus,
            status,
            implementationAgent,
            reviewAgent,
            createdAt,
            updatedAt
          )
          SELECT
            id,
            stepId,
            iterationNumber,
            type,
            commitSha,
            claudeLog,
            codexLog,
            buildStatus,
            reviewStatus,
            status,
            implementationAgent,
            reviewAgent,
            createdAt,
            updatedAt
          FROM iterations;

          DROP TABLE iterations;

          ALTER TABLE iterations_new RENAME TO iterations;

          COMMIT;
        `);
      } catch (error) {
        db.exec('ROLLBACK;');
        throw error;
      } finally {
        if (foreignKeysEnabled) {
          db.pragma('foreign_keys = ON');
        }
      }
    },
  },
  {
    id: 3,
    name: 'add_merge_conflict_build_status',
    up: (db) => {
      const pragmaOptions = { simple: true } as const;
      const foreignKeysEnabled = db.pragma('foreign_keys', pragmaOptions) === 1;

      db.pragma('foreign_keys = OFF');

      try {
        db.exec(`
          BEGIN;

          CREATE TABLE iterations_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            stepId INTEGER NOT NULL,
            iterationNumber INTEGER NOT NULL,
            type TEXT NOT NULL CHECK(type IN ('implementation', 'build_fix', 'review_fix')),
            commitSha TEXT,
            claudeLog TEXT,
            codexLog TEXT,
            buildStatus TEXT CHECK(buildStatus IN ('pending', 'in_progress', 'passed', 'failed', 'merge_conflict')),
            reviewStatus TEXT CHECK(reviewStatus IN ('pending', 'in_progress', 'passed', 'failed')),
            status TEXT NOT NULL CHECK(status IN ('in_progress', 'completed', 'failed', 'aborted')),
            implementationAgent TEXT NOT NULL CHECK(implementationAgent IN ('claude', 'codex')),
            reviewAgent TEXT CHECK(reviewAgent IN ('claude', 'codex')),
            createdAt TEXT NOT NULL,
            updatedAt TEXT NOT NULL,
            FOREIGN KEY (stepId) REFERENCES steps(id) ON DELETE CASCADE
          );

          INSERT INTO iterations_new (
            id,
            stepId,
            iterationNumber,
            type,
            commitSha,
            claudeLog,
            codexLog,
            buildStatus,
            reviewStatus,
            status,
            implementationAgent,
            reviewAgent,
            createdAt,
            updatedAt
          )
          SELECT
            id,
            stepId,
            iterationNumber,
            type,
            commitSha,
            claudeLog,
            codexLog,
            buildStatus,
            reviewStatus,
            status,
            implementationAgent,
            reviewAgent,
            createdAt,
            updatedAt
          FROM iterations;

          DROP TABLE iterations;

          ALTER TABLE iterations_new RENAME TO iterations;

          CREATE TABLE issues_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            iterationId INTEGER NOT NULL,
            type TEXT NOT NULL CHECK(type IN ('ci_failure', 'codex_review', 'merge_conflict', 'permission_request')),
            description TEXT NOT NULL,
            filePath TEXT,
            lineNumber INTEGER,
            severity TEXT CHECK(severity IN ('error', 'warning')),
            status TEXT NOT NULL CHECK(status IN ('open', 'fixed')),
            createdAt TEXT NOT NULL,
            resolvedAt TEXT,
            FOREIGN KEY (iterationId) REFERENCES iterations(id) ON DELETE CASCADE
          );

          INSERT INTO issues_new (
            id,
            iterationId,
            type,
            description,
            filePath,
            lineNumber,
            severity,
            status,
            createdAt,
            resolvedAt
          )
          SELECT
            id,
            iterationId,
            type,
            description,
            filePath,
            lineNumber,
            severity,
            status,
            createdAt,
            resolvedAt
          FROM issues;

          DROP TABLE issues;

          ALTER TABLE issues_new RENAME TO issues;

          COMMIT;
        `);
      } catch (error) {
        db.exec('ROLLBACK;');
        throw error;
      } finally {
        if (foreignKeysEnabled) {
          db.pragma('foreign_keys = ON');
        }
      }
    },
  },
  {
    id: 4,
    name: 'add_permission_request_issue_type',
    up: (db) => {
      const pragmaOptions = { simple: true } as const;
      const foreignKeysEnabled = db.pragma('foreign_keys', pragmaOptions) === 1;

      db.pragma('foreign_keys = OFF');

      try {
        db.exec(`
          BEGIN;

          CREATE TABLE issues_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            iterationId INTEGER NOT NULL,
            type TEXT NOT NULL CHECK(type IN ('ci_failure', 'codex_review', 'merge_conflict', 'permission_request')),
            description TEXT NOT NULL,
            filePath TEXT,
            lineNumber INTEGER,
            severity TEXT CHECK(severity IN ('error', 'warning')),
            status TEXT NOT NULL CHECK(status IN ('open', 'fixed')),
            createdAt TEXT NOT NULL,
            resolvedAt TEXT,
            FOREIGN KEY (iterationId) REFERENCES iterations(id) ON DELETE CASCADE
          );

          INSERT INTO issues_new (
            id,
            iterationId,
            type,
            description,
            filePath,
            lineNumber,
            severity,
            status,
            createdAt,
            resolvedAt
          )
          SELECT
            id,
            iterationId,
            type,
            description,
            filePath,
            lineNumber,
            severity,
            status,
            createdAt,
            resolvedAt
          FROM issues;

          DROP TABLE issues;

          ALTER TABLE issues_new RENAME TO issues;

          COMMIT;
        `);
      } catch (error) {
        db.exec('ROLLBACK;');
        throw error;
      } finally {
        if (foreignKeysEnabled) {
          db.pragma('foreign_keys = ON');
        }
      }
    },
  },
  {
    id: 5,
    name: 'add_foreign_key_indexes',
    up: (db) => {
      db.exec(`
        BEGIN;

        CREATE INDEX IF NOT EXISTS idx_steps_planId ON steps(planId);
        CREATE INDEX IF NOT EXISTS idx_iterations_stepId ON iterations(stepId);
        CREATE INDEX IF NOT EXISTS idx_issues_iterationId ON issues(iterationId);

        COMMIT;
      `);
    },
  },
];
