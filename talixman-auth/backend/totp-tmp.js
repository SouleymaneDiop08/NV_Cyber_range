const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const { authenticator } = require('otplib');
(async () => {
  const p = new PrismaClient();
  const u = await p.user.findUnique({ where: { email: process.argv[2] } });
  const key = Buffer.from(process.env.TOTP_ENC_KEY, 'hex');
  const [iv, tag, ct] = u.totpSecretEnc.split(':').map((b) => Buffer.from(b, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  console.log(authenticator.generate(Buffer.concat([d.update(ct), d.final()]).toString('utf8')));
  await p.$disconnect();
})();
