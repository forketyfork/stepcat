import BetterSqlite3 from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { Plan, DbStep, Iteration, Issue } from './models.js';
import { Storage, IterationUpdate } from './storage.js';
import { migrations } from './migrations.js';

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
      this.ensureMigrationsTable();
      this.runMigrations();
      this.db.pragma('foreign_keys = ON');
    } catch (error) {
      throw new Error(
        `Failed to initialize database at ${dbPath}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private ensureMigrationsTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        appliedAt TEXT NOT NULL
      );
    `);
  }

  private runMigrations(): void {
    const appliedRows = this.db.prepare('SELECT id FROM schema_migrations').all() as Array<{ id: number }>;
    const applied = new Set(appliedRows.map(row => row.id));

    for (const migration of migrations) {
      if (applied.has(migration.id)) {
        continue;
      }

      try {
        migration.up(this.db);
        const appliedAt = new Date().toISOString();
        this.db
          .prepare('INSERT INTO schema_migrations (id, name, appliedAt) VALUES (?, ?, ?)')
          .run(migration.id, migration.name, appliedAt);
      } catch (error) {
        throw new Error(
          `Failed to apply migration ${migration.id} (${migration.name}): ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
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

  createIteration(
    stepId: number,
    iterationNumber: number,
    type: Iteration['type'],
    implementationAgent: 'claude' | 'codex',
    reviewAgent: 'claude' | 'codex' | null
  ): Iteration {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(
      'INSERT INTO iterations (stepId, iterationNumber, type, status, implementationAgent, reviewAgent, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const result = stmt.run(stepId, iterationNumber, type, 'in_progress', implementationAgent, reviewAgent, now, now);
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
      implementationAgent,
      reviewAgent,
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
    if (updates.reviewAgent !== undefined) {
      fields.push('reviewAgent = ?');
      values.push(updates.reviewAgent);
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
