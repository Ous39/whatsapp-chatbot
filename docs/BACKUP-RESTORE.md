# Backup and restore

For PostgreSQL, take encrypted `pg_dump --format=custom` backups on a schedule, upload them to access-controlled storage, and verify restore drills in an isolated database. Restore with `pg_restore --clean --if-exists --no-owner --dbname=... backup.dump` after pausing API and worker writes.

Back up object storage with bucket versioning and a second-region lifecycle policy. Redis is not the system of record; after restoring PostgreSQL, clear stale queues and enqueue recoverable work from persisted event states. Document recovery point and recovery time objectives per deployment.

Never include `.env`, access tokens, session secrets, or encryption keys inside source archives. The encryption key requires a separate protected backup; losing it makes encrypted provider credentials unrecoverable.
