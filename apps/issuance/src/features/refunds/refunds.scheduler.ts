import { Inject, Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { ISSUANCE_CONFIG, type IssuanceConfig } from '../../config/issuance-config.ts';
import { RefundsService } from './refunds.service.ts';

/** Runs a refunds sweep every `sweepSeconds` while the server is up (0: never, e.g. in tests). */
@Injectable()
export class RefundsScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly refunds: RefundsService,
    @Inject(ISSUANCE_CONFIG) private readonly config: Pick<IssuanceConfig, 'refunds'>,
  ) {}

  onApplicationBootstrap(): void {
    const seconds = this.config.refunds.sweepSeconds;
    if (seconds <= 0) return;
    // sweep() catches its own errors and never overlaps itself.
    this.timer = setInterval(() => void this.refunds.sweep(), seconds * 1000);
    this.timer.unref(); // never keeps the process alive by itself
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }
}
