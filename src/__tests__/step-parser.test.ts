import { StepParser } from '../step-parser';
import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('StepParser', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'stepcat-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should parse steps from a valid plan file', () => {
    const planContent = `# Test Plan

## Step 1: Setup

Setup the project

## Step 2: Implementation

Implement the feature
`;
    const planFile = join(tempDir, 'plan.md');
    writeFileSync(planFile, planContent, 'utf-8');

    const parser = new StepParser(planFile);
    const steps = parser.parseSteps();

    expect(steps).toHaveLength(2);
    expect(steps[0].number).toBe(1);
    expect(steps[0].title).toBe('Setup');
    expect(steps[0].phase).toBe('pending');
    expect(steps[1].number).toBe(2);
    expect(steps[1].title).toBe('Implementation');
    expect(steps[1].phase).toBe('pending');
  });

  it('should detect phase markers', () => {
    const planContent = `# Test Plan

## Step 1: Setup [implementation]

Setup the project

## Step 2: Build [review]

Build the project

## Step 3: Deploy [done]

Deploy the project

## Step 4: Monitor

Monitor the project
`;
    const planFile = join(tempDir, 'plan.md');
    writeFileSync(planFile, planContent, 'utf-8');

    const parser = new StepParser(planFile);
    const steps = parser.parseSteps();

    expect(steps).toHaveLength(4);
    expect(steps[0].phase).toBe('implementation');
    expect(steps[0].title).toBe('Setup');
    expect(steps[1].phase).toBe('review');
    expect(steps[1].title).toBe('Build');
    expect(steps[2].phase).toBe('done');
    expect(steps[2].title).toBe('Deploy');
    expect(steps[3].phase).toBe('pending');
    expect(steps[3].title).toBe('Monitor');
  });

  it('should throw error if no steps found', () => {
    const planContent = `# Test Plan

Just some text without steps
`;
    const planFile = join(tempDir, 'plan.md');
    writeFileSync(planFile, planContent, 'utf-8');

    const parser = new StepParser(planFile);
    expect(() => parser.parseSteps()).toThrow('No steps found');
  });

  it('should throw error for duplicate step numbers', () => {
    const planContent = `# Test Plan

## Step 1: Setup

Setup the project

## Step 1: Duplicate

This is a duplicate
`;
    const planFile = join(tempDir, 'plan.md');
    writeFileSync(planFile, planContent, 'utf-8');

    const parser = new StepParser(planFile);
    expect(() => parser.parseSteps()).toThrow('Duplicate step numbers');
  });

  it('should return plan content', () => {
    const planContent = `# Test Plan

## Step 1: Setup

Setup the project
`;
    const planFile = join(tempDir, 'plan.md');
    writeFileSync(planFile, planContent, 'utf-8');

    const parser = new StepParser(planFile);
    expect(parser.getContent()).toBe(planContent);
  });

  it('should update step phase in the file', () => {
    const planContent = `# Test Plan

## Step 1: Setup

Setup the project

## Step 2: Build

Build the project
`;
    const planFile = join(tempDir, 'plan.md');
    writeFileSync(planFile, planContent, 'utf-8');

    const parser = new StepParser(planFile);
    parser.updateStepPhase(1, 'implementation');

    const updatedParser = new StepParser(planFile);
    const steps = updatedParser.parseSteps();

    expect(steps[0].phase).toBe('implementation');
    expect(steps[0].title).toBe('Setup');
    expect(steps[1].phase).toBe('pending');
  });

  it('should update step phase multiple times', () => {
    const planContent = `# Test Plan

## Step 1: Setup

Setup the project
`;
    const planFile = join(tempDir, 'plan.md');
    writeFileSync(planFile, planContent, 'utf-8');

    const parser = new StepParser(planFile);
    parser.updateStepPhase(1, 'implementation');
    parser.updateStepPhase(1, 'review');
    parser.updateStepPhase(1, 'done');

    const updatedParser = new StepParser(planFile);
    const steps = updatedParser.parseSteps();

    expect(steps[0].phase).toBe('done');
    expect(steps[0].title).toBe('Setup');
  });

  it('should throw error when updating non-existent step', () => {
    const planContent = `# Test Plan

## Step 1: Setup

Setup the project
`;
    const planFile = join(tempDir, 'plan.md');
    writeFileSync(planFile, planContent, 'utf-8');

    const parser = new StepParser(planFile);
    expect(() => parser.updateStepPhase(999, 'done')).toThrow('Step 999 not found');
  });
});
