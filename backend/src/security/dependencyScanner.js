const RISKY_PACKAGES = new Map([
  ['event-stream', { reason: 'Known supply chain attack (flatmap-stream)', severity: 'CRITICAL' }],
  ['flatmap-stream', { reason: 'Malicious package injected into event-stream', severity: 'CRITICAL' }],
  ['ua-parser-js', { reason: 'Compromised versions contained cryptominer', severity: 'HIGH' }],
  ['colors', { reason: 'Maintainer sabotaged v1.4.1+ with infinite loop', severity: 'HIGH' }],
  ['faker', { reason: 'Maintainer deleted package contents in v6.6.6', severity: 'HIGH' }],
  ['node-ipc', { reason: 'Maintainer added destructive code in protest', severity: 'CRITICAL' }],
  ['rc', { reason: 'Compromised versions contained credential theft', severity: 'HIGH' }],
  ['coa', { reason: 'Compromised versions contained malware', severity: 'CRITICAL' }],
  ['eslint-scope', { reason: 'Compromised version stole npm tokens', severity: 'CRITICAL' }],
  ['cross-env', { reason: 'Typosquat target — verify package name carefully', severity: 'MEDIUM' }],
]);

/**
 * Scans package.json for risky dependencies.
 * @param {object} packageJson - Parsed package.json content.
 * @returns {Array<{type: string, severity: string, message: string, package: string, metadata: object}>}
 */
export const scanDependencies = (packageJson) => {
  const findings = [];
  if (!packageJson) return findings;

  const allDeps = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };

  for (const [name, version] of Object.entries(allDeps)) {
    const risk = RISKY_PACKAGES.get(name);
    if (risk) {
      findings.push({
        type: 'VULNERABLE_DEPENDENCY',
        severity: risk.severity,
        message: `Risky package "${name}@${version}": ${risk.reason}`,
        package: name,
        metadata: { version, reason: risk.reason },
      });
    }
  }

  return findings;
};

/**
 * Detects version mismatches between package.json and package-lock.json.
 * @param {object} packageJson - Parsed package.json.
 * @param {object} packageLock - Parsed package-lock.json.
 * @returns {Array<{type: string, severity: string, message: string, package: string, metadata: object}>}
 */
export const detectVersionMismatches = (packageJson, packageLock) => {
  const findings = [];
  if (!packageJson || !packageLock) return findings;

  const declaredDeps = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };

  const lockPackages = packageLock.packages?.['']?.dependencies
    || packageLock.dependencies
    || {};

  // For lockfile v3 (packages-based), resolve from top-level packages
  const resolvedVersions = {};
  if (packageLock.packages) {
    for (const [pkgPath, pkgData] of Object.entries(packageLock.packages)) {
      if (pkgPath.startsWith('node_modules/')) {
        const pkgName = pkgPath.replace('node_modules/', '');
        if (!pkgName.includes('node_modules/')) {
          resolvedVersions[pkgName] = pkgData.version;
        }
      }
    }
  } else if (packageLock.dependencies) {
    for (const [name, data] of Object.entries(packageLock.dependencies)) {
      resolvedVersions[name] = data.version;
    }
  }

  for (const [name, declaredRange] of Object.entries(declaredDeps)) {
    const lockedVersion = resolvedVersions[name];
    if (!lockedVersion) {
      findings.push({
        type: 'VERSION_MISMATCH',
        severity: 'LOW',
        message: `Package "${name}" declared in package.json but missing from lock file`,
        package: name,
        metadata: { declared: declaredRange },
      });
    }
  }

  return findings;
};

/**
 * Runs npm audit and parses results (optional, wraps child_process).
 * @param {string} repoPath - Absolute path to repository root.
 * @returns {Promise<Array<{type: string, severity: string, message: string, package: string, metadata: object}>>}
 */
export const runNpmAudit = async (repoPath) => {
  const findings = [];

  try {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);

    const { stdout } = await execFileAsync('npm', ['audit', '--json'], {
      cwd: repoPath,
      timeout: 30000,
    }).catch((err) => ({ stdout: err.stdout || '{}' }));

    const audit = JSON.parse(stdout);
    const vulnerabilities = audit.vulnerabilities || {};

    for (const [name, vuln] of Object.entries(vulnerabilities)) {
      const severityMap = { critical: 'CRITICAL', high: 'HIGH', moderate: 'MEDIUM', low: 'LOW', info: 'LOW' };
      findings.push({
        type: 'VULNERABLE_DEPENDENCY',
        severity: severityMap[vuln.severity] || 'MEDIUM',
        message: `npm audit: "${name}" — ${vuln.title || vuln.severity} vulnerability`,
        package: name,
        metadata: {
          severity: vuln.severity,
          range: vuln.range,
          fixAvailable: vuln.fixAvailable,
        },
      });
    }
  } catch {
    // npm audit not available or failed — skip silently
  }

  return findings;
};

export { RISKY_PACKAGES };
