// Tests for Advisor composer drafts.

import { describe, expect, it } from 'vitest';
import {
  ADVISOR_COMPOSER_DRAFTS_STORAGE_KEY,
  ADVISOR_NEW_CHAT_DRAFT_KEY,
  clearAdvisorComposerDraftRecord,
  getAdvisorComposerDraftKey,
  getAdvisorComposerDraftRecord,
  hasAdvisorComposerDraftRecord,
  normalizeAdvisorComposerDraftStore,
  setAdvisorComposerDraftRecord
} from '@cavalry/advisor/domain/advisor/composer-drafts.js';

describe('advisor composer drafts', () => {
  it('stores drafts by workbook and thread key without mixing new chat drafts', () => {
    let store = normalizeAdvisorComposerDraftStore(null);
    store = setAdvisorComposerDraftRecord(store, {
      workbookId: 'workbook-one',
      draftKey: ADVISOR_NEW_CHAT_DRAFT_KEY,
      text: 'ask about June spending',
      attachments: [],
      updatedAt: '2026-06-22T00:00:00.000Z'
    });
    store = setAdvisorComposerDraftRecord(store, {
      workbookId: 'workbook-one',
      draftKey: getAdvisorComposerDraftKey('thread-one'),
      text: 'follow up on the rent draft',
      attachments: [],
      updatedAt: '2026-06-22T00:01:00.000Z'
    });

    expect(ADVISOR_COMPOSER_DRAFTS_STORAGE_KEY).toBe('advisorComposerDrafts:v1');
    expect(
      getAdvisorComposerDraftRecord(store, 'workbook-one', ADVISOR_NEW_CHAT_DRAFT_KEY).text
    ).toBe('ask about June spending');
    expect(
      getAdvisorComposerDraftRecord(store, 'workbook-one', getAdvisorComposerDraftKey('thread-one'))
        .text
    ).toBe('follow up on the rent draft');
    expect(hasAdvisorComposerDraftRecord(store, 'workbook-two', ADVISOR_NEW_CHAT_DRAFT_KEY)).toBe(
      false
    );
  });

  it('normalizes persisted attachments and prunes empty drafts', () => {
    let store = setAdvisorComposerDraftRecord(null, {
      workbookId: 'workbook-one',
      draftKey: getAdvisorComposerDraftKey('thread-one'),
      text: '',
      attachments: [
        {
          id: 'doc-one',
          type: 'document',
          filename: 'statement.pdf',
          mimeType: 'application/pdf',
          size: 2048
        }
      ],
      updatedAt: '2026-06-22T00:02:00.000Z'
    });

    expect(
      getAdvisorComposerDraftRecord(store, 'workbook-one', getAdvisorComposerDraftKey('thread-one'))
        .attachments
    ).toEqual([
      {
        id: 'doc-one',
        type: 'document',
        filename: 'statement.pdf',
        mimeType: 'application/pdf',
        size: 2048,
        text: '',
        extractionStatus: '',
        extractionError: ''
      }
    ]);

    store = setAdvisorComposerDraftRecord(store, {
      workbookId: 'workbook-one',
      draftKey: getAdvisorComposerDraftKey('thread-one'),
      text: '   ',
      attachments: [],
      updatedAt: '2026-06-22T00:03:00.000Z'
    });
    expect(store.workbooks).toEqual({});
  });

  it('clears only the requested draft record', () => {
    let store = setAdvisorComposerDraftRecord(null, {
      workbookId: 'workbook-one',
      draftKey: ADVISOR_NEW_CHAT_DRAFT_KEY,
      text: 'new chat draft',
      attachments: [],
      updatedAt: '2026-06-22T00:00:00.000Z'
    });
    store = setAdvisorComposerDraftRecord(store, {
      workbookId: 'workbook-one',
      draftKey: getAdvisorComposerDraftKey('thread-one'),
      text: 'thread draft',
      attachments: [],
      updatedAt: '2026-06-22T00:01:00.000Z'
    });

    store = clearAdvisorComposerDraftRecord(store, 'workbook-one', ADVISOR_NEW_CHAT_DRAFT_KEY);

    expect(hasAdvisorComposerDraftRecord(store, 'workbook-one', ADVISOR_NEW_CHAT_DRAFT_KEY)).toBe(
      false
    );
    expect(
      getAdvisorComposerDraftRecord(store, 'workbook-one', getAdvisorComposerDraftKey('thread-one'))
        .text
    ).toBe('thread draft');
  });
});
