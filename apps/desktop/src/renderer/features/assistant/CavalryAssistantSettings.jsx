import React, { useEffect, useId, useState } from 'react';

import { CavalryIcon } from '../../shared/CavalryIcon.jsx';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asText(value) {
  return String(value == null ? '' : value).trim();
}

function Icon({ name }) {
  return <CavalryIcon name={name} />;
}

function memoryErrorMessage(value, fallback) {
  return (
    asText(value?.error || value?.message || value) ||
    fallback ||
    'Companion memory is unavailable.'
  );
}

export function AssistantSettings({ advisor, onBack, onOpenConnectionSettings }) {
  const memoryFieldId = useId();
  const [memory, setMemory] = useState({
    content: '',
    items: [],
    revision: '',
    memoryEnabled: false,
    allowAutomaticMemory: false,
    path: '',
    folderPath: '',
    fileName: 'memory.md',
    malformed: false,
    diagnostics: []
  });
  const [draft, setDraft] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [allowAutomaticMemory, setAllowAutomaticMemory] = useState(false);
  const [itemDraft, setItemDraft] = useState('');
  const [itemEdits, setItemEdits] = useState({});
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [clearPending, setClearPending] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [conflictMemory, setConflictMemory] = useState(null);

  function applyMemory(nextMemory, options = {}) {
    const next = asObject(nextMemory);
    const normalized = {
      content: String(next.content == null ? '' : next.content),
      items: asArray(next.items),
      revision: asText(next.revision),
      memoryEnabled: next.memoryEnabled === true,
      allowAutomaticMemory: next.allowAutomaticMemory === true,
      path: asText(next.path),
      folderPath: asText(next.folderPath),
      fileName: asText(next.fileName) || 'memory.md',
      malformed: next.malformed === true,
      diagnostics: asArray(next.diagnostics)
    };
    setMemory(normalized);
    if (options.preserveSettingsDraft !== true) {
      setDraft(normalized.content);
      setEnabled(normalized.memoryEnabled);
      setAllowAutomaticMemory(normalized.allowAutomaticMemory);
    }
    setConflictMemory(null);
    setItemEdits((current) =>
      Object.fromEntries(
        normalized.items.map((item) => {
          const id = asText(item?.id);
          return [
            id,
            options.preserveItemEdits === true && Object.prototype.hasOwnProperty.call(current, id)
              ? current[id]
              : asText(item?.text)
          ];
        })
      )
    );
    if (normalized.malformed) {
      setError(
        asText(normalized.diagnostics[0]?.message) ||
          'memory.md is malformed and will not be sent to the model.'
      );
    } else {
      setError('');
    }
  }

  async function loadMemory(command = 'refreshMemory') {
    setLoading(true);
    setError('');
    setNotice('');
    try {
      if (!(advisor && typeof advisor.invoke === 'function')) {
        throw new Error('The local memory service is unavailable.');
      }
      let result = await advisor.invoke(command);
      if (command === 'refreshMemory' && result?.unavailable) {
        result = await advisor.invoke('getMemory');
      }
      if (!(result && result.ok)) throw new Error(memoryErrorMessage(result));
      if (command === 'refreshMemory' && dirty) {
        setConflictMemory(asObject(result.memory));
        setError(
          'You have unsaved memory edits. Load the latest file only if you want to discard them.'
        );
        return;
      }
      applyMemory(result.memory);
      setItemDraft('');
      if (command === 'refreshMemory') setNotice('Reloaded memory.md from disk.');
    } catch (loadError) {
      setError(memoryErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    // This panel is mounted afresh each time it opens, which intentionally
    // reloads memory.md after edits made outside Cavalry.
    void Promise.resolve()
      .then(() => {
        if (!(advisor && typeof advisor.invoke === 'function')) {
          throw new Error('The local memory service is unavailable.');
        }
        return advisor.invoke('getMemory');
      })
      .then((result) => {
        if (!active) return;
        if (!(result && result.ok)) throw new Error(memoryErrorMessage(result));
        const next = asObject(result.memory);
        const normalized = {
          content: String(next.content == null ? '' : next.content),
          items: asArray(next.items),
          revision: asText(next.revision),
          memoryEnabled: next.memoryEnabled === true,
          allowAutomaticMemory: next.allowAutomaticMemory === true,
          path: asText(next.path),
          folderPath: asText(next.folderPath),
          fileName: asText(next.fileName) || 'memory.md',
          malformed: next.malformed === true,
          diagnostics: asArray(next.diagnostics)
        };
        setMemory(normalized);
        setDraft(normalized.content);
        setEnabled(normalized.memoryEnabled);
        setAllowAutomaticMemory(normalized.allowAutomaticMemory);
        setItemEdits(
          Object.fromEntries(normalized.items.map((item) => [asText(item?.id), asText(item?.text)]))
        );
        if (normalized.malformed) {
          setError(
            asText(normalized.diagnostics[0]?.message) ||
              'memory.md is malformed and will not be sent to the model.'
          );
        }
      })
      .catch((loadError) => {
        if (active) setError(memoryErrorMessage(loadError));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [advisor]);

  async function saveMemory(event) {
    event?.preventDefault?.();
    setPending(true);
    setError('');
    setNotice('');
    try {
      const result = await advisor.invoke('saveMemory', {
        content: draft,
        memoryEnabled: enabled,
        allowAutomaticMemory,
        expectedRevision: memory.revision
      });
      if (!(result && result.ok)) {
        if (result?.conflict && result.memory) setConflictMemory(asObject(result.memory));
        throw new Error(memoryErrorMessage(result));
      }
      applyMemory(result.memory, { preserveItemEdits: true });
      setNotice(asText(result.message) || 'Companion memory saved locally.');
    } catch (saveError) {
      setError(memoryErrorMessage(saveError));
    } finally {
      setPending(false);
    }
  }

  async function clearMemory() {
    if (!clearPending) {
      setClearPending(true);
      setNotice('');
      return;
    }
    setPending(true);
    setError('');
    try {
      const result = await advisor.invoke('clearMemory', {
        memoryEnabled: enabled,
        allowAutomaticMemory,
        expectedRevision: memory.revision
      });
      if (!(result && result.ok)) {
        if (result?.conflict && result.memory) setConflictMemory(asObject(result.memory));
        throw new Error(memoryErrorMessage(result));
      }
      applyMemory(result.memory);
      setNotice(asText(result.message) || 'Companion memory cleared.');
      setClearPending(false);
    } catch (clearError) {
      setError(memoryErrorMessage(clearError));
    } finally {
      setPending(false);
    }
  }

  async function openMemory(command) {
    setError('');
    setNotice('');
    try {
      let result = await advisor.invoke(command);
      if (command === 'openMemoryFolder' && result?.unavailable) {
        result = await advisor.invoke('revealMemory');
      }
      if (!(result && result.ok)) throw new Error(memoryErrorMessage(result));
      setNotice(
        asText(result.message) ||
          (command === 'openMemoryFile' ? 'Opened memory.md.' : 'Opened the memory.md folder.')
      );
    } catch (openError) {
      setError(memoryErrorMessage(openError));
    }
  }

  async function mutateMemoryItems(command, payload, successMessage) {
    setPending(true);
    setError('');
    setNotice('');
    try {
      const result = await advisor.invoke(command, {
        ...payload,
        expectedRevision: memory.revision
      });
      if (!(result && result.ok)) {
        if (result?.conflict && result.memory) setConflictMemory(asObject(result.memory));
        throw new Error(memoryErrorMessage(result));
      }
      applyMemory(result.memory, {
        preserveSettingsDraft: true,
        preserveItemEdits: true
      });
      setNotice(asText(result.message) || successMessage);
      return true;
    } catch (mutationError) {
      setError(memoryErrorMessage(mutationError));
      return false;
    } finally {
      setPending(false);
    }
  }

  async function addMemoryItem() {
    const text = asText(itemDraft);
    if (!text) return;
    if (await mutateMemoryItems('createMemoryItem', { item: { text } }, 'Memory item added.')) {
      setItemDraft('');
    }
  }

  async function updateMemoryItem(item) {
    const itemId = asText(item?.id);
    const text = asText(itemEdits[itemId]);
    if (!itemId || !text) return;
    await mutateMemoryItems(
      'updateMemoryItem',
      { itemId, item: { text, tags: asArray(item?.tags), scope: asText(item?.scope) } },
      'Memory item updated.'
    );
  }

  async function deleteMemoryItem(itemId) {
    await mutateMemoryItems('deleteMemoryItem', { itemId }, 'Memory item deleted.');
  }

  function memoryItemDirty(item) {
    return asText(itemEdits[asText(item?.id)]) !== asText(item?.text);
  }

  const settingsDirty =
    draft !== memory.content ||
    enabled !== memory.memoryEnabled ||
    allowAutomaticMemory !== memory.allowAutomaticMemory;
  const itemDirty =
    Boolean(asText(itemDraft)) || memory.items.some((item) => memoryItemDirty(item));
  const dirty = settingsDirty || itemDirty;

  useEffect(() => {
    if (!(advisor && typeof advisor.invoke === 'function')) return undefined;
    let active = true;
    let polling = false;
    const checkForExternalEdit = async () => {
      if (!active || polling || pending) return;
      polling = true;
      try {
        let result = await advisor.invoke('refreshMemory');
        if (result?.unavailable) result = await advisor.invoke('getMemory');
        if (!active || !result?.ok) return;
        const next = asObject(result.memory);
        const nextRevision = asText(next.revision);
        if (!nextRevision || nextRevision === memory.revision) return;
        if (dirty) {
          setConflictMemory(next);
          setError(
            'memory.md changed outside Cavalry. Your draft is untouched; reload before saving or updating an item.'
          );
          return;
        }
        applyMemory(next);
        setNotice('memory.md was refreshed after an external edit.');
      } catch (_error) {
        // Poll failures are intentionally quiet; explicit reload still reports actionable errors.
      } finally {
        polling = false;
      }
    };
    const timer = window.setInterval(() => void checkForExternalEdit(), 2500);
    const handleFocus = () => void checkForExternalEdit();
    window.addEventListener('focus', handleFocus);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', handleFocus);
    };
    // applyMemory is scoped to this mounted settings panel; revision/dirty changes deliberately
    // replace the watcher closure so external content never overwrites an in-progress draft.
  }, [advisor, dirty, memory.revision, pending]);

  function loadConflictMemory() {
    if (!conflictMemory) return;
    applyMemory(conflictMemory);
    setItemDraft('');
    setError('');
    setNotice('Loaded the latest memory.md revision from disk.');
  }

  return (
    <section
      aria-labelledby="cavalry-assistant-settings-title"
      className="cavalry-assistant-settings"
    >
      <header className="cavalry-assistant-settings-heading">
        <button aria-label="Back to chat" className="btn btn-icon" onClick={onBack} type="button">
          <Icon name="arrow_back" />
        </button>
        <div>
          <h2 id="cavalry-assistant-settings-title">Personalization</h2>
          <p>Transparent context stored in your local memory.md file.</p>
        </div>
      </header>

      {loading ? (
        <div className="cavalry-assistant-settings-loading" role="status">
          <Icon name="progress_activity" />
          Loading local memory…
        </div>
      ) : (
        <form className="cavalry-assistant-memory-form" onSubmit={saveMemory}>
          <section className="cavalry-assistant-settings-card">
            <div className="cavalry-assistant-memory-field-heading">
              <label htmlFor={memoryFieldId}>What should Cavalry know about you?</label>
              <span>{draft.length.toLocaleString()} characters</span>
            </div>
            <p>
              Add preferences and lasting context. Cavalry uses it only when relevant instead of
              repeating it in every reply.
            </p>
            <textarea
              aria-describedby={`${memoryFieldId}-help`}
              id={memoryFieldId}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="For example: I prefer concise explanations, and my emergency fund is my top priority."
              rows="10"
              value={draft}
            />
            <small id={`${memoryFieldId}-help`}>
              Cavalry does not sync this file. External edits are picked up before the next request;
              when enabled, its relevant contents are sent to your selected model.
            </small>
            <div className="cavalry-assistant-memory-file">
              <Icon name="description" />
              <span>
                <strong>{memory.fileName}</strong>
                <small title={memory.path}>
                  {memory.path || 'Stored in Cavalry’s local data folder'}
                </small>
              </span>
              <span className="cavalry-assistant-memory-file-actions">
                <button
                  className="btn"
                  onClick={() => void loadMemory('refreshMemory')}
                  type="button"
                >
                  Refresh
                </button>
                <button
                  className="btn"
                  onClick={() => void openMemory('openMemoryFile')}
                  type="button"
                >
                  Open file
                </button>
                <button
                  className="btn"
                  onClick={() => void openMemory('openMemoryFolder')}
                  type="button"
                >
                  Open folder
                </button>
              </span>
            </div>
          </section>

          <section className="cavalry-assistant-settings-card cavalry-assistant-memory-items">
            <div className="cavalry-assistant-memory-field-heading">
              <span className="cavalry-assistant-memory-items-heading">Stable memory items</span>
              <span>{memory.items.length} saved</span>
            </div>
            <p>
              Each item keeps a stable id, so edits and deletions cannot accidentally target a
              different memory.
            </p>
            {memory.items.length ? (
              <div className="cavalry-assistant-memory-item-list">
                {memory.items.map((item) => {
                  const itemId = asText(item?.id);
                  return (
                    <div className="cavalry-assistant-memory-item" key={itemId}>
                      <textarea
                        aria-label={`Memory item ${itemId}`}
                        disabled={pending}
                        onChange={(event) =>
                          setItemEdits((current) => ({
                            ...current,
                            [itemId]: event.target.value
                          }))
                        }
                        rows="3"
                        value={itemEdits[itemId] ?? asText(item?.text)}
                      />
                      <div>
                        <small title={itemId}>{itemId}</small>
                        <button
                          className="btn"
                          disabled={pending || !memoryItemDirty(item)}
                          onClick={() => void updateMemoryItem(item)}
                          type="button"
                        >
                          Update
                        </button>
                        <button
                          className="btn btn-danger"
                          disabled={pending}
                          onClick={() => void deleteMemoryItem(itemId)}
                          type="button"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <small>No structured memory items yet.</small>
            )}
            <div className="cavalry-assistant-memory-item-add">
              <textarea
                aria-label="New memory item"
                disabled={pending}
                onChange={(event) => setItemDraft(event.target.value)}
                placeholder="Add one lasting fact, preference, or goal…"
                rows="3"
                value={itemDraft}
              />
              <button
                className="btn"
                disabled={pending || !asText(itemDraft)}
                onClick={() => void addMemoryItem()}
                type="button"
              >
                Add item
              </button>
            </div>
          </section>

          <section className="cavalry-assistant-settings-card cavalry-assistant-memory-controls">
            <div className="cavalry-assistant-memory-control">
              <span>
                <strong>Enable local memory</strong>
                <small>Include relevant memory in Companion conversations.</small>
              </span>
              <button
                aria-checked={enabled}
                aria-label="Enable local memory"
                className="cavalry-assistant-switch"
                onClick={() => setEnabled((current) => !current)}
                role="switch"
                type="button"
              >
                <span />
              </button>
            </div>
            <div className="cavalry-assistant-memory-control">
              <span>
                <strong>Allow approved updates from chats</strong>
                <small>
                  Permits explicit, reviewable memory actions. Cavalry never writes memories
                  silently.
                </small>
              </span>
              <button
                aria-checked={allowAutomaticMemory}
                aria-label="Allow approved memory updates from chats"
                className="cavalry-assistant-switch"
                onClick={() => setAllowAutomaticMemory((current) => !current)}
                role="switch"
                type="button"
              >
                <span />
              </button>
            </div>
          </section>

          {error ? (
            <div className="cavalry-assistant-settings-message bad" role="alert">
              <Icon name="error" />
              <span>{error}</span>
              <button
                onClick={
                  conflictMemory ? loadConflictMemory : () => void loadMemory('refreshMemory')
                }
                type="button"
              >
                {conflictMemory ? 'Load latest' : 'Retry'}
              </button>
            </div>
          ) : null}
          {notice ? (
            <div className="cavalry-assistant-settings-message good" role="status">
              <Icon name="check_circle" />
              <span>{notice}</span>
            </div>
          ) : null}

          <div className="cavalry-assistant-memory-actions">
            {clearPending ? (
              <span className="cavalry-assistant-memory-clear-confirm">
                Clear every remembered detail?
                <button onClick={() => setClearPending(false)} type="button">
                  Cancel
                </button>
              </span>
            ) : null}
            <button
              className="btn btn-danger"
              disabled={pending || (!draft && !memory.items.length)}
              onClick={clearMemory}
              type="button"
            >
              {clearPending ? 'Confirm clear' : 'Clear memory'}
            </button>
            <button className="btn btn-primary" disabled={pending || !settingsDirty} type="submit">
              {pending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      )}

      <button
        className="cavalry-assistant-connection-link"
        onClick={onOpenConnectionSettings}
        type="button"
      >
        <Icon name="tune" />
        <span>
          <strong>Model and connection settings</strong>
          <small>Provider, API key, local model, vision, and microphone controls</small>
        </span>
        <Icon name="chevron_right" />
      </button>
    </section>
  );
}
