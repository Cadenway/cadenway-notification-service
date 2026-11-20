import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { OwnerStateUnavailableInterceptor } from './infrastructure/adapters/http/owner-state-unavailable.interceptor.js';

/**
 * Class PlatformModule
 *
 * @description
 * Owner, inside this service, of the tables the service kit stores in the service's own database:
 * the outbox, processed-ids and versions tables of `@cadenway/nest-messaging/outbox` and the
 * `Idempotency-Key` table of `@cadenway/nest-common/database`. Its persistence layer re-exports them
 * so that drizzle-kit, which reads `src/modules/<module>/infrastructure/persistence/*.schema.ts`
 * only, writes them into the migrations of the service.
 *
 * A global HTTP interceptor maps recognized database availability failures to the documented
 * owner-state problem. The tables are used through the shared kit modules in `AppModule`.
 */
@Module({ providers: [{ provide: APP_INTERCEPTOR, useClass: OwnerStateUnavailableInterceptor }] })
export class PlatformModule {}
