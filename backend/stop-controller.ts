export class StopController {
  private stopAfterStepRequested = false;
  private stopAfterStepTriggered = false;

  requestStopAfterStep(): void {
    this.stopAfterStepRequested = true;
  }

  isStopAfterStepRequested(): boolean {
    return this.stopAfterStepRequested;
  }

  markStopAfterStepTriggered(): void {
    this.stopAfterStepTriggered = true;
  }

  wasStopAfterStepTriggered(): boolean {
    return this.stopAfterStepTriggered;
  }
}
