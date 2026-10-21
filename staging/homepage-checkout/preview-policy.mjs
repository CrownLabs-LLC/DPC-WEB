// Guards for the isolated QA entrypoint. Never imported by production runtime.
export const STAGING_PROJECT_URL = 'https://hohbsqkmrlhkstojfdgx.supabase.co';
export const QA_EMAIL = /^dpc-homepage-qa-20261020-[a-z0-9-]+@example\.com$/;

export function previewOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port
      || url.pathname !== '/' || url.search || url.hash
      || !/^(?:dpc|dpc-web)-[a-z0-9-]+-brandis-projects-65a11cb6\.vercel\.app$/.test(url.hostname)) {
    throw new Error('homepage_preview_origin_invalid');
  }
  return url.origin;
}

export function assertStagingConfiguration(projectUrl, config, origin) {
  if (projectUrl !== STAGING_PROJECT_URL || config.environment !== 'staging'
      || !config.stripeSecretKey.startsWith('sk_test_')
      || config.turnstileMode !== 'official_dummy') {
    throw new Error('homepage_preview_requires_isolated_staging');
  }
  return previewOrigin(origin);
}

export function allowedFixture(requestOrigin, configuredOrigin, email) {
  return requestOrigin === configuredOrigin && typeof email === 'string'
    && QA_EMAIL.test(email);
}
