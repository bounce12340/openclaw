import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type WorkflowStep = {
  "continue-on-error"?: boolean;
  id?: string;
  if?: string;
  uses?: string;
};

type WorkflowJob = {
  steps?: WorkflowStep[];
};

type Workflow = {
  jobs?: Record<string, WorkflowJob>;
};

describe("PR CI sweeper workflow", () => {
  it("keeps both app-token minting steps non-fatal when app keys are unavailable", () => {
    const workflow = parse(readFileSync(".github/workflows/pr-ci-sweeper.yml", "utf8")) as Workflow;
    const steps = workflow.jobs?.sweep?.steps ?? [];
    const primary = steps.find((step) => step.id === "app-token");
    const fallback = steps.find((step) => step.id === "app-token-fallback");

    expect(primary).toBeDefined();
    expect(primary?.uses).toBe(
      "actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1",
    );
    expect(primary?.["continue-on-error"]).toBe(true);

    expect(fallback).toBeDefined();
    expect(fallback?.if).toBe("steps.app-token.outcome == 'failure'");
    expect(fallback?.uses).toBe(
      "actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1",
    );
    expect(fallback?.["continue-on-error"]).toBe(true);
  });
});
