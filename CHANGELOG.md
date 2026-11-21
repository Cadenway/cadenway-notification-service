# Changelog

## [0.4.0](https://github.com/Cadenway/cadenway-notification-service/compare/v0.3.0...v0.4.0) (2026-11-21)


### Features

* **email:** send the account security e-mails ([#28](https://github.com/Cadenway/cadenway-notification-service/issues/28)) ([e606e0a](https://github.com/Cadenway/cadenway-notification-service/commit/e606e0a02a8ca26577124f5070e9e9aa60649c08))
* **email:** send the invitation e-mail ([#26](https://github.com/Cadenway/cadenway-notification-service/issues/26)) ([f60f8cc](https://github.com/Cadenway/cadenway-notification-service/commit/f60f8cc2e1b5c6cdbec9fa58d0cab5704c99f586))
* **email:** send the two-step verification e-mails ([#30](https://github.com/Cadenway/cadenway-notification-service/issues/30)) ([8c56a27](https://github.com/Cadenway/cadenway-notification-service/commit/8c56a2784fab2512dd949028f10e149c17301c0c))
* **notification:** deliver activity emails with current recipient authorization ([#35](https://github.com/Cadenway/cadenway-notification-service/issues/35)) ([d38cd30](https://github.com/Cadenway/cadenway-notification-service/commit/d38cd30efa8504b7dfae8866f94dbb0281d4a3aa))
* **notification:** deliver inbox preferences and reminders ([#33](https://github.com/Cadenway/cadenway-notification-service/issues/33)) ([08323d6](https://github.com/Cadenway/cadenway-notification-service/commit/08323d6b79c74e51043930c3647eebb850c4a9e0))
* **notifications:** deliver quota threshold emails ([#36](https://github.com/Cadenway/cadenway-notification-service/issues/36)) ([db36a1e](https://github.com/Cadenway/cadenway-notification-service/commit/db36a1e07313d0c45f636ede867c6931e2dcb7f0))


### Bug Fixes

* **email:** omit invitation link identifiers from logs ([#32](https://github.com/Cadenway/cadenway-notification-service/issues/32)) ([360f427](https://github.com/Cadenway/cadenway-notification-service/commit/360f427787f71df9448092c98ab38b36540a3ce2))
* **notification:** omit private inbox cursors from traces ([#34](https://github.com/Cadenway/cadenway-notification-service/issues/34)) ([1eb9b50](https://github.com/Cadenway/cadenway-notification-service/commit/1eb9b50cefbcbc90c0029db9444088962d3be2c3))

## [0.3.0](https://github.com/Cadenway/cadenway-notification-service/compare/v0.2.0...v0.3.0) (2026-11-16)


### Features

* **email:** send the sign-up and sign-in code e-mails ([#21](https://github.com/Cadenway/cadenway-notification-service/issues/21)) ([533f905](https://github.com/Cadenway/cadenway-notification-service/commit/533f905745909210cce750f100660d31074ec620))
* wire messaging and the outbox onto nest-common 0.3.0 ([#19](https://github.com/Cadenway/cadenway-notification-service/issues/19)) ([ff6c49f](https://github.com/Cadenway/cadenway-notification-service/commit/ff6c49fcb3cd936b582c5d85a7e052092ba4abd7))


### Bug Fixes

* **deploy:** keep the migrator url out of the running service ([#22](https://github.com/Cadenway/cadenway-notification-service/issues/22)) ([e4d3a25](https://github.com/Cadenway/cadenway-notification-service/commit/e4d3a2564555a8e6950fbb11fb1030563b8a59fe))

## [0.2.0](https://github.com/Cadenway/cadenway-notification-service/compare/v0.1.0...v0.2.0) (2026-11-15)


### Features

* wire the service onto the published service kit ([#16](https://github.com/Cadenway/cadenway-notification-service/issues/16)) ([bc75b75](https://github.com/Cadenway/cadenway-notification-service/commit/bc75b7545d7b386122fe1c8efc7340ac07217113))

## 0.1.0 (2026-11-12)


### Bug Fixes

* **deploy:** sign the deploy commits with the bot's noreply address ([#3](https://github.com/Cadenway/cadenway-notification-service/issues/3)) ([b16da7e](https://github.com/Cadenway/cadenway-notification-service/commit/b16da7e14168c59c8b17c5cd15da99784230b200))
