/**
 * E2E テスト用のテスト資格情報
 *
 * エージェント(agency)用:
 *   E2E_TEST_USER_EMAIL / E2E_TEST_USER_PASSWORD
 *
 * 求職者(seeker)用:
 *   E2E_TEST_SEEKER_EMAIL / E2E_TEST_SEEKER_PASSWORD
 *
 * セキュリティ:
 *   - 本ファイルは認証情報を直接書かない(環境変数経由)
 *   - 本番 Supabase に対しては絶対に実行しない(maira-dev / ローカルのみ)
 *   - 専用テスト organization + ユーザを事前に作成しておく前提
 */

export type E2ECredentials = {
  email: string;
  password: string;
};

export function getE2ECredentials(): E2ECredentials | null {
  const email = process.env.E2E_TEST_USER_EMAIL;
  const password = process.env.E2E_TEST_USER_PASSWORD;
  if (!email || !password) return null;
  return { email, password };
}

export function getE2ESeekerCredentials(): E2ECredentials | null {
  const email = process.env.E2E_TEST_SEEKER_EMAIL;
  const password = process.env.E2E_TEST_SEEKER_PASSWORD;
  if (!email || !password) return null;
  return { email, password };
}

/** 認証付き spec が storageState として使うファイル */
export const AGENT_STORAGE_STATE_PATH = "e2e/.auth/agent.json";
export const SEEKER_STORAGE_STATE_PATH = "e2e/.auth/seeker.json";
