import { describe, expect, it } from "vitest";

import { OperationState } from "../../../generated/prisma/client";
import { resolveProvisioningRequestAction } from "./request-recovery";

describe("provisioning request recovery", () => {
  it("resumes an authorized Operation after local preparation failed", () => {
    expect(resolveProvisioningRequestAction([
      { id: "operation-1", state: OperationState.AUTHORIZED },
    ])).toEqual({ kind: "resume", operationId: "operation-1" });
  });

  it("creates another instance when no unresolved Operation remains", () => {
    expect(resolveProvisioningRequestAction([])).toEqual({ kind: "create" });
  });

  it.each([
    OperationState.DISPATCHED,
    OperationState.RUNNING,
    OperationState.PARTIALLY_FAILED,
    OperationState.UNKNOWN,
  ])("requires review for an unresolved %s Operation", (state) => {
    expect(resolveProvisioningRequestAction([
      { id: "operation-1", state },
      { id: "operation-2", state: OperationState.AUTHORIZED },
    ])).toEqual({ kind: "review", operationId: "operation-1", state });
  });
});
