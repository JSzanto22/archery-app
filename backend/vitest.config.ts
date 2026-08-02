import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // These are integration tests against the Docker Postgres from the repo
    // root docker-compose.yml — they share one database, so running files in
    // parallel would let them collide.
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL:
        process.env.DATABASE_URL ??
        'postgresql://archery:archery_dev@localhost:5432/archery',
      // Every request in these tests is this user. env.ts refuses to allow this
      // outside development and test.
      DEV_USER_ID: '22222222-2222-4222-8222-000000000000',
    },
  },
});
