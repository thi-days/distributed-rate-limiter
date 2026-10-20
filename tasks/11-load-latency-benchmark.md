# 11 — Run reproducible k6 workloads and evaluate limiter latency

## Description

Create reusable k6 workloads for normal traffic, depletion, and outage/recovery, and execute them with direct limiter timing to evaluate the P95 < 10ms target in the local three-instance environment. Keep deterministic correctness assertions in the integration suites. Deliver workload scripts, captured samples, repeated results, and the performance conclusion together; do not expand this task into performance optimization.

## Acceptance criteria

- Reference profile: 100 requests/s through Nginx, separate uniform-100-key and one-key scenarios, default policies, 30s warm-up then 120s measurement, three independent runs, up to 50 VUs.
- Register fixture keys in the startup JSON. Isolate state between runs, but keep it through warm-up and measurement within a run.
- Check status codes, limiter headers, unexpected errors, and participation by all instances. Expected 429s are not availability failures.
- Export workload settings and summaries, including actual rate and dropped iterations. A generator that cannot sustain the profile produces an inconclusive run.
- Record hardware, OS, runtime/container versions and resources, workload settings, sample counts, and repeated results.
- Report the healthy limiter P95 for each reference scenario/run. Exclude warm-up and separate outage traffic and end-to-end HTTP latency.
- Use task 07 timing, including dependency waits. Do not subtract percentiles of different HTTP distributions to infer limiter overhead.
- Record expected 429s and generator limits; insufficient load is inconclusive.
- Report a missed target honestly, with a focused follow-up rather than changing architecture or workload to obtain a pass.

## Dependencies

07, 08, 09.

## Expected tests

- Small smoke runs for multi-key success and single-key depletion.
- Outage/recovery workload distinguishes normal and fallback traffic.
- Verify generated summaries correctly count expected 429s and dropped load.
- Check timing units, warm-up exclusion, and percentile calculation with a small known sample.
- Run both reference scenarios repeatedly and retain summaries and duration samples.
- Verify that failures/outage samples and unsustained-load runs cannot be counted as healthy performance passes.
