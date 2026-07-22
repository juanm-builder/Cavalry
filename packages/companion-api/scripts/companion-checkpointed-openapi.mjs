import yaml from 'js-yaml';

import {
  asString,
  ensureDirectory,
  packagePath,
  readText,
  repoPath,
  validateGeneratedOpenApi,
  validatePublicBaseUrlFromEnv,
  writeJson,
  writeText
} from './companion-beta-utils.mjs';

function fail(message) {
  console.error('Companion checkpointed OpenAPI generation failed:', message);
  process.exit(1);
}

function assertCheckpointedEnv() {
  if (process.env.CAVALRY_COMPANION_CHECKPOINTED_APPLY_ENABLED !== '1') {
    fail(
      'Set CAVALRY_COMPANION_CHECKPOINTED_APPLY_ENABLED=1 to generate the experimental checkpointed OpenAPI.'
    );
  }
}

function addCheckpointedPaths(spec) {
  spec.paths['/v1/workbooks/{workbook_id}/checkpointed-action-plans/execute'] = {
    post: {
      operationId: 'executeCavalryCheckpointedActionPlan',
      summary: 'Apply supported reversible Cavalry actions under a checkpoint.',
      description:
        'This consequential endpoint applies supported financial changes only after Cavalry creates a reversible checkpoint. The user can review or undo the checkpoint in Cavalry. Permanent deletes, raw mutations, safety-setting changes, bank/payment actions, and security-setting changes are not supported.',
      security: [{ OAuth2: ['cavalry.ai.checkpoint.execute'] }],
      'x-openai-isConsequential': true,
      parameters: [
        { $ref: '#/components/parameters/WorkbookId' },
        { $ref: '#/components/parameters/IdempotencyKey' }
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/CheckpointedActionPlanExecuteRequest' },
            examples: {
              reversibleTransaction: {
                value: {
                  action_plan: {
                    cavalry_action_plan_version: '1.0',
                    source: 'chatgpt',
                    date_default: '2026-06-27',
                    currency_default: 'PHP',
                    actions: [
                      {
                        id: 'add_printer_paper',
                        type: 'create_transaction',
                        description: 'Printer paper',
                        amount: 150,
                        currency: 'PHP',
                        direction: 'expense',
                        payment_account_hint: 'Office Cash Account',
                        category_hint: 'Office Supplies'
                      }
                    ]
                  }
                }
              }
            }
          }
        }
      },
      responses: {
        200: {
          description: 'Checkpointed action execution result.',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CheckpointedActionPlanResult' }
            }
          }
        },
        400: { $ref: '#/components/responses/Error' },
        403: { $ref: '#/components/responses/Error' },
        409: { $ref: '#/components/responses/Error' },
        422: { $ref: '#/components/responses/Error' }
      }
    }
  };
  spec.paths['/v1/workbooks/{workbook_id}/checkpoints'] = {
    get: {
      operationId: 'listCavalryCheckpoints',
      summary: 'List recent Cavalry checkpoints.',
      description:
        'Use this to inspect reversible AI-originated checkpoints. This endpoint does not mutate or rollback anything.',
      security: [{ OAuth2: ['cavalry.ai.checkpoint.read'] }],
      'x-openai-isConsequential': false,
      parameters: [
        { $ref: '#/components/parameters/WorkbookId' },
        {
          name: 'limit',
          in: 'query',
          schema: { type: 'integer', minimum: 1, maximum: 50, default: 20 }
        }
      ],
      responses: {
        200: {
          description: 'Checkpoint list.',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/CheckpointListResponse' } }
          }
        },
        403: { $ref: '#/components/responses/Error' }
      }
    }
  };
  spec.paths['/v1/workbooks/{workbook_id}/checkpoints/{checkpoint_id}'] = {
    get: {
      operationId: 'getCavalryCheckpoint',
      summary: 'Read a checkpoint review record.',
      description:
        'Use this to review reversible checkpoint metadata and before/after changes. This endpoint does not rollback anything.',
      security: [{ OAuth2: ['cavalry.ai.checkpoint.read'] }],
      'x-openai-isConsequential': false,
      parameters: [
        { $ref: '#/components/parameters/WorkbookId' },
        { name: 'checkpoint_id', in: 'path', required: true, schema: { type: 'string' } }
      ],
      responses: {
        200: {
          description: 'Checkpoint review record.',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/CheckpointReview' } }
          }
        },
        404: { $ref: '#/components/responses/Error' }
      }
    }
  };
  spec.paths['/v1/workbooks/{workbook_id}/checkpoints/{checkpoint_id}/rollback-preview'] = {
    post: {
      operationId: 'previewCavalryCheckpointRollback',
      summary: 'Preview rollback conflicts for a checkpoint.',
      description:
        'Use this to preview whether Cavalry can safely undo a checkpoint. This endpoint only previews rollback and does not mutate workbook data.',
      security: [{ OAuth2: ['cavalry.ai.checkpoint.read'] }],
      'x-openai-isConsequential': false,
      parameters: [
        { $ref: '#/components/parameters/WorkbookId' },
        { name: 'checkpoint_id', in: 'path', required: true, schema: { type: 'string' } }
      ],
      requestBody: {
        required: false,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                change_ids: { type: 'array', items: { type: 'string' } }
              }
            }
          }
        }
      },
      responses: {
        200: {
          description: 'Rollback preview.',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/RollbackResult' } }
          }
        },
        404: { $ref: '#/components/responses/Error' }
      }
    }
  };
}

function addCheckpointedSchemas(spec) {
  spec.components.securitySchemes.OAuth2.flows.authorizationCode.scopes[
    'cavalry.ai.checkpoint.execute'
  ] = 'Apply supported reversible checkpointed action plans.';
  spec.components.securitySchemes.OAuth2.flows.authorizationCode.scopes[
    'cavalry.ai.checkpoint.read'
  ] = 'Read checkpoint review metadata.';
  spec.components.securitySchemes.OAuth2.flows.authorizationCode.scopes[
    'cavalry.ai.checkpoint.rollback'
  ] = 'Reserved for Cavalry-side rollback confirmation, not granted to GPT by default.';
  Object.assign(spec.components.schemas, {
    CheckpointedActionPlanExecuteRequest: {
      type: 'object',
      additionalProperties: false,
      required: ['action_plan'],
      properties: {
        action_plan: { $ref: '#/components/schemas/CavalryActionPlan' },
        source_prompt: { type: 'string', maxLength: 1000 },
        dry_run: { type: 'boolean', default: false }
      }
    },
    CheckpointedActionPlanResult: {
      type: 'object',
      additionalProperties: true,
      required: ['status', 'summary'],
      properties: {
        status: { type: 'string' },
        checkpoint_id: { type: 'string' },
        checkpoint_review_url: { type: 'string' },
        summary: { $ref: '#/components/schemas/CheckpointSummary' },
        message_for_user: { type: 'string' },
        blocked_actions: { type: 'array', items: { type: 'object' } }
      }
    },
    CheckpointSummary: {
      type: 'object',
      additionalProperties: false,
      properties: {
        total_actions: { type: 'integer' },
        applied: { type: 'integer' },
        blocked: { type: 'integer' },
        needs_review: { type: 'integer' },
        warnings: { type: 'integer' },
        reversible: { type: 'boolean' }
      }
    },
    CheckpointReview: {
      type: 'object',
      additionalProperties: true,
      properties: {
        checkpoint_id: { type: 'string' },
        header: { type: 'string' },
        status: { type: 'string' },
        review_url: { type: 'string' },
        rollback_available: { type: 'boolean' },
        summary: { $ref: '#/components/schemas/CheckpointSummary' }
      }
    },
    CheckpointListResponse: {
      type: 'object',
      additionalProperties: false,
      properties: {
        checkpoints: { type: 'array', items: { $ref: '#/components/schemas/CheckpointReview' } }
      }
    },
    RollbackResult: {
      type: 'object',
      additionalProperties: true,
      properties: {
        checkpoint_id: { type: 'string' },
        status: { type: 'string' },
        rolled_back_changes: { type: 'array', items: { type: 'string' } },
        conflicted_changes: { type: 'array', items: { type: 'object' } }
      }
    }
  });
}

function sanityCheck(text) {
  const forbidden = [
    /\/v1\/workbooks\/\{workbook_id\}\/transactions\s*:/i,
    /\/transactions\/\{transaction_id\}/i,
    /permanently_delete/i,
    /disable_checkpoints/i,
    /Authorization:/i,
    /cavb_[A-Za-z0-9_-]{8}/
  ];
  for (const pattern of forbidden) {
    if (pattern.test(text)) {
      fail(
        'Forbidden raw mutation, permanent-delete, settings, or token-like content found in checkpointed OpenAPI.'
      );
    }
  }
  for (const operationId of [
    'executeCavalryCheckpointedActionPlan',
    'listCavalryCheckpoints',
    'getCavalryCheckpoint',
    'previewCavalryCheckpointRollback'
  ]) {
    if (!text.includes('operationId: ' + operationId)) {
      fail('Missing checkpointed operationId: ' + operationId);
    }
  }
  if (/operationId:\s*rollbackCavalryCheckpoint/i.test(text)) {
    fail('Rollback execution must not be included in the GPT-facing checkpointed spec by default.');
  }
}

try {
  assertCheckpointedEnv();
  const publicBaseUrl = validatePublicBaseUrlFromEnv();
  const source = readText(packagePath('openapi/cavalry-gpt-actions.openapi.yaml'));
  const base = yaml.load(
    source.replace(/servers:\n\s+- url:\s*.+\n/, 'servers:\n  - url: ' + publicBaseUrl + '\n')
  );
  base.info = Object.assign({}, base.info, {
    title: 'Cavalry Companion API - Experimental Checkpointed Actions',
    description:
      'Experimental power-user API for applying supported reversible changes under Cavalry checkpoints. Production cloud ready: false.'
  });
  addCheckpointedPaths(base);
  addCheckpointedSchemas(base);
  const outDir = repoPath('test-artifacts/companion-checkpointed-beta/openapi');
  ensureDirectory(outDir);
  const yamlPath = repoPath(
    'test-artifacts/companion-checkpointed-beta/openapi/cavalry-gpt-actions.checkpointed.openapi.yaml'
  );
  const jsonPath = repoPath(
    'test-artifacts/companion-checkpointed-beta/openapi/cavalry-gpt-actions.checkpointed.openapi.json'
  );
  const text = yaml.dump(base, { lineWidth: 120, noRefs: true });
  sanityCheck(text);
  writeText(yamlPath, text);
  writeJson(jsonPath, base);
  validateGeneratedOpenApi(yamlPath);
  console.log('Companion checkpointed OpenAPI generated:');
  console.log(yamlPath);
  console.log(jsonPath);
} catch (error) {
  fail(error && error.message ? error.message : asString(error));
}
