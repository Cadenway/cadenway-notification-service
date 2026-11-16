# Notification worker pilot

The owner and the companion use the same release image. The owner remains the only migration
entry and provides the internal HTTP API, NATS subscriptions, job submission and cron registration.
The companion consumes job queues and sends e-mails. Its HTTP listener binds to loopback for
the container health check. It receives the existing application-role database URL and SMTP
settings.

| Desired state            | `NOTIFICATION_SERVICE_PROCESS_ROLE` | `NOTIFICATION_SERVICE_WORKER_REPLICAS` |
| ------------------------ | ----------------------------------- | -------------------------------------- |
| Combined baseline        | `combined` (default)                | `0` (default)                          |
| Prepare the split        | `api`                               | `0`                                    |
| Run and scale the worker | `api`                               | `1` or `2`                             |

Enable the pilot after deploying the role-aware Service Kit and a GitOps agent that reconciles
the companion. Apply the preparation state first, then confirm the old combined containers
have stopped and the API is healthy. Apply one worker, verify job completion, then scale from
one to two and back to one. Check the earliest queued job, per-process connections and HTTP
readiness at each step.

To roll back, set the worker replicas to zero, wait for the agent to stop both workers or the
single remaining worker, then restore `combined`. Pending and retried jobs remain in PostgreSQL.
The process split keeps existing queue names, schedule keys and event durable names.
