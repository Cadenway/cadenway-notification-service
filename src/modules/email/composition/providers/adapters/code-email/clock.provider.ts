import type { ClassProvider } from '@nestjs/common';
import { CLOCK } from '../../../../composition/tokens/code-email/clock.token.js';
import { SystemClock } from '../../../../infrastructure/adapters/clock/system-clock.adapter.js';

/**
 * Constant clockProvider
 *
 * @description
 * Binds the wall clock to the clock port.
 *
 * @type {ClassProvider}
 */
export const clockProvider: ClassProvider = { provide: CLOCK, useClass: SystemClock };
