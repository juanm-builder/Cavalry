# Cavalry LlamaCPP

This separated companion folder builds a double-clickable macOS launcher for Cavalry's embedded local advisor server. It stays outside the Electron app, but its defaults are optimized to match Cavalry's local advisor settings.

Default Cavalry profile:

- Model: `Qwen3.5-9B-UD-Q4_K_XL.gguf`
- Endpoint: `http://127.0.0.1:8080/v1/chat/completions`
- Alias/model name: `cavalry-advisor`
- Context: `32768`
- UI: disabled by default with `--no-ui`

## Build the app

Run:

```zsh
./scripts/build-app.sh
```

The generated app bundle will be created at:

`dist/Cavalry LlamaCPP.app`

## Use it

Double-click `dist/Cavalry LlamaCPP.app`.

At launch, you can choose:

- `Launch Cavalry Advisor Server`
- `Manage Cache` (open cache folder, delete one cached file, or delete all cached files)

On every launch, the app asks whether you want to use a local `.gguf` file or a public Hugging Face repo. Choose your downloaded `Qwen3.5-9B-UD-Q4_K_XL.gguf` file for the default Cavalry setup. It stores settings here:

`~/Library/Application Support/Cavalry LlamaCPP/config.env`

If you used the older `LlamaCPP Launcher` build, the launcher copies its existing `config.env` into the new Cavalry app support folder on first run.

Logs and runtime state live here:

- `~/Library/Application Support/Cavalry LlamaCPP/logs/llama-server.log`
- `~/Library/Application Support/Cavalry LlamaCPP/run/llama-server.pid`

## Config

Edit `~/Library/Application Support/Cavalry LlamaCPP/config.env` to change:

- `MODEL_PATH`
- `HF_REPO`
- `HF_FILE`
- `HOST`
- `PORT`
- `LLAMA_SERVER_BIN`
- `LLAMA_ALIAS`
- `LLAMA_API_KEY`
- `LLAMA_CTX_SIZE`
- `LLAMA_PARALLEL`
- `LLAMA_GPU_LAYERS`
- `LLAMA_FLASH_ATTN`
- `LLAMA_JINJA`
- `LLAMA_REASONING`
- `LLAMA_NO_UI`
- `LLAMA_NO_KV_OFFLOAD`
- `LLAMA_CACHE_TYPE_K`
- `LLAMA_CACHE_TYPE_V`
- `LLAMA_MLOCK`
- `LLAMA_EXTRA_ARGS`

Use `MODEL_PATH` for local models, or `HF_REPO` with optional `HF_FILE` for Hugging Face-hosted GGUF models.
The launcher clears the unused model source fields when you configure it through the app, and it safely reads paths that contain spaces.
Use the `LLAMA_*` tuning keys for common memory and context adjustments, and keep `LLAMA_EXTRA_ARGS` for advanced flags that are not covered by the dedicated keys.

To require a local API key, set `LLAMA_API_KEY` in the launcher config and enter the same value in Cavalry's Advisor Model settings.

### Memory Tuning Example

For a 27B model on roughly 16 GB VRAM with 32 GB system RAM, a practical starting point is:

```env
LLAMA_CTX_SIZE=8192
LLAMA_PARALLEL=1
LLAMA_GPU_LAYERS=20
LLAMA_NO_KV_OFFLOAD=1
LLAMA_CACHE_TYPE_K=q8_0
LLAMA_CACHE_TYPE_V=q8_0
LLAMA_MLOCK=1
LLAMA_EXTRA_ARGS=--no-warmup
```

This pushes the KV cache into system RAM, limits concurrent slots to one, and keeps only part of the model in VRAM. If startup still runs out of memory, lower `LLAMA_GPU_LAYERS` or `LLAMA_CTX_SIZE`. If it fits comfortably, raise `LLAMA_GPU_LAYERS` first for more speed.

## Cache Management

The llama.cpp cache directory is:

`~/Library/Caches/llama.cpp`

You can also run cache actions directly:

```zsh
./scripts/launch-llama-webui.sh --cache-open
./scripts/launch-llama-webui.sh --cache-delete
./scripts/launch-llama-webui.sh --cache-delete-all
./scripts/launch-llama-webui.sh --cache-menu
```

## Notes

- The app opens Terminal so you can watch `llama-server` output live.
- When using Hugging Face downloads, the launcher prints periodic download progress snapshots in Terminal.
- Closing the Terminal session stops the launched server.
- If a healthy llama.cpp server is already running on the configured port, the launcher reuses it and does not start a second server.
- Set `LLAMA_NO_UI=0` if you want the llama.cpp WebUI. Cavalry's embedded advisor mode uses `LLAMA_NO_UI=1`.
- If startup fails with a Metal GPU out-of-memory error or startup timeout, the launcher retries automatically with safer flags (adds `--no-warmup --parallel 1 --ctx-size 2048`, then also `--n-gpu-layers 0`).
- Optional: set `LLAMA_LAUNCHER_PROGRESS_INTERVAL=<seconds>` to control progress update frequency (default: 5).
- Optional: set `LLAMA_LAUNCHER_STARTUP_TIMEOUT=<seconds>` to tune startup timeout (default: 300).
