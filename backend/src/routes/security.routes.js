import express from 'express';
import { param } from 'express-validator';
import {
  triggerScan,
  getScanStatus,
  getSecurityEvents,
} from '../controllers/security.controller.js';
import { protect } from '../middleware/authMiddleware.js';
import validate from '../middleware/validate.js';
import { repoParamValidator } from '../validators/repository.validators.js';
import schemaValidator from '../middleware/schemaValidator.js';
import { contracts } from '../contracts/index.js';

const router = express.Router();

const scanIdValidator = [
  ...repoParamValidator,
  param('scanId')
    .trim()
    .notEmpty()
    .withMessage('Scan ID is required')
    .isUUID()
    .withMessage('Scan ID must be a valid UUID'),
];

// Mount endpoints with protect, contract validation (schemaValidator), and parameter validation (validate)
router.post(
  '/:username/:reponame/security/scan',
  protect,
  ...schemaValidator(contracts.security.scan),
  validate(repoParamValidator),
  triggerScan
);

router.get(
  '/:username/:reponame/security/status/:scanId',
  protect,
  ...schemaValidator(contracts.security.status),
  validate(scanIdValidator),
  getScanStatus
);

router.get(
  '/:username/:reponame/security/events',
  protect,
  ...schemaValidator(contracts.security.events),
  validate(repoParamValidator),
  getSecurityEvents
);

export default router;
