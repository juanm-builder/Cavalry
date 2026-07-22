#!/bin/zsh

set -euo pipefail
setopt NO_BG_NICE

APP_NAME="Cavalry LlamaCPP"
LEGACY_APP_NAME="LlamaCPP Launcher"
DEFAULT_HOST="127.0.0.1"
DEFAULT_PORT="8080"
DEFAULT_STARTUP_TIMEOUT="300"
DEFAULT_ALIAS="cavalry-advisor"
DEFAULT_CTX_SIZE="32768"
DEFAULT_GPU_LAYERS="auto"
DEFAULT_FLASH_ATTN="auto"

APP_SUPPORT_DIR="${LLAMA_LAUNCHER_APP_SUPPORT_DIR:-$HOME/Library/Application Support/$APP_NAME}"
LEGACY_APP_SUPPORT_DIR="${LLAMA_LAUNCHER_LEGACY_APP_SUPPORT_DIR:-$HOME/Library/Application Support/$LEGACY_APP_NAME}"
CONFIG_FILE="$APP_SUPPORT_DIR/config.env"
LOG_DIR="$APP_SUPPORT_DIR/logs"
RUN_DIR="$APP_SUPPORT_DIR/run"
LOG_FILE="$LOG_DIR/llama-server.log"
PID_FILE="$RUN_DIR/llama-server.pid"
STARTUP_TIMEOUT="${LLAMA_LAUNCHER_STARTUP_TIMEOUT:-$DEFAULT_STARTUP_TIMEOUT}"
PROGRESS_INTERVAL_SECONDS="${LLAMA_LAUNCHER_PROGRESS_INTERVAL:-5}"
CACHE_DIR="${LLAMA_LAUNCHER_CACHE_DIR:-$HOME/Library/Caches/llama.cpp}"

typeset -i SERVER_STARTED=0
typeset -i LAST_PROGRESS_SAMPLE_SECONDS=0
typeset -i LAST_PROGRESS_BYTES=-1
typeset -i LAST_DOWNLOAD_GROWTH_SECONDS=0
typeset -i DOWNLOAD_IN_PROGRESS=0
typeset -i LAST_LOG_GROWTH_SECONDS=0
typeset -i LAST_LOG_BYTES=-1
SERVER_PID=""
LLAMA_SERVER_RESOLVED=""
LLAMA_SERVER_HELP=""
HOST="$DEFAULT_HOST"
PORT="$DEFAULT_PORT"
MODEL_PATH=""
HF_REPO=""
HF_FILE=""
LLAMA_SERVER_BIN=""
LLAMA_ALIAS=""
LLAMA_API_KEY=""
LLAMA_CTX_SIZE=""
LLAMA_PARALLEL=""
LLAMA_GPU_LAYERS=""
LLAMA_FLASH_ATTN=""
LLAMA_JINJA=""
LLAMA_REASONING=""
LLAMA_NO_UI=""
LLAMA_NO_KV_OFFLOAD=""
LLAMA_CACHE_TYPE_K=""
LLAMA_CACHE_TYPE_V=""
LLAMA_MLOCK=""
LLAMA_EXTRA_ARGS=""
CURRENT_PROGRESS_FILE=""
LAUNCHER_MODE="launch"

timestamp() {
  date '+%Y-%m-%d %H:%M:%S'
}

log() {
  print -- "[$(timestamp)] $*"
}

show_alert() {
  local title="${2:-$APP_NAME}"
  local message="$1"

  if [[ "${LLAMA_LAUNCHER_DISABLE_ALERTS:-0}" == "1" ]]; then
    return 0
  fi

  if command -v osascript >/dev/null 2>&1; then
    /usr/bin/osascript - "$title" "$message" <<'APPLESCRIPT' >/dev/null 2>&1 || true
on run argv
  set alertTitle to item 1 of argv
  set alertMessage to item 2 of argv
  display alert alertTitle message alertMessage as critical
end run
APPLESCRIPT
  fi
}

fail() {
  local message="$1"
  print -u2 -- "$message"
  show_alert "$message"
  exit 1
}

parse_args() {
  while (( $# > 0 )); do
    case "$1" in
      --cache-open)
        LAUNCHER_MODE="cache-open"
        ;;
      --cache-delete)
        LAUNCHER_MODE="cache-delete"
        ;;
      --cache-delete-all)
        LAUNCHER_MODE="cache-delete-all"
        ;;
      --cache-menu)
        LAUNCHER_MODE="cache-menu"
        ;;
      -h|--help)
        cat <<'EOF'
Usage: launch-llama-webui.sh [option]

Options:
  --cache-open        Open the llama.cpp cache folder in Finder and exit
  --cache-delete      Select and delete one cached model/download file
  --cache-delete-all  Delete all cached model/download files after confirmation
  --cache-menu        Open an interactive cache management menu
  -h, --help          Show this help and exit
EOF
        exit 0
        ;;
      *)
        fail "Unknown argument: $1"
        ;;
    esac
    shift
  done
}

require_osascript() {
  if ! command -v osascript >/dev/null 2>&1; then
    fail "This action requires osascript, but it is not available."
  fi
}

cleanup_pid_file() {
  if [[ -n "$SERVER_PID" && -f "$PID_FILE" ]]; then
    local recorded_pid
    recorded_pid="$(<"$PID_FILE")"

    if [[ "$recorded_pid" == "$SERVER_PID" ]]; then
      rm -f "$PID_FILE"
    fi
  fi
}

trap cleanup_pid_file EXIT

ensure_state_dirs() {
  mkdir -p "$APP_SUPPORT_DIR" "$LOG_DIR" "$RUN_DIR"
}

migrate_legacy_config() {
  if [[ -n "${LLAMA_LAUNCHER_APP_SUPPORT_DIR:-}" || -f "$CONFIG_FILE" ]]; then
    return 0
  fi

  local legacy_config="$LEGACY_APP_SUPPORT_DIR/config.env"
  if [[ -f "$legacy_config" ]]; then
    cp "$legacy_config" "$CONFIG_FILE"
    log "Copied existing launcher config from $legacy_config"
  fi
}

create_default_config() {
  cat > "$CONFIG_FILE" <<EOF
# $APP_NAME configuration
# MODEL_PATH: local .gguf model file
# HF_REPO: public Hugging Face repo in owner/model[:quant] format
# HF_FILE: optional exact .gguf filename inside HF_REPO
# LLAMA_ALIAS: model alias used by Cavalry's OpenAI-compatible requests
# LLAMA_API_KEY: optional Bearer token; enter the same value in Cavalry settings
# LLAMA_NO_UI: set 1 for embedded Cavalry mode, 0 to open the llama.cpp WebUI
# LLAMA_* tuning keys: optional llama-server memory/performance settings
# Leave the model source blank to pick a source at launch time.

MODEL_PATH=
HF_REPO=
HF_FILE=
HOST=$DEFAULT_HOST
PORT=$DEFAULT_PORT
LLAMA_SERVER_BIN=
LLAMA_ALIAS=$DEFAULT_ALIAS
LLAMA_API_KEY=
LLAMA_CTX_SIZE=$DEFAULT_CTX_SIZE
LLAMA_PARALLEL=
LLAMA_GPU_LAYERS=$DEFAULT_GPU_LAYERS
LLAMA_FLASH_ATTN=$DEFAULT_FLASH_ATTN
LLAMA_JINJA=1
LLAMA_REASONING=off
LLAMA_NO_UI=1
LLAMA_NO_KV_OFFLOAD=
LLAMA_CACHE_TYPE_K=
LLAMA_CACHE_TYPE_V=
LLAMA_MLOCK=
LLAMA_EXTRA_ARGS=
EOF
}

load_config() {
  if [[ ! -f "$CONFIG_FILE" ]]; then
    create_default_config
  fi

  HOST="$DEFAULT_HOST"
  PORT="$DEFAULT_PORT"
  MODEL_PATH=""
  HF_REPO=""
  HF_FILE=""
  LLAMA_SERVER_BIN=""
  LLAMA_ALIAS=""
  LLAMA_API_KEY=""
  LLAMA_CTX_SIZE=""
  LLAMA_PARALLEL=""
  LLAMA_GPU_LAYERS=""
  LLAMA_FLASH_ATTN=""
  LLAMA_JINJA=""
  LLAMA_REASONING=""
  LLAMA_NO_UI=""
  LLAMA_NO_KV_OFFLOAD=""
  LLAMA_CACHE_TYPE_K=""
  LLAMA_CACHE_TYPE_V=""
  LLAMA_MLOCK=""
  LLAMA_EXTRA_ARGS=""

  local line key raw_value parsed_value
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" =~ '^[[:space:]]*(#.*)?$' ]]; then
      continue
    fi

    if [[ "$line" =~ '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$' ]]; then
      key="$match[1]"
      raw_value="$match[2]"
      parsed_value="$(parse_config_value "$raw_value")"

      case "$key" in
        MODEL_PATH) MODEL_PATH="$parsed_value" ;;
        HF_REPO) HF_REPO="$parsed_value" ;;
        HF_FILE) HF_FILE="$parsed_value" ;;
        HOST) HOST="$parsed_value" ;;
        PORT) PORT="$parsed_value" ;;
        LLAMA_SERVER_BIN) LLAMA_SERVER_BIN="$parsed_value" ;;
        LLAMA_ALIAS) LLAMA_ALIAS="$parsed_value" ;;
        LLAMA_API_KEY) LLAMA_API_KEY="$parsed_value" ;;
        LLAMA_CTX_SIZE) LLAMA_CTX_SIZE="$parsed_value" ;;
        LLAMA_PARALLEL) LLAMA_PARALLEL="$parsed_value" ;;
        LLAMA_GPU_LAYERS) LLAMA_GPU_LAYERS="$parsed_value" ;;
        LLAMA_FLASH_ATTN) LLAMA_FLASH_ATTN="$parsed_value" ;;
        LLAMA_JINJA) LLAMA_JINJA="$parsed_value" ;;
        LLAMA_REASONING) LLAMA_REASONING="$parsed_value" ;;
        LLAMA_NO_UI) LLAMA_NO_UI="$parsed_value" ;;
        LLAMA_NO_KV_OFFLOAD) LLAMA_NO_KV_OFFLOAD="$parsed_value" ;;
        LLAMA_CACHE_TYPE_K) LLAMA_CACHE_TYPE_K="$parsed_value" ;;
        LLAMA_CACHE_TYPE_V) LLAMA_CACHE_TYPE_V="$parsed_value" ;;
        LLAMA_MLOCK) LLAMA_MLOCK="$parsed_value" ;;
        LLAMA_EXTRA_ARGS) LLAMA_EXTRA_ARGS="$parsed_value" ;;
      esac
    fi
  done < "$CONFIG_FILE"

  HOST="${HOST:-$DEFAULT_HOST}"
  PORT="${PORT:-$DEFAULT_PORT}"
  LLAMA_ALIAS="${LLAMA_ALIAS:-$DEFAULT_ALIAS}"
  LLAMA_CTX_SIZE="${LLAMA_CTX_SIZE:-$DEFAULT_CTX_SIZE}"
  LLAMA_GPU_LAYERS="${LLAMA_GPU_LAYERS:-$DEFAULT_GPU_LAYERS}"
  LLAMA_FLASH_ATTN="${LLAMA_FLASH_ATTN:-$DEFAULT_FLASH_ATTN}"
  LLAMA_JINJA="${LLAMA_JINJA:-1}"
  LLAMA_REASONING="${LLAMA_REASONING:-off}"
  LLAMA_NO_UI="${LLAMA_NO_UI:-1}"
}

trim_outer_whitespace() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  print -r -- "$value"
}

parse_config_value() {
  local raw_value="$1"
  local trimmed_value

  trimmed_value="$(trim_outer_whitespace "${raw_value%$'\r'}")"
  print -r -- "${(Q)trimmed_value}"
}

config_flag_enabled() {
  local key="$1"
  local raw_value="${2:-}"
  local value="${raw_value:l}"

  case "$value" in
    "")
      return 1
      ;;
    1|true|yes|on)
      return 0
      ;;
    0|false|no|off)
      return 1
      ;;
    *)
      fail "Invalid boolean value for $key in $CONFIG_FILE: $raw_value. Use 1/0, true/false, yes/no, or on/off."
      ;;
  esac
}

require_non_negative_integer_config() {
  local key="$1"
  local value="$2"

  if [[ "$value" != <-> ]]; then
    fail "Invalid numeric value for $key in $CONFIG_FILE: $value. Use a non-negative integer."
  fi
}

require_positive_integer_config() {
  local key="$1"
  local value="$2"

  require_non_negative_integer_config "$key" "$value"
  if (( value < 1 )); then
    fail "Invalid numeric value for $key in $CONFIG_FILE: $value. Use an integer greater than zero."
  fi
}

require_integer_config() {
  local key="$1"
  local value="$2"

  if [[ "$value" != <-> && "$value" != -<-> ]]; then
    fail "Invalid numeric value for $key in $CONFIG_FILE: $value. Use an integer."
  fi
}

require_single_token_config() {
  local key="$1"
  local value="$2"

  if [[ "$value" == *[[:space:]]* ]]; then
    fail "Invalid value for $key in $CONFIG_FILE: $value. Use a single token without spaces."
  fi
}

set_config_value() {
  local key="$1"
  local value="$2"
  local escaped_value
  local tmp_file="$CONFIG_FILE.tmp"

  escaped_value="$(printf '%q' "$value")"

  awk -v key="$key" -v replacement="$key=$escaped_value" '
    BEGIN { updated = 0 }
    index($0, key "=") == 1 {
      print replacement
      updated = 1
      next
    }
    { print }
    END {
      if (!updated) {
        print replacement
      }
    }
  ' "$CONFIG_FILE" > "$tmp_file"

  mv "$tmp_file" "$CONFIG_FILE"
}

choose_model_path() {
  local selected_file
  if [[ -n "${LLAMA_LAUNCHER_TEST_MODEL_PATH:-}" ]]; then
    selected_file="$LLAMA_LAUNCHER_TEST_MODEL_PATH"
  else
    if ! command -v osascript >/dev/null 2>&1; then
      fail "Local model selection requires osascript, but it is not available."
    fi

    selected_file="$(
      /usr/bin/osascript <<'APPLESCRIPT'
try
  set chosenFile to choose file with prompt "Choose a .gguf model for Cavalry Advisor"
  return POSIX path of chosenFile
on error number -128
  return ""
end try
APPLESCRIPT
    )"
  fi

  if [[ -z "$selected_file" ]]; then
    fail "No model was selected. Launch canceled."
  fi

  if [[ "${selected_file:e:l}" != "gguf" ]]; then
    fail "The selected file is not a .gguf model: $selected_file"
  fi

  if [[ ! -f "$selected_file" ]]; then
    fail "The selected model does not exist: $selected_file"
  fi

  MODEL_PATH="$selected_file"
  HF_REPO=""
  HF_FILE=""
  set_config_value "MODEL_PATH" "$MODEL_PATH"
  set_config_value "HF_REPO" ""
  set_config_value "HF_FILE" ""
  log "Saved MODEL_PATH to $CONFIG_FILE"
}

trim_value() {
  print -r -- "$1" | awk '{$1=$1; print}'
}

bytes_to_human() {
  local bytes="${1:-0}"
  awk -v bytes="$bytes" '
    function human(x) {
      split("B KiB MiB GiB TiB PiB", u, " ")
      i = 1
      while (x >= 1024 && i < 6) {
        x /= 1024
        i++
      }
      if (i == 1) {
        return sprintf("%d %s", x, u[i])
      }
      return sprintf("%.2f %s", x, u[i])
    }
    BEGIN {
      if (bytes < 0) bytes = 0
      print human(bytes)
    }
  '
}

open_cache_folder() {
  mkdir -p "$CACHE_DIR"
  if ! open "$CACHE_DIR"; then
    fail "Could not open cache folder: $CACHE_DIR"
  fi
  log "Opened cache folder: $CACHE_DIR"
}

list_cache_artifacts() {
  local -a files
  files=("$CACHE_DIR"/*.gguf(NOm) "$CACHE_DIR"/*.downloadInProgress(NOm) "$CACHE_DIR"/*_preset.ini(NOm))
  print -r -l -- "${files[@]}"
}

prompt_cache_action() {
  local selected

  require_osascript
  selected="$(
    /usr/bin/osascript <<'APPLESCRIPT'
try
  set options to {"Open Cache Folder", "Delete Cached File", "Delete All Cached Files"}
  set picked to choose from list options with prompt "Cache Management" with title "Cavalry LlamaCPP" OK button name "Select" cancel button name "Cancel" without multiple selections allowed
  if picked is false then
    return "__CANCELED__"
  end if
  return item 1 of picked
on error number -128
  return "__CANCELED__"
end try
APPLESCRIPT
  )"

  print -r -- "$selected"
}

choose_cache_file_to_delete() {
  local -a files
  local -a options
  local selected
  local target_file=""
  local size_bytes
  local size_human
  local label

  require_osascript
  mkdir -p "$CACHE_DIR"
  files=("$CACHE_DIR"/*.gguf(NOm) "$CACHE_DIR"/*.downloadInProgress(NOm))
  if (( ${#files} == 0 )); then
    fail "No cached model/download files found in $CACHE_DIR."
  fi

  typeset -A option_to_path
  for target_file in "${files[@]}"; do
    size_bytes="$(stat -f%z "$target_file" 2>/dev/null || print 0)"
    size_human="$(bytes_to_human "$size_bytes")"
    label="${target_file:t} [$size_human]"
    option_to_path["$label"]="$target_file"
    options+=("$label")
  done

  selected="$(
    /usr/bin/osascript - "${options[@]}" <<'APPLESCRIPT'
on run argv
  try
    set picked to choose from list argv with prompt "Choose one cached file to delete." with title "Cavalry LlamaCPP" OK button name "Delete" cancel button name "Cancel" without multiple selections allowed
    if picked is false then
      return "__CANCELED__"
    end if
    return item 1 of picked
  on error number -128
    return "__CANCELED__"
  end try
end run
APPLESCRIPT
  )"

  if [[ "$selected" == "__CANCELED__" || -z "$selected" ]]; then
    log "Cache deletion canceled."
    return 0
  fi

  target_file="${option_to_path[$selected]:-}"
  if [[ -z "$target_file" || ! -f "$target_file" ]]; then
    fail "Selected cache file is no longer available."
  fi

  local confirm
  confirm="$(
    /usr/bin/osascript - "${target_file:t}" <<'APPLESCRIPT'
on run argv
  set itemName to item 1 of argv
  try
    set answer to button returned of (display dialog "Delete this cached file?" & return & return & itemName buttons {"Cancel", "Delete"} default button "Delete" with icon caution)
    return answer
  on error number -128
    return "__CANCELED__"
  end try
end run
APPLESCRIPT
  )"

  if [[ "$confirm" != "Delete" ]]; then
    log "Cache deletion canceled."
    return 0
  fi

  rm -f "$target_file"
  if [[ "$target_file" == *.gguf ]]; then
    rm -f "$target_file.downloadInProgress"
  fi
  log "Deleted cached file: $target_file"
}

delete_all_cache_files() {
  local -a files
  local confirm

  require_osascript
  mkdir -p "$CACHE_DIR"
  files=("$CACHE_DIR"/*.gguf(N) "$CACHE_DIR"/*.downloadInProgress(N) "$CACHE_DIR"/*_preset.ini(N))
  if (( ${#files} == 0 )); then
    fail "No cached model/download files found in $CACHE_DIR."
  fi

  confirm="$(
    /usr/bin/osascript - "${#files[@]}" <<'APPLESCRIPT'
on run argv
  set fileCount to item 1 of argv
  try
    set answer to button returned of (display dialog "Delete all cached llama.cpp files?" & return & return & fileCount & " files will be removed." buttons {"Cancel", "Delete All"} default button "Cancel" with icon caution)
    return answer
  on error number -128
    return "__CANCELED__"
  end try
end run
APPLESCRIPT
  )"

  if [[ "$confirm" != "Delete All" ]]; then
    log "Delete-all canceled."
    return 0
  fi

  rm -f "${files[@]}"
  log "Deleted ${#files[@]} cached file(s) from $CACHE_DIR"
}

run_cache_mode() {
  local action="$1"
  local selected_action

  case "$action" in
    cache-open)
      open_cache_folder
      ;;
    cache-delete)
      choose_cache_file_to_delete
      ;;
    cache-delete-all)
      delete_all_cache_files
      ;;
    cache-menu)
      selected_action="$(prompt_cache_action)"
      case "$selected_action" in
        "Open Cache Folder")
          open_cache_folder
          ;;
        "Delete Cached File")
          choose_cache_file_to_delete
          ;;
        "Delete All Cached Files")
          delete_all_cache_files
          ;;
        "__CANCELED__"|"")
          log "Cache menu canceled."
          ;;
        *)
          fail "Unknown cache action: $selected_action"
          ;;
      esac
      ;;
    *)
      fail "Unknown launcher mode: $action"
      ;;
  esac
}

find_download_progress_file() {
  local repo_key=""
  local file_key=""
  local expected_file=""
  local -a files

  if [[ ! -d "$CACHE_DIR" ]]; then
    return 1
  fi

  repo_key="$(print -r -- "$HF_REPO" | sed 's/[^[:alnum:]._-]/_/g')"
  if [[ -n "$HF_FILE" ]]; then
    file_key="$(print -r -- "$HF_FILE" | sed 's/[^[:alnum:]._-]/_/g')"
    expected_file="$CACHE_DIR/${repo_key}_${file_key}.downloadInProgress"
    if [[ -f "$expected_file" ]]; then
      print -r -- "$expected_file"
      return 0
    fi
  fi

  if [[ -n "$repo_key" ]]; then
    files=("$CACHE_DIR"/${repo_key}*.downloadInProgress(NOm[1]))
    if (( ${#files} > 0 )); then
      print -r -- "${files[1]}"
      return 0
    fi
  fi

  files=("$CACHE_DIR"/*.downloadInProgress(NOm[1]))
  if (( ${#files} == 0 )); then
    return 1
  fi

  print -r -- "${files[1]}"
}

report_download_progress() {
  if [[ -n "$MODEL_PATH" || -z "$HF_REPO" ]]; then
    DOWNLOAD_IN_PROGRESS=0
    return 0
  fi

  if (( PROGRESS_INTERVAL_SECONDS <= 0 )); then
    return 0
  fi

  if (( LAST_PROGRESS_SAMPLE_SECONDS > 0 )) && (( SECONDS - LAST_PROGRESS_SAMPLE_SECONDS < PROGRESS_INTERVAL_SECONDS )); then
    return 0
  fi

  local now_seconds="$SECONDS"
  local download_file
  local bytes
  local bytes_human
  local rate_text="n/a"

  LAST_PROGRESS_SAMPLE_SECONDS="$now_seconds"
  download_file="$(find_download_progress_file || true)"

  if [[ -z "$download_file" ]]; then
    DOWNLOAD_IN_PROGRESS=0
    if [[ -n "$CURRENT_PROGRESS_FILE" ]]; then
      log "Download finished or moved from in-progress file; waiting for server readiness."
      CURRENT_PROGRESS_FILE=""
      LAST_PROGRESS_BYTES=-1
    fi
    return 0
  fi

  DOWNLOAD_IN_PROGRESS=1
  bytes="$(stat -f%z "$download_file" 2>/dev/null || print 0)"
  bytes_human="$(bytes_to_human "$bytes")"

  if [[ "$CURRENT_PROGRESS_FILE" != "$download_file" ]]; then
    CURRENT_PROGRESS_FILE="$download_file"
    LAST_PROGRESS_BYTES=-1
    LAST_DOWNLOAD_GROWTH_SECONDS="$now_seconds"
    log "Download started: ${download_file:t}"
  fi

  if (( LAST_PROGRESS_BYTES >= 0 )); then
    local delta_bytes=$(( bytes - LAST_PROGRESS_BYTES ))
    local delta_seconds=$PROGRESS_INTERVAL_SECONDS
    if (( delta_seconds > 0 && delta_bytes >= 0 )); then
      local rate_bytes=$(( delta_bytes / delta_seconds ))
      rate_text="$(bytes_to_human "$rate_bytes")/s"
    fi
  fi

  if (( LAST_PROGRESS_BYTES >= 0 && bytes == LAST_PROGRESS_BYTES )); then
    log "Download progress: ${download_file:t} at $bytes_human (no growth in last ${PROGRESS_INTERVAL_SECONDS}s)"
  else
    LAST_DOWNLOAD_GROWTH_SECONDS="$now_seconds"
    log "Download progress: ${download_file:t} at $bytes_human, approx rate $rate_text"
  fi

  LAST_PROGRESS_BYTES="$bytes"
}

report_server_log_activity() {
  if [[ ! -f "$LOG_FILE" ]]; then
    return 0
  fi

  local log_bytes
  log_bytes="$(stat -f%z "$LOG_FILE" 2>/dev/null || print 0)"

  if (( LAST_LOG_BYTES < 0 )); then
    LAST_LOG_BYTES="$log_bytes"
    LAST_LOG_GROWTH_SECONDS="$SECONDS"
    return 0
  fi

  if (( log_bytes > LAST_LOG_BYTES )); then
    LAST_LOG_GROWTH_SECONDS="$SECONDS"
  fi

  LAST_LOG_BYTES="$log_bytes"
}

choose_model_source_for_launch() {
  local selected_source

  if [[ -n "${LLAMA_LAUNCHER_TEST_SOURCE_CHOICE:-}" ]]; then
    selected_source="$LLAMA_LAUNCHER_TEST_SOURCE_CHOICE"
  else
    if ! command -v osascript >/dev/null 2>&1; then
      fail "Interactive model selection is unavailable because osascript is not installed."
    fi

    selected_source="$(
      /usr/bin/osascript <<'APPLESCRIPT'
try
  set sourceDialog to display dialog "Select the model source for this launch." buttons {"Cancel", "Hugging Face Repo", "Local GGUF File"} default button "Local GGUF File"
  return button returned of sourceDialog
on error number -128
  return ""
end try
APPLESCRIPT
    )"
  fi

  case "$selected_source" in
    "Local GGUF File")
      choose_model_path
      ;;
    "Hugging Face Repo")
      choose_hf_repo
      ;;
    *)
      fail "No model source was selected. Launch canceled."
      ;;
  esac
}

valid_hf_repo() {
  local repo="$1"
  [[ "$repo" =~ '^[^/[:space:]]+/[^/[:space:]:]+(:[^[:space:]]+)?$' ]]
}

prompt_hf_repo_value() {
  local repo_value

  if (( ${+LLAMA_LAUNCHER_TEST_HF_REPO} )); then
    print -r -- "$LLAMA_LAUNCHER_TEST_HF_REPO"
    return 0
  fi

  repo_value="$(
    /usr/bin/osascript <<'APPLESCRIPT'
try
  set repoDialog to display dialog "Enter a public Hugging Face repo in owner/model[:quant] format." default answer "" buttons {"Cancel", "Save"} default button "Save"
  return text returned of repoDialog
on error number -128
  return "__CANCELED__"
end try
APPLESCRIPT
  )"

  print -r -- "$repo_value"
}

prompt_hf_file_value() {
  local file_value

  if (( ${+LLAMA_LAUNCHER_TEST_HF_FILE} )); then
    print -r -- "$LLAMA_LAUNCHER_TEST_HF_FILE"
    return 0
  fi

  file_value="$(
    /usr/bin/osascript <<'APPLESCRIPT'
try
  set fileDialog to display dialog "Optional: enter an exact .gguf filename from that repo, or leave blank." default answer "" buttons {"Cancel", "Save"} default button "Save"
  return text returned of fileDialog
on error number -128
  return "__CANCELED__"
end try
APPLESCRIPT
  )"

  print -r -- "$file_value"
}

choose_hf_repo() {
  if (( ! ${+LLAMA_LAUNCHER_TEST_HF_REPO} )) && ! command -v osascript >/dev/null 2>&1; then
    fail "Hugging Face model setup requires osascript, but it is not available."
  fi

  local repo_value
  local file_value

  repo_value="$(trim_value "$(prompt_hf_repo_value)")"
  if [[ "$repo_value" == "__CANCELED__" ]]; then
    fail "No Hugging Face repo was entered. Launch canceled."
  fi

  if [[ -z "$repo_value" ]]; then
    fail "No Hugging Face repo was entered. Launch canceled."
  fi

  if ! valid_hf_repo "$repo_value"; then
    fail "HF_REPO must be in owner/model[:quant] format. Received: $repo_value"
  fi

  file_value="$(trim_value "$(prompt_hf_file_value)")"
  if [[ "$file_value" == "__CANCELED__" ]]; then
    fail "Hugging Face setup was canceled."
  fi

  if [[ -n "$file_value" && "${file_value:e:l}" != "gguf" ]]; then
    fail "HF_FILE must be a .gguf filename when provided. Received: $file_value"
  fi

  MODEL_PATH=""
  HF_REPO="$repo_value"
  HF_FILE="$file_value"
  set_config_value "MODEL_PATH" ""
  set_config_value "HF_REPO" "$HF_REPO"
  set_config_value "HF_FILE" "$HF_FILE"
  log "Saved Hugging Face model source to $CONFIG_FILE"
}

resolve_llama_server() {
  local -a candidates=()

  if [[ -n "$LLAMA_SERVER_BIN" ]]; then
    candidates+=("$LLAMA_SERVER_BIN")
  fi

  if command -v llama-server >/dev/null 2>&1; then
    candidates+=("$(command -v llama-server)")
  fi

  candidates+=("/opt/homebrew/bin/llama-server" "/usr/local/bin/llama-server")

  local candidate
  for candidate in "${candidates[@]}"; do
    if [[ -n "$candidate" && -x "$candidate" ]]; then
      LLAMA_SERVER_RESOLVED="$candidate"
      return 0
    fi
  done

  fail "Could not find llama-server. Install llama.cpp with Homebrew or set LLAMA_SERVER_BIN in $CONFIG_FILE."
}

load_llama_server_help() {
  if [[ -z "$LLAMA_SERVER_HELP" ]]; then
    LLAMA_SERVER_HELP="$("$LLAMA_SERVER_RESOLVED" --help 2>&1 || true)"
  fi
}

server_supports_flag() {
  local flag="$1"
  load_llama_server_help
  grep -Eq "(^|[[:space:]])${flag}([,[:space:]]|$)" <<< "$LLAMA_SERVER_HELP"
}

server_url() {
  print -- "http://$HOST:$PORT"
}

health_check() {
  curl -fsS --max-time 2 "$(server_url)/health" >/dev/null 2>&1
}

open_browser() {
  if config_flag_enabled "LLAMA_NO_UI" "$LLAMA_NO_UI"; then
    log "Embedded server mode is ready for Cavalry at $(server_url)/v1/chat/completions"
    return 0
  fi

  if [[ "${LLAMA_LAUNCHER_SKIP_BROWSER_OPEN:-0}" == "1" ]]; then
    return 0
  fi

  if ! open "$(server_url)/"; then
    local message="The server is running, but the browser could not be opened automatically. Visit $(server_url)/ manually."
    print -u2 -- "$message"
    show_alert "$message"
  fi
}

cleanup_stale_pid() {
  if [[ ! -f "$PID_FILE" ]]; then
    return 0
  fi

  local recorded_pid
  recorded_pid="$(<"$PID_FILE")"

  if [[ -z "$recorded_pid" ]]; then
    rm -f "$PID_FILE"
    return 0
  fi

  if ! kill -0 "$recorded_pid" >/dev/null 2>&1; then
    log "Removing stale PID file for process $recorded_pid"
    rm -f "$PID_FILE"
  fi
}

assert_model_source() {
  if [[ -n "$MODEL_PATH" ]]; then
    if [[ ! -f "$MODEL_PATH" ]]; then
      fail "Configured MODEL_PATH does not exist: $MODEL_PATH"
    fi

    if [[ "${MODEL_PATH:e:l}" != "gguf" ]]; then
      fail "Configured MODEL_PATH is not a .gguf file: $MODEL_PATH"
    fi

    return 0
  fi

  if [[ -n "$HF_REPO" ]]; then
    if ! valid_hf_repo "$HF_REPO"; then
      fail "Configured HF_REPO must be in owner/model[:quant] format. Received: $HF_REPO"
    fi

    if [[ -n "$HF_FILE" && "${HF_FILE:e:l}" != "gguf" ]]; then
      fail "Configured HF_FILE must be a .gguf filename when provided. Received: $HF_FILE"
    fi

    return 0
  fi

  if [[ -n "$HF_FILE" ]]; then
    fail "HF_FILE is configured without HF_REPO. Set HF_REPO in $CONFIG_FILE or clear HF_FILE."
  fi

  fail "No model source was selected for this launch."
}

assert_port_ready_for_launch() {
  if health_check; then
    log "A healthy llama.cpp server is already running at $(server_url)"
    open_browser
    exit 0
  fi

  if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    local owner
    owner="$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | awk 'NR == 2 { print $1 " (PID " $2 ")" }')"

    if [[ -n "$owner" ]]; then
      fail "Port $PORT is already in use by $owner. Stop that service or change HOST/PORT in $CONFIG_FILE."
    fi

    fail "Port $PORT is already in use. Stop the other service or change HOST/PORT in $CONFIG_FILE."
  fi
}

start_server() {
  local -a retry_args=("$@")
  local -a server_args
  local -a extra_args=()

  server_args=(--host "$HOST" --port "$PORT")

  if server_supports_flag "--alias"; then
    server_args+=(--alias "$LLAMA_ALIAS")
  else
    log "Installed llama-server does not support --alias; Cavalry will still call model '$LLAMA_ALIAS'."
  fi

  if config_flag_enabled "LLAMA_NO_UI" "$LLAMA_NO_UI"; then
    if server_supports_flag "--no-ui"; then
      server_args+=(--no-ui)
    elif server_supports_flag "--no-webui"; then
      server_args+=(--no-webui)
    else
      log "Installed llama-server does not expose a no-UI flag; the server WebUI may remain enabled."
    fi
  else
    if server_supports_flag "--webui"; then
      server_args+=(--webui)
    fi
  fi

  if [[ -n "$LLAMA_API_KEY" ]]; then
    if server_supports_flag "--api-key"; then
      server_args+=(--api-key "$LLAMA_API_KEY")
    else
      fail "LLAMA_API_KEY is configured, but this llama-server does not support --api-key."
    fi
  fi

  if [[ -n "$MODEL_PATH" ]]; then
    server_args+=(-m "$MODEL_PATH")
  else
    server_args+=(-hf "$HF_REPO")
    if [[ -n "$HF_FILE" ]]; then
      server_args+=(--hf-file "$HF_FILE")
    fi
  fi

  if [[ -n "$LLAMA_CTX_SIZE" ]]; then
    require_non_negative_integer_config "LLAMA_CTX_SIZE" "$LLAMA_CTX_SIZE"
    server_args+=(--ctx-size "$LLAMA_CTX_SIZE")
  fi

  if [[ -n "$LLAMA_PARALLEL" ]]; then
    require_positive_integer_config "LLAMA_PARALLEL" "$LLAMA_PARALLEL"
    server_args+=(--parallel "$LLAMA_PARALLEL")
  fi

  if [[ -n "$LLAMA_GPU_LAYERS" ]]; then
    if [[ "$LLAMA_GPU_LAYERS" != "auto" ]]; then
      require_integer_config "LLAMA_GPU_LAYERS" "$LLAMA_GPU_LAYERS"
    fi
    server_args+=(--n-gpu-layers "$LLAMA_GPU_LAYERS")
  fi

  if [[ -n "$LLAMA_FLASH_ATTN" ]]; then
    require_single_token_config "LLAMA_FLASH_ATTN" "$LLAMA_FLASH_ATTN"
    if server_supports_flag "--flash-attn"; then
      server_args+=(--flash-attn "$LLAMA_FLASH_ATTN")
    else
      log "Installed llama-server does not support --flash-attn; skipping LLAMA_FLASH_ATTN."
    fi
  fi

  if config_flag_enabled "LLAMA_JINJA" "$LLAMA_JINJA"; then
    if server_supports_flag "--jinja"; then
      server_args+=(--jinja)
    else
      log "Installed llama-server does not support --jinja; skipping LLAMA_JINJA."
    fi
  fi

  if [[ -n "$LLAMA_REASONING" ]]; then
    require_single_token_config "LLAMA_REASONING" "$LLAMA_REASONING"
    if server_supports_flag "--reasoning"; then
      server_args+=(--reasoning "$LLAMA_REASONING")
    elif server_supports_flag "--reasoning-format"; then
      if [[ "$LLAMA_REASONING" == "off" || "$LLAMA_REASONING" == "none" || "$LLAMA_REASONING" == "0" ]]; then
        server_args+=(--reasoning-format none)
      else
        server_args+=(--reasoning-format "$LLAMA_REASONING")
      fi
    else
      log "Installed llama-server does not support a reasoning flag; skipping LLAMA_REASONING."
    fi
  fi

  if config_flag_enabled "LLAMA_NO_KV_OFFLOAD" "$LLAMA_NO_KV_OFFLOAD"; then
    server_args+=(--no-kv-offload)
  fi

  if [[ -n "$LLAMA_CACHE_TYPE_K" ]]; then
    require_single_token_config "LLAMA_CACHE_TYPE_K" "$LLAMA_CACHE_TYPE_K"
    server_args+=(--cache-type-k "$LLAMA_CACHE_TYPE_K")
  fi

  if [[ -n "$LLAMA_CACHE_TYPE_V" ]]; then
    require_single_token_config "LLAMA_CACHE_TYPE_V" "$LLAMA_CACHE_TYPE_V"
    server_args+=(--cache-type-v "$LLAMA_CACHE_TYPE_V")
  fi

  if config_flag_enabled "LLAMA_MLOCK" "$LLAMA_MLOCK"; then
    server_args+=(--mlock)
  fi

  if [[ -n "$LLAMA_EXTRA_ARGS" ]]; then
    extra_args=(${(z)LLAMA_EXTRA_ARGS})
    server_args+=("${extra_args[@]}")
  fi

  if (( ${#retry_args[@]} > 0 )); then
    server_args+=("${retry_args[@]}")
  fi

  : > "$LOG_FILE"
  LAST_LOG_BYTES=-1
  LAST_LOG_GROWTH_SECONDS="$SECONDS"
  log "Starting llama-server from $LLAMA_SERVER_RESOLVED"
  log "Streaming logs to $LOG_FILE"

  "$LLAMA_SERVER_RESOLVED" "${server_args[@]}" > >(tee -a "$LOG_FILE") 2>&1 &
  SERVER_PID="$!"
  SERVER_STARTED=1
  print -- "$SERVER_PID" > "$PID_FILE"
}

wait_for_server() {
  local start_seconds=$SECONDS
  local reference_seconds

  LAST_DOWNLOAD_GROWTH_SECONDS="$start_seconds"
  LAST_LOG_GROWTH_SECONDS="$start_seconds"
  while true; do
    report_download_progress
    report_server_log_activity

    if health_check; then
      if config_flag_enabled "LLAMA_NO_UI" "$LLAMA_NO_UI"; then
        log "Cavalry advisor server is ready at $(server_url)/v1/chat/completions"
      else
        log "WebUI is ready at $(server_url)/"
      fi
      return 0
    fi

    if ! kill -0 "$SERVER_PID" >/dev/null 2>&1; then
      wait "$SERVER_PID" || true
      SERVER_STARTED=0
      rm -f "$PID_FILE"
      return 10
    fi

    reference_seconds="$start_seconds"
    if (( DOWNLOAD_IN_PROGRESS == 1 )); then
      reference_seconds="$LAST_DOWNLOAD_GROWTH_SECONDS"
    fi
    if (( LAST_LOG_GROWTH_SECONDS > reference_seconds )); then
      reference_seconds="$LAST_LOG_GROWTH_SECONDS"
    fi

    if (( SECONDS - reference_seconds >= STARTUP_TIMEOUT )); then
      if kill -0 "$SERVER_PID" >/dev/null 2>&1; then
        kill "$SERVER_PID" >/dev/null 2>&1 || true
        wait "$SERVER_PID" || true
      fi

      SERVER_STARTED=0
      rm -f "$PID_FILE"
      return 11
    fi

    sleep 1
  done
}

has_metal_oom_signature() {
  if [[ ! -f "$LOG_FILE" ]]; then
    return 1
  fi

  grep -Eiq 'Insufficient Memory|kIOGPUCommandBufferCallbackErrorOutOfMemory|MTLCommandBufferErrorDomain|ggml_metal_synchronize: error: command buffer' "$LOG_FILE"
}

has_warmup_stall_signature() {
  if [[ ! -f "$LOG_FILE" ]]; then
    return 1
  fi

  grep -Eiq 'common_init_from_params: warming up the model with an empty run|--no-warmup to disable' "$LOG_FILE"
}

launch_server_with_retries() {
  local attempt=1
  local wait_status=0
  local -a fallback_args=()
  local fallback_note=""

  while (( attempt <= 3 )); do
    fallback_args=()
    fallback_note="default startup settings"

    if (( attempt == 2 )); then
      fallback_args=(--no-warmup --parallel 1 --ctx-size 2048)
      fallback_note="startup retry with --no-warmup --parallel 1 --ctx-size 2048"
    elif (( attempt == 3 )); then
      fallback_args=(--no-warmup --parallel 1 --ctx-size 2048 --n-gpu-layers 0)
      fallback_note="startup retry with --no-warmup --parallel 1 --ctx-size 2048 --n-gpu-layers 0"
    fi

    if (( attempt > 1 )); then
      log "Retry attempt $attempt/3: $fallback_note"
    fi

    start_server "${fallback_args[@]}"
    wait_status=0
    if wait_for_server; then
      if (( attempt > 1 )); then
        log "Server became ready after retry attempt $attempt."
      fi
      return 0
    else
      wait_status="$?"
    fi
    if (( wait_status == 10 )) && has_metal_oom_signature && (( attempt < 3 )); then
      log "Detected Metal memory exhaustion during startup. Preparing a safer retry."
      (( attempt++ ))
      continue
    fi

    if (( wait_status == 11 )) && (( attempt < 3 )); then
      if has_warmup_stall_signature; then
        log "Startup timed out while warmup was in progress. Preparing a safer retry."
      else
        log "Startup timed out before the server became ready. Preparing a safer retry."
      fi
      (( attempt++ ))
      continue
    fi

    if (( wait_status == 11 )); then
      if has_warmup_stall_signature; then
        fail "Warmup did not complete within ${STARTUP_TIMEOUT}s even after retries. Review $LOG_FILE and consider LLAMA_EXTRA_ARGS='--no-warmup --n-gpu-layers 0 --ctx-size 2048'."
      fi

      fail "Timed out waiting for llama-server after ${STARTUP_TIMEOUT}s with no new startup/log/download activity. Review $LOG_FILE and consider LLAMA_EXTRA_ARGS='--no-warmup --n-gpu-layers 0 --ctx-size 2048'."
    fi

    if (( wait_status == 10 )) && has_metal_oom_signature; then
      fail "llama-server hit a Metal out-of-memory condition during startup even after automatic retries. Review $LOG_FILE and consider LLAMA_EXTRA_ARGS='--no-warmup --n-gpu-layers 0'."
    fi

    fail "llama-server exited before the server became ready. Review $LOG_FILE for details."
  done
}

main() {
  parse_args "$@"

  if [[ "$LAUNCHER_MODE" != "launch" ]]; then
    run_cache_mode "$LAUNCHER_MODE"
    return 0
  fi

  ensure_state_dirs
  migrate_legacy_config
  load_config
  cleanup_stale_pid
  resolve_llama_server
  choose_model_source_for_launch
  assert_model_source
  assert_port_ready_for_launch
  launch_server_with_retries
  open_browser
  log "Terminal will stay open while llama-server is running."
  wait "$SERVER_PID"
}

main "$@"
