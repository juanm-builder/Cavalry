// Keeps local advisor process logs private, bounded, and free of request or credential data.

'use strict';

const ADVISOR_LOG_MAX_BYTES = 2 * 1024 * 1024;
const ADVISOR_LOG_TAIL_MAX_CHARS = 20000;
const ADVISOR_LOG_MAX_PENDING_CHARS = 65536;
const ADVISOR_LOG_LIMIT_MARKER = '\n[Advisor log limit reached; further output was not stored.]\n';

function redactAdvisorLogText(value) {
  return String(value == null ? '' : value)
    .replace(
      /^.*(?:["']?(?:prompt|messages?|input|content|request[_ -]?body|image(?:_url)?|audio|transcript)["']?\s*[:=]).*$/gim,
      '[redacted model request content]'
    )
    .replace(/\b(authorization\s*[:=]\s*(?:bearer\s+)?)[^\s,;]+/gi, '$1[redacted]')
    .replace(/\b(bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1[redacted]')
    .replace(
      /((?:--)?(?:api[-_ ]?key|access[-_ ]?token|token|secret|password)\s*(?:[:=]|\s)\s*["']?)[^"'\s,;}]+/gi,
      '$1[redacted]'
    )
    .replace(/([?&](?:api[_-]?key|access[_-]?token|token|key)=)[^&#\s]+/gi, '$1[redacted]')
    .replace(/\b(?:sk|rk|pk|cavb)_[A-Za-z0-9_-]{8,}\b/g, '[redacted-secret]')
    .replace(/\/Users\/[^/\s]+/g, '/Users/[user]')
    .replace(/\/home\/[^/\s]+/g, '/home/[user]')
    .replace(/\b[A-Za-z]:\\Users\\[^\\\s]+/gi, 'C:\\Users\\[user]');
}

async function prepareAdvisorLogFile(fs, path, logPath, maxBytes = ADVISOR_LOG_MAX_BYTES) {
  await fs.mkdir(path.dirname(logPath), { recursive: true, mode: 0o700 });
  let existingBytes = 0;
  try {
    const stats = await fs.stat(logPath);
    existingBytes = Math.max(0, Number(stats && stats.size) || 0);
    if (existingBytes >= maxBytes) {
      await fs.truncate(logPath, 0);
      existingBytes = 0;
    }
    await fs.chmod(logPath, 0o600);
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error;
  }
  return existingBytes;
}

function createBoundedAdvisorLogWriter(logStream, options = {}) {
  const maxBytes = Math.max(1, Number(options.maxBytes) || ADVISOR_LOG_MAX_BYTES);
  let bytesWritten = Math.max(0, Number(options.initialBytes) || 0);
  let capped = bytesWritten >= maxBytes;

  return {
    write(value) {
      const safeText = redactAdvisorLogText(value);
      if (!safeText || capped) return safeText;

      const remainingBytes = Math.max(0, maxBytes - bytesWritten);
      const chunk = Buffer.from(safeText, 'utf8');
      if (chunk.length <= remainingBytes) {
        logStream.write(chunk);
        bytesWritten += chunk.length;
        return safeText;
      }

      const marker = Buffer.from(ADVISOR_LOG_LIMIT_MARKER, 'utf8');
      const output =
        remainingBytes >= marker.length
          ? Buffer.concat([chunk.subarray(0, remainingBytes - marker.length), marker])
          : marker.subarray(0, remainingBytes);
      if (output.length) {
        logStream.write(output);
        bytesWritten += output.length;
      }
      capped = true;
      return safeText;
    },
    get bytesWritten() {
      return bytesWritten;
    },
    get capped() {
      return capped;
    }
  };
}

function createAdvisorLogLineCollector(onText, options = {}) {
  const maxPendingChars = Math.max(
    1024,
    Number(options.maxPendingChars) || ADVISOR_LOG_MAX_PENDING_CHARS
  );
  let pending = '';

  return {
    push(value) {
      pending += String(value == null ? '' : value);
      const boundary = Math.max(pending.lastIndexOf('\n'), pending.lastIndexOf('\r'));
      if (boundary >= 0) {
        onText(pending.slice(0, boundary + 1));
        pending = pending.slice(boundary + 1);
      }
      if (pending.length > maxPendingChars) {
        onText('[oversized llama-server log line suppressed]\n');
        pending = '';
      }
    },
    flush() {
      if (pending) {
        onText(pending);
        pending = '';
      }
    }
  };
}

async function createAdvisorProcessLog({ fs, fsSync, path, logPath }) {
  const existingBytes = await prepareAdvisorLogFile(fs, path, logPath);
  const stream = fsSync.createWriteStream(logPath, { flags: 'a', mode: 0o600 });
  const writer = createBoundedAdvisorLogWriter(stream, { initialBytes: existingBytes });
  let collectedText = '';
  const collect = (text) => {
    collectedText += writer.write(text);
    if (collectedText.length > ADVISOR_LOG_TAIL_MAX_CHARS) {
      collectedText = collectedText.slice(-ADVISOR_LOG_TAIL_MAX_CHARS);
    }
  };
  const stdout = createAdvisorLogLineCollector(collect);
  const stderr = createAdvisorLogLineCollector(collect);

  writer.write(`\n[${new Date().toISOString()}] Starting local llama-server process.\n`);
  return {
    attach(child, onExit) {
      child.stdout.on('data', (chunk) => stdout.push(chunk));
      child.stderr.on('data', (chunk) => stderr.push(chunk));
      child.on('exit', (code, signal) => {
        stdout.flush();
        stderr.flush();
        writer.write(
          `\n[${new Date().toISOString()}] llama-server exited with code ${code} signal ${signal || ''}\n`
        );
        stream.end();
        onExit();
      });
    },
    getCollectedText() {
      return collectedText;
    }
  };
}

module.exports = {
  ADVISOR_LOG_MAX_BYTES,
  createAdvisorLogLineCollector,
  createAdvisorProcessLog,
  createBoundedAdvisorLogWriter,
  prepareAdvisorLogFile,
  redactAdvisorLogText
};
