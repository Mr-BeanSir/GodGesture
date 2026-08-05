import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt, timingSafeEqual } from 'node:crypto';
import nodemailer from 'nodemailer';
import type { EmailCodePurpose, RequestEmailCodeResponse } from '@godgesture/shared';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { sha256Hex } from './token.service';

const CODE_LENGTH = 6;

@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async issue(
    email: string,
    purpose: EmailCodePurpose,
  ): Promise<RequestEmailCodeResponse> {
    const normalizedEmail = email.trim().toLowerCase();
    const now = Date.now();
    const ttlSec = this.config.get('EMAIL_CODE_TTL_SEC', { infer: true });
    const cooldownSec = this.config.get('EMAIL_CODE_COOLDOWN_SEC', { infer: true });
    const latest = await this.prisma.emailVerificationCode.findFirst({
      where: { email: normalizedEmail, purpose, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (latest && now - latest.createdAt.getTime() < cooldownSec * 1000) {
      return {
        accepted: true,
        expiresInSec: Math.max(1, Math.ceil((latest.expiresAt.getTime() - now) / 1000)),
        retryAfterSec: Math.max(
          1,
          Math.ceil((latest.createdAt.getTime() + cooldownSec * 1000 - now) / 1000),
        ),
      };
    }

    const code = randomInt(0, 1_000_000).toString().padStart(CODE_LENGTH, '0');
    const record = await this.prisma.emailVerificationCode.create({
      data: {
        email: normalizedEmail,
        purpose,
        codeHash: sha256Hex(code),
        expiresAt: new Date(now + ttlSec * 1000),
      },
    });
    try {
      await this.send(normalizedEmail, purpose, code, ttlSec);
    } catch (error) {
      await this.prisma.emailVerificationCode
        .delete({ where: { id: record.id } })
        .catch(() => undefined);
      if (error instanceof InternalServerErrorException) throw error;
      throw new InternalServerErrorException({ error: 'email_delivery_failed' });
    }
    return {
      accepted: true,
      expiresInSec: ttlSec,
      retryAfterSec: cooldownSec,
    };
  }

  acceptedResponse(): RequestEmailCodeResponse {
    return {
      accepted: true,
      expiresInSec: this.config.get('EMAIL_CODE_TTL_SEC', { infer: true }),
      retryAfterSec: this.config.get('EMAIL_CODE_COOLDOWN_SEC', { infer: true }),
    };
  }

  async consume(
    email: string,
    purpose: EmailCodePurpose,
    code: string,
  ): Promise<void> {
    const normalizedEmail = email.trim().toLowerCase();
    const record = await this.prisma.emailVerificationCode.findFirst({
      where: { email: normalizedEmail, purpose, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    const maxAttempts = this.config.get('EMAIL_CODE_MAX_ATTEMPTS', { infer: true });
    if (!record || record.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException({ error: 'verification_code_invalid' });
    }
    if (record.attempts >= maxAttempts) {
      throw new BadRequestException({ error: 'verification_code_locked' });
    }
    const expected = Buffer.from(record.codeHash, 'utf8');
    const actual = Buffer.from(sha256Hex(code), 'utf8');
    const matches =
      expected.length === actual.length && timingSafeEqual(expected, actual);
    if (!matches) {
      const updated = await this.prisma.emailVerificationCode.updateMany({
        where: { id: record.id, consumedAt: null },
        data: { attempts: { increment: 1 } },
      });
      if (!updated.count) {
        throw new BadRequestException({ error: 'verification_code_invalid' });
      }
      throw new BadRequestException({
        error:
          record.attempts + 1 >= maxAttempts
            ? 'verification_code_locked'
            : 'verification_code_invalid',
      });
    }
    const consumed = await this.prisma.emailVerificationCode.updateMany({
      where: { id: record.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (!consumed.count) {
      throw new BadRequestException({ error: 'verification_code_invalid' });
    }
  }

  private async send(
    email: string,
    purpose: EmailCodePurpose,
    code: string,
    ttlSec: number,
  ): Promise<void> {
    const host = this.config.get('SMTP_HOST', { infer: true });
    const nodeEnv = this.config.get('NODE_ENV', { infer: true });
    if (!host) {
      if (nodeEnv === 'production') {
        throw new InternalServerErrorException({ error: 'email_delivery_unavailable' });
      }
      this.logger.log(
        '[GodGesture][email] ' +
          purpose +
          ' code generated for ' +
          email +
          '; expires in ' +
          ttlSec +
          's (development adapter)',
      );
      return;
    }
    const user = this.config.get('SMTP_USER', { infer: true });
    const password = this.config.get('SMTP_PASSWORD', { infer: true });
    const transport = nodemailer.createTransport({
      host,
      port: this.config.get('SMTP_PORT', { infer: true }),
      secure: this.config.get('SMTP_SECURE', { infer: true }),
      auth: user ? { user, pass: password ?? '' } : undefined,
    });
    const from = this.config.get('SMTP_FROM', { infer: true }) ?? user;
    if (!from) {
      throw new InternalServerErrorException({ error: 'email_delivery_unavailable' });
    }
    const subject =
      purpose === 'register'
        ? 'GodGesture registration verification code'
        : 'GodGesture password reset code';
    await transport.sendMail({
      from,
      to: email,
      subject,
      text:
        'Your GodGesture verification code is ' +
        code +
        '. It expires in ' +
        ttlSec +
        ' seconds.',
    });
  }
}
