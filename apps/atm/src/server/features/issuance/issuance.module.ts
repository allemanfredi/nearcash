import { HttpIssuanceClient } from '@nearcash/core';
import { Module } from '@nestjs/common';
import { OPERATOR_LOG, type OperatorLog } from '../../common/operator-log.ts';
import { ATM_CONFIG, type AtmConfig } from '../../config/atm-config.ts';
import { ISSUANCE, TRUSTED_ISSUERS } from './issuance.port.ts';
import { trustedIssuers } from './trusted-issuers.ts';

/** Feature: the connection to the issuance server, and the issuers to trust. */
@Module({
  providers: [
    {
      provide: ISSUANCE,
      inject: [ATM_CONFIG],
      useFactory: ({ issuance }: AtmConfig) => new HttpIssuanceClient(issuance.url, issuance.atmToken),
    },
    {
      provide: TRUSTED_ISSUERS,
      inject: [ATM_CONFIG, ISSUANCE, OPERATOR_LOG],
      useFactory: (config: AtmConfig, issuance: HttpIssuanceClient, log: OperatorLog) =>
        trustedIssuers(config.trustedIssuerKey, issuance, log),
    },
  ],
  exports: [ISSUANCE, TRUSTED_ISSUERS],
})
export class IssuanceModule {}
