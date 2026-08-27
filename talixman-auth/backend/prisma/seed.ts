import { PrismaClient, SectorName } from '@prisma/client';
import * as argon2 from 'argon2';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { createHash, randomBytes } from 'crypto';
import { encryptWithKey, parseHexKey } from '../src/common/crypto/aes-gcm.util';

const prisma = new PrismaClient();

const SECTORS: { name: SectorName; label: string }[] = [
  { name: 'dispatching_electrique', label: 'Dispatching électrique' },
  { name: 'raffinerie', label: 'Raffinerie' },
  { name: 'systeme_ferroviaire', label: 'Système ferroviaire' },
];

function generateRecoveryCodes(count = 10) {
  return Array.from({ length: count }, () => {
    const raw = randomBytes(5).toString('hex').toUpperCase().match(/.{1,5}/g)!.join('-');
    return { raw, hash: createHash('sha256').update(raw).digest('hex') };
  });
}

async function main() {
  for (const sector of SECTORS) {
    await prisma.sector.upsert({
      where: { name: sector.name },
      update: { label: sector.label },
      create: sector,
    });
  }

  const superadminEmail = process.env.SEED_SUPERADMIN_EMAIL;
  const superadminPassword = process.env.SEED_SUPERADMIN_PASSWORD;
  const totpEncKey = process.env.TOTP_ENC_KEY;

  if (!superadminEmail || !superadminPassword || !totpEncKey) {
    throw new Error(
      'SEED_SUPERADMIN_EMAIL, SEED_SUPERADMIN_PASSWORD et TOTP_ENC_KEY doivent être définis (voir .env.example).',
    );
  }

  const existing = await prisma.user.findUnique({ where: { email: superadminEmail } });
  if (existing) {
    console.log(`Superadmin "${superadminEmail}" existe déjà — aucune action TOTP/mot de passe.`);
    console.log(`Seed terminé : ${SECTORS.length} secteurs.`);
    return;
  }

  const key = parseHexKey(totpEncKey);
  const passwordHash = await argon2.hash(superadminPassword, { type: argon2.argon2id });
  const secret = authenticator.generateSecret();
  const totpSecretEnc = encryptWithKey(key, secret);
  const recoveryCodes = generateRecoveryCodes();

  const user = await prisma.user.create({
    data: {
      email: superadminEmail,
      passwordHash,
      role: 'SUPERADMIN',
      status: 'ACTIVE',
      totpSecretEnc,
      totpActivatedAt: new Date(),
      recoveryCodes: {
        create: recoveryCodes.map((c) => ({ codeHash: c.hash })),
      },
    },
  });

  const otpauthUrl = authenticator.keyuri(user.email, 'Talixman Cyber Range', secret);
  const qrPngPath = `${__dirname}/../superadmin-totp-qr.png`;
  await QRCode.toFile(qrPngPath, otpauthUrl, { width: 320 });

  console.log(`Seed terminé : ${SECTORS.length} secteurs, superadmin "${superadminEmail}".`);
  console.log('\n=== Configuration TOTP du superadmin (à faire immédiatement) ===');
  console.log(`QR code enregistré dans : ${qrPngPath}`);
  console.log('Ouvrez ce fichier et scannez-le avec Google Authenticator.');
  console.log(`URI (si vous préférez le saisir manuellement) : ${otpauthUrl}`);
  console.log('\n=== Codes de récupération (à conserver en lieu sûr, usage unique) ===');
  recoveryCodes.forEach((c) => console.log(`  ${c.raw}`));
  console.log('');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
