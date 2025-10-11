import BetterSqlite3 from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { Plan, DbStep, Iteration, Issue } from './models';
import { Storage, IterationUpdate } from './storage';

export class Database implements Storage {
  private db: BetterSqlite3.Database;

  constructor(workDir: string, databasePath?: string) {
    const dbPath = databasePath || path.join(workDir, '.stepcat', 'executions.db');
    const dbDir = path.dirname(dbPath);

    try {
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }

      this.db = new BetterSqlite3(dbPath);
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('foreign_keys = ON');
      this.initializeSchema();
    } catch (error) {
      throw new Error(
        `Failed to initialize database at ${dbPath}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private initializeSchema(): void {
    this.db.exec(`
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
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        FOREIGN KEY (stepId) REFERENCES steps(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS issues (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        iterationId INTEGER NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('ci_failure', 'codex_review')),
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
  }

  createPlan(planFilePath: string, workDir: string, owner: string, repo: string): Plan {
    const createdAt = new Date().toISOString();
    const stmt = this.db.prepare(
      'INSERT INTO plans (planFilePath, workDir, owner, repo, createdAt) VALUES (?, ?, ?, ?, ?)'
    );
    const result = stmt.run(planFilePath, workDir, owner, repo, createdAt);
    return {
      id: result.lastInsertRowid as number,
      planFilePath,
      workDir,
      owner,
      repo,
      createdAt,
    };
  }

  getPlan(id: number): Plan | undefined {
    const stmt = this.db.prepare('SELECT * FROM plans WHERE id = ?');
    return stmt.get(id) as Plan | undefined;
  }

  createStep(planId: number, stepNumber: number, title: string): DbStep {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(
      'INSERT INTO steps (planId, stepNumber, title, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const result = stmt.run(planId, stepNumber, title, 'pending', now, now);
    return {
      id: result.lastInsertRowid as number,
      planId,
      stepNumber,
      title,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };
  }

  getSteps(planId: number): DbStep[] {
    const stmt = this.db.prepare('SELECT * FROM steps WHERE planId = ? ORDER BY stepNumber');
    return stmt.all(planId) as DbStep[];
  }

  updateStepStatus(stepId: number, status: DbStep['status']): void {
    const updatedAt = new Date().toISOString();
    const stmt = this.db.prepare('UPDATE steps SET status = ?, updatedAt = ? WHERE id = ?');
    stmt.run(status, updatedAt, stepId);
  }

  createIteration(stepId: number, iterationNumber: number, type: Iteration['type']): Iteration {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(
      'INSERT INTO iterations (stepId, iterationNumber, type, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const result = stmt.run(stepId, iterationNumber, type, 'in_progress', now, now);
    return {
      id: result.lastInsertRowid as number,
      stepId,
      iterationNumber,
      type,
      commitSha: null,
      claudeLog: null,
      codexLog: null,
      buildStatus: null,
      reviewStatus: null,
      status: 'in_progress',
      createdAt: now,
      updatedAt: now,
    };
  }

  getIterations(stepId: number): Iteration[] {
    const stmt = this.db.prepare('SELECT * FROM iterations WHERE stepId = ? ORDER BY iterationNumber');
    return stmt.all(stepId) as Iteration[];
  }

  updateIteration(iterationId: number, updates: IterationUpdate): void {
    const updatedAt = new Date().toISOString();
    const fields: string[] = [];
    const values: (string | number | null)[] = [];

    if (updates.commitSha !== undefined) {
      fields.push('commitSha = ?');
      values.push(updates.commitSha);
    }
    if (updates.claudeLog !== undefined) {
      fields.push('claudeLog = ?');
      values.push(updates.claudeLog);
    }
    if (updates.codexLog !== undefined) {
      fields.push('codexLog = ?');
      values.push(updates.codexLog);
    }
    if (updates.buildStatus !== undefined) {
      fields.push('buildStatus = ?');
      values.push(updates.buildStatus);
    }
    if (updates.reviewStatus !== undefined) {
      fields.push('reviewStatus = ?');
      values.push(updates.reviewStatus);
    }
    if (updates.status !== undefined) {
      fields.push('status = ?');
      values.push(updates.status);
    }

    fields.push('updatedAt = ?');
    values.push(updatedAt);
    values.push(iterationId);

    const stmt = this.db.prepare(`UPDATE iterations SET ${fields.join(', ')} WHERE id = ?`);
    stmt.run(...values);
  }

  createIssue(
    iterationId: number,
    type: Issue['type'],
    description: string,
    filePath: string | null = null,
    lineNumber: number | null = null,
    severity: Issue['severity'] = null,
    status: Issue['status'] = 'open'
  ): Issue {
    const createdAt = new Date().toISOString();
    const stmt = this.db.prepare(
      'INSERT INTO issues (iterationId, type, description, filePath, lineNumber, severity, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const result = stmt.run(iterationId, type, description, filePath, lineNumber, severity, status, createdAt);
    return {
      id: result.lastInsertRowid as number,
      iterationId,
      type,
      description,
      filePath,
      lineNumber,
      severity,
      status,
      createdAt,
      resolvedAt: null,
    };
  }

  getIssues(iterationId: number): Issue[] {
    const stmt = this.db.prepare('SELECT * FROM issues WHERE iterationId = ? ORDER BY id');
    return stmt.all(iterationId) as Issue[];
  }

  updateIssueStatus(issueId: number, status: Issue['status'], resolvedAt?: string): void {
    const stmt = this.db.prepare('UPDATE issues SET status = ?, resolvedAt = ? WHERE id = ?');
    stmt.run(status, resolvedAt || null, issueId);
  }

  getOpenIssues(stepId: number): Issue[] {
    const stmt = this.db.prepare(`
      SELECT issues.*
      FROM issues
      JOIN iterations ON issues.iterationId = iterations.id
      WHERE iterations.stepId = ? AND issues.status = 'open'
      ORDER BY issues.id
    `);
    return stmt.all(stepId) as Issue[];
  }

  close(): void {
    this.db.close();
  }
}
