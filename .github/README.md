# cadenway-notification-service

cadenway-notification-service owns everything that tells someone something: in the app, by email or on mobile. NestJS, its own PostgreSQL database (one database and one user in the shared PostgreSQL of the VPS), events over NATS JetStream through `@cadenway/nest-messaging`, internal REST for the API gateway. Local port 3016.

|            |                                                                                                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data       | Notifications and their read state, reminders and their due time, preferences (7 events × 3 channels, digest, Do not disturb), delivery log, the 13 email templates.      |
| API        | Inbox (list, mark read), reminders (create, snooze, mark done), preferences.                                                                                              |
| Emits      | `notification.created`, `reminder.due`                                                                                                                                    |
| Listens to | `task.assigned`, `comment.created (mentions)`, `approval.requested`, `member.invited (invitation email)`, `user.signed-up (verification code)`, `quota.threshold-reached` |
| External   | Email provider, mobile push.                                                                                                                                              |
| Phase      | First version                                                                                                                                                             |

A scheduled job sends reminders, digests and due-date alerts.

## Getting started

Requirements: Node.js LTS and pnpm (versions in `package.json`), and Docker.

1. Clone this repository next to the other Cadenway repositories, flat, in one folder.
2. To run it with the rest of Cadenway, start the stack from `cadenway-ops`; it builds the sibling
   folders, this one included (`core` profile; `full` adds every other service):

   ```bash
   cd ../cadenway-ops/compose
   docker compose -f compose.yaml -f compose.local.yaml --profile core up -d
   ```

3. To work on this repository alone:

   ```bash
   pnpm install
   pnpm start:dev              # http://localhost:3016
   ```

## Checks

Run the narrowest check first; CI runs them all on every pull request.

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test src/modules/<module>      # targeted
pnpm test:integration                    # PostgreSQL and NATS in Docker
pnpm test:coverage
pnpm build
docker compose -f compose.dev.yaml config -q
```

## Contributing

- [Contributing guide](CONTRIBUTING.md): branches, commits, pull requests, releases.
- [Code of conduct](CODE_OF_CONDUCT.md), [security policy](SECURITY.md), [getting help](SUPPORT.md).
- AI assistants follow [AGENTS.md](../AGENTS.md); Claude Code also reads [CLAUDE.md](../CLAUDE.md) and the
  tooling described in [.claude/README.md](../.claude/README.md).

## License

This repository is proprietary. See [LICENSE](../LICENSE) for the rights and restrictions that apply.

## References

- [Interactive mockup](https://claude.ai/artifact/KYRM7AnsYLiBLBLKy8i4HE): every screen, state and interaction.
- [Integration guide](https://claude.ai/artifact/CpJHVCiFfF9j3KbHQ2S1Et): tokens, data shapes, component names.
- [Repositories and packages](https://claude.ai/artifact/BPinmYxoF3mbK8w9BMB43N): what each repository owns, deployment.
