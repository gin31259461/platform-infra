import { describe, expect, it } from "vitest";

import { deriveProvisionedRunnerInstance } from "./instance";

describe("Provisioned Runner instance identity", () => {
  it("derives isolated host identities only from an approved Template and platform Operation ID", () => {
    expect(deriveProvisionedRunnerInstance({
      canonicalName: "gitlab-runners/dotnet",
      operationId: "b08629f8-dfa8-4d2f-a720-3f593b195033",
      workload: "dotnet",
    })).toEqual({
      canonicalName: "gitlab-runners/dotnet",
      containerName: "glr-dotnet-b08629f8dfa8",
      runnerName: "runner-platform-dotnet-b08629f8dfa8",
      runnerUser: "glr-dotnet-b08629f8dfa8",
      serviceName: "glr-dotnet-b08629f8dfa8",
      stackId: "dotnet-b08629f8dfa8",
      workload: "dotnet",
    });
  });

  it("rejects a mismatched or caller-shaped Template identity", () => {
    expect(() => deriveProvisionedRunnerInstance({
      canonicalName: "gitlab-runners/frontend",
      operationId: "b08629f8-dfa8-4d2f-a720-3f593b195033",
      workload: "dotnet",
    })).toThrow("Runner Template identity is inconsistent");
    expect(() => deriveProvisionedRunnerInstance({
      canonicalName: "../../dotnet",
      operationId: "b08629f8-dfa8-4d2f-a720-3f593b195033",
      workload: "dotnet",
    })).toThrow();
  });
});
