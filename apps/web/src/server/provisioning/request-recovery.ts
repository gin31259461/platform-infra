import { OperationState } from "../../../generated/prisma/client";

type ExistingOperation = {
  id: string;
  state: OperationState;
};

export type ProvisioningRequestAction =
  | { kind: "create" }
  | { kind: "resume"; operationId: string }
  | { kind: "review"; operationId: string; state: OperationState };

export const unresolvedProvisioningStates = [
  OperationState.AUTHORIZED,
  OperationState.DISPATCHED,
  OperationState.RUNNING,
  OperationState.PARTIALLY_FAILED,
  OperationState.UNKNOWN,
] as const;

export function resolveProvisioningRequestAction(
  existing: ExistingOperation[],
): ProvisioningRequestAction {
  const unsafe = existing.find((operation) => operation.state !== OperationState.AUTHORIZED);
  if (unsafe) {
    return { kind: "review", operationId: unsafe.id, state: unsafe.state };
  }
  const resumable = existing[0];
  return resumable
    ? { kind: "resume", operationId: resumable.id }
    : { kind: "create" };
}
