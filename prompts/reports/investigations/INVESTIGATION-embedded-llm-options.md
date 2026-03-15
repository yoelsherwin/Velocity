# Investigation: Embedded LLM Options for Velocity Agent Mode

**Date**: 2026-03-15
**Scope**: Evaluate inference engines, models, and architecture for local NL-to-shell-command translation
**Status**: Complete

---

## 1. Executive Summary

Velocity's Agent Mode requires a local LLM that can translate natural language ("find all typescript files modified this week") into correct shell commands (`Get-ChildItem -Recurse -Filter *.ts | Where-Object { $_.LastWriteTime -gt (Get-Date).AddDays(-7) }`). This is a single inference call, not a conversation. The model must run locally, offline, on CPU, within a Tauri v2 Rust backend, on Windows 10/11, without external dependencies like Ollama or Python.

**Recommended approach**: Use **Candle** (pure Rust inference engine) with **Qwen2.5-Coder-1.5B-Instruct** (Q4_K_M quantized, ~986 MB), downloaded on first Agent Mode activation. This combination delivers the best balance of code generation quality, binary size overhead (~3-5 MB to the exe), inference speed (~1-3 seconds on CPU for short outputs), and integration simplicity (pure Rust, no C/C++ build toolchain required).

---

## 2. Inference Engine Comparison

### 2.1 Comparison Table

| Engine | Language | Pure Rust? | GGUF Support | Quantization | Binary Overhead | GPU Support | Windows | Maturity | Maintenance |
|---|---|---|---|---|---|---|---|---|---|
| **Candle** (HuggingFace) | Rust | Yes | Yes (native) | Q2-Q8, GGUF/GGML | ~3-5 MB | CUDA, Metal | Good | High | Active (HuggingFace) |
| **llama-cpp-rs** (llama-cpp-2) | Rust + C++ | No (C++ dep) | Yes (native) | All GGUF types | ~10-20 MB | CUDA, Vulkan, Metal | Good | Very High | Very Active |
| **Burn** (Tracel) | Rust | Yes | No (ONNX only) | PTQ 2/4/8-bit | ~5-8 MB | CUDA, Vulkan, WGPU | Good | Medium | Active |
| **ort** (ONNX Runtime) | Rust + C | No (C dep) | No (ONNX only) | ONNX quantized | ~15-30 MB (DLL) | CUDA, DirectML, TensorRT | Good | Very High | Active (Microsoft) |
| **Tract** (Sonos) | Rust | Yes | No (ONNX/TF) | i8 quantized | ~3-5 MB | CPU only | Good | Medium | Active |
| **RTen** | Rust | Yes | No (ONNX/.rten) | fp32 primarily | ~2-4 MB | CPU only (GPU planned) | Good | Low-Medium | Active (solo dev) |
| **lm.rs** | Rust | Yes | Custom format | Q4, Q8 | ~1-3 MB | CPU only | Untested | Low | Early stage |

### 2.2 Detailed Engine Assessments

#### Candle (HuggingFace) -- RECOMMENDED

- **Repository**: https://github.com/huggingface/candle
- **Pros**:
  - Pure Rust -- no C/C++ build dependencies, no CMake, no MSVC C++ workload
  - Native GGUF file loading and quantization support (Q2K through Q8K)
  - Proven model architectures: LLaMA, Phi, Qwen, Mistral, Gemma, Falcon
  - Essential crates (candle-core, candle-nn, candle-transformers) compile to very small binaries
  - Benchmark: Phi-2 (2.7B) Q4K on i9-13900H = 468 tok/s; LLaMA2-7B Q4K on RTX-4090 = 186 tok/s
  - Compiled binary for quantized inference: ~38-48 MB standalone (includes runtime); as a library in an existing app, adds ~3-5 MB
  - Actively maintained by HuggingFace with strong community
  - WebAssembly support (future-proofs for potential web-based use)
- **Cons**:
  - Slightly slower than llama.cpp on raw throughput (llama.cpp has years of SIMD/AVX optimization)
  - Fewer SIMD optimizations on Windows x86 compared to llama.cpp
  - Some model architectures may lag behind llama.cpp in support
- **Risk**: Low. Backed by HuggingFace, widely adopted, pure Rust build simplicity is a major advantage for Tauri.

#### llama-cpp-rs (llama-cpp-2 crate)

- **Repository**: https://github.com/utilityai/llama-cpp-rs
- **Pros**:
  - Wraps the industry-leading llama.cpp engine -- best raw performance, most model support
  - Extensive GGUF quantization support, heavily optimized SIMD kernels
  - Vulkan backend for GPU acceleration without CUDA
  - Extremely mature and battle-tested
- **Cons**:
  - Requires C++ compilation toolchain (CMake, MSVC on Windows)
  - Adds significant build complexity to Tauri pipeline
  - C++ dependency means potential ABI issues, harder cross-compilation
  - Binary overhead: ~10-20 MB for the compiled C++ library
  - Debug builds are extremely slow (must always use --release)
  - PATH_MAX issues on Windows with Vulkan feature enabled
- **Risk**: Medium. Build complexity and C++ dependency are the main concerns for a Tauri app.

#### Burn (Tracel)

- **Repository**: https://github.com/tracel-ai/burn
- **Pros**:
  - Pure Rust, no external dependencies
  - ONNX model import (converts to native Burn operations)
  - Quantization support (PTQ 2/4/8-bit) being actively developed
  - Multiple backends: CPU, CUDA, Vulkan, WGPU, WebAssembly
- **Cons**:
  - No GGUF support -- requires ONNX format models
  - LLM support is not the primary focus (more for vision/audio models)
  - Quantization is still early-stage compared to GGUF ecosystem
  - Fewer pre-quantized code models available in ONNX format
  - Would require converting models from GGUF to ONNX, which may lose quality
- **Risk**: Medium-High. Not the best fit for LLM inference specifically.

#### ort (ONNX Runtime bindings)

- **Repository**: https://github.com/pykeio/ort
- **Pros**:
  - Wraps Microsoft's ONNX Runtime -- extremely optimized, production-grade
  - DirectML support on Windows for GPU acceleration without CUDA
  - Broad model support via ONNX format
  - `minimal-build` feature for reduced binary size
- **Cons**:
  - Requires shipping onnxruntime.dll (~15-30 MB depending on features)
  - C library dependency (not pure Rust)
  - Some Windows versions ship conflicting older onnxruntime.dll in System32
  - ONNX models for LLMs are less common than GGUF
  - Quantized LLM models in ONNX are larger than GGUF equivalents
- **Risk**: Medium. DLL dependency and ONNX model availability are concerns.

#### Tract (Sonos)

- **Repository**: https://github.com/sonos/tract
- **Pros**:
  - Pure Rust, no external dependencies
  - Lightweight, designed for embedded/edge use cases
  - Passes 85% of ONNX backend tests
- **Cons**:
  - CPU only -- no GPU acceleration
  - Limited LLM-specific optimizations
  - Quantization limited to i8
  - Not designed for generative LLM inference
  - ONNX format only (same model availability issue as ort/Burn)
- **Risk**: High for LLM use case. Better suited for classification/embedding models.

#### RTen

- **Repository**: https://github.com/robertknight/rten
- **Pros**:
  - Pure Rust, minimal dependencies
  - Good for models under 1B parameters
  - Can load .onnx files directly
- **Cons**:
  - Author explicitly notes it is "not a great choice for LLMs beyond 1B params"
  - CPU only (GPU support planned but not available)
  - Solo developer project
  - Limited LLM architecture support
- **Risk**: High. Not designed for the LLM inference use case at the needed scale.

---

## 3. Model Comparison

### 3.1 Comparison Table

| Model | Params | Q4_K_M Size | License | Code Focus | Shell/CLI Focus | HumanEval (est.) | Availability |
|---|---|---|---|---|---|---|---|
| **Qwen2.5-Coder-1.5B-Instruct** | 1.5B | ~986 MB | Apache 2.0 | Yes (dedicated) | Moderate | ~46-50% | GGUF on HF |
| **Qwen2.5-Coder-0.5B-Instruct** | 0.5B | ~350 MB | Apache 2.0 | Yes (dedicated) | Low | ~30-35% | GGUF on HF |
| **Qwen3-0.6B** | 0.6B | ~397 MB | Apache 2.0 | General + code | Low | ~25-30% | GGUF on HF |
| **Phi-4-Mini-Instruct** | 3.8B | ~2.49 GB | MIT | General + code | Moderate | ~55-65% | GGUF on HF |
| **Phi-3-Mini-4K-Instruct** | 3.8B | ~2.3 GB | MIT | General + code | Moderate | ~55-60% | GGUF on HF |
| **DeepSeek-Coder-1.3B-Instruct** | 1.3B | ~800 MB | Permissive* | Yes (dedicated) | Low | ~35-40% | GGUF on HF |
| **StarCoder2-3B** | 3B | ~1.85 GB | BigCode OpenRAIL-M | Yes (dedicated) | Low | ~45-50% | GGUF on HF |
| **TinyLlama-1.1B-Chat** | 1.1B | ~670 MB | Apache 2.0 | No | No | ~15-20% | GGUF on HF |
| **CodeLlama-7B-Instruct** | 7B | ~4.2 GB | Llama 2 License | Yes (dedicated) | Moderate | ~60-65% | GGUF on HF |

*DeepSeek-Coder uses a custom permissive license allowing commercial use.

### 3.2 Detailed Model Assessments

#### Qwen2.5-Coder-1.5B-Instruct -- RECOMMENDED

- **Why**: Best code-specific model in the ~1B-2B parameter range. Trained on 5.5T tokens with 70% code data across 92 programming languages. The 1.5B variant "rivals the majority of models exceeding 6 billion parameters" per the technical report. Apache 2.0 license is ideal.
- **Shell command quality**: The model understands PowerShell, Bash, CMD, and common CLI patterns. Being code-specialized rather than general-purpose means higher accuracy on the exact task we need.
- **Size**: ~986 MB at Q4_K_M is manageable as a first-use download. Acceptable for users who opt into Agent Mode.
- **Risk**: May struggle with obscure or highly complex compound commands, but should handle 80-90% of common use cases.

#### Qwen2.5-Coder-0.5B-Instruct -- ALTERNATIVE (smaller)

- **Why**: If ~1 GB download is too large, this is a viable fallback at ~350 MB. However, accuracy drops significantly at 0.5B parameters -- expect noticeably worse shell command quality.
- **Risk**: Higher error rate. May generate syntactically valid but semantically wrong commands. For a terminal app, wrong commands are dangerous.

#### Phi-4-Mini-Instruct -- ALTERNATIVE (higher quality)

- **Why**: MIT license, strong general reasoning, good at code. At 3.8B parameters, quality is substantially better than 1.5B models.
- **Drawback**: ~2.5 GB download is large. Inference on CPU will be 2-3x slower than 1.5B model. May push past the 5-second target on lower-end hardware.
- **Risk**: Size and speed may be unacceptable for a terminal app add-on feature.

#### Qwen3-0.6B -- FUTURE CONSIDERATION

- **Why**: Qwen3 architecture has improved reasoning and code generation over Qwen2.5. At 0.6B / ~397 MB, it is very lightweight.
- **Drawback**: General-purpose rather than code-specialized. Released April 2025 -- newer but less battle-tested for code tasks specifically.
- **Risk**: Needs evaluation against Qwen2.5-Coder-1.5B on shell command tasks. May underperform despite newer architecture because it lacks code-specific training focus.

---

## 4. Architecture Options Analysis

### Option A: Ship Model with App
- **Installer size impact**: +986 MB (Q4_K_M for Qwen2.5-Coder-1.5B)
- **Verdict**: REJECTED. A 1 GB installer for a terminal app is unacceptable. Current app target is ~5-8 MB release.

### Option B: Download on First Use -- RECOMMENDED
- **How it works**:
  1. User enables Agent Mode in settings or invokes it for the first time
  2. App shows download progress dialog: "Downloading AI model (986 MB)..."
  3. Model saved to `%LOCALAPPDATA%\Velocity\models\qwen2.5-coder-1.5b-instruct-q4_k_m.gguf`
  4. Subsequent uses load from disk (no internet needed)
- **Installer size impact**: +3-5 MB (Candle inference engine compiled into the Rust binary)
- **Pros**: Small installer, works offline after first download, can update model independently of app
- **Cons**: Requires internet once, needs robust download/resume logic
- **Model updates**: Check hash against a manifest file on app update; re-download only if model version changes.

### Option C: Ultra-Small Fine-Tuned Model (<100 MB)
- **How it works**: Fine-tune Qwen2.5-Coder-0.5B on a NL2Bash/NL2Shell dataset using LoRA, then quantize aggressively.
- **Realistic size**: 200-350 MB at Q4 for 0.5B params. Getting under 100 MB requires ~100-200M params, which is too small for reliable shell command generation.
- **Verdict**: DEFERRED. Interesting as a v2 optimization, but requires:
  - Collecting/curating training data for PowerShell + Bash + CMD
  - LoRA fine-tuning pipeline
  - Evaluation harness for shell command correctness
  - This is a significant ML engineering effort beyond the scope of MVP.

### Option D: Hybrid (Local Simple + API Complex)
- **Verdict**: DEFERRED. Two code paths increase complexity. The primary requirement is fully offline operation. API integration can be a separate optional feature later without affecting the local architecture.

### Recommended Architecture: Option B (Download on First Use)

```
                    Velocity Application
                    +-------------------+
                    |   React Frontend  |
                    |  (Agent Mode UI)  |
                    +--------+----------+
                             | Tauri IPC (invoke)
                    +--------v----------+
                    |    Rust Backend    |
                    |                   |
                    |  +-------------+  |
                    |  | Candle      |  |
                    |  | Inference   |  |  Background thread (tokio::spawn_blocking)
                    |  | Engine      |  |
                    |  +------+------+  |
                    |         |         |
                    +---------|----------+
                              |
                    +---------v---------+
                    | GGUF Model File   |
                    | %LOCALAPPDATA%\   |
                    | Velocity\models\  |
                    +-------------------+
```

---

## 5. Recommended Stack

### Engine: Candle

**Justification**:
1. **Pure Rust** -- integrates seamlessly with Tauri v2's Rust backend. No CMake, no C++ toolchain, no DLL shipping.
2. **Native GGUF loading** -- loads the same quantized model files as llama.cpp.
3. **Small binary overhead** -- adds ~3-5 MB to the release binary, compared to ~10-20 MB for llama.cpp bindings or ~15-30 MB for ONNX Runtime.
4. **Proven model support** -- Qwen2/Qwen2.5, Phi-3/Phi-4, LLaMA, Mistral architectures all supported.
5. **Active maintenance** -- backed by HuggingFace, the de facto hub for ML models.
6. **Acceptable performance** -- while ~10-20% slower than llama.cpp for raw token throughput, for our use case (generating 20-50 tokens for a shell command), the difference is negligible.

### Model: Qwen2.5-Coder-1.5B-Instruct (Q4_K_M)

**Justification**:
1. **Code-specialized** -- trained on 5.5T tokens, 70% code, 92 languages. Outperforms general-purpose models of the same size on code tasks.
2. **Right size** -- 1.5B is the sweet spot. 0.5B is too inaccurate for safety-critical shell commands. 3.8B (Phi-4-Mini) is too large/slow for a responsive terminal feature.
3. **Permissive license** -- Apache 2.0, no restrictions on commercial use or redistribution.
4. **Manageable download** -- ~986 MB at Q4_K_M is a one-time download, comparable to a game patch or VS Code extension.
5. **GGUF availability** -- pre-quantized GGUF files available on HuggingFace, ready to load with Candle.
6. **Instruct-tuned** -- the Instruct variant follows instructions better than the base model, critical for "translate this natural language to a shell command" prompts.

---

## 6. Performance Estimates

### Inference Speed

For a single NL-to-shell-command inference (short input, ~20-50 output tokens):

| Hardware | Estimated Speed | Estimated Latency | Verdict |
|---|---|---|---|
| Modern laptop (i7-13xxx, 8+ cores) | ~30-50 tok/s | **0.5-1.5s** | Excellent |
| Mid-range laptop (i5-12xxx, 6 cores) | ~20-35 tok/s | **1-2.5s** | Good |
| Older laptop (i5-10xxx, 4 cores) | ~10-20 tok/s | **2-5s** | Acceptable |
| Budget laptop (i3/Celeron, 2-4 cores) | ~5-10 tok/s | **5-10s** | Marginal |

These estimates are based on:
- llama.cpp benchmarks for 1-1.5B Q4 models on similar hardware (Candle is ~10-20% slower)
- Llama 3.2 1B achieving ~50 tok/s on AMD Ryzen AI 300 (recent high-end)
- TinyLlama 1.1B Q4_K_M running at 40-60 tok/s on 16-core machines
- Short output length (shell commands are typically 50-200 characters)

**Conclusion**: On modern hardware (90%+ of Windows users), latency will be **under 2 seconds**. On older hardware, a loading indicator should be shown for responses taking 2-5 seconds.

### Memory Usage

| Metric | Value |
|---|---|
| Model file on disk | ~986 MB |
| RAM during inference | ~1.2-1.5 GB (model + KV cache + buffers) |
| RAM after inference (model cached) | ~1.0-1.2 GB |
| RAM if model unloaded | ~0 MB (reclaimed) |

**Strategy**: Load model on first Agent Mode invocation, keep in memory for the session. Unload after configurable idle timeout (e.g., 5 minutes of no Agent Mode use) to reclaim memory. This avoids re-loading latency for repeated use while not permanently consuming 1+ GB.

### Binary Size Impact

| Component | Size Added |
|---|---|
| Candle crates (core, nn, transformers) | ~3-5 MB |
| Tokenizer (HF tokenizers crate) | ~1-2 MB |
| Download/model management code | ~0.1 MB |
| **Total exe size increase** | **~4-7 MB** |
| Current exe size (release) | ~5-8 MB |
| **New exe size (release)** | **~9-15 MB** |

This is acceptable. The model file (~986 MB) is separate and downloaded on demand.

---

## 7. Implementation Plan (High-Level)

### Phase 1: Inference Integration
1. Add Candle crates to `src-tauri/Cargo.toml`:
   - `candle-core` (tensor operations)
   - `candle-nn` (neural network layers)
   - `candle-transformers` (model architectures including Qwen2)
   - `hf-hub` or custom download logic for model fetching
   - `tokenizers` (HuggingFace tokenizer for prompt encoding)
2. Create `src-tauri/src/llm/` module:
   - `mod.rs` -- public API
   - `engine.rs` -- Candle model loading, inference, token generation
   - `download.rs` -- model download with progress reporting
   - `prompt.rs` -- prompt templates for NL-to-shell translation
3. Implement Tauri commands:
   - `translate_to_command(natural_language, shell_type, cwd, os_type) -> String`
   - `download_model(on_progress) -> Result<()>`
   - `check_model_status() -> ModelStatus` (not_downloaded, downloading, ready)

### Phase 2: Prompt Engineering
Design a prompt template that maximizes shell command accuracy:
```
You are a shell command translator. Convert the natural language instruction
to a single {shell_type} command for {os_type}.

Current directory: {cwd}
Shell: {shell_type}

Rules:
- Output ONLY the command, no explanation
- Use correct syntax for {shell_type}
- Prefer built-in commands over external tools
- If the instruction is ambiguous, choose the safest interpretation

Instruction: {user_input}
Command:
```

### Phase 3: Frontend Integration
1. Agent Mode UI trigger (keyboard shortcut or button)
2. Natural language input field
3. Loading indicator during inference
4. Generated command appears in the input editor for review
5. User can edit, accept (execute), or reject

### Phase 4: Model Management
1. First-use download dialog with progress bar
2. Model stored in `%LOCALAPPDATA%\Velocity\models\`
3. Model integrity check (SHA-256 hash verification)
4. Settings page showing model status, size, option to delete/re-download

---

## 8. Risk Assessment

| Risk | Severity | Likelihood | Mitigation |
|---|---|---|---|
| **Wrong shell commands generated** | High | Medium | Always show command for user review before execution. Never auto-execute. Add disclaimer. |
| **Model too slow on older hardware** | Medium | Low | Show loading indicator. Allow timeout. Offer option to use smaller model. |
| **Candle doesn't support Qwen2.5 architecture** | Medium | Very Low | Candle already supports Qwen2/Qwen2.5. Fallback: use Phi-3-Mini which is confirmed supported. |
| **1 GB download deters users** | Medium | Medium | Make Agent Mode opt-in. Show size clearly before download. Offer smaller model option. |
| **Memory usage impacts terminal performance** | Medium | Low | Lazy load model, unload after idle timeout. Run inference on background thread via tokio::spawn_blocking. |
| **Model updates break compatibility** | Low | Low | Version model files with hashes. Only update when app update explicitly requires it. |
| **Candle project abandoned** | Low | Very Low | HuggingFace-backed. Fallback: migrate to llama-cpp-rs (same GGUF models, different engine). |
| **Windows Defender flags model download** | Low | Low | Sign the download. Use HTTPS. Store in AppData (standard location). |
| **Prompt injection via model output** | Medium | Low | Treat model output as untrusted text, display for review only, never auto-execute. Sanitize for display. |

---

## 9. Alternatives Considered and Rejected

### Ollama / LM Studio / Local Server
- Rejected: Requires external software installation. Violates "no external dependencies" requirement.

### Python-based inference (transformers, vLLM)
- Rejected: Requires Python runtime. Massive dependency. Not Rust-native.

### WebLLM / Browser-based inference
- Rejected: Tauri's webview has limited WebGPU support. Performance would be poor.

### Cloud API with local fallback
- Rejected for MVP: Adds complexity. Local-first is the requirement. API integration can come later as an optional enhancement.

### Shipping llama.cpp as a sidecar binary
- Considered but rejected: Adds ~50-100 MB to installer for the llama.cpp executable. More complex process management. Candle integrated directly is simpler.

---

## 10. Open Questions for CTO Decision

1. **Model size tolerance**: Is ~986 MB download acceptable? If not, the 0.5B variant at ~350 MB is available but with lower quality.
2. **Memory budget**: Is ~1.2 GB RAM for the loaded model acceptable? This is comparable to a single Chrome tab.
3. **Auto-download vs. manual**: Should model download be triggered automatically on first Agent Mode use, or require explicit opt-in in settings?
4. **Fallback model**: Should we ship a tiny fallback model (~350 MB) for basic commands and download the larger model for complex ones?
5. **Telemetry**: Should we collect anonymized accuracy feedback (user accepted vs. rejected the suggestion) to inform future model selection?

---

## 11. References

- [Candle - HuggingFace Rust ML Framework](https://github.com/huggingface/candle)
- [llama-cpp-2 Rust crate](https://crates.io/crates/llama-cpp-2)
- [Burn - Rust Deep Learning Framework](https://github.com/tracel-ai/burn)
- [ort - ONNX Runtime Rust bindings](https://github.com/pykeio/ort)
- [Tract - Rust ONNX/TF inference](https://github.com/sonos/tract)
- [RTen - Rust ONNX inference](https://github.com/robertknight/rten)
- [lm.rs - Minimal Rust LLM inference](https://github.com/samuel-vitorino/lm.rs)
- [Crane - Candle-based LLM engine](https://github.com/lucasjinreal/Crane)
- [Qwen2.5-Coder-1.5B-Instruct-GGUF](https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF)
- [Phi-4-Mini-Instruct-GGUF](https://huggingface.co/unsloth/Phi-4-mini-instruct-GGUF)
- [Qwen2.5-Coder Technical Report](https://arxiv.org/html/2409.12186v1)
- [Qwen2.5-Coder Series Blog](https://qwenlm.github.io/blog/qwen2.5-coder-family/)
- [Running Phi-3 on CPU with Rust & Candle](https://dev.to/hossein-mortazavi/running-microsofts-phi-3-on-cpu-with-rust-candle-md)
- [Building Local LM Desktop Apps with Tauri](https://medium.com/@dillon.desilva/building-local-lm-desktop-applications-with-tauri-f54c628b13d9)
- [Local-First AI with Rust and Tauri](https://medium.com/@Musbell008/a-technical-blueprint-for-local-first-ai-with-rust-and-tauri-b9211352bc0e)
- [Building LLM Applications with Rust: Candle and llm Crates](https://dasroot.net/posts/2026/01/building-llm-applications-rust-candle-llm-crates/)
- [NL2Bash - LLM-Supported Translation (2025)](https://arxiv.org/html/2502.06858v1)
- [DeepSeek-Coder Repository](https://github.com/deepseek-ai/DeepSeek-Coder)
- [StarCoder2 Repository](https://github.com/bigcode-project/starcoder2)
- [Qwen3-0.6B-GGUF](https://huggingface.co/Qwen/Qwen3-0.6B-GGUF)
- [TinyLlama-1.1B-Chat GGUF](https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF)
- [llama.cpp Performance Testing](https://johannesgaessler.github.io/llamacpp_performance)
- [AMD Ryzen AI llama.cpp Performance](https://www.amd.com/en/blogs/2024/accelerating-llama-cpp-performance-in-consumer-llm.html)
