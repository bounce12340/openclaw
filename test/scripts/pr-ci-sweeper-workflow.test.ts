import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const WORKFLOW = ".github/workflows/pr-ci-sweeper.yml";
const CREATE_GITHUB_APP_TOKEN_V3 =
  "actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1";

type WorkflowStep = {
  "continue-on-error"?: boolean;
  id?: string;
  if?: string;
  uses?: string;
  with?: Record<string, string>;
};

type Workflow = {
  jobs?: {
    sweep?: {
      steps?: WorkflowStep[];
    };
  };
};

function readWorkflow(): Workflow {
  return parse(readFileSync(WORKFLOW, "utf8")) as Workflow;
}

function workflowStep(
  steps: readonly WorkflowStep[],
  index: number,
  context: string,
): WorkflowStep {
  const step = steps[index];
  expect(step, context).toBeDefined();
  return step as WorkflowStep;
}

describe("PR CI Sweeper workflow", () => {
  it("keeps both app-token steps non-fatal when secrets are unavailable", () => {
    const workflow = readFileSync(WORKFLOW, "utf8");
    const steps = readWorkflow().jobs?.sweep?.steps ?? [];
    const primaryTokenStep = workflowStep(steps, 1, "primary app token step");
    const fallbackTokenStep = workflowStep(steps, 2, "fallback app token step");

    expect(primaryTokenStep).toMatchObject({
      id: "app-token",
      uses: CREATE_GITHUB_APP_TOKEN_V3,
      "continue-on-error": true,
      with: { "app-id": "2729701" },
    });
    expect(fallbackTokenStep).toMatchObject({
      id: "app-token-fallback",
      if: "steps.app-token.outcome == 'failure'",
      uses: CREATE_GITHUB_APP_TOKEN_V3,
      "continue-on-error": true,
      with: { "app-id": "2971289" },
    });
    expect(workflow).toContain(
      "${{ steps.app-token.outputs.token || steps.app-token-fallback.outputs.token }}",
    );
  });
});
