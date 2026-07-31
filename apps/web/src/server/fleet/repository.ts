import type { FleetSnapshot } from "@gitlab-runner-platform/contracts";

export interface FleetRepository {
  getSnapshot(now: Date): Promise<FleetSnapshot>;
}
