// Tests for Advisor image attachment normalization.

import { describe, expect, it } from 'vitest';
import {
  ADVISOR_ATTACHMENT_MAX_COUNT,
  ADVISOR_DOCUMENT_ATTACHMENT_ACCEPT,
  ADVISOR_IMAGE_ATTACHMENT_MAX_BYTES,
  ADVISOR_IMAGE_ATTACHMENT_MAX_EDGE,
  ADVISOR_IMAGE_ATTACHMENT_MODEL_MIME_TYPE,
  ADVISOR_IMAGE_ATTACHMENT_MODEL_QUALITY,
  ADVISOR_IMAGE_INTAKE_DEFAULT_PROMPT,
  ADVISOR_IMAGE_INTAKE_VISION_REQUIRED_MESSAGE,
  getAdvisorAttachmentMetadata,
  getAdvisorDocumentAttachmentExportLabel,
  getAdvisorImageAttachmentExportLabel,
  getAdvisorImageAttachmentMetadata,
  getAdvisorImageIntakePrompt,
  normalizeAdvisorAttachments,
  normalizeAdvisorImageAttachments,
  validateAdvisorAttachmentMeta,
  validateAdvisorDocumentAttachmentMeta,
  validateAdvisorImageAttachmentMeta
} from '@cavalry/advisor/domain/advisor/image-attachments.js';

describe('advisor image attachments', () => {
  it('accepts valid image metadata and normalizes export-safe labels', () => {
    const validation = validateAdvisorImageAttachmentMeta({
      name: 'receipt_20260617.jpg',
      type: 'image/jpeg',
      size: 1024 * 1200
    });

    expect(validation).toMatchObject({
      ok: true,
      filename: 'receipt_20260617.jpg',
      mimeType: 'image/jpeg',
      size: 1024 * 1200
    });
    expect(
      getAdvisorImageAttachmentExportLabel({
        filename: 'receipt_20260617.jpg',
        mimeType: 'image/jpeg',
        size: 1024 * 1200,
        width: 1200,
        height: 900,
        dataUrl: 'data:image/jpeg;base64,abc'
      })
    ).toBe('receipt_20260617.jpg - 1.2 MB - 1200x900');
  });

  it('rejects unsupported types, oversized files, and messages over three images', () => {
    expect(
      validateAdvisorImageAttachmentMeta({
        name: 'receipt.gif',
        type: 'image/gif',
        size: 1000
      }).ok
    ).toBe(false);
    expect(
      validateAdvisorImageAttachmentMeta({
        name: 'receipt.jpg',
        type: 'image/jpeg',
        size: ADVISOR_IMAGE_ATTACHMENT_MAX_BYTES + 1
      }).error
    ).toMatch(/larger than the 5 MB/);
    expect(
      validateAdvisorImageAttachmentMeta(
        {
          name: 'receipt.png',
          type: 'image/png',
          size: 1000
        },
        {
          existingCount: 3
        }
      ).error
    ).toMatch(/up to 3 images/);
  });

  it('keeps data URLs for local review while metadata excludes raw image data', () => {
    const normalized = normalizeAdvisorImageAttachments([
      {
        id: 'image-one',
        filename: 'receipt.webp',
        mimeType: 'image/webp',
        size: 900,
        width: 800,
        height: 1000,
        dataUrl: 'data:image/webp;base64,abc'
      }
    ]);

    expect(normalized.attachments[0].dataUrl).toContain('base64');
    expect(getAdvisorImageAttachmentMetadata(normalized.attachments)).toEqual([
      {
        id: 'image-one',
        filename: 'receipt.webp',
        mimeType: 'image/webp',
        size: 900,
        width: 800,
        height: 1000,
        modelWidth: 800,
        modelHeight: 1000,
        modelQuality: ADVISOR_IMAGE_ATTACHMENT_MODEL_QUALITY,
        modelMaxEdge: ADVISOR_IMAGE_ATTACHMENT_MAX_EDGE
      }
    ]);
  });

  it('accepts supported document metadata without raw file data', () => {
    const validation = validateAdvisorDocumentAttachmentMeta({
      name: 'statement.pdf',
      type: 'application/pdf',
      size: 1024 * 800
    });

    expect(validation).toMatchObject({
      ok: true,
      filename: 'statement.pdf',
      mimeType: 'application/pdf',
      size: 1024 * 800
    });
    expect(ADVISOR_DOCUMENT_ATTACHMENT_ACCEPT).toContain('.docx');
    expect(
      getAdvisorDocumentAttachmentExportLabel({
        id: 'doc-one',
        type: 'document',
        filename: 'statement.pdf',
        mimeType: 'application/pdf',
        size: 1024 * 800
      })
    ).toBe('statement.pdf - 800 KB');
    expect(
      getAdvisorAttachmentMetadata([
        {
          id: 'doc-one',
          type: 'document',
          filename: 'statement.pdf',
          mimeType: 'application/pdf',
          size: 1024 * 800,
          text: 'Laptop Purchase - 140000',
          extractionStatus: 'extracted',
          dataUrl: 'data:application/pdf;base64,abc'
        }
      ])
    ).toEqual([
      {
        id: 'doc-one',
        type: 'document',
        filename: 'statement.pdf',
        mimeType: 'application/pdf',
        size: 1024 * 800,
        extractionStatus: 'extracted',
        hasText: true
      }
    ]);
  });

  it('rejects unsupported document types and caps mixed attachment lists', () => {
    expect(
      validateAdvisorAttachmentMeta({
        name: 'archive.zip',
        type: 'application/zip',
        size: 1000
      }).ok
    ).toBe(false);

    const normalized = normalizeAdvisorAttachments([
      {
        id: 'image-one',
        filename: 'receipt.jpg',
        mimeType: 'image/jpeg',
        size: 900,
        width: 100,
        height: 100,
        dataUrl: 'data:image/jpeg;base64,abc'
      },
      {
        id: 'doc-one',
        type: 'document',
        filename: 'statement.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        size: 1200,
        dataUrl: 'data:application/octet-stream;base64,raw'
      }
    ]);

    expect(normalized.errors).toEqual([]);
    expect(normalized.attachments.map((attachment) => attachment.type)).toEqual([
      'image',
      'document'
    ]);
    expect(normalized.attachments[1]).not.toHaveProperty('dataUrl');
    expect(normalized.attachments[1]).toHaveProperty('text', '');

    const tooMany = normalizeAdvisorAttachments(
      Array.from({ length: ADVISOR_ATTACHMENT_MAX_COUNT + 1 }, (_item, index) => ({
        id: 'doc-' + String(index),
        type: 'document',
        filename: 'statement-' + String(index) + '.pdf',
        mimeType: 'application/pdf',
        size: 1000
      }))
    );

    expect(tooMany.attachments).toHaveLength(ADVISOR_ATTACHMENT_MAX_COUNT);
    expect(tooMany.errors[0]).toMatch(/Only the first/);
  });

  it('shares copy constants for the image-only flow', () => {
    expect(getAdvisorImageIntakePrompt('')).toBe(ADVISOR_IMAGE_INTAKE_DEFAULT_PROMPT);
    expect(ADVISOR_IMAGE_INTAKE_VISION_REQUIRED_MESSAGE).toContain('vision-capable');
    expect(ADVISOR_IMAGE_ATTACHMENT_MAX_EDGE).toBe(1536);
    expect(ADVISOR_IMAGE_ATTACHMENT_MODEL_MIME_TYPE).toBe('image/jpeg');
    expect(ADVISOR_IMAGE_ATTACHMENT_MODEL_QUALITY).toBe(0.92);
    expect(ADVISOR_IMAGE_ATTACHMENT_MODEL_QUALITY).toBeGreaterThan(0);
    expect(ADVISOR_IMAGE_ATTACHMENT_MODEL_QUALITY).toBeLessThanOrEqual(1);
  });
});
