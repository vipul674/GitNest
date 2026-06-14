import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import sagaQueue from '../queue/sagaQueue.js';
import { crawlRepositoryFiles } from '../security/fileCrawler.js';
import IndexedSymbol from '../models/IndexedSymbol.model.js';
import { extractSymbolsFromFiles } from './symbolExtractor.js';
import { DependencyGraphBuilder, extractDependencyEdgesFromFiles } from './dependencyGraphBuilder.service.js';
import { ArchitectureMapping } from './architectureMapping.service.js';
import { HealthScoring } from './healthScoring.service.js';
import { PolicyEvaluation } from './policyEvaluation.service.js';

export const REPOSITORY_INDEX_TYPE = 'REPOSITORY_INDEX';

export const buildRepositoryIndexSteps = () => [
  {
    name: 'crawl_and_extract_symbols',
    execute: async (context) => {
      const { userId, repoName } = context;
      const repoPath = path.resolve(process.cwd(), 'repositories', userId, repoName);

      if (!fs.existsSync(repoPath)) {
        throw new Error(`Repository directory does not exist at path: ${repoPath}`);
      }

      const files = crawlRepositoryFiles(repoPath);
      const symbols = extractSymbolsFromFiles(files);
      const dependencyEdges = extractDependencyEdgesFromFiles(files, symbols);

      return { fileCount: files.length, symbols, dependencyEdges };
    },
  },
  {
    name: 'replace_indexed_symbols',
    execute: async (context, session) => {
      const { repositoryId, repositoryName, owner, symbols } = context;
      const indexedAt = new Date();

      await IndexedSymbol.deleteMany({ repositoryId }, { session });

      const documents = symbols.map((symbol) => ({
        repositoryId,
        repositoryName,
        owner,
        filePath: symbol.filePath,
        symbolName: symbol.symbolName,
        symbolType: symbol.symbolType,
        line: symbol.line,
        exportName: symbol.exportName,
        metadata: symbol.metadata,
        indexedAt,
      }));

      if (documents.length > 0) {
        await IndexedSymbol.insertMany(documents, { session });
      }

      return { symbolCount: documents.length, indexedAt };
    },
    compensate: async (context, session) => {
      await IndexedSymbol.deleteMany({ repositoryId: context.repositoryId }, { session });
    },
  },
  {
    name: 'replace_dependency_graph',
    execute: async (context, session) => {
      const { repositoryId, dependencyEdges } = context;
      const { edgeCount } = await DependencyGraphBuilder.replaceEdges({
        repositoryId,
        edges: dependencyEdges,
        session,
      });
      return { dependencyEdgeCount: edgeCount, dependencyEdges: [], symbols: [] };
    },
  },
  {
    name: 'replace_architecture_analysis',
    execute: async (context, session) => {
      const { repositoryId, repositoryName } = context;
      const analysis = await ArchitectureMapping.generateAndPersist({
        repositoryId,
        repositoryName,
        session,
      });

      return {
        architectureRiskScore: analysis.riskScore,
        architectureGeneratedAt: analysis.generatedAt,
      };
    },
  },
  {
    name: 'generate_repository_health',
    execute: async (context, session) => {
      const { repositoryId, repositoryName } = context;
      const health = await HealthScoring.generateAndPersist({
        repositoryId,
        repositoryName,
        session,
      });

      return {
        healthScore: health.overallScore,
        healthCategory: health.healthCategory,
        healthGeneratedAt: health.generatedAt,
      };
    },
  },
  {
    name: 'generate_repository_compliance',
    execute: async (context, session) => {
      const { repositoryId, repositoryName } = context;
      const compliance = await PolicyEvaluation.evaluateAndPersist({
        repositoryId,
        repositoryName,
        session,
      });

      return {
        complianceStatus: compliance.complianceStatus,
        complianceScore: compliance.complianceScore,
        complianceGeneratedAt: compliance.generatedAt,
      };
    },
  },
];

export const triggerRepositoryIndex = async ({ userId, repositoryId, repositoryName, owner }) => {
  const indexId = uuidv4();
  const initialContext = {
    userId: userId.toString(),
    repositoryId: repositoryId.toString(),
    repositoryName,
    repoName: repositoryName,
    owner,
    fileCount: 0,
    symbolCount: 0,
    dependencyEdgeCount: 0,
    dependencyEdges: [],
    symbols: [],
  };

  const promise = sagaQueue.enqueue(
    indexId,
    REPOSITORY_INDEX_TYPE,
    buildRepositoryIndexSteps(),
    initialContext,
    { maxRetries: 2, retryDelayMs: 200 }
  );

  return { indexId, promise };
};
