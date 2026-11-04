import { bytesToHex } from '@nearcash/core';
import { Controller, Get } from '@nestjs/common';
import { CertificatesService } from './certificates.service.ts';

/**
 *   GET /issuer          issuer name and public key (what wallets trust)
 *   GET /denominations   allowed banknote amounts, and {amount, symbol, decimals} for displays
 */
@Controller()
export class CertificatesController {
  constructor(private readonly certificates: CertificatesService) {}

  @Get('issuer')
  async issuer(): Promise<{ name: string; publicKey: string }> {
    return { name: this.certificates.issuerName, publicKey: bytesToHex(await this.certificates.issuerPublicKey()) };
  }

  @Get('denominations')
  async denominations(): Promise<{
    denominations: string[];
    banknotes: { amount: string; symbol: string; decimals: number }[];
  }> {
    const banknotes = await this.certificates.saleDenominations();
    return {
      denominations: banknotes.map((banknote) => banknote.amount.toString()),
      banknotes: banknotes.map((banknote) => ({ ...banknote, amount: banknote.amount.toString() })),
    };
  }
}
