import { readFileSync, writeFileSync } from 'fs';

export type StepPhase = 'pending' | 'implementation' | 'review' | 'done';

export interface Step {
  number: number;
  title: string;
  fullHeader: string;
  phase: StepPhase;
}

export class StepParser {
  private content: string;
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    try {
      this.content = readFileSync(filePath, 'utf-8');
      console.log(`Loaded plan file: ${filePath}`);
      console.log(`File size: ${this.content.length} bytes`);
    } catch (error) {
      throw new Error(
        `Failed to read plan file: ${filePath}\n` +
        `Error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  parseSteps(): Step[] {
    const steps: Step[] = [];
    const lines = this.content.split('\n');

    console.log(`Parsing steps from ${lines.length} lines...`);

    for (const line of lines) {
      const match = line.match(/^##\s+Step\s+(\d+):\s+(.+)$/i);
      if (match) {
        const titleAndStatus = match[2].trim();

        let phase: StepPhase = 'pending';
        let title = titleAndStatus;

        if (/\[done\]\s*$/i.test(titleAndStatus)) {
          phase = 'done';
          title = titleAndStatus.replace(/\s*\[done\]\s*$/i, '').trim();
        } else if (/\[review\]\s*$/i.test(titleAndStatus)) {
          phase = 'review';
          title = titleAndStatus.replace(/\s*\[review\]\s*$/i, '').trim();
        } else if (/\[implementation\]\s*$/i.test(titleAndStatus)) {
          phase = 'implementation';
          title = titleAndStatus.replace(/\s*\[implementation\]\s*$/i, '').trim();
        }

        steps.push({
          number: parseInt(match[1], 10),
          title,
          fullHeader: line.trim(),
          phase
        });
      }
    }

    if (steps.length === 0) {
      throw new Error(
        `No steps found in plan file: ${this.filePath}\n` +
        'Expected format: ## Step N: Description\n' +
        'Example: ## Step 1: Setup Project'
      );
    }

    const sorted = steps.sort((a, b) => a.number - b.number);

    const duplicates = sorted.filter((step, index, arr) =>
      index > 0 && arr[index - 1].number === step.number
    );

    if (duplicates.length > 0) {
      throw new Error(
        `Duplicate step numbers found: ${duplicates.map(s => s.number).join(', ')}`
      );
    }

    const totalSteps = sorted.length;
    const doneSteps = sorted.filter(s => s.phase === 'done').length;
    const pendingSteps = totalSteps - doneSteps;

    console.log(`Found ${totalSteps} steps (${doneSteps} done, ${pendingSteps} pending)`);

    return sorted;
  }

  getContent(): string {
    return this.content;
  }

  updateStepPhase(stepNumber: number, newPhase: StepPhase): void {
    const lines = this.content.split('\n');
    let updated = false;

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^(##\s+Step\s+(\d+):\s+)(.+)$/i);
      if (match && parseInt(match[2], 10) === stepNumber) {
        const prefix = match[1];
        const titleAndStatus = match[3].trim();

        const title = titleAndStatus
          .replace(/\s*\[done\]\s*$/i, '')
          .replace(/\s*\[review\]\s*$/i, '')
          .replace(/\s*\[implementation\]\s*$/i, '')
          .trim();

        let newHeader = `${prefix}${title}`;
        if (newPhase !== 'pending') {
          newHeader += ` [${newPhase}]`;
        }

        lines[i] = newHeader;
        updated = true;
        break;
      }
    }

    if (!updated) {
      throw new Error(`Step ${stepNumber} not found in plan file`);
    }

    this.content = lines.join('\n');
    writeFileSync(this.filePath, this.content, 'utf-8');
    console.log(`Updated step ${stepNumber} to phase: ${newPhase}`);
  }
}
