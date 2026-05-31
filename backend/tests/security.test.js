import request from 'supertest';
import fs from 'fs';
import path from 'path';
import app from '../src/app.js';
import User from '../src/models/User.model.js';
import Repository from '../src/models/Repository.model.js';
import SecurityEvent from '../src/models/SecurityEvent.model.js';
import SagaState from '../src/models/SagaState.model.js';
import { crawlRepositoryFiles } from '../src/security/fileCrawler.js';
import { scanContent, checkEnvFile } from '../src/security/secretScanner.js';
import { scanDependencies, detectVersionMismatches } from '../src/security/dependencyScanner.js';

describe('Repository Security Scanning System', () => {
  let userToken;
  let anotherUserToken;
  let username = 'scanowner';
  let anotherUsername = 'scanvisitor';
  let repoName = 'secure-repo';
  let repoOwnerId;
  let repositoryId;

  const validOwner = {
    username,
    email: 'scanowner@gitnest.com',
    password: 'Password123',
  };

  const validVisitor = {
    username: anotherUsername,
    email: 'scanvisitor@gitnest.com',
    password: 'Password123',
  };

  beforeAll(async () => {
    // 1. Register and Login Owner
    await request(app).post('/api/v1/auth/register').send(validOwner);
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: validOwner.email, password: validOwner.password });
    userToken = loginRes.body.data.token;
    repoOwnerId = loginRes.body.data._id;

    // 2. Register and Login Visitor
    await request(app).post('/api/v1/auth/register').send(validVisitor);
    const loginResVisitor = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: validVisitor.email, password: validVisitor.password });
    anotherUserToken = loginResVisitor.body.data.token;

    // 3. Create a Repository for Owner
    const createRepoRes = await request(app)
      .post('/api/v1/repositories')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        name: repoName,
        description: 'Test scanning repo',
        visibility: 'public',
      });
    
    repositoryId = createRepoRes.body.data._id;

    // 4. Write dummy vulnerable files to the physical repository storage
    const repoPath = path.resolve(process.cwd(), 'repositories', repoOwnerId.toString(), repoName);
    
    // Create folders
    fs.mkdirSync(repoPath, { recursive: true });

    // Write a .env file (should trigger secret scanner checkEnvFile)
    fs.writeFileSync(path.join(repoPath, '.env'), 'API_KEY=sk-12345abcde67890fghij\n');

    // Write a file with a GitHub token
    fs.writeFileSync(
      path.join(repoPath, 'index.js'),
      'const token = "ghp_123456789012345678901234567890123456";\n// comment line\nconst pass = "password";\n'
    );

    // Write a package.json with event-stream dependency
    const packageJson = {
      name: 'vulnerable-pkg',
      dependencies: {
        'event-stream': '^3.3.4',
        'colors': '^1.4.0',
      },
    };
    fs.writeFileSync(path.join(repoPath, 'package.json'), JSON.stringify(packageJson, null, 2));

    // Write package-lock.json with missing colors to trigger version mismatch
    const packageLock = {
      name: 'vulnerable-pkg',
      lockfileVersion: 3,
      packages: {
        'node_modules/event-stream': {
          version: '3.3.4',
        },
      },
    };
    fs.writeFileSync(path.join(repoPath, 'package-lock.json'), JSON.stringify(packageLock, null, 2));
  });

  afterAll(async () => {
    // Cleanup physical files
    if (repoOwnerId) {
      const repoPath = path.resolve(process.cwd(), 'repositories', repoOwnerId.toString(), repoName);
      if (fs.existsSync(repoPath)) {
        fs.rmSync(repoPath, { recursive: true, force: true });
      }
    }
  });

  describe('Unit Scanners', () => {
    test('fileCrawler should crawl text files and ignore binary files/folders', () => {
      const repoPath = path.resolve(process.cwd(), 'repositories', repoOwnerId.toString(), repoName);
      const files = crawlRepositoryFiles(repoPath);

      expect(files.length).toBeGreaterThanOrEqual(4);
      expect(files.find(f => f.path === '.env')).toBeDefined();
      expect(files.find(f => f.path === 'index.js')).toBeDefined();
      expect(files.find(f => f.path === 'package.json')).toBeDefined();
      expect(files.find(f => f.path === 'package-lock.json')).toBeDefined();
    });

    test('secretScanner should identify hardcoded tokens and environment files', () => {
      const content = 'const key = "ghp_123456789012345678901234567890123456";';
      const findings = scanContent(content, 'test.js');

      expect(findings.length).toBe(1);
      expect(findings[0].type).toBe('SECRET_EXPOSED');
      expect(findings[0].severity).toBe('CRITICAL');
      expect(findings[0].message).toContain('GitHub Token');

      const envFinding = checkEnvFile('.env');
      expect(envFinding).not.toBeNull();
      expect(envFinding.severity).toBe('CRITICAL');
    });

    test('dependencyScanner should identify risky packages and version mismatches', () => {
      const packageJson = {
        dependencies: {
          'event-stream': '^3.3.4',
          'colors': '^1.4.0',
        },
      };

      const packageLock = {
        packages: {
          'node_modules/event-stream': {
            version: '3.3.4',
          },
        },
      };

      const depFindings = scanDependencies(packageJson);
      expect(depFindings.length).toBeGreaterThanOrEqual(1);
      expect(depFindings[0].type).toBe('VULNERABLE_DEPENDENCY');
      expect(depFindings[0].severity).toBe('CRITICAL');
      expect(depFindings[0].message).toContain('event-stream');

      const mismatchFindings = detectVersionMismatches(packageJson, packageLock);
      expect(mismatchFindings.length).toBe(1);
      expect(mismatchFindings[0].type).toBe('VERSION_MISMATCH');
      expect(mismatchFindings[0].package).toBe('colors');
    });
  });

  describe('Integration Scanning REST API', () => {
    let scanId;

    test('POST /security/scan should reject unauthorized users', async () => {
      const res = await request(app)
        .post(`/api/v1/repositories/${username}/${repoName}/security/scan`)
        .set('Authorization', `Bearer ${anotherUserToken}`);

      expect(res.statusCode).toBe(403);
      expect(res.body.success).toBe(false);
    });

    test('POST /security/scan should trigger a scan and return 202 Accepted for owner', async () => {
      const res = await request(app)
        .post(`/api/v1/repositories/${username}/${repoName}/security/scan`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.statusCode).toBe(202);
      expect(res.body.success).toBe(true);
      expect(res.body.data.scanId).toBeDefined();
      expect(res.body.data.status).toBe('processing');

      scanId = res.body.data.scanId;
    });

    test('GET /security/status/:scanId should return scan status', async () => {
      // Allow the background saga job to execute. Wait briefly or poll SagaState.
      // Since it runs in the background queue, let's wait up to 1 second
      let statusRes;
      for (let i = 0; i < 10; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        statusRes = await request(app)
          .get(`/api/v1/repositories/${username}/${repoName}/security/status/${scanId}`)
          .set('Authorization', `Bearer ${userToken}`);
        
        if (statusRes.body.data.status === 'completed') {
          break;
        }
      }

      expect(statusRes.statusCode).toBe(200);
      expect(statusRes.body.success).toBe(true);
      expect(statusRes.body.data.scanId).toBe(scanId);
      expect(statusRes.body.data.status).toBe('completed');
      expect(statusRes.body.data.findingsSummary).toBeDefined();
      expect(statusRes.body.data.findingsSummary.totalFindings).toBeGreaterThan(0);
      expect(statusRes.body.data.findingsSummary.riskScore).toBeGreaterThan(0);
    });

    test('GET /security/events should return security event findings list', async () => {
      const res = await request(app)
        .get(`/api/v1/repositories/${username}/${repoName}/security/events`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.events).toBeDefined();
      expect(res.body.data.events.length).toBeGreaterThan(0);

      // Verify that findings include a SECRET_EXPOSED and VULNERABLE_DEPENDENCY
      const types = res.body.data.events.map(e => e.type);
      expect(types).toContain('SECRET_EXPOSED');
      expect(types).toContain('VULNERABLE_DEPENDENCY');
    });

    test('GET /security/events should filter by severity', async () => {
      const res = await request(app)
        .get(`/api/v1/repositories/${username}/${repoName}/security/events?severity=CRITICAL`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      
      const severities = res.body.data.events.map(e => e.severity);
      for (const severity of severities) {
        expect(severity).toBe('CRITICAL');
      }
    });
  });
});
