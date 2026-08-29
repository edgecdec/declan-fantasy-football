/// <reference lib="webworker" />
/**
 * Web Worker running one SLICE of the simulation range off the main thread.
 *
 * Work is split by sim range, not by candidate -- see the note on `simulateSlice`. Each
 * worker runs every candidate over its own slice and returns the raw per-sim records; the
 * main thread concatenates and aggregates. Verified exactly equivalent to a single thread:
 * four 60-sim slices reproduce one 240-sim run bit-for-bit, same ordering, same noise
 * floor.
 *
 * The artifact is sent once per worker and cached. It is ~250 KB of JSON and deriving the
 * typed arrays from it is not free, so re-sending it per job would dominate the runtime.
 */
import { Artifact } from "./engine";
import { OddsRequest, Slice, simulateSlice } from "./candidateOdds";

type InMsg =
  | { kind: "artifact"; artifact: Artifact }
  | { kind: "job"; jobId: number; req: OddsRequest; simOffset: number };

let art: Artifact | null = null;
const post = (m: unknown, transfer?: Transferable[]) =>
  (self as unknown as Worker).postMessage(m, transfer ?? []);

self.onmessage = (e: MessageEvent<InMsg>) => {
  const msg = e.data;
  if (msg.kind === "artifact") {
    art = msg.artifact;
    post({ kind: "ready" });
    return;
  }
  if (msg.kind !== "job") return;
  if (!art) {
    post({ kind: "error", jobId: msg.jobId, message: "worker has no artifact" });
    return;
  }
  try {
    const slice: Slice = simulateSlice(art, msg.req, msg.simOffset);
    // Transfer the typed arrays rather than copying them.
    const transfer: Transferable[] = [
      ...slice.po.map((a) => a.buffer), ...slice.ti.map((a) => a.buffer),
      ...slice.pf.map((a) => a.buffer),
    ];
    post({ kind: "slice", jobId: msg.jobId, simOffset: msg.simOffset, slice }, transfer);
  } catch (err) {
    post({ kind: "error", jobId: msg.jobId,
           message: err instanceof Error ? err.message : String(err) });
  }
};
