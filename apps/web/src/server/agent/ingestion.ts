import {
  hostAgentObservationSchema,
  type HostAgentObservation,
} from "@gitlab-runner-platform/contracts";

import type { HostAgentPrincipal } from "./authentication";

export type ObservationIngestionResult = {
  acceptedStacks: number;
  deliveryId: string;
  status: "accepted" | "duplicate";
};

export interface HostAgentObservationStore {
  persist(principal: HostAgentPrincipal, observation: HostAgentObservation): Promise<ObservationIngestionResult>;
}

export class HostAgentIdentityMismatchError extends Error {
  constructor() {
    super("Credential is not authorized for the observation Host or Runner Stack");
    this.name = "HostAgentIdentityMismatchError";
  }
}

export class InvalidObservationTimeError extends Error {
  constructor() {
    super("Observation timestamp is too far in the future");
    this.name = "InvalidObservationTimeError";
  }
}

export async function ingestHostAgentObservation(
  principal: HostAgentPrincipal,
  input: unknown,
  store: HostAgentObservationStore,
  now: Date,
): Promise<ObservationIngestionResult> {
  const observation = hostAgentObservationSchema.parse(input);
  if (
    observation.hostId !== principal.hostId
    || observation.stacks.length !== 1
    || observation.stacks[0]?.id !== principal.runnerStackId
  ) {
    throw new HostAgentIdentityMismatchError();
  }

  const maximumClockSkewMs = 5 * 60 * 1_000;
  if (new Date(observation.observedAt).getTime() > now.getTime() + maximumClockSkewMs) {
    throw new InvalidObservationTimeError();
  }

  return store.persist(principal, observation);
}
