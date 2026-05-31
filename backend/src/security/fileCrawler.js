import fs from 'fs';
import path from 'path';

const IGNORED_DIRS = new Set(['.git', 'node_modules']);
const MAX_FILE_SIZE = 1 * 1024 * 1024; // 1MB limit for safety

// Simple utility to check if file is likely binary
const isBinary = (filePath) => {
  const binaryExtensions = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.zip', '.tar', '.gz', 
    '.mp4', '.mp3', '.exe', '.dll', '.so', '.dylib', '.woff', '.woff2', 
    '.eot', '.ttf', '.map'
  ]);
  return binaryExtensions.has(path.extname(filePath).toLowerCase());
};

export const crawlRepositoryFiles = (repoPath) => {
  const files = [];

  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    const items = fs.readdirSync(dir);
    for (const item of items) {
      if (IGNORED_DIRS.has(item)) continue;
      const fullPath = path.join(dir, item);
      const stats = fs.statSync(fullPath);

      if (stats.isDirectory()) {
        walk(fullPath);
      } else if (stats.isFile()) {
        if (stats.size > MAX_FILE_SIZE) continue;
        if (isBinary(fullPath)) continue;

        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          // Compute a relative path from the repository root
          const relativePath = path.relative(repoPath, fullPath).replace(/\\/g, '/');
          files.push({
            path: relativePath,
            content,
          });
        } catch (err) {
          // Ignore read errors
        }
      }
    }
  };

  walk(repoPath);
  return files;
};
