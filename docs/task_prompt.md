# Business Scenrio:

TaskHub serves external applications that submit operations such as document processing, report generation, and data synchronization. Some operations take time. Clients need a reliable way to submit a task, inspect its progress, obtain its result, and receive a webhook when execution ends.
TaskHub supports multiple customers. The business needs clear evidence of successful execution, timely notifications, customer experience, and platform reliability.

# What we need to build:

- Accept task submissions with a task type, payload, customer identifier, and idempotency key.
- Return a task identifier without waiting for execution to finish.
- Execute accepted tasks asynchronously and persist their state.
- Support task status and result retrieval, including failure details.
- Support concurrent submissions, retries, and execution timeouts.
- Define valid lifecycle transitions and recovery behavior after a process restart.

Use Pending, Running, Completed, and Failed as the baseline task states. Add states only when you can justify them.

# Webhook notifications

- Accept or configure a customer webhook URL for task notifications.
- Publish task.completed, task.failed, and task.timed_out events where applicable.
- Include an event ID, task ID, customer ID, event type, timestamp, and relevant outcome details.
- Deliver notifications asynchronously and record each delivery attempt.
- Handle non-success responses, network failures, retries, and duplicate delivery risk.
- Expose the delivery status so an operator can investigate missing notifications.

A completed task and a delivered webhook are separate outcomes. Track both.

# Metrics and observability

Provide a way to inspect technical and business metrics. Measure latencies and show p50, p96, and p99 for meaningful durations. State each metric definition, unit, and measurement window.
| Technical metric | Business metric |
| --- | --- |
| API request rate, error rate, and response latency | Task completion and terminal failure rates |
| Queue wait time and execution duration | Task turnaround time and SLA compliance |
| Pending and active task counts | Tasks per customer |
| Webhook latency, attempts, and failure rate | Webhook delivery success and end-to-end notification latency |

Make diagnostics available through structured logs, metrics, or traces. Correlate submission, task execution, and webhook delivery by identifiers.

# Demonstrations

Prepare a local demonstration that covers these scenarios:

| Scenario | Expected evidence |
| --- | --- |
| Normal task | Submission, execution, result retrieval, and successful webhook. |
| Failed task | Recorded failure and corresponding terminal notification. |
| Duplicate submission | Consistent outcome for repeated idempotency keys. |
| Webhook endpoint failure | Recorded attempt, retry behavior, and final delivery status. |
| Metrics | Actual measurements with p50, p96, p99 and business outcomes. |
| Failure investigation | Find an individual task and explain its execution and notification history. |


