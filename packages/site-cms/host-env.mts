/**
 * @file host-env.mts
 * @description Self-contained zero-dependency host environment snapshot helper for `site-cms`.
 */

import os from 'node:os';

export interface HostEnvSnapshot {
  readonly colorScheme: 'dark' | 'light';
  readonly locale: string;
  readonly timeZone: string;
  readonly logicalCpus: number;
  readonly totalRamMb: number;
  readonly platform: NodeJS.Platform;
  readonly probedAt: string;
}

export function getHostEnvironmentSnapshot(): HostEnvSnapshot {
  let locale = 'en-US';
  let timeZone = 'UTC';
  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions();
    locale = resolved.locale || locale;
    timeZone = resolved.timeZone || timeZone;
  } catch {
    // Fallback to safe defaults.
  }

  const cpuCount = os.cpus().length;
  return Object.freeze({
    colorScheme: 'dark',
    locale,
    timeZone,
    logicalCpus: cpuCount > 0 ? cpuCount : 1,
    totalRamMb: Math.round(os.totalmem() / 1048576),
    platform: process.platform,
    probedAt: new Date().toISOString(),
  });
}
