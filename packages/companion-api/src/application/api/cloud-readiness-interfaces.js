export class CompanionApiAuthProvider {
  async authenticateRequest() {
    throw new Error('Companion API production auth provider is not implemented.');
  }
}

export class CompanionApiOAuthProvider extends CompanionApiAuthProvider {
  getAuthorizationUrl() {
    throw new Error('Companion API OAuth authorization URL provider is not implemented.');
  }

  async exchangeAuthorizationCode() {
    throw new Error('Companion API OAuth token exchange is not implemented.');
  }

  async introspectToken() {
    throw new Error('Companion API OAuth token introspection is not implemented.');
  }
}

export class CompanionApiRateLimitStore {
  async consume() {
    throw new Error('Companion API durable rate limit store is not implemented.');
  }
}

export class CompanionApiIdempotencyStore {
  async get() {
    throw new Error('Companion API durable idempotency store is not implemented.');
  }

  async put() {
    throw new Error('Companion API durable idempotency store is not implemented.');
  }
}

export class CompanionApiAuditLogStore {
  async append() {
    throw new Error('Companion API durable audit log store is not implemented.');
  }

  async exportForWorkbook() {
    throw new Error('Companion API durable audit export is not implemented.');
  }
}

export class CompanionApiWorkbookAccessProvider {
  async listWorkbooks() {
    throw new Error('Companion API cloud workbook listing is not implemented.');
  }

  async getWorkbook() {
    throw new Error('Companion API cloud workbook loading is not implemented.');
  }

  async saveWorkbook() {
    throw new Error('Companion API cloud workbook persistence is not implemented.');
  }
}

export class CompanionApiDraftGroupStore {
  async getDraftGroup() {
    throw new Error('Companion API durable draft group store is not implemented.');
  }

  async saveDraftGroup() {
    throw new Error('Companion API durable draft group store is not implemented.');
  }
}

export function createCloudReadinessInterfaces() {
  return {
    authProvider: new CompanionApiOAuthProvider(),
    rateLimitStore: new CompanionApiRateLimitStore(),
    idempotencyStore: new CompanionApiIdempotencyStore(),
    auditLogStore: new CompanionApiAuditLogStore(),
    workbookAccessProvider: new CompanionApiWorkbookAccessProvider(),
    draftGroupStore: new CompanionApiDraftGroupStore()
  };
}
