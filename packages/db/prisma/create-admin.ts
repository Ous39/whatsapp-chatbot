// Creates (or resets) an OceanBrown platform administrator with a generated password.
// Usage: pnpm db:create-admin admin@oceanbrown.gm "Full Name"
// The password is printed once. Store it in a password manager and change it after first login.
import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

const db = new PrismaClient();

async function main() {
  const email = String(process.argv[2] ?? "").trim().toLowerCase();
  const name = String(process.argv[3] ?? "OceanBrown Platform Admin").trim().slice(0, 120);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Usage: pnpm db:create-admin <email> ["Full Name"]');
  if (email.endsWith("@oceanbrown.local")) throw new Error("Use a real mailbox you control, not a .local demo address.");
  const password = randomBytes(18).toString("base64url");
  const passwordHash = await bcrypt.hash(password, 12);
  const now = new Date();
  const existing = await db.user.findUnique({ where: { email }, select: { id: true, role: true } });
  if (existing && existing.role !== Role.SUPER_ADMIN) throw new Error(`${email} already exists as ${existing.role}; refusing to promote it.`);
  const user = existing
    ? await db.user.update({ where: { id: existing.id }, data: { passwordHash, passwordChangedAt: now, active: true, failedLoginCount: 0, lockedUntil: null } })
    : await db.user.create({ data: { email, name, passwordHash, role: Role.SUPER_ADMIN, passwordChangedAt: now } });
  await db.auditLog.create({ data: { actorId: null, action: existing ? "platform.admin.reset" : "platform.admin.create", entityType: "User", entityId: user.id, metadata: { email, via: "create-admin" } } });
  console.log(`${existing ? "Reset" : "Created"} platform administrator ${email}`);
  console.log(`Temporary password (shown once): ${password}`);
}

main()
  .catch(e => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
